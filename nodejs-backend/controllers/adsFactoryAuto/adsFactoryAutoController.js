const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
const Campaign      = require("../../Module/adFactory/adFactory");
const FBUsers       = require('../../Module/adPosting/facebookUsers');
const { CELLS, CTA_LABELS } = require("../../config/wizardSchema");
const { scheduleJob, cancelJob, runJobNow, resolveScheduleForQueue, resolvePresetCron, resolveInclusiveEndDate, getNextRunTime } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");
const {
  createJobSchema,
  updateJobSchema,
  EDITABLE_META_PAYLOAD_FIELDS,
  EDITABLE_GOOGLE_PAYLOAD_FIELDS,
} = require("../../Validations/adsFactoryAuto/adsFactoryAutoValidation");
const logger = require("../../utils/logger");
const { _runningJobs } = require("../../services/adsFactoryAuto/adsFactoryAutoOrchestrator");
const UnifiedCreditController = require("../UnifiedCreditController");
const { getCreditDeduction, imageEntries } = require("../../config/modelRegistry");

async function ownsFacebookConnection(userId, target) {
  if (!target?.facebookId || !target?.connectionId) return false;
  const rawUserId = userId?.includes('-')
    ? userId.split('-').slice(1).join('-')
    : userId;
  return !!(await FBUsers.exists({
    _id: target.connectionId,
    facebookId: target.facebookId,
    userId: { $in: [...new Set([userId, rawUserId].filter(Boolean))] },
  }));
}

function isJobRunLocked(job) {
  if (!job?._id) return false;
  if (_runningJobs.has(job._id.toString())) return true;
  const expiresAt = job.runLock?.expiresAt ? new Date(job.runLock.expiresAt) : null;
  return !!(expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt > new Date());
}

// ─── Controller ───────────────────────────────────────────────────────────────

class AdsFactoryAutoController {

