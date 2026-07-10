/**
 * Google Campaign Template controller — CRUD for user-saved snapshots of the
 * Google Ads wizard `form` state. Mounted under `/google-ads/templates`.
 *
 * Completely separate from Meta's campaignTemplate.controller.js.
 * Uses its own model (GoogleCampaignTemplate) and its own validator.
 */
const GoogleCampaignTemplate = require("../Module/googleCampaignTemplate/googleCampaignTemplate");
const {
  createGoogleTemplateSchema,
} = require("../Validations/googleCampaignTemplate.validator");
const logger = require("../utils/logger");

// Maps Google's channel-type vocabulary (conversionLocation) down to the
// three-bucket media type used for template filtering. VIDEO-family channels
// -> "video", SEARCH -> "text" (no image/video asset), everything else
// (DISPLAY, PERFORMANCE_MAX, SHOPPING, APP_PROMOTION, MULTI_CHANNEL) -> "image"
// since they're primarily asset/image-driven in Google's own UI.
const VIDEO_CHANNELS = new Set(["VIDEO", "YOUTUBE_REACH", "DEMAND_GEN"]);
const TEXT_CHANNELS  = new Set(["SEARCH"]);
function deriveMediaType(conversionLocation) {
  const cl = String(conversionLocation || "").toUpperCase();
  if (VIDEO_CHANNELS.has(cl)) return "video";
  if (TEXT_CHANNELS.has(cl))  return "text";
  return "image";
}

// Structural group — same vocabulary as googleAdController.getCampaignsByCustomer.
// PERFORMANCE_MAX templates use asset groups + assets instead of ad groups +
// ads. Defaults to "ads" when omitted, so PMax templates are excluded unless
// the caller explicitly asks for group=assets — matches the live-campaigns
// endpoint's default exactly.
function deriveGroup(conversionLocation) {
  return String(conversionLocation || "").toUpperCase() === "PERFORMANCE_MAX" ? "assets" : "ads";
}

// GET /google-ads/templates?type=image|video|text&group=ads|assets
async function listTemplates(req, res) {
  try {
    const userId = req.user.user_id;
    const { type } = req.query;

    const filter = { userId };
    if (type) {
      if (!["image", "video", "text"].includes(type)) {
        return res.status(400).json({ status: false, error: "type must be one of image, video, text" });
      }
      filter.mediaType = type;
    }

    const groupRaw = req.query.group;
    const groups = groupRaw
      ? (Array.isArray(groupRaw) ? groupRaw : [groupRaw]).map((g) => String(g).toLowerCase())
      : ["ads"];
    if (groups.some((g) => !["ads", "assets"].includes(g))) {
      return res.status(400).json({ status: false, error: "group must be one of ads, assets" });
    }
    // "ads" = everything except PERFORMANCE_MAX; "assets" = only PERFORMANCE_MAX.
    if (!(groups.includes("ads") && groups.includes("assets"))) {
      filter.conversionLocation = groups.includes("assets")
        ? "PERFORMANCE_MAX"
        : { $ne: "PERFORMANCE_MAX" };
    }

    const rows = await GoogleCampaignTemplate.find(filter)
      .select("_id name objective conversionLocation mediaType createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({
      status: true,
      templates: rows.map((r) => ({
        id: String(r._id),
        name: r.name,
        objective: r.objective || "",
        conversionLocation: r.conversionLocation || "",
        mediaType: r.mediaType || deriveMediaType(r.conversionLocation),
        group: deriveGroup(r.conversionLocation),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      count: rows.length,
    });
  } catch (err) {
    logger.error(`[googleTemplate] listTemplates error: ${err.message}`);
    return res.status(500).json({ status: false, error: "Failed to load templates" });
  }
}

// GET /google-ads/templates/:id
async function getTemplate(req, res) {
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const row = await GoogleCampaignTemplate.findOne({ _id: id, userId }).lean();
    if (!row) {
      return res.status(404).json({ status: false, error: "Template not found" });
    }
    return res.status(200).json({
      status: true,
      template: {
        id: String(row._id),
        name: row.name,
        objective: row.objective || "",
        conversionLocation: row.conversionLocation || "",
        mediaType: row.mediaType || deriveMediaType(row.conversionLocation),
        group: deriveGroup(row.conversionLocation),
        payload: row.payload || {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    logger.error(`[googleTemplate] getTemplate error: ${err.message}`);
    return res.status(500).json({ status: false, error: "Failed to load template" });
  }
}

// POST /google-ads/templates
async function createTemplate(req, res) {
  const { error, value } = createGoogleTemplateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }
  try {
    const userId = req.user.user_id;
    const objective = value.objective || value.payload?.objective || "";
    const conversionLocation =
      value.conversionLocation || value.payload?.destination || value.payload?.conversionLocation || "";

    // Keywords are a SEARCH-only concept — strip blank/placeholder entries so
    // they never reach non-SEARCH templates and trip Google's non-empty-text
    // rule when the template is later applied.
    const payload = { ...value.payload };
    if (Array.isArray(payload.keywords)) {
      const validKeywords = payload.keywords.filter((k) => k?.text?.trim());
      if (validKeywords.length) payload.keywords = validKeywords;
      else delete payload.keywords;
    }

    const doc = await GoogleCampaignTemplate.create({
      userId,
      name: value.name,
      objective,
      conversionLocation,
      mediaType: deriveMediaType(conversionLocation),
      payload,
    });
    return res.status(201).json({
      status: true,
      template: {
        id: String(doc._id),
        name: doc.name,
        objective: doc.objective,
        conversionLocation: doc.conversionLocation,
        mediaType: doc.mediaType,
        group: deriveGroup(doc.conversionLocation),
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    logger.error(`[googleTemplate] createTemplate error: ${err.message}`);
    return res.status(500).json({ status: false, error: "Failed to save template" });
  }
}

// DELETE /google-ads/templates/:id
async function deleteTemplate(req, res) {
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const r = await GoogleCampaignTemplate.deleteOne({ _id: id, userId });
    if (!r.deletedCount) {
      return res.status(404).json({ status: false, error: "Template not found" });
    }
    return res.status(200).json({ status: true, message: "Template deleted" });
  } catch (err) {
    logger.error(`[googleTemplate] deleteTemplate error: ${err.message}`);
    return res.status(500).json({ status: false, error: "Failed to delete template" });
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
};
