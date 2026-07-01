const { PromptTemplate } = require("../../Module/promptTemplate/promptTemplate");
const {
  createPromptTemplatesSchema,
  getPromptTemplatesSchema,
  getPromptTemplateCategoriesSchema,
} = require("../../Validations/promptTemplate.validator");
const logger = require("../../utils/logger");

// POST /prompt-templates — open (internal/dev use via Swagger).
// Bulk insert: send an array of { type, title, prompt } across any module
// types in a single call. Each entry becomes a new document.
exports.createPromptTemplate = async (req, res) => {
  /* #swagger.tags = ['Prompt Templates']
     #swagger.description = 'Bulk-store prompt templates. Internal/dev use. Send an array of { type, title, prompt } (across any module types) and each entry is inserted as a new document. Multiple prompts per type are allowed.'
     #swagger.requestBody = {
       required: true,
       content: {
         "application/json": {
           schema: {
             type: "array",
             items: {
               type: "object",
               required: ["type", "title", "prompt"],
               properties: {
                 type: { type: "string", enum: ["lifestyle","product_shot","apps_saas","brand_awareness","ai_custom"], example: "lifestyle" },
                 title: { type: "string", example: "Morning routine" },
                 prompt: { type: "string", example: "Create a warm, authentic lifestyle ad image..." }
               }
             }
           },
           example: [
             { type: "lifestyle", title: "Morning routine", prompt: "Create a warm, authentic lifestyle ad image..." },
             { type: "product_shot", title: "Studio hero", prompt: "Create a clean studio product shot..." }
           ]
         }
       }
     }
     #swagger.security = []
     #swagger.responses[201] = {
       description: 'Prompt templates stored',
       content: { "application/json": { example: { status: true, count: 2, templates: [ { _id: "665f0c2a8b1e4a0012a3c9d1", type: "lifestyle", title: "Morning routine", prompt: "Create a warm, authentic lifestyle ad image...", createdAt: "2026-06-04T09:15:22.114Z", updatedAt: "2026-06-04T09:15:22.114Z" } ] } } }
     }
     #swagger.responses[400] = {
       description: 'Validation error',
       content: { "application/json": { example: { status: false, error: "send at least one prompt template" } } }
     }
     #swagger.responses[500] = {
       description: 'Server error',
       content: { "application/json": { example: { status: false, error: "Failed to store prompt templates" } } }
     }
  */
  try {
    // Accept either a raw array body or { templates: [...] }.
    const payload = Array.isArray(req.body)
      ? { templates: req.body }
      : req.body || {};

    const { error, value } = createPromptTemplatesSchema.validate(payload, {
      abortEarly: false,
    });
    if (error)
      return res
        .status(400)
        .json({ status: false, error: error.details[0].message });

    const docs = value.templates.map((t) => ({
      type: t.type,
      category: t.category || null,
      subcategory: t.subcategory || null,
      title: t.title,
      prompt: t.prompt,
    }));

    const templates = await PromptTemplate.insertMany(docs);

    return res
      .status(201)
      .json({ status: true, count: templates.length, templates });
  } catch (err) {
    logger.error(
      `[prompt-templates] create failed: ${err.stack || err.message}`,
    );
    return res
      .status(500)
      .json({ status: false, error: "Failed to store prompt templates" });
  }
};

