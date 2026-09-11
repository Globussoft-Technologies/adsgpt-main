#!/usr/bin/env node

const assert = require("node:assert/strict");
const { inputSchemasByType } = require("../Validations/imageValidator");

const imageUrl = (index) => `https://cdn.example.com/reference-${index}.png`;

const makePayload = ({ referenceCount = 0, competitorReferenceImage = "" } = {}) => ({
    userPrompt: "Create a custom ad",
    ReferenceImages: Array.from({ length: referenceCount }, (_, index) => imageUrl(index)),
    competitorReferenceImage,
    aspectRatioPerImage: [{ aspectRatio: "1:1", numberOfImages: 1 }],
    Model: "gemini-3.1-flash-image-preview",
    quality: "high",
});

const aiAdsSchema = inputSchemasByType.ai_ads.extract("userInputs");

assert.equal(aiAdsSchema.validate(makePayload({ referenceCount: 5 })).error, undefined);
assert.equal(
    aiAdsSchema.validate(makePayload({ referenceCount: 4, competitorReferenceImage: imageUrl(10) })).error,
    undefined,
);

assert.ok(
    aiAdsSchema.validate(makePayload({ referenceCount: 6 })).error,
    "six reference images must be rejected",
);
assert.ok(
    aiAdsSchema.validate(makePayload({ referenceCount: 5, competitorReferenceImage: imageUrl(10) })).error,
    "the competitor reference must count toward the combined five-image limit",
);

const duplicatePayload = makePayload({ referenceCount: 2 });
duplicatePayload.ReferenceImages[1] = duplicatePayload.ReferenceImages[0];
assert.ok(
    aiAdsSchema.validate(duplicatePayload).error,
    "duplicate reference image URLs must be rejected",
);

const lifestyleSchema = inputSchemasByType.lifestyle.extract("userInputs");
const makeLifestylePayload = ({ modelReferences = [], keyVisuals = [] } = {}) => ({
    userPrompt: "Create a lifestyle ad",
    productDescription: "A reusable water bottle",
    modelDescription: { modelReferenceImages: modelReferences },
    keyVisuals,
    aspectRatioPerImage: [{ aspectRatio: "1:1", numberOfImages: 1 }],
    Model: "gemini-3.1-flash-image-preview",
    quality: "high",
});

assert.equal(
    lifestyleSchema.validate(makeLifestylePayload({
        modelReferences: [imageUrl(1), imageUrl(2), imageUrl(3)],
        keyVisuals: [imageUrl(4), imageUrl(5)],
    })).error,
    undefined,
);
assert.ok(
    lifestyleSchema.validate(makeLifestylePayload({
        modelReferences: [imageUrl(1), imageUrl(2), imageUrl(3)],
        keyVisuals: [imageUrl(4), imageUrl(5), imageUrl(6)],
    })).error,
    "Lifestyle model references and key visuals must share the five-image limit",
);
assert.ok(
    lifestyleSchema.validate(makeLifestylePayload({
        modelReferences: [imageUrl(1)],
        keyVisuals: [imageUrl(1)],
    })).error,
    "Lifestyle references must reject the same URL across both image groups",
);

console.log("imageValidator reference limit tests passed");
