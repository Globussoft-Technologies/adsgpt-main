const Joi = require("joi");

// =========================
// SHARED SCHEMAS
// =========================

const aspectRatioPerImageSchema = Joi.array()
    .items(
        Joi.object({
            aspectRatio: Joi.string().valid("9:16", "1:1", "16:9", "2:3", "3:2").required(),
            numberOfImages: Joi.number().integer().min(1).required(),
        })
    )
    .min(1)
    .required();

const brandInfoSchema = Joi.object({
    brandName: Joi.string().required(),
    brandDescription: Joi.string().allow("", null),
    brandLogo: Joi.string().allow("", null),  // Optional - can be empty or blob
    brandImages: Joi.array().items(Joi.string()).allow(null),  // Optional - can contain blobs
    brandColors: Joi.array().items(Joi.string()),
});

const baseUserInputs = {
    userPrompt: Joi.string().required(),
    aspectRatioPerImage: aspectRatioPerImageSchema,
    Model: Joi.string().required(),
};

// =========================
// LIFESTYLE
// =========================
const lifestyleUserInputsSchema = Joi.object({
    ...baseUserInputs,
    productDescription: Joi.string().required(),
    modelDescription: Joi.object({
        age: Joi.string().allow("", null),
        gender: Joi.string().allow("", null),
        language: Joi.string().allow("", null),
        ethnicity: Joi.string().allow("", null),
        mood: Joi.string().allow("", null),
        wardrobe: Joi.string().allow("", null),
        modelReferenceImages: Joi.array().items(Joi.string()),
    }),
    keyVisuals: Joi.array().items(Joi.string()),
});

const lifestyleSchema = Joi.object({
    type: Joi.valid("lifestyle").required(),
    brandInfo: brandInfoSchema.required(),
    userInputs: lifestyleUserInputsSchema.required(),
});

// =========================
// PRODUCT SHOT
// =========================
const productShotUserInputsSchema = Joi.object({
    ...baseUserInputs,
    productName: Joi.string().required(),
    productDescription: Joi.string().allow("", null),
    productImages: Joi.array().items(Joi.string()),
});

const productShotSchema = Joi.object({
    type: Joi.valid("product_shot").required(),
    brandInfo: brandInfoSchema.required(),
    userInputs: productShotUserInputsSchema.required(),
});

// =========================
// APPS / SAAS
// =========================
const appsSaasUserInputsSchema = Joi.object({
    ...baseUserInputs,
    productName: Joi.string().required(),
    productDescription: Joi.string().allow("", null),
    productImages: Joi.array().items(Joi.string()),
});

const appsSaasSchema = Joi.object({
    type: Joi.valid("apps_saas").required(),
    brandInfo: brandInfoSchema.required(),
    userInputs: appsSaasUserInputsSchema.required(),
});

// =========================
// BRAND AWARENESS
// =========================
const brandAwarenessUserInputsSchema = Joi.object({
    ...baseUserInputs,
    productName: Joi.string().allow("", null),
    productDescription: Joi.string().allow("", null),
    productImages: Joi.array().items(Joi.string()),
});

const brandAwarenessSchema = Joi.object({
    type: Joi.valid("brand_awareness").required(),
    brandInfo: brandInfoSchema.required(),
    userInputs: brandAwarenessUserInputsSchema.required(),
});

// =========================
// RECREATE ADS
// =========================
const recreateAdsBrandInfoSchema = Joi.object({
    brandName: Joi.string().allow("", null),
    brandDescription: Joi.string().allow("", null),
    brandLogo: Joi.string().allow("", null),
    brandImages: Joi.array().items(Joi.string()),
    brandColors: Joi.array().items(Joi.string()),
});

const recreateAdsUserInputsSchema = Joi.object({
    userPrompt: Joi.string().required(),
    competitorReferenceImage: Joi.string().required(),
    ReferenceImages: Joi.array().items(Joi.string()),
    aspectRatioPerImage: aspectRatioPerImageSchema,
    Model: Joi.string().required(),
});

const recreateAdsSchema = Joi.object({
    type: Joi.valid("recreate_ads").required(),
    brandInfo: recreateAdsBrandInfoSchema.required(),
    userInputs: recreateAdsUserInputsSchema.required(),
});

// =========================
// AI ADS
// =========================
const aiAdsBrandInfoSchema = Joi.object({
    brandName: Joi.string().allow("", null),
    brandDescription: Joi.string().allow("", null),
    brandLogo: Joi.string().allow("", null),
    brandImages: Joi.array().items(Joi.string()),
    brandColors: Joi.array().items(Joi.string()),
});

const aiAdsUserInputsSchema = Joi.object({
    ...baseUserInputs,
    ReferenceImages: Joi.array().items(Joi.string()),
    competitorReferenceImage: Joi.string().allow("", null),
});

const aiAdsSchema = Joi.object({
    type: Joi.valid("ai_ads").required(),
    brandInfo: aiAdsBrandInfoSchema.required(),
    userInputs: aiAdsUserInputsSchema.required(),
});

// =========================
// MAIN
// =========================
const generateImageRequestSchema = Joi.alternatives().try(
    lifestyleSchema,
    productShotSchema,
    appsSaasSchema,
    brandAwarenessSchema,
    aiAdsSchema,
    recreateAdsSchema
);

// =========================
// RESULT UPDATE (Python callback)
// =========================
const imageResultSchema = Joi.object({
    generatedImageUrl: Joi.string().required(),
    aspectRatio: Joi.string().valid("9:16", "1:1", "16:9", "2:3", "3:2"),
    prompt: Joi.string().allow(""),
    promptTokens: Joi.number().default(0),
    completionTokens: Joi.number().default(0),
    imageBytes: Joi.number().default(0),
    error: Joi.string().allow(null, ""),
});

const updateImageResultSchema = Joi.object({
    taskId: Joi.string().required(),
    userId: Joi.string().required(),
    sessionId: Joi.string().required(),
    creativeType: Joi.string().required(),
    model: Joi.string().required(),
    type: Joi.string().valid("image", "video").required(),
    status: Joi.string().valid("completed", "failed", "pending").required(),
    error: Joi.string().allow(null, ""),
    images: Joi.array()
        .items(imageResultSchema)
        .required(),
    timing: Joi.object({
        generationMs: Joi.number().required(),
        s3UploadMs: Joi.number().required(),
        totalMs: Joi.number().required(),
    }).required(),
    queuedAt: Joi.string().required(),
    completedAt: Joi.string().required(),
});

const inputSchemasByType = {
    lifestyle: lifestyleSchema,
    product_shot: productShotSchema,
    apps_saas: appsSaasSchema,
    brand_awareness: brandAwarenessSchema,
    ai_ads: aiAdsSchema,
    recreate_ads: recreateAdsSchema,
};

module.exports = {
    generateImageRequestSchema,
    updateImageResultSchema,
    inputSchemasByType,
};
