/**
 * Campaign Template controller — CRUD for user-saved snapshots of the
 * Meta Ads V2 wizard's `form` state. Mounted under `/meta-ads/v2/templates`
 * so it inherits the same JWT auth as the wizard endpoints.
 */
const CampaignTemplate = require("../Module/campaignTemplate/campaignTemplate");
const {
  createTemplateSchema,
} = require("../Validations/campaignTemplate.validator");
const logger = require("../utils/logger");

// GET /meta-ads/v2/templates
//
// Returns the user's saved templates, newest first. Slim — just enough for
// the picker (id, name, objective, conversionLocation, createdAt). The full
// payload comes back via GET /:id when the user applies one.
async function listTemplates(req, res) {
  try {
    const userId = req.user.user_id;
    const rows = await CampaignTemplate.find({ userId })
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
    logger.error(`listTemplates error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to load templates",
    });
  }
}

// GET /meta-ads/v2/templates/:id — full payload for applying a template.
async function getTemplate(req, res) {
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const row = await CampaignTemplate.findOne({ _id: id, userId }).lean();
    if (!row) {
      return res
        .status(404)
        .json({ status: false, error: "Template not found" });
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
    logger.error(`getTemplate error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to load template",
    });
  }
}

// POST /meta-ads/v2/templates — save the current wizard form as a template.
async function createTemplate(req, res) {
  const { error, value } = createTemplateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }
  try {
    const userId = req.user.user_id;
    // Denormalize objective / conversionLocation from payload when the
    // caller didn't pass them — the picker reads these without unpacking
    // the full payload.
    const objective = value.objective || value.payload?.objective || "";
    const conversionLocation =
      value.conversionLocation || value.payload?.conversionLocation || "";

    const doc = await CampaignTemplate.create({
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
    logger.error(`createTemplate error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to save template",
    });
  }
}

// DELETE /meta-ads/v2/templates/:id
async function deleteTemplate(req, res) {
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const r = await CampaignTemplate.deleteOne({ _id: id, userId });
    if (!r.deletedCount) {
      return res
        .status(404)
        .json({ status: false, error: "Template not found" });
    }
    return res.status(200).json({ status: true, message: "Template deleted" });
  } catch (err) {
    logger.error(`deleteTemplate error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to delete template",
    });
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
};
