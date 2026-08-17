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
const Campaign = require("../../Module/adFactory/adFactory");
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

/**
 * Run a controller method that expects (req, res) and capture what it sent.
 *
 * `createJob` is a full controller action — validation, ownership checks,
 * duplicate-job detection, queue scheduling, the campaign back-link, GA4, and
 * rollback if any of it throws. Calling it rather than reimplementing its body
 * is what makes a brief-created job identical to a canvas-created one by
 * construction instead of by careful copying, and it is what
 * test/adFactory/v2JobParity.test.js pins.
 */
function callController(fn, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(fn(req, res)).catch(reject);
  });
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

    // The same call the canvas makes. Credits freeze and settle against
    // `campaign:<id>` inside this path, so there is exactly one meter.
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
