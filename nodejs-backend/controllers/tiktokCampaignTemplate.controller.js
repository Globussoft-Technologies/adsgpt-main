/**
 * TikTok Campaign Template controller — CRUD for user-saved snapshots of the
 * TikTok Ads Manager wizard's `form` state. Mounted under `/tiktok-ads/templates`
 * so it inherits the same JWT auth as the wizard endpoints.
 */
const TiktokCampaignTemplate = require("../Module/tiktokCampaignTemplate/tiktokCampaignTemplate");
const {
  createTemplateSchema,
} = require("../Validations/tiktokCampaignTemplate.validator");
const logger = require("../utils/logger");

// GET /tiktok-ads/templates
//
// Returns the user's saved templates, newest first. Slim — just enough for
// the picker (id, name, objective, conversionLocation, createdAt). The full
// payload comes back via GET /:id when the user applies one.
async function listTemplates(req, res) {
  /* #swagger.tags = ['TikTok Ads']
     #swagger.summary = 'List campaign templates'
     #swagger.description = 'Returns the authenticated user\'s saved TikTok wizard templates, newest first — a slim projection (id, name, objective, conversionLocation, timestamps) for the template picker. Fetch the full payload via GET /templates/{id} when applying one.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.responses[200] = {
       description: "Templates",
       schema: {
         status: true,
         templates: [{ id: "665f1a2b3c4d5e6f7a8b9c0d", name: "US Traffic Template", objective: "TRAFFIC", conversionLocation: "WEBSITE", createdAt: "2026-07-01T10:00:00.000Z", updatedAt: "2026-07-01T10:00:00.000Z" }],
         count: 1
       }
     }
     #swagger.responses[500] = { description: "Failed to load templates" }
  */
  try {
    const userId = req.user.user_id;
    const rows = await TiktokCampaignTemplate.find({ userId })
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
    logger.error(`[tiktokTemplate] listTemplates error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to load templates",
    });
  }
}

// GET /tiktok-ads/templates/:id — full payload for applying a template.
async function getTemplate(req, res) {
  /* #swagger.tags = ['TikTok Ads']
     #swagger.summary = 'Get a campaign template'
     #swagger.description = 'Returns the full saved wizard `form` payload for one template, scoped to the authenticated user, used to re-hydrate the create-campaign wizard when the user applies a saved template.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.parameters['id'] = { in: 'path', required: true, description: 'Template Mongo _id', type: 'string', example: '665f1a2b3c4d5e6f7a8b9c0d' }
     #swagger.responses[200] = {
       description: "Template",
       schema: {
         status: true,
         template: {
           id: "665f1a2b3c4d5e6f7a8b9c0d",
           name: "US Traffic Template",
           objective: "TRAFFIC",
           conversionLocation: "WEBSITE",
           payload: { objectiveKey: "TRAFFIC", objectiveType: "TRAFFIC", budgetMode: "BUDGET_MODE_DAY", budget: 50 },
           createdAt: "2026-07-01T10:00:00.000Z",
           updatedAt: "2026-07-01T10:00:00.000Z"
         }
       }
     }
     #swagger.responses[404] = { description: "Template not found" }
     #swagger.responses[500] = { description: "Failed to load template" }
  */
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const row = await TiktokCampaignTemplate.findOne({ _id: id, userId }).lean();
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
    logger.error(`[tiktokTemplate] getTemplate error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to load template",
    });
  }
}

// POST /tiktok-ads/templates — save the current wizard form as a template.
async function createTemplate(req, res) {
  /* #swagger.tags = ['TikTok Ads']
     #swagger.summary = 'Save a campaign template'
     #swagger.description = 'Saves the current create-campaign wizard `form` state as a reusable template for the authenticated user. `objective`/`conversionLocation` are denormalized from `payload` for picker display when not passed explicitly. `payload` is stored as-is (Mixed schema) so the wizard shape can evolve without migrations.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.requestBody = {
       required: true,
       content: {
         "application/json": {
           schema: {
             type: "object",
             required: ["name", "payload"],
             properties: {
               name: { type: "string", example: "US Traffic Template" },
               objective: { type: "string", example: "TRAFFIC", description: "Optional — denormalized from payload.objectiveKey if omitted" },
               conversionLocation: { type: "string", example: "WEBSITE", description: "Optional — denormalized from payload.objectiveType / objectiveKey if omitted" },
               payload: { type: "object", description: "The full wizard form state to snapshot", example: { objectiveKey: "TRAFFIC", objectiveType: "TRAFFIC", budgetMode: "BUDGET_MODE_DAY", budget: 50 } }
             }
           }
         }
       }
     }
     #swagger.responses[201] = {
       description: "Template saved",
       schema: {
         status: true,
         template: { id: "665f1a2b3c4d5e6f7a8b9c0d", name: "US Traffic Template", objective: "TRAFFIC", conversionLocation: "WEBSITE", createdAt: "2026-07-01T10:00:00.000Z" }
       }
     }
     #swagger.responses[400] = { description: "Validation error (e.g. missing name/payload)" }
     #swagger.responses[500] = { description: "Failed to save template" }
  */
  const { error, value } = createTemplateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      status: false,
      error: error.details[0].context?.message || error.details[0].message,
    });
  }
  try {
    const userId = req.user.user_id;
    // Denormalize objective / conversionLocation from payload when the caller
    // didn't pass them — the picker reads these without unpacking the payload.
    const objective = value.objective || value.payload?.objectiveKey || "";
    const conversionLocation =
      value.conversionLocation ||
      value.payload?.objectiveType ||
      value.payload?.objectiveKey ||
      "";

    const doc = await TiktokCampaignTemplate.create({
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
    logger.error(`[tiktokTemplate] createTemplate error: ${err.message}`);
    return res.status(500).json({
      status: false,
      error: "Failed to save template",
    });
  }
}

// DELETE /tiktok-ads/templates/:id
async function deleteTemplate(req, res) {
  /* #swagger.tags = ['TikTok Ads']
     #swagger.summary = 'Delete a campaign template'
     #swagger.description = 'Deletes a saved TikTok wizard template, scoped to the authenticated user.'
     #swagger.security = [{ "BearerAuth": [] }]
     #swagger.parameters['id'] = { in: 'path', required: true, description: 'Template Mongo _id', type: 'string', example: '665f1a2b3c4d5e6f7a8b9c0d' }
     #swagger.responses[200] = {
       description: "Deleted",
       schema: { status: true, message: "Template deleted" }
     }
     #swagger.responses[404] = { description: "Template not found" }
     #swagger.responses[500] = { description: "Failed to delete template" }
  */
  try {
    const userId = req.user.user_id;
    const { id } = req.params;
    const r = await TiktokCampaignTemplate.deleteOne({ _id: id, userId });
    if (!r.deletedCount) {
      return res
        .status(404)
        .json({ status: false, error: "Template not found" });
    }
    return res.status(200).json({ status: true, message: "Template deleted" });
  } catch (err) {
    logger.error(`[tiktokTemplate] deleteTemplate error: ${err.message}`);
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
