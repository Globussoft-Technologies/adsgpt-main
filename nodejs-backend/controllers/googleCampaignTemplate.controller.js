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

// GET /google-ads/templates
async function listTemplates(req, res) {
  try {
    const userId = req.user.user_id;
    const rows = await GoogleCampaignTemplate.find({ userId })
      .select("_id name objective conversionLocation createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({
      status: true,
      templates: rows.map((r) => ({
        id: String(r._id),
        name: r.name,
        objective: r.objective || "",
        conversionLocation: r.conversionLocation || "",
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
    const doc = await GoogleCampaignTemplate.create({
      userId,
      name: value.name,
      objective,
      conversionLocation,
      payload: value.payload,
    });
    return res.status(201).json({
      status: true,
      template: {
        id: String(doc._id),
        name: doc.name,
        objective: doc.objective,
        conversionLocation: doc.conversionLocation,
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