  async createJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Create autopilot job'
      #swagger.description = 'Create a new autopilot job that automatically generates and posts ad creatives on a schedule.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/createAutopilotJobPayload" }
          }
        }
      }
    */
    let createdJob = null;
    let campaignLinked = false;
    try {
      const { error, value } = createJobSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details.map((d) => d.message).join("; "),
        });
      }

      const userId = req.user.user_id;

      const campaign = await Campaign.findOne({ _id: value.campaignId, userId }).lean();
      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: "Campaign not found or does not belong to this user",
        });
      }

      const existingLiveJob = await AdsFactoryJob.findOne({
        userId,
        campaignId: value.campaignId,
        status: { $nin: ["completed", "archived"] },
      }).select("_id status").lean();
      if (existingLiveJob) {
        return res.status(409).json({
          success: false,
          error: `This campaign already has a ${existingLiveJob.status} automation job. Update or archive it instead of creating a duplicate.`,
          jobId: existingLiveJob._id,
        });
      }

      if (value.targets?.meta && !(await ownsFacebookConnection(userId, value.targets.meta))) {
        return res.status(403).json({
          success: false,
          error: 'The selected Facebook account is not connected to this AdsGPT user',
        });
      }

      // Resolve and store cron for preset frequencies
      const resolvedCron = resolvePresetCron(value.schedule.frequency, value.schedule.hour) || null;

      const lifecycleKey = `${userId}:${value.campaignId}`;
      const job = await AdsFactoryJob.create({
        userId,
        campaignId:     value.campaignId,
        lifecycleKey,
        schedule: {
          ...value.schedule,
          cronExpression: resolvedCron,
        },
        pairsPerCycle: value.pairsPerCycle ?? 1,
        model:         value.model         ?? null,
        targets:        value.targets ?? {},
        alerts:         value.alerts  ?? {},
        status:         "active",
      });
      createdJob = job;

      await scheduleJob(job._id, resolveScheduleForQueue(job.schedule));

      const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
      if (nextTime) {
        job.schedule.nextRunAt = nextTime;
        await job.save();
      }

      // Link the campaign back to its automation job. The campaign schema has
      // carried a `metadata.jobId` field since automation was introduced
      // (Module/adFactory/adFactory.js) precisely for this, but nothing ever
      // populated it — so it stayed null and the campaign looked "manual".
      // Store it here at job creation so the campaign is tagged from the start.
      await Campaign.updateOne(
        { _id: value.campaignId },
        { $set: { "metadata.jobId": job._id.toString() } }
      );
      campaignLinked = true;

      return res.status(201).json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:createJob] ${err.message}`);
      if (createdJob?._id) {
        await cancelJob(createdJob._id.toString()).catch(() => {});
        await AdsFactoryJob.deleteOne({ _id: createdJob._id }).catch(() => {});
        if (campaignLinked) {
          await Campaign.updateOne(
            { _id: createdJob.campaignId, "metadata.jobId": createdJob._id.toString() },
            { $unset: { "metadata.jobId": 1 } },
          ).catch(() => {});
        }
      }
      const duplicate = err?.code === 11000;
      return res.status(duplicate ? 409 : 500).json({
        success: false,
        error: duplicate
          ? "This campaign already has an automation job. Update or archive it instead of creating a duplicate."
          : err.message,
      });
    }
  }

  async getJobs(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'List autopilot jobs'
      #swagger.description = 'Retrieve a paginated list of autopilot jobs for the authenticated user.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['status'] = { description: 'Filter by job status', type: 'string', enum: ['active', 'paused', 'completed'] }
      #swagger.parameters['skip'] = { description: 'Number of items to skip (default: 0)', type: 'integer', default: 0 }
      #swagger.parameters['limit'] = { description: 'Items to return (default: 20)', type: 'integer', default: 20 }
    */
    try {
      const userId = req.user.user_id;
      const { status, campaignId, skip = 0, limit = 20 } = req.query;

      const filter = { userId };
      // Archived (soft-deleted) jobs are hidden from the default list — pass
      // ?status=archived explicitly to see them.
      if (status) filter.status = status;
      else filter.status = { $ne: "archived" };
      if (campaignId) filter.campaignId = campaignId;

      const skipNum = Number(skip);
      const limitNum = Number(limit);
      const [jobs, total] = await Promise.all([
        AdsFactoryJob.find(filter)
          .select("-runHistory")
          .populate("campaignId", "metadata brandInfo distribution status")
          .sort({ createdAt: -1 })
          .skip(skipNum)
          .limit(limitNum)
          .lean(),
        AdsFactoryJob.countDocuments(filter),
      ]);

      jobs.forEach((job) => {
        if (job.targets && job.targets.meta && typeof job.targets.meta.adSetId === "string") {
          job.targets.meta.adSetId = job.targets.meta.adSetId ? [job.targets.meta.adSetId] : [];
        }
      });

      return res.json({ success: true, total, skip: skipNum, limit: limitNum, data: jobs });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getJobs] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Get autopilot job'
      #swagger.description = 'Retrieve a single autopilot job by ID.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select("-runHistory")
        .populate("campaignId")
        .lean();
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      if (job.schedule && job.status === "active") {
        try {
          const { getNextRunTime } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");
          const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
          if (nextTime) job.schedule.nextRunAt = nextTime;
        } catch (e) {}
      }
      if (job.targets && job.targets.meta && typeof job.targets.meta.adSetId === "string") {
        job.targets.meta.adSetId = job.targets.meta.adSetId ? [job.targets.meta.adSetId] : [];
      }

      return res.json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Update autopilot job'
      #swagger.description = 'Partially update an autopilot job. At least one field must be provided. Updating the schedule reschedules the underlying queue job.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
      #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/updateAutopilotJobPayload" }
          }
        }
      }
    */
    let scheduleRollback = null;
    try {
      const { error, value } = updateJobSchema.validate(req.body, { abortEarly: false });
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details.map((d) => d.message).join("; "),
        });
      }

      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId });
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      if (job.status === "completed") {
        return res.status(409).json({
          success: false,
          error: "This job has already completed. You cannot edit a completed job — please create a new one instead.",
        });
      }

      const isRunning = isJobRunLocked(job);
      if (isRunning) {
        return res.status(409).json({
          success: false,
          error: "This job is currently running. Editing it now would cause a duplicate posting — please wait for the current run to finish before making changes.",
        });
      }

      // Validate the targets diff BEFORE mutating `job` at all — a rejected
      // request must leave the in-memory document (and therefore the DB,
      // since nothing is saved yet) completely untouched.
      // Platforms being newly added by this request (no existing template on
      // the job) — these accept a full template, since there's nothing to
      // diff against yet. Platforms that already have a template are still
      // restricted to editing budget/CTA/link only (see below).
      const newlyAddedPlatforms = new Set();

      if (value.targets !== undefined) {
        const incomingMetaHasConnection = !!(
          value.targets.meta?.facebookId || value.targets.meta?.connectionId
        );
        const isAddingMeta = !!(
          value.targets.meta && !job.targets.meta?.template
        );
        if (
          value.targets.meta &&
          (incomingMetaHasConnection || isAddingMeta) &&
          !(await ownsFacebookConnection(userId, value.targets.meta))
        ) {
          return res.status(403).json({
            success: false,
            error: 'The selected Facebook account is not connected to this AdsGPT user',
          });
        }
        // The frontend may send back the full job object it already has (so
        // it doesn't need to hand-pick fields), but only budget/CTA/link are
        // actually editable on an EXISTING platform template — the
        // campaign/ad group/ad structure was fixed when that template was
        // first used. Any non-editable field that differs from the saved
        // value is rejected by name; fields echoed back unchanged are
        // accepted silently either way. A platform with no existing template
        // is a brand-new addition and accepts its full template as-is.
        const EDITABLE_FIELDS = { meta: EDITABLE_META_PAYLOAD_FIELDS, google: EDITABLE_GOOGLE_PAYLOAD_FIELDS };
        const rejections = [];

        for (const [platform, targetData] of Object.entries(value.targets)) {
          const savedTemplate = job.targets[platform]?.template;
          if (!savedTemplate) {
            newlyAddedPlatforms.add(platform);
            continue; // new platform — full template accepted, nothing to diff
          }

          if (
            platform === 'meta' &&
            job.targets.meta?.facebookId &&
            (targetData.facebookId !== undefined || targetData.connectionId !== undefined)
          ) {
            if (
              String(targetData.facebookId || '') !== String(job.targets.meta.facebookId) ||
              String(targetData.connectionId || '') !== String(job.targets.meta.connectionId)
            ) {
              rejections.push('targets.meta Facebook connection cannot be changed');
            }
          }

          // The campaign name is normally locked — renaming wouldn't rename the
          // already-created platform campaign (which is reused by
          // createdCampaignId), so it would only cause confusion. BUT when this
          // platform has NOT yet created a campaign (no createdCampaignId — e.g.
          // the job auto-paused on its FIRST run due to a duplicate-name
          // collision), renaming IS safe and is the intended recovery, so allow
          // it. The name is stored in the payload as both `name` and
          // `campaignName` (the frontend writes both); it may also arrive as a
          // top-level template.name. Unlock all three in that case.
          const hasCreatedCampaign = !!job.targets[platform]?.createdCampaignId;
          const nameKeys = ["name", "campaignName"];

          // Top-level template fields (name, objective, conversionLocation, pageId/customerId)
          const lockedTopLevel = hasCreatedCampaign
            ? ["name", "objective", "conversionLocation", "pageId", "customerId"]
            : ["objective", "conversionLocation", "pageId", "customerId"];
          const incomingTemplate = targetData.template || {};
          for (const key of lockedTopLevel) {
            if (incomingTemplate[key] === undefined) continue;
            const savedVal = savedTemplate[key] ?? "";
            const incomingVal = incomingTemplate[key] ?? "";
            if (String(savedVal) !== String(incomingVal)) {
              rejections.push(`targets.${platform}.template.${key} cannot be changed`);
            }
          }

          // Payload fields — only EDITABLE_FIELDS[platform] (plus the campaign
          // name, when no campaign has been created yet) may actually differ.
          const savedPayload    = savedTemplate.payload || {};
          const incomingPayload = incomingTemplate.payload || {};
          const editableSet = new Set(EDITABLE_FIELDS[platform] || []);
          if (!hasCreatedCampaign) nameKeys.forEach((k) => editableSet.add(k));
          for (const key of Object.keys(incomingPayload)) {
            if (editableSet.has(key)) continue;
            const savedVal = savedPayload[key] ?? "";
            const incomingVal = incomingPayload[key] ?? "";
            if (String(savedVal) !== String(incomingVal)) {
              rejections.push(`targets.${platform}.template.payload.${key} cannot be changed`);
            }
          }
        }

        if (rejections.length) {
          return res.status(400).json({
            success: false,
            error: `The following fields cannot be edited on an existing job: ${rejections.join("; ")}`,
          });
        }
      }

      // Validation passed (or no targets were sent) — now safe to mutate.
      if (value.pairsPerCycle !== undefined) job.pairsPerCycle = value.pairsPerCycle;
      if (value.model         !== undefined) job.model         = value.model;

      // Alert recipients — merge (PATCH semantics): only overwrite emailTo when
      // it was sent, so an update that omits `alerts` leaves recipients intact.
      if (value.alerts !== undefined) {
        if (!job.alerts) job.alerts = {};
        if (value.alerts.emailTo !== undefined) job.alerts.emailTo = value.alerts.emailTo;
        job.markModified("alerts");
      }

      if (value.targets !== undefined) {
        const EDITABLE_FIELDS = { meta: EDITABLE_META_PAYLOAD_FIELDS, google: EDITABLE_GOOGLE_PAYLOAD_FIELDS };
        for (const [platform, targetData] of Object.entries(value.targets)) {
          if (newlyAddedPlatforms.has(platform)) {
            // Brand-new platform on this job — save its full template as-is.
            if (!job.targets[platform]) job.targets[platform] = {};
            if (platform === 'meta') {
              job.targets[platform].facebookId = targetData.facebookId;
              job.targets[platform].connectionId = targetData.connectionId;
            }
            job.targets[platform].template = targetData.template;
            continue;
          }
          if (
            platform === 'meta' &&
            !job.targets.meta?.facebookId &&
            targetData.facebookId &&
            targetData.connectionId
          ) {
            job.targets.meta.facebookId = targetData.facebookId;
            job.targets.meta.connectionId = targetData.connectionId;
          }
          const editableSet = new Set(EDITABLE_FIELDS[platform] || []);
          // Campaign name is editable only while no campaign has been created
          // yet (recovery from a first-run duplicate-name collision). Mirrors
          // the validation gate above.
          const hasCreatedCampaign = !!job.targets[platform]?.createdCampaignId;
          if (!hasCreatedCampaign) { editableSet.add("name"); editableSet.add("campaignName"); }
          for (const key of Object.keys(targetData.template.payload || {})) {
            if (editableSet.has(key)) {
              job.targets[platform].template.payload[key] = targetData.template.payload[key];
            }
          }
          // Also apply a top-level template.name rename when allowed.
          if (!hasCreatedCampaign && targetData.template?.name !== undefined) {
            job.targets[platform].template.name = targetData.template.name;
          }
        }
        job.markModified("targets");

        // If a Google campaign already exists for this job (created on a prior
        // run), push the campaign-level budget change to Google now instead of
        // waiting for the next run. Name is intentionally excluded — never
        // renamed. lifetimeBudget/cpcBid/finalUrl are ad-group/ad-level, not
        // campaign-level — they aren't pushed here because there's nothing to
        // push to yet; they take effect naturally on the next run, since the
        // orchestrator always builds a fresh ad group + ads from the saved
        // template payload every run.
        const googleCampaignId = job.targets.google?.createdCampaignId;
        const googlePayload    = value.targets.google?.template?.payload;
        if (googleCampaignId && googlePayload) {
          try {
            const googleAdController = require("../adPosting/googleAdController");
            const adAccountId = job.targets.google.template.payload.adAccountId || job.targets.google.template.customerId;
            const dailyBudgetMicros = googlePayload.dailyBudgetMicros
              ?? (googlePayload.dailyBudget != null ? Math.round(Number(googlePayload.dailyBudget) * 1_000_000) : undefined);
            const updateReq = {
              body: { adAccountId, campaignId: googleCampaignId, dailyBudgetMicros },
              user: { user_id: userId },
            };
            let updateStatus = 200, updateBody = null;
            const updateRes = {
              status: (code) => { updateStatus = code; return updateRes; },
              json:   (data)  => { updateBody = data; return updateRes; },
            };
            await googleAdController.updateCampaignAPI(updateReq, updateRes);
            if (updateStatus >= 400) {
              logger.warn(`[adsFactoryAuto:updateJob] Google campaign sync failed: ${updateBody?.error || "unknown error"}`);
            } else {
              logger.info(`[adsFactoryAuto:updateJob] synced budget change to existing Google campaign ${googleCampaignId}`);
            }
          } catch (e) {
            logger.warn(`[adsFactoryAuto:updateJob] Google campaign sync failed: ${e.message}`);
          }
        }
      }

      if (value.schedule) {
        const previousSchedule = job.schedule?.toObject
          ? job.schedule.toObject()
          : { ...(job.schedule || {}) };
        const resolvedCron = resolvePresetCron(value.schedule.frequency, value.schedule.hour) || null;
        const nextSchedule = {
          ...previousSchedule,
          ...value.schedule,
          cronExpression: resolvedCron,
        };
        if (job.status === "active") {
          try {
            await scheduleJob(job._id, resolveScheduleForQueue(nextSchedule));
          } catch (scheduleError) {
            await scheduleJob(job._id, resolveScheduleForQueue(previousSchedule)).catch((rollbackError) => {
              logger.error(`[adsFactoryAuto:updateJob] failed to restore previous schedule: ${rollbackError.message}`);
            });
            throw scheduleError;
          }
          scheduleRollback = { jobId: job._id.toString(), previousSchedule };
        } else {
          await cancelJob(job._id.toString());
        }
        Object.assign(job.schedule, nextSchedule);
      }

      const nextTime = job.status === "active"
        ? await getNextRunTime(job._id.toString(), job.schedule)
        : null;
      if (nextTime) job.schedule.nextRunAt = nextTime;
      else job.schedule.nextRunAt = null;
      await job.save();
      scheduleRollback = null;

      return res.json({ success: true, data: job });
    } catch (err) {
      if (scheduleRollback) {
        await scheduleJob(
          scheduleRollback.jobId,
          resolveScheduleForQueue(scheduleRollback.previousSchedule),
        ).catch((rollbackError) => {
          logger.error(`[adsFactoryAuto:updateJob] DB save failed and previous schedule could not be restored: ${rollbackError.message}`);
        });
      }
      logger.error(`[adsFactoryAuto:updateJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Delete (archive) autopilot job'
      #swagger.description = 'Soft-deletes an autopilot job — sets status to "archived" and cancels its scheduled queue entry. The job document and its full runHistory are preserved so campaign-level activity/history views keep showing past runs. Archived jobs are excluded from the normal active job list.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId });
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      if (isJobRunLocked(job)) {
        return res.status(409).json({
          success: false,
          error: "This job is currently running. Deleting it now could cause incomplete postings — please wait for the current run to finish before deleting.",
        });
      }

      // Soft-delete: archive instead of removing the document, so runHistory
      // (generated creatives, errors, posting outcomes) is never lost —
      // campaign-level activity/history views continue to show past runs
      // even after the job that created them is "deleted" by the user.
      await AdsFactoryJob.updateOne(
        { _id: req.params.id, userId },
        {
          $set: { status: "archived", "schedule.nextRunAt": null },
          $unset: { lifecycleKey: 1 },
        }
      );
      await cancelJob(req.params.id);
      if (job.campaignId) {
        const stuckCampaign = await Campaign.findOne(
          { _id: job.campaignId, $or: [{ status: "in-progress" }, { "results.status": "in-progress" }] },
          { "results.text": 1, "results.image": 1 }
        ).lean();
        if (stuckCampaign) {
          const hadSuccess =
            (stuckCampaign.results?.text  || []).some((t) => t.status === 200) ||
            (stuckCampaign.results?.image || []).some((i) => i.status === 200);
          await Campaign.updateOne(
            { _id: job.campaignId },
            { $set: { status: hadSuccess ? "success" : "draft", "results.status": hadSuccess ? "success" : "draft" } }
          );
        }
      }
      return res.json({ success: true, message: "Job archived" });
    } catch (err) {
      logger.error(`[adsFactoryAuto:deleteJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async pauseJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Pause autopilot job'
      #swagger.description = 'Pause an active autopilot job, preventing further scheduled executions until resumed.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId });
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });
      if (job.status === "paused") {
        const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
        if (nextTime) job.schedule.nextRunAt = nextTime;
        return res.json({ success: true, message: "Already paused", data: job });
      }

      if (isJobRunLocked(job)) {
        return res.status(409).json({
          success: false,
          error: "This job is currently running. Please wait for the current run to finish, then pause it.",
        });
      }

      job.status = "paused";
      await job.save();
      await cancelJob(job._id.toString());
      if (job.campaignId) {
        const stuckCampaign = await Campaign.findOne(
          { _id: job.campaignId, $or: [{ status: "in-progress" }, { "results.status": "in-progress" }] },
          { "results.text": 1, "results.image": 1 }
        ).lean();
        if (stuckCampaign) {
          const hadSuccess =
            (stuckCampaign.results?.text  || []).some((t) => t.status === 200) ||
            (stuckCampaign.results?.image || []).some((i) => i.status === 200);
          await Campaign.updateOne(
            { _id: job.campaignId },
            { $set: { status: hadSuccess ? "success" : "draft", "results.status": hadSuccess ? "success" : "draft" } }
          );
        }
      }
      const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
      if (nextTime) {
        job.schedule.nextRunAt = nextTime;
        await job.save();
      }

      return res.json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:pauseJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async resumeJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Resume autopilot job'
      #swagger.description = 'Resume a paused autopilot job, re-scheduling it based on its original schedule.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId });
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });
      if (job.status === "active") {
        const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
        if (nextTime) job.schedule.nextRunAt = nextTime;
        return res.json({ success: true, message: "Already active", data: job });
      }
      if (job.status === "completed") {
        return res.status(400).json({ success: false, error: "Cannot resume a completed job" });
      }
      job.status = "active";
      await scheduleJob(job._id, resolveScheduleForQueue(job.schedule));
      const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
      if (nextTime) job.schedule.nextRunAt = nextTime;
      await job.save();

      return res.json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:resumeJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async runNow(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Run job immediately'
      #swagger.description = 'Queue an autopilot job for immediate execution, independent of its regular schedule.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId }).lean();
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      if (job.status === "paused") {
        return res.status(400).json({ success: false, error: "Cannot run a paused job. Resume it first." });
      }
      if (job.status === "completed") {
        return res.status(400).json({ success: false, error: "Cannot run a completed job." });
      }
      if (isJobRunLocked(job)) {
        return res.status(409).json({
          success: false,
          error: "This job is already running right now. Please wait for the current run to finish before triggering another one.",
        });
      }

      await runJobNow(req.params.id);
      return res.json({ success: true, message: "Job queued for immediate execution" });
    } catch (err) {
      logger.error(`[adsFactoryAuto:runNow] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async testAlertEmail(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Send a test alert email'
      #swagger.description = 'Sends a plain confirmation email to whatever address the caller provides. Fully independent of any automation, job, or campaign — works at any time.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['body'] = {
        in: 'body',
        description: 'Test email request',
        required: true,
        schema: {
          to: 'alice@example.com'
        }
      }
    */
    try {
      const { sendEmail, parseEmailRecipients } =
        require("../../services/adsFactoryAuto/adsFactoryAlertService");

      const explicitTo = req.body?.to || req.query?.to || null;
      const recipients = parseEmailRecipients(explicitTo);
      if (!recipients.length) {
        return res.status(400).json({
          success: false,
          error: "No email address provided. Enter one (or up to 5, comma-separated) and try again.",
        });
      }

      const now = new Date();
      const bodyLines = [
        `AdsGPT Ads Factory — test email`,
        `sent: ${now.toISOString()}`,
        ``,
        `This is a test of the alert email for Ads Factory automations.`,
        `If you received this, alert emails are working correctly. You'll get`,
        `an email like this every time an automation finishes a run.`,
      ];

      const result = await sendEmail({
        to: recipients,
        subject: `AdsGPT Ads Factory — test email`,
        text: bodyLines.join("\n"),
      });

      return res.status(result.sent ? 200 : 500).json({
        success: !!result.sent,
        to:      recipients,
        ...result,
      });
    } catch (err) {
      logger.error(`[adsFactoryAuto:testAlertEmail] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getCtaOptions(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Get CTA options for an objective'
      #swagger.description = 'Returns allowed call-to-action values for the given objective, sourced from the wizard schema.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['objective'] = { description: 'Campaign objective key e.g. OUTCOME_TRAFFIC, OUTCOME_LEADS', type: 'string', required: true }
    */
    try {
      const { objective } = req.query;
      if (!objective) {
        return res.status(400).json({ success: false, error: "objective is required" });
      }

      const locations = CELLS[objective];
      if (!locations) {
        return res.status(404).json({ success: false, error: `No CTAs found for objective: ${objective}` });
      }

      const seen = new Set();
      for (const cell of Object.values(locations)) {
        if (cell.placeholder || !cell.ctas) continue;
        for (const cta of cell.ctas.allowed) seen.add(cta);
      }

      const options = [...seen].map((value) => ({
        value,
        label: CTA_LABELS[value] ?? value,
      }));

      return res.json({ success: true, objective, data: options });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getCtaOptions] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getRunHistory(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Get run history — by job or by campaign'
      #swagger.description = 'Retrieve paginated run history, newest-first. Pass a job ObjectId in :id for a single job'\''s history. Pass an Ads Factory campaignId in :id to get every autopilot job ever created for that campaign, each with its own paginated history — covers the full automation lifetime across job restarts, not just the currently-active job.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId OR Ads Factory campaignId', type: 'string', required: true }
      #swagger.parameters['page'] = { description: 'Page number (default: 1)', type: 'integer', default: 1 }
      #swagger.parameters['limit'] = { description: 'Items per page (default: 20)', type: 'integer', default: 20 }
    */
    try {
      const userId = req.user.user_id;
      const { page = 1, limit = 20 } = req.query;
      const skip  = (Number(page) - 1) * Number(limit);
      const SELECT = "campaignId runHistory totalRuns failedRuns status createdAt";

      // :id is a job ObjectId first; if no job matches, treat it as a
      // campaignId and return every autopilot job ever created for that
      // campaign — so pausing/deleting a job and starting a new one for the
      // same campaign doesn't hide the earlier job's history from this view.
      const jobById = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select(SELECT).lean();

      let jobs;
      let idType;
      if (jobById) {
        jobs = [jobById];
        idType = "jobId";
      } else {
        jobs = await AdsFactoryJob.find({ campaignId: req.params.id, userId })
          .select(SELECT).sort({ createdAt: -1 }).lean();
        if (!jobs.length) {
          return res.status(404).json({ success: false, error: "No job or campaign found for this id" });
        }
        idType = "campaignId";
      }

      const buildHistoryPage = (job) => {
        const allRuns = [...(job.runHistory || [])].reverse();
        const data = allRuns.slice(skip, skip + Number(limit)).map((run) => ({
          runId:       run.runId,
          status:      run.status, // "success" | "failed" | "partial" | "skipped"
          startedAt:   run.startedAt,
          completedAt: run.completedAt,
          durationMs:  (run.startedAt && run.completedAt) ? new Date(run.completedAt) - new Date(run.startedAt) : null,
          // The cause when a run failed/partially failed — null on a clean success.
          error: run.error || null,
          platformAdIds: run.platformAdIds
            ? (run.platformAdIds instanceof Map ? Object.fromEntries(run.platformAdIds) : run.platformAdIds)
            : {},
          // What Autopilot actually generated + attempted to post this run.
          generatedCreatives: (run.automationCreatives || []).map((c) => ({
            creativeId:   c.creativeId,
            meta:         c.platformText?.meta   || null,
            google:       c.platformText?.google || null,
            description:  c.description || null,
            imageUrl: c.imageUrl
              ? (c.imageUrl.startsWith("http")
                  ? c.imageUrl
                  : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${c.imageUrl.startsWith("/") ? "" : "/"}${c.imageUrl}`)
              : null,
            callToAction: c.callToAction || null,
            linkUrl:      c.linkUrl || null,
            platform:     c.platform || null,
          })),
        }));
        return {
          jobId:      job._id,
          jobStatus:  job.status,
          createdAt:  job.createdAt,
          total:      job.totalRuns || (job.runHistory || []).length,
          failedRuns: job.failedRuns || 0,
          page:       Number(page),
          data,
        };
      };

      if (idType === "jobId") {
        const single = buildHistoryPage(jobs[0]);
        return res.json({ success: true, ...single });
      }

      // campaignId lookup — one entry per job, newest job first
      const perJob = jobs.map(buildHistoryPage);
      return res.json({
        success:    true,
        campaignId: req.params.id,
        totalJobs:  perJob.length,
        jobs:       perJob,
      });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getRunHistory] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getStats(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Overall autopilot stats'
      #swagger.description = 'Aggregate run statistics across all autopilot jobs belonging to the authenticated user.'
      #swagger.security = [{ "BearerAuth": [] }]
    */
    try {
      const userId = req.user.user_id;

      const [jobCounts, runAgg] = await Promise.all([
        // Count of jobs per status
        AdsFactoryJob.aggregate([
          { $match: { userId } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),

        // Run totals + per-status breakdown across all jobs
        AdsFactoryJob.aggregate([
          { $match: { userId } },
          { $unwind: { path: "$runHistory", preserveNullAndEmptyArrays: false } },
          {
            $group: {
              _id:          null,
              totalRuns:    { $sum: 1 },
              successRuns:  { $sum: { $cond: [{ $eq: ["$runHistory.status", "success"]  }, 1, 0] } },
              partialRuns:  { $sum: { $cond: [{ $eq: ["$runHistory.status", "partial"]  }, 1, 0] } },
              failedRuns:   { $sum: { $cond: [{ $eq: ["$runHistory.status", "failed"]   }, 1, 0] } },
              skippedRuns:  { $sum: { $cond: [{ $eq: ["$runHistory.status", "skipped"]  }, 1, 0] } },
              avgDurationMs: {
                $avg: {
                  $cond: [
                    { $and: ["$runHistory.startedAt", "$runHistory.completedAt"] },
                    { $subtract: ["$runHistory.completedAt", "$runHistory.startedAt"] },
                    null,
                  ],
                },
              },
              lastRunAt:    { $max: "$runHistory.completedAt" },
              // Count runs that produced at least one platform ad ID (i.e. actually posted)
              postedCount:  {
                $sum: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: [{ $objectToArray: { $ifNull: ["$runHistory.platformAdIds", {}] } }, []] } }, 0] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

      // ── Build job status map ─────────────────────────────────────────────────
      const jobsByStatus = { active: 0, paused: 0, completed: 0, failed: 0, draft: 0, archived: 0 };
      let totalJobs = 0;
      for (const row of jobCounts) {
        jobsByStatus[row._id] = row.count;
        totalJobs += row.count;
      }

      // ── Build run summary ────────────────────────────────────────────────────
      const run = runAgg[0] || {
        totalRuns: 0, successRuns: 0, partialRuns: 0,
        failedRuns: 0, skippedRuns: 0, avgDurationMs: 0, lastRunAt: "", postedCount: 0,
      };
      delete run._id;

      const successRate = run.totalRuns > 0
        ? +((run.successRuns / run.totalRuns) * 100).toFixed(1)
        : 0;

      return res.json({
        success: true,
        data: {
          jobs: {
            total:    totalJobs,
            byStatus: jobsByStatus,
          },
          runs: {
            total:        run.totalRuns,
            success:      run.successRuns,
            partial:      run.partialRuns,
            failed:       run.failedRuns,
            skipped:      run.skippedRuns,
            successRate:  `${successRate}%`,
            postedCount:  run.postedCount || 0,
            avgDurationMs: run.avgDurationMs !== null ? Math.round(run.avgDurationMs) : 0,
            lastRunAt:    run.lastRunAt || "",
          },
        },
      });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getStats] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async getJobStats(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Single job stats'
      #swagger.description = 'Detailed run statistics for a specific autopilot job, including per-run breakdown, duration analytics, and platform ad IDs.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
      #swagger.parameters['skip'] = { description: 'Number of recent runs to skip (default: 0)', type: 'integer', default: 0 }
      #swagger.parameters['limit'] = { description: 'Recent runs to return (default: 30)', type: 'integer', default: 30 }
    */
    try {
      const userId = req.user.user_id;
      const { skip = 0, limit = 30 } = req.query;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select("runHistory totalRuns failedRuns status schedule createdAt targets pairsPerCycle")
        .lean();
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      const history = job.runHistory || [];

      // ── Run counts by status ──────────────────────────────────────────────────
      const counts = { success: 0, partial: 0, failed: 0, skipped: 0 };
      let totalDurationMs = 0;
      let durationCount   = 0;
      let lastRunAt       = "";
      const platformAdSummary = {}; // { meta: ["id1","id2"], … }

      // Generation health variables
      let totalImagesRequested = 0, totalImagesGenerated = 0;
      let totalTextsRequested = 0,  totalTextsGenerated = 0;
      let totalCreativesAssembled = 0, totalCreativesPosted = 0, totalCreativesNotPosted = 0;
      // Per-platform posted/failed — a run where Meta succeeds but Google
      // fails (or vice versa) is invisible in the combined "posted" count
      // above (any platform succeeding marks the whole run's creatives as
      // posted). Tracked here so the same failing platform across many runs
      // is visible without opening each run's detail.
      const platformPostCounts = {}; // { meta: { posted: N, failed: N }, google: {...} }

      for (const run of history) {
        if (counts[run.status] !== undefined) counts[run.status]++;

        if (run.startedAt && run.completedAt) {
          const dur = new Date(run.completedAt) - new Date(run.startedAt);
          totalDurationMs += dur;
          durationCount++;
        }

        if (!lastRunAt || new Date(run.completedAt) > new Date(lastRunAt)) {
          lastRunAt = run.completedAt || "";
        }

        // Collect per-platform ad IDs
        const ids = run.platformAdIds
          ? (run.platformAdIds instanceof Map
              ? Object.fromEntries(run.platformAdIds)
              : run.platformAdIds)
          : {};
        for (const [platform, adId] of Object.entries(ids)) {
          if (!adId) continue;
          if (!platformAdSummary[platform]) platformAdSummary[platform] = [];
          platformAdSummary[platform].push(adId);
        }

        // Per-platform posted/failed — only counts platforms this job has
        // configured (so a never-attempted platform doesn't show as failed).
        for (const platform of Object.keys(job.targets || {})) {
          if (!job.targets[platform]?.template) continue;
          if (!platformPostCounts[platform]) platformPostCounts[platform] = { posted: 0, failed: 0 };
          if (ids[platform]) platformPostCounts[platform].posted++;
          else platformPostCounts[platform].failed++;
        }

        // Calculate health metrics
        const rawImages = run.rawImages || [];
        const rawTexts  = run.rawTexts  || [];
        
        totalImagesRequested += job.pairsPerCycle || 1;
        totalImagesGenerated += rawImages.filter(i => i.status === 200).length;
        totalTextsRequested  += job.pairsPerCycle || 1;
        totalTextsGenerated  += rawTexts.filter(t => t.status === 200).length;
        
        const cLen = (run.automationCreatives || []).length;
        totalCreativesAssembled += cLen;

        const posted = Object.keys(ids).length > 0;
        if (posted) totalCreativesPosted += cLen;
        else totalCreativesNotPosted += cLen;
      }

      // Only show platforms that are currently active (have a template configured)
      const platformDetails = {};
      for (const [platform, config] of Object.entries(job.targets || {})) {
        if (!config?.template) continue;
        if (platform === "meta" && typeof config.adSetId === "string") {
          config.adSetId = config.adSetId ? [config.adSetId] : [];
        }
        platformDetails[platform] = { config };
      }

      const generationHealth = {
        totalImagesRequested,
        totalImagesGenerated,
        totalImagesFailed:    Math.max(0, totalImagesRequested - totalImagesGenerated),
        totalTextsRequested,
        totalTextsGenerated,
        totalTextsFailed:     Math.max(0, totalTextsRequested - totalTextsGenerated),
        totalCreativesAssembled,
        totalCreativesPosted,
        totalCreativesNotPosted,
        platformPostCounts,
      };

      const totalRuns   = job.totalRuns || history.length;
      const successRate = totalRuns > 0
        ? +((counts.success / totalRuns) * 100).toFixed(1)
        : 0;
      const avgDurationMs = durationCount > 0
        ? Math.round(totalDurationMs / durationCount)
        : 0;

      const skipNum = Number(skip);
      const limitNum = Number(limit);

      // ── Activity timeline — paginated runs newest-first ─────────────────────────
      const recentRuns = [...history]
        .reverse()
        .slice(skipNum, skipNum + limitNum)
        .map((r) => ({
          runId:       r.runId,
          status:      r.status,
          startedAt:   r.startedAt,
          completedAt: r.completedAt,
          durationMs:  (r.startedAt && r.completedAt)
            ? new Date(r.completedAt) - new Date(r.startedAt)
            : null,
          error:       r.error || null,
          platformAdIds: r.platformAdIds
            ? (r.platformAdIds instanceof Map
                ? Object.fromEntries(r.platformAdIds)
                : r.platformAdIds)
            : {},
        }));

      let dynamicNextRun = null;
      if (job.status !== "completed" && job.status !== "paused") {
        try {
          const { getNextRunTime } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");
          dynamicNextRun = await getNextRunTime(job._id.toString(), job.schedule);
        } catch (e) {}
        if (!dynamicNextRun) {
          dynamicNextRun = job.schedule?.nextRunAt || null;
        }
      }

      return res.json({
        success: true,
        skip: skipNum,
        limit: limitNum,
        data: {
          jobId:        job._id,
          status:       job.status,
          totalRuns:    totalRuns,
          successRuns:  counts.success,
          partialRuns:  counts.partial,
          failedRuns:   counts.failed,
          skippedRuns:  counts.skipped,
          successRate:  `${successRate}%`,
          postedCount:  totalCreativesPosted,
          avgDurationMs,
          lastRunAt,
          schedule: {
            frequency:  job.schedule?.frequency  || "",
            lastRunAt:  job.schedule?.lastRunAt  || "",
            nextRunAt:  dynamicNextRun,
            startDate:  job.schedule?.startDate  || "",
            endDate:    job.schedule?.endDate    || "",
          },
          createdAt: job.createdAt,
          generationHealth,
          platforms: platformDetails,
          recentRuns,
        },
      });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getJobStats] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ─── Job Activity (full generation + posting trace) ───────────────────────────

  async getJobActivity(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Full job activity trace'
      #swagger.description = 'Returns a complete per-run breakdown: generated images, generated text, assembled ad-set creatives (image+text combos), and posting status per platform. Use this to audit every generation+posting cycle of an autopilot job.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
      #swagger.parameters['skip'] = { description: 'Number of runs to skip (default: 0)', type: 'integer', default: 0 }
      #swagger.parameters['limit'] = { description: 'Runs to return (default: 10)', type: 'integer', default: 10 }
    */
    try {
      const userId = req.user.user_id;
      const { skip = 0, limit = 10 } = req.query;

      // ── 1. Detect whether :id is a jobId or a campaignId ────────────────────
      // Strategy: try jobId lookup first (exact _id match).
      // If that returns nothing, treat :id as a campaignId and return ALL jobs
      // for that campaign — each with their own full activity data.
      const SELECT = "campaignId runHistory totalRuns failedRuns status schedule pairsPerCycle model createdAt targets";

      let jobs = [];
      let idType = "jobId";

      const jobById = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select(SELECT).lean();

      if (jobById) {
        jobs = [jobById];
      } else {
        // :id is a campaignId — load all autopilot jobs for that campaign
        const byCampaign = await AdsFactoryJob.find({ campaignId: req.params.id, userId })
          .select(SELECT).sort({ createdAt: -1 }).lean();
        if (!byCampaign || byCampaign.length === 0) {
          return res.status(404).json({ success: false, error: "No autopilot jobs found for this campaign" });
        }
        jobs = byCampaign;
        idType = "campaignId";
      }

      // Load connected FBUsers to resolve Meta account names
      const fbConnectionIds = jobs.map((j) => j.targets?.meta?.connectionId).filter(Boolean);
      const fbFacebookIds = jobs.map((j) => j.targets?.meta?.facebookId).filter(Boolean);

      const fbUsers = (fbConnectionIds.length > 0 || fbFacebookIds.length > 0)
        ? await FBUsers.find({
            $or: [
              { _id: { $in: fbConnectionIds } },
              { facebookId: { $in: fbFacebookIds } }
            ]
          }).select("facebookId name email").lean()
        : [];

      const fbUserMap = new Map();
      fbUsers.forEach((u) => {
        const displayName = u.name || u.email || (u.facebookId ? `Meta (${u.facebookId})` : "Meta Account");
        if (u._id) fbUserMap.set(u._id.toString(), displayName);
        if (u.facebookId) fbUserMap.set(u.facebookId.toString(), displayName);
      });

      // ── Shared helper — builds full activity detail for one job ─────────────
      const buildJobDetail = async (job, skipNum, limitNum) => {
        const campaign = await Campaign.findById(job.campaignId)
          .select("metadata brandInfo results creatives services status").lean();

        const metaAccountName = fbUserMap.get(job.targets?.meta?.connectionId?.toString())
          || fbUserMap.get(job.targets?.meta?.facebookId?.toString())
          || (job.targets?.meta?.facebookId ? `Meta (${job.targets.meta.facebookId})` : "Meta Account");

        const googleAccountName = job.targets?.google?.customerId
          ? `Google (${job.targets.google.customerId})`
          : "Google Account";

        const allRuns   = [...(job.runHistory || [])].reverse();
        const pageRuns  = allRuns.slice(skipNum, skipNum + limitNum);

        const runActivity = pageRuns.map((run) => {
          const adsPosted = run.platformAdIds
            ? (run.platformAdIds instanceof Map ? Object.fromEntries(run.platformAdIds) : run.platformAdIds)
            : {};
          const posted       = Object.keys(adsPosted).length > 0;
          const runCreatives = run.automationCreatives || [];
          const rawImages    = run.rawImages || [];
          const rawTexts     = run.rawTexts  || [];

          const generatedImages = rawImages.map((img, i) => {
            const imgUrl = typeof img.data === "string" ? img.data : (img.data?.base_image || img.data?.url || img.data?.data || null);
            const aspectRatio = typeof img.data === "object" ? (img.data?.aspect_ratio || img.data?.aspectRatio || img.data?.aspectRatioString || null) : null;
            return {
              index: i,
              generated: img.status === 200,
              status: img.status,
              url: imgUrl
                ? (imgUrl.startsWith("http")
                    ? imgUrl
                    : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${imgUrl.startsWith("/") ? "" : "/"}${imgUrl}`)
                : imgUrl,
              aspectRatio,
              prompt: img.prompt || null,
              error: img.error || null,
            };
          });

          const splitPlatformText = (txt) => {
            const data = txt?.data;
            const isObj = typeof data === "object" && data !== null;
            const meta = isObj && (data?.meta?.headline || data?.meta?.primary_text)
              ? { headline: data.meta.headline || null, body: data.meta.primary_text || null }
              : null;
            const google = isObj && (data?.google?.headline || data?.google?.description)
              ? { headline: data.google.headline || null, body: data.google.description || null }
              : null;
            const fallback = (!meta && !google)
              ? {
                  headline: isObj ? (data?.headline || null) : (data || null),
                  body:     isObj ? (data?.body || data?.message || null) : null,
                }
              : null;
            return { meta, google, fallback };
          };

          const generatedTexts = rawTexts.map((txt, i) => {
            const { meta, google, fallback } = splitPlatformText(txt);
            return {
              index:     i,
              generated: txt.status === 200,
              status:    txt.status,
              meta,
              google,
              fallback,
              error:     txt.error || null,
            };
          });

          const imagesRequested = job.pairsPerCycle || 1;
          const textsRequested  = job.pairsPerCycle || 1;
          const imagesGenerated = runCreatives.filter(c => c.imageUrl).length;
          const textsGenerated  = runCreatives.filter(c => c.platformText?.meta || c.platformText?.google).length;

          return {
            runId:       run.runId,
            status:      run.status,
            startedAt:   run.startedAt,
            completedAt: run.completedAt,
            durationMs:  (run.startedAt && run.completedAt) ? new Date(run.completedAt) - new Date(run.startedAt) : null,
            error:       run.error || null,
            generationSummary: {
              imagesRequested, imagesGenerated, imagesFailed: Math.max(0, imagesRequested - imagesGenerated),
              textsRequested,  textsGenerated,  textsFailed:  Math.max(0, textsRequested  - textsGenerated),
              creativesAssembled: runCreatives.length,
            },
            postingSummary: { posted, platforms: Object.keys(adsPosted), adIds: adsPosted },
            generatedImages,
            generatedTexts,
            creatives: runCreatives.flatMap((c, i) => {
              const { meta: metaText, google: googleText, fallback } = splitPlatformText(rawTexts[i] || {});
              const perPlatformText = { meta: metaText, google: googleText };

              const creativePosted = c.postedAdIds instanceof Map
                ? Object.fromEntries(c.postedAdIds)
                : (c.postedAdIds || {});
              const platformsForCreative = Object.keys(creativePosted).length
                ? Object.keys(creativePosted)
                : Object.keys(adsPosted);
              const platforms = platformsForCreative.length
                ? platformsForCreative
                : Object.keys(job.targets || {}).filter((p) => job.targets[p]?.template);

              return platforms.map((platform) => {
                const txt = perPlatformText[platform] || fallback || null;
                const headline = txt?.headline || "";
                const body     = txt?.body     || "";
                const platformAdId = creativePosted[platform] || (adsPosted[platform] || null);

                const accountName = platform === "meta"
                  ? metaAccountName
                  : platform === "google"
                    ? googleAccountName
                    : `${platform.charAt(0).toUpperCase() + platform.slice(1)} Account`;

                return {
                  creativeId: `${c.creativeId}:${platform}`,
                  sourceCreativeId: c.creativeId,
                  imageIndex: i,
                  textIndex:  i,
                  platform,
                  accountName,
                  runStatus:  run.status,
                  runError:   run.error,
                  ad: {
                    imageUrl: c.imageUrl
                      ? (c.imageUrl.startsWith("http")
                          ? c.imageUrl
                          : `${(process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "")}${c.imageUrl.startsWith("/") ? "" : "/"}${c.imageUrl}`)
                      : c.imageUrl,
                    imageStatus:  c.imageUrl ? "generated" : "missing",
                    headline,
                    body,
                    description:  c.description,
                    textStatus:   (headline || body) ? "generated" : "missing",
                    callToAction: c.callToAction,
                    linkUrl:      c.linkUrl,
                    platform,
                  },
                  posting: {
                    posted:   !!platformAdId,
                    adId:     platformAdId,
                    postedAt: platformAdId ? (run.completedAt || null) : null,
                  },
                };
              });
            }),
          };
        });

        let totalImagesRequested = 0, totalImagesGenerated = 0;
        let totalTextsRequested  = 0, totalTextsGenerated  = 0;
        let totalCreativesAssembled = 0, totalCreativesPosted = 0, totalCreativesNotPosted = 0;
        // Per-platform posted/failed — see comment on the equivalent block in
        // getJobStats; only counts platforms this job has configured.
        const platformPostCounts = {};
        for (const run of allRuns) {
          const ri = run.rawImages || [], rt = run.rawTexts || [];
          totalImagesRequested += job.pairsPerCycle || 1;
          totalImagesGenerated += ri.filter(i => i.status === 200).length;
          totalTextsRequested  += job.pairsPerCycle || 1;
          totalTextsGenerated  += rt.filter(t => t.status === 200).length;
          const cLen = (run.automationCreatives || []).length;
          totalCreativesAssembled += cLen;
          const p = run.platformAdIds && (run.platformAdIds instanceof Map ? run.platformAdIds.size > 0 : Object.keys(run.platformAdIds).length > 0);
          if (p) totalCreativesPosted += cLen; else totalCreativesNotPosted += cLen;

          const runIds = run.platformAdIds
            ? (run.platformAdIds instanceof Map ? Object.fromEntries(run.platformAdIds) : run.platformAdIds)
            : {};
          for (const platform of Object.keys(job.targets || {})) {
            if (!job.targets[platform]?.template) continue;
            if (!platformPostCounts[platform]) platformPostCounts[platform] = { posted: 0, failed: 0 };
            if (runIds[platform]) platformPostCounts[platform].posted++;
            else platformPostCounts[platform].failed++;
          }
        }

        // Only include platforms that are currently active (have a template configured)
        const platformDetails = {};
        for (const [platform, config] of Object.entries(job.targets || {})) {
          if (!config?.template) continue; // skip platforms with no active template
          platformDetails[platform] = { config };
        }

        // templateInputs — show the currently active platform's template, not hardcoded to meta
        // Preference: google > meta (most recent switch wins display)
        const activeTemplate =
          job.targets?.google?.template ||
          job.targets?.meta?.template   ||
          null;
        const activePlatform = job.targets?.google?.template ? "google"
          : job.targets?.meta?.template ? "meta"
          : null;

        const templateInputs = activeTemplate ? {
          platform:           activePlatform,
          objective:          activeTemplate.objective          || null,
          conversionLocation: activeTemplate.conversionLocation || null,
          // meta-specific fields
          pageId:             activeTemplate.pageId             || activeTemplate.payload?.pageId       || null,
          adAccountId:        activeTemplate.payload?.adAccountId                                        || null,
          bidStrategy:        activeTemplate.payload?.bidStrategy                                        || null,
          dailyBudget:        activeTemplate.payload?.dailyBudget                                        || null,
          lifetimeBudget:     activeTemplate.payload?.lifetimeBudget                                     || null,
          callToAction:       activeTemplate.payload?.callToAction                                       || null,
          linkUrl:            activeTemplate.payload?.linkUrl   || activeTemplate.payload?.finalUrl      || null,
          targeting:          activeTemplate.payload?.targeting                                          || null,
          // google-specific fields
          customerId:         activeTemplate.customerId         || activeTemplate.payload?.adAccountId   || null,
          destination:        activeTemplate.conversionLocation || activeTemplate.payload?.destination   || null,
          dailyBudgetMicros:  activeTemplate.payload?.dailyBudgetMicros                                  || null,
          lifetimeBudgetMicros: activeTemplate.payload?.lifetimeBudgetMicros                             || null,
          budgetType:         activeTemplate.payload?.budgetType                                         || null,
          biddingGoal:        activeTemplate.payload?.biddingGoal                                        || null,
          keywords:           activeTemplate.payload?.keywords                                           || null,
        } : null;

        return {
          jobId:  job._id,
          total:  allRuns.length,
          skip:   skipNum,
          limit:  limitNum,
          jobConfig: {
            status:        job.status,
            pairsPerCycle: job.pairsPerCycle,
            model:         job.model || null,
            createdAt:     job.createdAt,
            schedule: {
              frequency:       job.schedule?.frequency,
              startDate:       job.schedule?.startDate       || null,
              endDate:         job.schedule?.endDate         || null,
              hour:            job.schedule?.hour            ?? null,
              timezone:        job.schedule?.timezone        || "UTC",
              nextRunAt:       (job.status === "completed" || job.status === "paused") ? null : (job.schedule?.nextRunAt || null),
              lastRunAt:       job.schedule?.lastRunAt       || null,
              customFrequency: job.schedule?.customFrequency || null,
            },
            templateInputs,
          },
          campaign: campaign ? {
            _id:          campaign._id,
            campaignId:   campaign.metadata?.campaignId,
            campaignName: campaign.metadata?.campaignName,
            status:       campaign.status,
          } : null,
          generationHealth: {
            totalImagesRequested, totalImagesGenerated, totalImagesFailed: Math.max(0, totalImagesRequested - totalImagesGenerated),
            totalTextsRequested,  totalTextsGenerated,  totalTextsFailed:  Math.max(0, totalTextsRequested  - totalTextsGenerated),
            totalCreativesAssembled, totalCreativesPosted, totalCreativesNotPosted,
            platformPostCounts,
          },
          platforms: platformDetails,
          data: runActivity,
        };
      };

      // ── If campaignId was passed, return full detail for ALL jobs ─────────────
      if (idType === "campaignId") {
        const skipNum  = Number(skip);
        const limitNum = Number(limit);
        const results  = await Promise.all(jobs.map((job) => buildJobDetail(job, skipNum, limitNum)));
        return res.json({
          success:    true,
          campaignId: req.params.id,
          total:      jobs.length,
          jobs:       results,
        });
      }

      // ── jobId path — unchanged response shape ────────────────────────────────
      const detail = await buildJobDetail(jobs[0], Number(skip), Number(limit));
      return res.json({ success: true, ...detail });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getJobActivity] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ─── Summary preview card (shown BEFORE job is created) ───────────────────────
  //
  // POST /jobs/summary
  // Body: { campaignId, pairsPerCycle, model, schedule: { frequency, startDate, endDate, timezone, cronExpression } }
  //
  // All numbers are computed from the user's current form inputs so they can
  // see projected cost/coverage before committing to creating the job.

  async getJobSummary(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Job summary preview'
      #swagger.description = 'Calculates the summary card shown before creating an autopilot job: next run time based on schedule, cycles scheduled until endDate, credits per cycle derived from campaignId services × pairsPerCycle, how many future cycles remaining credits cover, and total credits that will be consumed across all runnable cycles.'
      #swagger.security = [{ "BearerAuth": [] }]
    */
    try {
      const userId = req.user.user_id;
      const { campaignId, pairsPerCycle = 1, model = null, schedule = {} } = req.body;

      if (!campaignId) {
        return res.status(400).json({ success: false, error: "campaignId is required" });
      }
      if (!schedule.frequency) {
        return res.status(400).json({ success: false, error: "schedule.frequency is required" });
      }

      // ── Load campaign to get its services ────────────────────────────────────
      const campaign = await Campaign.findOne({ _id: campaignId, userId })
        .select("services")
        .lean();
      if (!campaign) {
        return res.status(404).json({ success: false, error: "Campaign not found" });
      }
      const cronExpr = schedule.cronExpression || resolvePresetCron(schedule.frequency, schedule.hour) || null;
      const tz       = schedule.timezone || "UTC";
      const fromDate = schedule.startDate ? new Date(schedule.startDate) : new Date();

      // ── 1. Next run time ────────────────────────────────────────────────────
      let nextRunAt = null;
      if (schedule.frequency === "does_not_repeat") {
        // One-shot: runs on startDate at the chosen hour in the job's timezone.
        if (schedule.startDate) {
          const hour = Number(schedule.hour) || 0;
          const cronOnce = `0 ${hour} * * *`;
          try {
            const cronParser = require("cron-parser");
            nextRunAt = cronParser.parseExpression(cronOnce, {
              currentDate: new Date(schedule.startDate),
              tz,
            }).next().toDate();
          } catch (_) {
            nextRunAt = new Date(schedule.startDate);
          }
        } else {
          nextRunAt = new Date();
        }
      } else if (cronExpr) {
        try {
          const cronParser = require("cron-parser");
          nextRunAt = cronParser.parseExpression(cronExpr, { currentDate: fromDate, tz })
            .next()
            .toDate();
        } catch (_) {}
      }

      // ── 2. Cycles scheduled — cron fires from now until endDate ────────────
      // null = no endDate → job runs indefinitely
      //
      // The end-date picker gives a DATE only, which parses to midnight (00:00)
      // of that day. But the run fires at schedule.hour (e.g. 2:00 PM). Left as
      // midnight, cron-parser's endDate cuts off the end date's own run — a job
      // set "21 → 23 Jul, run at 2 PM" would count only the 21st + 22nd (2),
      // silently dropping the 23rd's 2 PM fire the user expects. The end date is
      // inclusive AT the chosen run hour, so anchor the boundary to that hour on
      // the end date (in the job's timezone) so the final day's run is counted.
      let cyclesScheduled = null;
      if (schedule.frequency === "does_not_repeat") {
        // Always exactly 1 run — end date is irrelevant for a one-shot.
        cyclesScheduled = 1;
      } else if (cronExpr && schedule.endDate) {
        try {
          const cronParser = require("cron-parser");
          const endBoundary = resolveInclusiveEndDate(schedule.endDate, schedule.hour, tz);
          const iter = cronParser.parseExpression(cronExpr, {
            currentDate: fromDate,
            endDate:     endBoundary,
            tz,
          });
          let count = 0;
          while (count <= 10000) {
            try { iter.next(); count++; } catch (_) { break; }
          }
          cyclesScheduled = count;
        } catch (_) {}
      }

      // ── 3. Credits per cycle ────────────────────────────────────────────────
      // Autopilot jobs store model + pairsPerCycle on the job itself, not on
      // campaign.services.servicesSelected (that's the manual Ad Factory flow).
      // Each cycle generates pairsPerCycle images + pairsPerCycle text copies.
      // If model is missing/unresolvable, fall back to the first active image model.
      const ppc = Number(pairsPerCycle) || 1;

      const _resolvedImageDeduction = (() => {
        if (model) {
          const d = UnifiedCreditController.getModelDeduction(model);
          if (d > 0) return d;
        }
        // fallback: first active image model
        const first = imageEntries({ activeOnly: true })[0];
        return first ? getCreditDeduction(first.canonicalKey) : 0;
      })();

      const textDeduction  = UnifiedCreditController.getModelDeduction("ADSGPT-TEXT") || 0;
      const creditsPerCycle = ppc * (_resolvedImageDeduction + textDeduction);

      // ── 4. User's credit balance ────────────────────────────────────────────
      let totalCredits = 0, remainingCredits = 0;
      try {
        const cs     = await UnifiedCreditController.getCreditStatus(userId);
        totalCredits     = cs?.total_credits     || 0;
        remainingCredits = cs?.remaining_credits || 0;
      } catch (_) {}

      // ── 5. Cycles your credits cover ────────────────────────────────────────
      const cyclesCredsCover = creditsPerCycle > 0
        ? Math.floor(remainingCredits / creditsPerCycle)
        : null;

      // ── 6. Credits used across runnable cycles ──────────────────────────────
      // Runnable = min(cyclesScheduled, cyclesCredsCover).
      // If no endDate (indefinite), runnable = cyclesCredsCover.
      const runnableCycles = (cyclesScheduled !== null && cyclesCredsCover !== null)
        ? Math.min(cyclesScheduled, cyclesCredsCover)
        : (cyclesCredsCover ?? 0);
      const creditsUsedAcrossRunnable = Math.round(runnableCycles * creditsPerCycle);

      return res.json({
        success: true,
        data: {
          frequency:  schedule.frequency,
          timezone:   tz,

          nextRunAt,                      // "Next Run"
          cyclesScheduled,                // "Cycles Scheduled" — null if indefinite
          creditsPerCycle,                // "Credits / Cycle"
          cyclesCredsCover,               // "Cycles Your Credits Cover"

          creditsUsedAcrossRunnable,      // left of "21 / 900"
          totalCredits,                   // right of "21 / 900"
          remainingCredits,
        },
      });
    } catch (err) {
      logger.error(`[adsFactoryAuto:getJobSummary] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new AdsFactoryAutoController();
