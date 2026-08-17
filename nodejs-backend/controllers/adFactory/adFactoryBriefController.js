/**
 * Ad Factory 2.0 brief endpoints.
 *
 * `POST /brief { url }` is the entire front door: one field in, a fully
 * populated editable brief out. Everything v1 asked across six modals is
 * inferred behind this call.
 *
 * Two things this controller is careful about:
 *
 *   1. It validates the URL through `utils/safeUrl` BEFORE anything else. The
 *      request body causes a server-side fetch, which is textbook SSRF surface;
 *      Node is the first hop and must not delegate that check to Python.
 *
 *   2. It returns 202 and lets inference run detached. Autofill is allowed up
 *      to 60s (scrape + LLM), and holding an HTTP connection open that long
 *      turns every slow page into a browser timeout. The client polls or
 *      subscribes with the id it gets back.
 */

const AdFactoryBrief = require("../../Module/adFactory/adFactoryBrief");
const Campaign = require("../../Module/adFactory/adFactory");
const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
const brandNameLists = require("../../Module/brandNames/brandNamesSchema");
const briefService = require("../../services/adFactory/briefService");
const { briefGenerationView } = require("../../services/adFactory/briefGenerationView");
const { estimateBriefCredits } = require("../../services/adFactory/briefCreditEstimate");
const UnifiedCreditController = require("../UnifiedCreditController");
const { assertSafeUrl, UnsafeUrlError } = require("../../utils/safeUrl");
const {
  createFromUrlSchema,
  createFromBrandSchema,
  updateBriefSchema,
  rejectForbiddenKeys,
} = require("../../Validations/adFactory/adFactoryBriefValidation");
const logger = require("../../utils/logger");

// Ownership is enforced by querying with BOTH id and userId, so another user's
// brief is indistinguishable from one that doesn't exist. A 403 would confirm
// the id is real — a 404 tells an attacker nothing.
const findOwned = (id, userId) => AdFactoryBrief.findOne({ _id: id, userId });

const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id || ""));