// GET /prompt-templates?type=lifestyle&category=...&search=... — JWT (frontend read).
// No category (or empty category) returns the "General" prompts: those with no
// category and no subcategory. A specific category returns only that category.
exports.getPromptTemplatesByType = async (req, res) => {
  /* #swagger.tags = ['Prompt Templates']
     #swagger.description = 'Get prompt templates for a given module type. No category returns General prompts; a specific category filters by that category. Search matches title and prompt within the selected scope.'
     #swagger.parameters['type'] = { in: 'query', description: 'Module type', required: true, type: 'string', enum: ["lifestyle","product_shot","apps_saas","brand_awareness","ai_custom"] }
     #swagger.parameters['category'] = { in: 'query', description: 'Category filter (omit or empty for General)', required: false, type: 'string' }
     #swagger.parameters['search'] = { in: 'query', description: 'Optional search term (matches title and prompt) within the selected category', required: false, type: 'string' }
     #swagger.responses[200] = {
       description: 'Prompt templates for the type/category (newest first)',
       content: { "application/json": { example: { status: true, count: 1, templates: [ { _id: "665f0c2a8b1e4a0012a3c9d1", type: "lifestyle", category: "Real Estate", title: "Morning routine", prompt: "Create a warm..." } ] } } }
     }
     #swagger.responses[400] = {
       description: 'Validation error',
       content: { "application/json": { example: { status: false, error: "type must be one of: lifestyle, product_shot, apps_saas, brand_awareness, ai_custom" } } }
     }
     #swagger.responses[401] = { description: 'Missing token' }
     #swagger.responses[403] = { description: 'Invalid or expired token' }
     #swagger.responses[500] = {
       description: 'Server error',
       content: { "application/json": { example: { status: false, error: "Failed to fetch prompt templates" } } }
     }
  */
  try {
    const { error, value } = getPromptTemplatesSchema.validate(req.query || {});
    if (error)
      return res
        .status(400)
        .json({ status: false, error: error.details[0].message });

    const filter = { type: value.type };
    if (value.category) {
      filter.category = value.category;
    } else {
      // General = no category and no subcategory.
      filter.$and = [
        { $or: [{ category: null }, { category: "" }] },
        { $or: [{ subcategory: null }, { subcategory: "" }] },
      ];
    }
    if (value.search) {
      const term = value.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(term, "i");
      // Combine category filter and search filter safely.
      const searchClause = { $or: [{ title: re }, { prompt: re }] };
      if (filter.$and) {
        filter.$and.push(searchClause);
      } else {
        filter.$and = [searchClause];
      }
    }

    const templates = await PromptTemplate.find(
      filter,
      { type: 1, category: 1, subcategory: 1, title: 1, prompt: 1 },
    )
      .sort({ createdAt: -1 })
      .lean();

    return res
      .status(200)
      .json({ status: true, count: templates.length, templates });
  } catch (err) {
    logger.error(`[prompt-templates] fetch failed: ${err.stack || err.message}`);
    return res
      .status(500)
      .json({ status: false, error: "Failed to fetch prompt templates" });
  }
};

// GET /prompt-templates/categories?type=... — JWT (frontend read).
// Returns the distinct categories that actually have templates for the type.
exports.getPromptTemplateCategories = async (req, res) => {
  /* #swagger.tags = ['Prompt Templates']
     #swagger.description = 'Get distinct categories that have prompt templates for a given module type.'
     #swagger.parameters['type'] = { in: 'query', description: 'Module type', required: true, type: 'string', enum: ["lifestyle","product_shot","apps_saas","brand_awareness","ai_custom"] }
     #swagger.responses[200] = {
       description: 'Distinct template categories for the type',
       content: { "application/json": { example: { status: true, categories: ["Real Estate", "Food and Beverage Services"] } } }
     }
     #swagger.responses[400] = {
       description: 'Validation error',
       content: { "application/json": { example: { status: false, error: "type must be one of: lifestyle, product_shot, apps_saas, brand_awareness, ai_custom" } } }
     }
     #swagger.responses[401] = { description: 'Missing token' }
     #swagger.responses[403] = { description: 'Invalid or expired token' }
     #swagger.responses[500] = {
       description: 'Server error',
       content: { "application/json": { example: { status: false, error: "Failed to fetch prompt template categories" } } }
     }
  */
  try {
    const { error, value } = getPromptTemplateCategoriesSchema.validate(
      req.query || {},
    );
    if (error)
      return res
        .status(400)
        .json({ status: false, error: error.details[0].message });

    const categories = await PromptTemplate.distinct("category", {
      type: value.type,
      category: { $nin: [null, ""] },
    });

    return res.status(200).json({
      status: true,
      categories: categories.sort(),
    });
  } catch (err) {
    logger.error(
      `[prompt-templates] categories fetch failed: ${err.stack || err.message}`,
    );
    return res.status(500).json({
      status: false,
      error: "Failed to fetch prompt template categories",
    });
  }
};
