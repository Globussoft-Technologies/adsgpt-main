/**
 * Brief actions — the two buttons that spend money.
 *
 *   POST /ad-factory/briefs/:id/generate   brief → creatives
 *   POST /ad-factory/briefs/:id/activate   brief → AdsFactoryJob
 *
 * Both work the same way, and that sameness is the point: materialise the
 * brief's Campaign, then hand it to the machinery that already exists.
 *
 *   generate  → controllers/adFactory.sendAdFactoryRequest  (unchanged)
 *   activate  → adsFactoryAutoController.createJob          (unchanged)
 *
 * Neither path teaches the orchestrator, the queue, Python or the credit
 * system anything new. Python cannot tell whether a run came from the canvas or
 * a brief, which is exactly the promise docs/AD_FACTORY_2.md §10.1 makes.
 *
 * The previous attempt at activate returned
 * `501 AUTOMATION_REQUIRES_FULL_CONTROL` because briefs had no campaign to run
 * against. They do now — see services/adFactory/briefToCampaignDoc.
 */

const mongoose = require("mongoose");

const AdFactoryBrief = require("../../Module/adFactory/adFactoryBrief");
const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
const adFactoryController = require("../adFactory");
const adsFactoryAutoController = require("../adsFactoryAuto/adsFactoryAutoController");
const { materializeCampaign } = require("../../services/adFactory/briefService");
const {
  briefToJobPayload,
  BriefJobPayloadError,
} = require("../../services/adFactory/briefToJobPayload");
const { BriefProjectionError } = require("../../services/adFactory/briefToCampaignDoc");
const { buildResultSlotUpdate } = require("../../services/adFactory/resultSlots");
const { estimateBriefCredits } = require("../../services/adFactory/briefCreditEstimate");
const UnifiedCreditController = require("../UnifiedCreditController");
const Campaign = require("../../Module/adFactory/adFactory");
// Runs createJob/deleteJob in-process and captures what they sent, so a
// brief-created job is identical to a canvas-created one by construction.
// Shared with the CRUD controller, which uses it to sync edits through
// `updateJob`. See utils/callController.js for why.
const { callController } = require("../../utils/callController");
const logger = require("../../utils/logger");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

/**
 * Another user's brief must be indistinguishable from one that doesn't exist —
 * 404, never 403. A 403 confirms the id is real, which is a free existence
 * oracle over the whole collection.
 */
async function findOwnedBrief(id, userId) {
  if (!isValidObjectId(id)) return null;
  return AdFactoryBrief.findOne({ _id: id, userId });
}


// ─── brief → creatives ───────────────────────────────────────────────────────

