const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
const Campaign      = require("../../Module/adFactory/adFactory");
const { CELLS, CTA_LABELS } = require("../../config/wizardSchema");
const { scheduleJob, cancelJob, runJobNow, resolveScheduleForQueue, resolvePresetCron, getNextRunTime } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");
const {
  createJobSchema,
  updateJobSchema,
} = require("../../Validations/adsFactoryAuto/adsFactoryAutoValidation");
const logger = require("../../utils/logger");
const UnifiedCreditController = require("../UnifiedCreditController");
const { getCreditDeduction, imageEntries } = require("../../config/modelRegistry");

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

      // Resolve and store cron for preset frequencies
      const resolvedCron = resolvePresetCron(value.schedule.frequency, value.schedule.hour) || null;

      const job = await AdsFactoryJob.create({
        userId,
        campaignId:     value.campaignId,
        schedule: {
          ...value.schedule,
          cronExpression: resolvedCron,
        },
        pairsPerCycle: value.pairsPerCycle ?? 1,
        model:         value.model         ?? null,
        targets:        value.targets ?? {},
        status:         "active",
      });

      await scheduleJob(job._id, resolveScheduleForQueue(job.schedule));

      const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
      if (nextTime) {
        job.schedule.nextRunAt = nextTime;
        await job.save();
      }

      return res.status(201).json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:createJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
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
      if (status) filter.status = status;
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

      if (job.schedule && !job.schedule.nextRunAt) {
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

      if (value.campaignId     !== undefined) job.campaignId     = value.campaignId;
      if (value.pairsPerCycle  !== undefined) job.pairsPerCycle  = value.pairsPerCycle;
      if (value.model          !== undefined) job.model          = value.model;
      if (value.callToAction   !== undefined) job.callToAction   = value.callToAction;
      if (value.destinationUrl !== undefined) job.destinationUrl = value.destinationUrl;
      if (value.targets        !== undefined) Object.assign(job.targets, value.targets);

      if (value.schedule) {
        const resolvedCron = resolvePresetCron(value.schedule.frequency, value.schedule.hour) || null;
        Object.assign(job.schedule, { ...value.schedule, cronExpression: resolvedCron });
        await cancelJob(job._id.toString());
        if (job.status === "active") {
          await scheduleJob(job._id, resolveScheduleForQueue(job.schedule));
        }
      }

      const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
      if (nextTime) job.schedule.nextRunAt = nextTime;
      await job.save();

      return res.json({ success: true, data: job });
    } catch (err) {
      logger.error(`[adsFactoryAuto:updateJob] ${err.message}`);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteJob(req, res) {
    /*
      #swagger.tags = ['Ads Factory Autopilot']
      #swagger.summary = 'Delete autopilot job'
      #swagger.description = 'Permanently delete an autopilot job and cancel its scheduled queue entry.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
    */
    try {
      const userId = req.user.user_id;
      const job = await AdsFactoryJob.findOneAndDelete({ _id: req.params.id, userId });
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });
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
      return res.json({ success: true, message: "Job deleted" });
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

      await runJobNow(req.params.id);
      return res.json({ success: true, message: "Job queued for immediate execution" });
    } catch (err) {
      logger.error(`[adsFactoryAuto:runNow] ${err.message}`);
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
      #swagger.summary = 'Get job run history'
      #swagger.description = 'Retrieve paginated run history for an autopilot job, ordered newest-first.'
      #swagger.security = [{ "BearerAuth": [] }]
      #swagger.parameters['id'] = { in: 'path', description: 'Job MongoDB ObjectId', type: 'string', required: true }
      #swagger.parameters['page'] = { description: 'Page number (default: 1)', type: 'integer', default: 1 }
      #swagger.parameters['limit'] = { description: 'Items per page (default: 20)', type: 'integer', default: 20 }
    */
    try {
      const userId = req.user.user_id;
      const { page = 1, limit = 20 } = req.query;
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select("runHistory totalRuns failedRuns")
        .lean();
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      const skip    = (Number(page) - 1) * Number(limit);
      const history = [...job.runHistory].reverse().slice(skip, skip + Number(limit));

      return res.json({
        success:    true,
        total:      job.totalRuns || job.runHistory.length,
        failedRuns: job.failedRuns || 0,
        page:       Number(page),
        data:       history,
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

      // Build detailed platforms object
      const platformDetails = {};
      for (const [platform, config] of Object.entries(job.targets || {})) {
        if (!config || Object.keys(config).length === 0) continue;
        if (platform === "meta" && typeof config.adSetId === "string") {
          config.adSetId = config.adSetId ? [config.adSetId] : [];
        }
        platformDetails[platform] = {
          config // includes adAccountId, campaignId, pageId, adSetId
        };
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

      let dynamicNextRun = job.schedule?.nextRunAt || "";
      if (!dynamicNextRun) {
        try {
          const { getNextRunTime } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");
          const nextTime = await getNextRunTime(job._id.toString(), job.schedule);
          if (nextTime) dynamicNextRun = nextTime;
        } catch (e) {}
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

      // ── 1. Load job ──────────────────────────────────────────────────────────
      const job = await AdsFactoryJob.findOne({ _id: req.params.id, userId })
        .select("campaignId runHistory totalRuns failedRuns status schedule pairsPerCycle createdAt")
        .lean();
      if (!job) return res.status(404).json({ success: false, error: "Job not found" });

      // ── 2. Load associated campaign ──────────────────────────────────────────
      const campaign = await Campaign.findById(job.campaignId)
        .select("metadata brandInfo results creatives services status")
        .lean();

      // ── 3. Slice run history (newest-first) ───────────────────────────────
      const allRuns = [...(job.runHistory || [])].reverse();
      const skipNum = Number(skip);
      const limitNum = Number(limit);
      const pageRuns = allRuns.slice(skipNum, skipNum + limitNum);

      // ── 4. Removed campaign.results dependency ─────────────
      // The orchestrator no longer pushes to campaign.creatives.
      // All historical data (generated pairs and stats) is now safely
      // stored inside the job's runHistory directly.

      // ── 5. Build per-run activity rows ───────────────────────────────────────
      const runActivity = pageRuns.map((run) => {
        const adsPosted = run.platformAdIds
          ? (run.platformAdIds instanceof Map
              ? Object.fromEntries(run.platformAdIds)
              : run.platformAdIds)
          : {};

        const posted = Object.keys(adsPosted).length > 0;
        const runCreatives = run.automationCreatives || [];
        
        // Calculate dynamic stats
        const imagesRequested = job.pairsPerCycle || 1;
        const textsRequested  = job.pairsPerCycle || 1;
        const imagesGenerated = runCreatives.filter(c => c.imageUrl).length;
        const textsGenerated  = runCreatives.filter(c => c.headline || c.message).length;

        const rawImages = run.rawImages || [];
        const rawTexts  = run.rawTexts  || [];

        // Reconstruct generated assets directly from the raw python results saved to the job
        const generatedImages = rawImages.map((img, i) => {
          const imgUrl = typeof img.data === "string" ? img.data : (img.data?.base_image || img.data?.url || img.data?.data || null);
          const aspectRatio = typeof img.data === "object" ? (img.data?.aspect_ratio || img.data?.aspectRatio || img.data?.aspectRatioString || null) : null;
          return {
            index:     i,
            generated: img.status === 200,
            status:    img.status,
            url:       imgUrl,
            aspectRatio: aspectRatio,
            prompt:    img.prompt || null,
            error:     img.error || null,
          };
        });

        const generatedTexts = rawTexts.map((txt, i) => ({
          index:       i,
          generated:   txt.status === 200,
          status:      txt.status,
          headline:    typeof txt.data === "object" ? txt.data?.meta?.headline || txt.data?.google?.headline || txt.data?.headline : txt.data || null,
          body:        typeof txt.data === "object" ? txt.data?.meta?.primary_text || txt.data?.google?.description || txt.data?.body || txt.data?.message : null,
          description: typeof txt.data === "object" ? txt.data?.meta?.description || txt.data?.description : null,
          error:       txt.error || null,
        }));


        return {
          runId:       run.runId,
          status:      run.status,
          startedAt:   run.startedAt,
          completedAt: run.completedAt,
          durationMs:  (run.startedAt && run.completedAt)
            ? new Date(run.completedAt) - new Date(run.startedAt)
            : null,
          error: run.error || null,

          generationSummary: {
            imagesRequested,
            imagesGenerated,
            imagesFailed:    Math.max(0, imagesRequested - imagesGenerated),
            textsRequested,
            textsGenerated,
            textsFailed:     Math.max(0, textsRequested - textsGenerated),
            creativesAssembled: runCreatives.length,
          },

          postingSummary: {
            posted,
            platforms: Object.keys(adsPosted),
            adIds:     adsPosted,
          },

          generatedImages,
          generatedTexts,

          // ── assembled creatives to post (image+text combos) ──────────────────
          creatives: runCreatives.map((c, i) => ({
            creativeId:  c.creativeId,
            imageIndex:  i,
            textIndex:   i,
            runStatus:   run.status,
            runError:    run.error,
            ad: {
              imageUrl:     c.imageUrl,
              imageStatus:  c.imageUrl ? "generated" : "missing",
              headline:     c.headline,
              body:         c.message,
              description:  c.description,
              textStatus:   (c.headline || c.message) ? "generated" : "missing",
              callToAction: c.callToAction,
              linkUrl:      c.linkUrl,
              platform:     c.platform,
            },
            posting: {
              posted,
              postedAdIds: adsPosted,
              postedAt:    posted ? (run.completedAt || null) : null,
            },
          })),
        };
      });

      // ── 6. Overall campaign generation health ────────────────────────────────
      let totalImagesRequested = 0, totalImagesGenerated = 0;
      let totalTextsRequested = 0,  totalTextsGenerated = 0;
      let totalCreativesAssembled = 0, totalCreativesPosted = 0, totalCreativesNotPosted = 0;

      for (const run of allRuns) {
        const rawImages = run.rawImages || [];
        const rawTexts  = run.rawTexts  || [];
        
        totalImagesRequested += job.pairsPerCycle || 1;
        totalImagesGenerated += rawImages.filter(i => i.status === 200).length;
        totalTextsRequested  += job.pairsPerCycle || 1;
        totalTextsGenerated  += rawTexts.filter(t => t.status === 200).length;
        
        const cLen = (run.automationCreatives || []).length;
        totalCreativesAssembled += cLen;

        const posted = run.platformAdIds && (run.platformAdIds instanceof Map ? run.platformAdIds.size > 0 : Object.keys(run.platformAdIds).length > 0);
        if (posted) {
          totalCreativesPosted += cLen;
        } else {
          totalCreativesNotPosted += cLen;
        }
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
      };

      const platformAdSummary = {};
      for (const run of allRuns) {
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
      }

      const platformDetails = {};
      for (const [platform, config] of Object.entries(job.targets || {})) {
        if (!config || Object.keys(config).length === 0) continue;
        platformDetails[platform] = {
          config
        };
      }

      return res.json({
        success: true,
        jobId:   job._id,
        total:   allRuns.length,
        skip:    skipNum,
        limit:   limitNum,
        campaign: campaign ? {
          _id:          campaign._id,
          campaignId:   campaign.metadata?.campaignId,
          campaignName: campaign.metadata?.campaignName,
          status:       campaign.status,
        } : null,
        generationHealth,
        platforms: platformDetails,
        data: runActivity,
      });
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
      let cyclesScheduled = null;
      if (schedule.frequency === "does_not_repeat") {
        // Always exactly 1 run — end date is irrelevant for a one-shot.
        cyclesScheduled = 1;
      } else if (cronExpr && schedule.endDate) {
        try {
          const cronParser = require("cron-parser");
          const iter = cronParser.parseExpression(cronExpr, {
            currentDate: fromDate,
            endDate:     new Date(schedule.endDate),
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
