#!/usr/bin/env node

const assert = require("node:assert/strict");

const creditsApi = require("../../controllers/creditsApiController");
const { finalizeSchema } = require("../../Validations/creditsApiValidator");

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

  for (const model of models) {
    assert.ok(
      Array.isArray(model.quality_tiers) && model.quality_tiers.length > 0,
      `${model.model} should expose quality-specific credits`,
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
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
