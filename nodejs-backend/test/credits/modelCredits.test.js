#!/usr/bin/env node

const assert = require("node:assert/strict");

const creditsApi = require("../../controllers/creditsApiController");
const modelConfigurationService = require("../../services/modelConfigurationService");
const { SURFACE_CATALOG } = require("../../config/surfaceCatalog");
const { finalizeSchema } = require("../../Validations/creditsApiValidator");

const imageModelFixture = {
  canonicalKey: "gemini-3.1-flash-image-preview",
  displayName: "Nano Banana 2",
  type: "image",
  enabled: true,
  archived: false,
  credits: 3,
  pricing: { per_image: 0.101 },
  qualityTiers: [
    { quality: "low", credits: 1, pricing: { per_image: 0.04 } },
    { quality: "medium", credits: 2, pricing: { per_image: 0.067 } },
    { quality: "high", credits: 3, pricing: { per_image: 0.101 } },
    { quality: "ultra_high", credits: 4, pricing: { per_image: 0.151 } },
  ],
  surfaces: {
    ad_creative: {
      enabled: true,
      aspectRatios: SURFACE_CATALOG.ad_creative[
        "gemini-3.1-flash-image-preview"
      ].aspectRatios,
      durations: [],
    },
  },
};

async function getImageModels() {
  let statusCode = 0;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return value;
    },
  };

  await creditsApi.getModels({ query: { type: "image" } }, res);
  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  return body.models;
}

(async () => {
  const originalGetAllModels = modelConfigurationService.getAllModels;
  const originalGetRuntimeCredit = modelConfigurationService.getRuntimeCredit;
  modelConfigurationService.getAllModels = async () => [imageModelFixture];
  modelConfigurationService.getRuntimeCredit = (entry, quality) => {
    const tier = entry?.qualityTiers?.find((item) => item.quality === quality);
    return Number(tier?.credits ?? entry?.credits) || 0;
  };

  try {
    const models = await getImageModels();
  const nanoBanana2 = models.find(
    (model) => model.model === "gemini-3.1-flash-image-preview",
  );

  assert.ok(nanoBanana2, "Nano Banana 2 must be exposed to the Assistant");
  assert.deepEqual(
    nanoBanana2.quality_tiers.map((tier) => tier.quality),
    ["low", "medium", "high", "ultra_high"],
  );
  assert.equal(
    nanoBanana2.credit,
    nanoBanana2.quality_tiers.find((tier) => tier.quality === "high").credit,
    "the model's default credit must match its high-quality tier",
  );
  assert.equal(nanoBanana2.label, "Nano Banana 2");
  assert.deepEqual(
    nanoBanana2.surface_capabilities.ad_creative.aspect_ratios,
    SURFACE_CATALOG.ad_creative[
      "gemini-3.1-flash-image-preview"
    ].aspectRatios,
    "Assistant ratios must come from the exact Ad Creative surface catalog",
  );
  assert.equal(
    nanoBanana2.surface_capabilities.ad_creative.aspect_ratios.length,
    14,
  );

  for (const model of models) {
    assert.ok(
      Array.isArray(model.quality_tiers) && model.quality_tiers.length > 0,
      `${model.model} should expose quality-specific credits`,
    );
    assert.ok(
      model.surface_capabilities.ad_creative,
      `${model.model} should be available on the Ad Creative surface`,
    );
  }

  const { error, value } = finalizeSchema.validate({
    reservation_key: "assistant:test:1",
    actual_used: 3,
    media: [
      {
        type: "image",
        url: "/creatives/user/example.webp",
        model: "gemini-3.1-flash-image-preview",
        credit_deduction: 3,
        aspect_ratio: "4:5",
        quality: "high",
      },
    ],
  });
  assert.equal(error, undefined);
  assert.equal(value.media[0].aspect_ratio, "4:5");
  assert.equal(value.media[0].quality, "high");

    console.log("Assistant model credit contract tests passed");
  } finally {
    modelConfigurationService.getAllModels = originalGetAllModels;
    modelConfigurationService.getRuntimeCredit = originalGetRuntimeCredit;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
