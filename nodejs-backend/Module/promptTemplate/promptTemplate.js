const mongoose = require("mongoose");

// Allowed module names. Mirrors the AdCreative image module `type` values
// (see controllers/imageController.js), with ai_custom in place of ai_ads.
const PROMPT_TEMPLATE_TYPES = [
  "lifestyle",
  "product_shot",
  "apps_saas",
  "brand_awareness",
  "ai_custom",
];

const promptTemplateSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: PROMPT_TEMPLATE_TYPES,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
);

const PromptTemplate = mongoose.model("PromptTemplate", promptTemplateSchema);

module.exports = { PromptTemplate, PROMPT_TEMPLATE_TYPES };