exports.createBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Create a brief from a URL'
    #swagger.description = 'Reads a product or landing page and infers the brand, audience, objective and creative seeds. Returns 202 immediately; inference continues in the background.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const { error, value } = createFromUrlSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details.map((d) => d.message).join("; "),
      });
    }

    const userId = req.user.user_id;

    // SSRF guard. Runs before the quota check and before any document is
    // written, so a hostile URL costs nothing and leaves no trace.
    let safe;
    try {
      safe = await assertSafeUrl(value.url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        logger.warn(
          `[adFactory:brief] blocked URL from user=${userId} reason=${err.reason}`,
        );
        return res
          .status(400)
          .json({ success: false, error: err.message, reason: err.reason });
      }
      throw err;
    }

    if (!(await briefService.isWithinFreeQuota(userId))) {
      return res.status(429).json({
        success: false,
        code: "BRIEF_QUOTA_EXCEEDED",
        error: `You've used all ${briefService.FREE_BRIEF_QUOTA} page reads on this account. Start from a saved brand, or edit one of your existing briefs.`,
      });
    }

    const { brief, reused } = await briefService.createOrReuseUrlBrief({
      userId,
      url: safe.href,
      forceRefresh: value.forceRefresh,
    });

    // Already done or already running — nothing to kick off.
    if (!reused) {
      // Detached on purpose: the response must not wait on a 60s call.
      // runInference persists its own outcome and never rejects for an
      // expected failure, so the catch here is a genuine last resort.
      briefService.runInference(brief).catch((err) => {
        logger.error(
          `[adFactory:brief] unhandled inference error brief=${brief._id}: ${err.message}`,
        );
      });
    }

    return res.status(202).json({
      success: true,
      data: { briefId: brief._id.toString(), status: brief.status, reused },
    });
  } catch (err) {
    logger.error(`[adFactory:brief:create] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.createBriefFromBrand = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Create a brief from a saved brand'
    #swagger.description = 'The zero-typing path, and the fallback whenever URL inference cannot deliver.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const { error, value } = createFromBrandSchema.validate(
      { brandId: req.params.brandId },
      { abortEarly: false },
    );
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details.map((d) => d.message).join("; "),
      });
    }
    // NOTE: brand ids are opaque strings on the subdocument, NOT ObjectIds —
    // no isValidObjectId check here on purpose.

    const userId = req.user.user_id;

    // Brands are SUBDOCUMENTS inside one BrandsList per user
    // (`{ user_id, brands: [...] }`), keyed by their own string `id` — not
    // top-level documents with an ObjectId. Scoping the query by `user_id`
    // is what enforces ownership here.
    const list = await brandNameLists.findOne({ user_id: userId }).lean();
    const brand = (list?.brands || []).find(
      (b) => String(b?.id) === String(value.brandId),
    );
    if (!brand) {
      return res
        .status(404)
        .json({ success: false, error: "Brand not found or does not belong to this user" });
    }

    const { brief, shouldInfer } = await briefService.createBrandBrief({
      userId,
      brandId: value.brandId,
      brand,
    });

    // A brand with a saved website gets the same inference pass as the URL
    // path — BrandIQ brands store no voice, tone, do's, don'ts or palette, so
    // without this the brief would arrive half-empty. Detached for the same
    // reason as the URL path: the response must not wait on a 60s call.
    if (shouldInfer) {
      briefService.runInference(brief).catch((err) => {
        logger.error(
          `[adFactory:brief] unhandled inference error brief=${brief._id}: ${err.message}`,
        );
      });
    }

    return res.status(201).json({
      success: true,
      data: brief,
      meta: { inferring: shouldInfer },
    });
  } catch (err) {
    logger.error(`[adFactory:brief:createFromBrand] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Fetch one brief'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }
    const brief = await findOwned(req.params.id, req.user.user_id);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    // Creatives live on the campaign, because generation rides the v1 pipeline
    // and Python writes there. Returned alongside the brief so the preview
    // screen is one request rather than two — and so the client never has to
    // know that the campaign exists.
    //
    // Keyed `run`, NOT `generation`: the brief already has a `generation`
    // subdocument (model, counts, seed images) and spreading a second key of
    // that name over it would silently replace the user's settings with a
    // results payload. `generation` is what to make; `run` is what came back.
    let run = { status: "idle", pairs: [], pending: 0, failed: 0, requested: 0 };
    if (brief.campaignId) {
      const campaign = await Campaign.findOne({
        _id: brief.campaignId,
        userId: req.user.user_id,
      }).lean();
      if (campaign) run = briefGenerationView(campaign);
    }

    // What one run will cost, priced the same way the freeze is (see
    // briefCreditEstimate). Null when the brief can't be priced — the UI shows
    // nothing rather than a misleading "0 credits".
    const estimate = estimateBriefCredits(
      brief,
      UnifiedCreditController.getModelDeduction.bind(UnifiedCreditController),
    );

    return res
      .status(200)
      .json({ success: true, data: { ...brief.toObject(), run, estimate } });
  } catch (err) {
    logger.error(`[adFactory:brief:get] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.listBriefs = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'List the user\'s briefs, newest first'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    // `generationStatus` used to be selected here and no longer exists — the
    // brief does not duplicate the campaign's run state (see the schema note).
    // Selecting a dead field is silent, so it stayed until the list was
    // actually rendered.
    const briefs = await AdFactoryBrief.find({ userId: req.user.user_id })
      .select(
        "source status jobId brand.name brand.logoUrls brand.category " +
          "offer.primaryObjective delivery.budget createdAt updatedAt",
      )
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return res.status(200).json({ success: true, data: briefs });
  } catch (err) {
    logger.error(`[adFactory:brief:list] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Correct an inferred brief'
    #swagger.description = 'Every inferred value is editable. Server-owned fields (provenance, status, ownership) are rejected.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const forbidden = rejectForbiddenKeys(req.body);
    if (forbidden) {
      return res.status(400).json({ success: false, error: forbidden });
    }

    const { error, value } = updateBriefSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details.map((d) => d.message).join("; "),
      });
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    const brief = await findOwned(req.params.id, req.user.user_id);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    // Merge per section so a partial PATCH doesn't wipe sibling fields the
    // client didn't send.
    for (const section of ["brand", "offer", "delivery", "generation"]) {
      if (!value[section]) continue;
      const current = brief[section]?.toObject?.() || brief[section] || {};
      brief[section] = { ...current, ...value[section] };
    }

    // A user edit supersedes whatever we inferred for that field. Recording it
    // is what stops the UI continuing to flag a value the user has already
    // confirmed — and what keeps provenance honest about who decided what.
    const provenance = { ...(brief.provenance || {}) };
    for (const [section, fields] of Object.entries(value)) {
      for (const field of Object.keys(fields || {})) {
        provenance[`${section}.${field}`] = {
          source: "user",
          confidence: 1,
          evidence: "you edited this",
        };
      }
    }
    brief.provenance = provenance;
    brief.markModified("provenance");

    // A brief that needed input is usable again once the user has filled it in.
    if (brief.status === "needs_input" && brief.brand?.name) {
      brief.status = "draft";
      brief.failureReason = "";
    }

    await brief.save();

    // Keep the projection in step with the record. Non-fatal by the same
    // reasoning as in runInference: the user's edit is saved either way, and
    // generate/activate both materialise before they act — so the worst case is
    // that the campaign is rebuilt a moment later rather than now.
    try {
      await briefService.materializeCampaign(brief);
    } catch (projectionErr) {
      logger.warn(
        `[adFactory:brief:update] projection deferred brief=${brief._id}: ${projectionErr.message}`,
      );
    }

    return res.status(200).json({ success: true, data: brief });
  } catch (err) {
    logger.error(`[adFactory:brief:update] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteBrief = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Delete a brief'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    if (!isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    const brief = await findOwned(req.params.id, userId);
    if (!brief) {
      return res.status(404).json({ success: false, error: "Brief not found" });
    }

    // A brief with a live automation is still posting ads and spending money.
    // Deleting it here would leave the job running with its campaign torn out
    // from under it — the orchestrator would find no campaign, pause itself,
    // and the user would be left with ads live on Meta and nothing in the
    // product that explains them. Refuse and say what to do instead.
    const liveJob = await AdsFactoryJob.findOne({
      userId,
      campaignId: brief.campaignId,
      status: { $nin: ["completed", "archived"] },
    })
      .select("_id status")
      .lean();

    if (liveJob) {
      return res.status(409).json({
        success: false,
        code: "BRIEF_HAS_LIVE_AUTOMATION",
        error:
          "This brief is still delivering ads. Stop deliveries first, then delete it.",
        jobId: liveJob._id,
      });
    }

    // Ownership runs one way, so deletion does too: the brief owns its campaign
    // projection and takes it with it. Leaving the campaign behind is what
    // "orphaning" would actually look like, and it would also show up in Full
    // control as a campaign the user never made.
    //
    // Campaign first: if that succeeds and the brief delete then fails, the
    // brief simply re-materialises a fresh projection on its next save. The
    // reverse order can strand a campaign with nothing pointing at it.
    if (brief.campaignId) {
      await Campaign.deleteOne({ _id: brief.campaignId, userId });
    }
    await AdFactoryBrief.deleteOne({ _id: brief._id, userId });

    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error(`[adFactory:brief:delete] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Adoption ────────────────────────────────────────────────────────────────

exports.adoptCampaign = async (req, res) => {
  /*
    #swagger.tags = ['Ad Factory 2.0']
    #swagger.summary = 'Open a Full control campaign in Quick setup'
    #swagger.description = 'Builds the brief a canvas-authored campaign would have produced, pointing at the same campaign document. Idempotent — adopting twice returns the same brief.'
    #swagger.security = [{ "BearerAuth": [] }]
  */
  try {
    const userId = req.user.user_id;
    if (!isValidObjectId(req.params.campaignId)) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    const campaign = await Campaign.findOne({
      _id: req.params.campaignId,
      userId,
    }).lean();
    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    const brief = await briefService.adoptCampaign({
      userId,
      campaign,
      url: typeof req.body?.url === "string" ? req.body.url : "",
    });

    return res.status(200).json({ success: true, data: brief });
  } catch (err) {
    logger.error(`[adFactory:brief:adopt] ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