exports.generateFromBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Generate creatives from a brief'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    const brief = await findOwnedBrief(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }
    if (brief.status === "inferring") {
      return res.status(409).json({
        success: false,
        error: "Still reading your page — this will be ready in a moment.",
      });
    }

    const campaign = await materializeCampaign(brief);

    // ── Snapshot the previous run ────────────────────────────────────────────
    // Full control versions a campaign before regenerating one that already
    // succeeded: storeAdFactoryHistory copies the whole document — creatives
    // included — into CampaignHistory with a version number, readable at
    // GET /campaign/get-history/:userId/:campaignId.
    //
    // Quick setup never did this, so a regenerate pushed a new batch of slots
    // and the previous batch fell out of view for good. It stayed in
    // results.text/image (the arrays are append-only), but nothing could reach
    // it, and Full control could show a history for a canvas campaign that
    // Quick setup could not show for its own.
    //
    // Same store, same condition, same version counter — so a brief's history
    // is readable from either mode, which is the point of the two sharing one
    // campaign in the first place.
    if (campaign.status === "success") {
      await adFactoryController
        .storeAdFactoryHistory(campaign.toObject ? campaign.toObject() : campaign)
        .catch((err) =>
          // Losing a snapshot must not cost the user the run they asked for.
          logger.warn(
            `[adFactory:brief:generate] history snapshot failed brief=${brief._id}: ${err.message}`,
          ),
        );
    }

    // Pre-allocate the slots Python's callback writes into. This is NOT
    // optional bookkeeping: updateGenerationResult fills slots positionally
    // (`results.text.$` filtered on `status: null`), so with no slots the
    // callback matches nothing, answers "Campaign not found" — misleading, the
    // campaign is right there — and every generated creative is dropped.
    //
    // Found in a live run: two images and two copies came back from Python and
    // all four were lost here. The orchestrator has always done this before its
    // own runs; the manual generate path had not.
    const { update: slotUpdate } = buildResultSlotUpdate(
      campaign.services?.servicesSelected,
    );
    if (!slotUpdate) {
      return res.status(400).json({
        success: false,
        error: "This brief asks for no images and no copy, so there is nothing to generate.",
      });
    }
    await Campaign.updateOne({ _id: campaign._id }, slotUpdate);

    // ── Freeze the run's cost ────────────────────────────────────────────────
    // This has to happen HERE, and an earlier comment in this file claimed
    // wrongly that it came for free with sendAdFactoryRequest. It does not.
    //
    // In Full control the freeze lives in `updateCampaign`, gated on
    // `nodeType === "services"` — the canvas saving its services node. Quick
    // setup never touches that endpoint, so nothing was ever frozen. The settle
    // still ran on the result callback (`settleAdFactoryCampaign` ->
    // `releasePartial("campaign:<id>")`), found no reservation, and no-oped —
    // so a run generated real ads and cost the user nothing.
    //
    // The key MUST be `campaign:<metadata.campaignId>`, because that is the key
    // the settle looks for. Priced with the same arithmetic validateCredits
    // uses, via the estimator already serving the UI, so the quote the user saw
    // and the amount held are the same number.
    const estimate = estimateBriefCredits(
      brief,
      UnifiedCreditController.getModelDeduction.bind(UnifiedCreditController),
    );
    const required = estimate?.total || 0;
    const reservationKey = `campaign:${campaign.metadata.campaignId}`;

    if (required > 0) {
      const check = await UnifiedCreditController.checkCredits(campaign.userId, required);
      if (!check.isAllowed) {
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_CREDITS",
          error: check.message || "You don't have enough credits for this run.",
          required,
          available: Math.max(0, (check.totalAllowed || 0) - (check.currentUsage || 0)),
        });
      }

      const freeze = await UnifiedCreditController.freezeCredits({
        userId: campaign.userId,
        reservationKey,
        amount: required,
        meta: {
          service_type: "adfactory_campaign",
          campaignId: campaign.metadata.campaignId,
          briefId: brief._id.toString(),
        },
      });
      if (!freeze.ok && freeze.reason === "INSUFFICIENT") {
        return res.status(400).json({
          success: false,
          code: "INSUFFICIENT_CREDITS",
          error: "You don't have enough credits for this run.",
          required,
          available: freeze.remaining,
        });
      }
    }

    // The same call the canvas makes.
    const result = await adFactoryController.sendAdFactoryRequest(
      campaign.metadata.campaignId,
      "adFactory",
      "active",
      null,
    );

    if (!result?.allNodesSuccess) {
      logger.error(
        `[adFactory:brief:generate] python rejected brief=${brief._id}: ${result?.error || result?.message}`,
      );
      // A run that never started must not leave credits held. Settlement
      // normally happens on the result callback, which will never arrive here.
      await UnifiedCreditController.releaseCredits(reservationKey).catch((e) =>
        logger.warn(`[adFactory:brief:generate] could not release hold: ${e.message}`),
      );
      // Put the campaign back too — it was flipped to in-progress for a run
      // that isn't happening, and the orchestrator skips a tick on that.
      await Campaign.updateOne(
        { _id: campaign._id },
        { $set: { status: "error", "results.status": "error" } },
      ).catch(() => {});
      return res.status(502).json({
        success: false,
        error: result?.error || result?.message || "Generation could not be started.",
      });
    }

    if (brief.status === "draft" || brief.status === "needs_input") {
      brief.status = "previewing";
      await brief.save();
    }

    return res.status(202).json({
      success: true,
      data: { briefId: brief._id, campaignId: campaign.metadata.campaignId },
    });
  } catch (err) {
    if (err instanceof BriefProjectionError) {
      return res.status(400).json({ success: false, error: err.message, field: err.field });
    }
    logger.error(`[adFactory:brief:generate] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── brief → AdsFactoryJob ───────────────────────────────────────────────────

exports.activateBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Start the automation for a brief'
    #swagger.description = 'Builds the autopilot job from the brief and hands it to the existing createJob flow. No saved Meta template is required — the template is synthesised from the objective and budget.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    const brief = await findOwnedBrief(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    // The campaign must exist before the payload is built — `createJob`
    // verifies it is real and owned before it writes anything.
    const campaign = await materializeCampaign(brief);

    const connection = req.body?.connection || req.body || {};
    let payload;
    try {
      payload = briefToJobPayload(brief, connection, { campaignId: campaign._id });
    } catch (err) {
      if (err instanceof BriefJobPayloadError) {
        // These are all "you haven't told us X yet" — a 400 the UI can point at
        // a specific field, not a failure.
        return res.status(400).json({ success: false, error: err.message, field: err.field });
      }
      throw err;
    }

    const { statusCode, body } = await callController(
      adsFactoryAutoController.createJob.bind(adsFactoryAutoController),
      { ...req, body: payload, user: req.user },
    );

    if (statusCode >= 400) return res.status(statusCode).json(body);

    const jobId = body?.data?._id ? String(body.data._id) : null;
    brief.jobId = jobId;
    brief.status = "live";
    // Mirror what the user actually committed to, so the brief reads correctly
    // on its own without joining the job.
    if (payload.schedule) {
      brief.delivery.frequency = {
        ...(brief.delivery.frequency || {}),
        preset: payload.schedule.frequency,
        hour: payload.schedule.hour,
        timezone: payload.schedule.timezone,
        startDate: payload.schedule.startDate || null,
        endDate: payload.schedule.endDate || null,
      };
    }
    await brief.save();

    return res.status(201).json({ success: true, data: body?.data });
  } catch (err) {
    if (err instanceof BriefProjectionError) {
      return res.status(400).json({ success: false, error: err.message, field: err.field });
    }
    logger.error(`[adFactory:brief:activate] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.stopBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Stop the automation for a brief'
    #swagger.description = 'Archives the underlying autopilot job and cancels its queue entry. Run history is preserved — the deliveries timeline keeps showing past cycles. Irreversible: restarting means activating again.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    const brief = await findOwnedBrief(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }
    if (!brief.jobId) {
      return res.status(409).json({
        success: false,
        code: "BRIEF_NOT_LIVE",
        error: "This brief isn't running on a schedule.",
      });
    }

    // `deleteJob` is a SOFT delete — it archives, cancels the queue entry, and
    // deliberately keeps `runHistory` so campaign-level views keep showing past
    // runs. That is exactly the behaviour a brief wants: stopping deliveries
    // must not erase the record of what was already delivered and paid for.
    //
    // It also owns the checks that matter: 409 while a run is mid-flight, so
    // stopping can't tear the job out from under a posting that is half done.
    const { statusCode, body } = await callController(
      adsFactoryAutoController.deleteJob.bind(adsFactoryAutoController),
      { ...req, params: { id: String(brief.jobId) }, user: req.user },
    );

    if (statusCode >= 400) return res.status(statusCode).json(body);

    // `jobId` is KEPT on purpose. The timeline endpoint reads it, and clearing
    // it here would throw away the history `deleteJob` just went out of its way
    // to preserve — the user would stop their automation and watch every past
    // delivery vanish with it.
    brief.status = "ended";
    await brief.save();

    return res.status(200).json({ success: true, data: { status: brief.status } });
  } catch (err) {
    logger.error(`[adFactory:brief:stop] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.runBriefNow = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Run this brief\'s automation immediately'
    #swagger.description = 'Queues one cycle right now, independent of the schedule. The schedule is unchanged — this is an extra run, not a reschedule.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    const brief = await findOwnedBrief(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }
    if (!brief.jobId) {
      return res.status(409).json({
        success: false,
        code: "BRIEF_NOT_LIVE",
        error: "This brief isn't running on a schedule yet.",
      });
    }

    // `runNow` owns the checks worth having: a paused job refuses (resume
    // first), a completed one refuses, and a job already mid-run 409s rather
    // than posting the same cycle twice. Relayed verbatim — every one of them
    // is advice the user can act on.
    const { statusCode, body } = await callController(
      adsFactoryAutoController.runNow.bind(adsFactoryAutoController),
      { ...req, params: { id: String(brief.jobId) }, user: req.user },
    );

    return res.status(statusCode).json(body);
  } catch (err) {
    logger.error(`[adFactory:brief:runNow] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Deliveries ──────────────────────────────────────────────────────────────

exports.getBriefTimeline = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Delivery timeline for a brief'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    const brief = await findOwnedBrief(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }
    if (!brief.jobId) {
      // Not an error: a brief that has only ever previewed has no deliveries
      // yet, and the screen renders that as its own empty state.
      return res.status(200).json({ success: true, data: { summary: null, rows: [] } });
    }

    const job = await AdsFactoryJob.findOne({ _id: brief.jobId, userId }).lean();
    if (!job) {
      return res.status(200).json({ success: true, data: { summary: null, rows: [] } });
    }

    const { serializeRunTimeline } = require("../../services/adsFactoryAuto/runTimelineSerializer");
    return res.status(200).json({ success: true, data: serializeRunTimeline(job) });
  } catch (err) {
    logger.error(`[adFactory:brief:timeline] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// Exported so the parity test can build a payload without an HTTP round trip.
exports.__buildJobPayload = briefToJobPayload;
exports.__internals = { findOwnedBrief, callController };
