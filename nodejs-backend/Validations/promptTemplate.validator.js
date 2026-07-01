const Joi = require("joi");
const {
  PROMPT_TEMPLATE_TYPES,
} = require("../Module/promptTemplate/promptTemplate");

// A single prompt-template item.
const promptTemplateItemSchema = Joi.object({
  type: Joi.string()
    .valid(...PROMPT_TEMPLATE_TYPES)
    .required()
    .messages({
      "any.only": `type must be one of: ${PROMPT_TEMPLATE_TYPES.join(", ")}`,
      "any.required": "type is required",
      "string.empty": "type is required",
    }),
  category: Joi.string().trim().max(100).allow(null, "").optional(),
  subcategory: Joi.string().trim().max(100).allow(null, "").optional(),
  title: Joi.string().trim().min(1).max(200).required().messages({
    "string.empty": "title is required",
    "string.min": "title must be at least 1 character",
    "string.max": "title must be 200 characters or fewer",
    "any.required": "title is required",
  }),
  prompt: Joi.string().trim().min(3).max(20000).required().messages({
    "string.empty": "prompt is required",
    "string.min": "prompt must be at least 3 characters",
    "string.max": "prompt must be 20000 characters or fewer",
    "any.required": "prompt is required",
  }),
});

// POST /prompt-templates — bulk insert. Accepts either a raw array of items
// or an object { templates: [...] }. Each entry carries its own `type`, so a
// single call can seed prompts across all module types at once.
const createPromptTemplatesSchema = Joi.object({
  templates: Joi.array()
    .items(promptTemplateItemSchema)
    .min(1)
    .max(500)
    .required()
    .messages({
      "array.base": "templates must be an array",
      "array.min": "send at least one prompt template",
      "array.max": "cannot insert more than 500 templates in one request",
      "any.required": "templates is required",
    }),
});

// GET /prompt-templates?type=...&category=...&search=...
const getPromptTemplatesSchema = Joi.object({
  type: Joi.string()
    .valid(...PROMPT_TEMPLATE_TYPES)
    .required()
    .messages({
      "any.only": `type must be one of: ${PROMPT_TEMPLATE_TYPES.join(", ")}`,
      "any.required": "type is required",
      "string.empty": "type is required",
    }),
  category: Joi.string().trim().max(100).allow(null, "").optional(),
  search: Joi.string().trim().max(200).allow(null, "").optional(),
});

// GET /prompt-templates/categories?type=...
const getPromptTemplateCategoriesSchema = Joi.object({
  type: Joi.string()
    .valid(...PROMPT_TEMPLATE_TYPES)
    .required()
    .messages({
      "any.only": `type must be one of: ${PROMPT_TEMPLATE_TYPES.join(", ")}`,
      "any.required": "type is required",
      "string.empty": "type is required",
    }),
});

module.exports = {
  createPromptTemplatesSchema,
  getPromptTemplatesSchema,
  getPromptTemplateCategoriesSchema,
};
