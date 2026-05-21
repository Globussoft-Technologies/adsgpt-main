// Shared brandInfo structure used across all image types
const brandInfoShape = {
    type: "object",
    required: ["brandName", "brandDescription"],
    properties: {
        brandName: { type: "string", example: "Acme" },
        brandDescription: { type: "string", example: "premium everyday goods" },
        brandLogo: { type: "string", example: "" },
        brandImages: { type: "array", items: { type: "string" }, example: [] },
        brandColors: { type: "array", items: { type: "string" }, example: ["#0F172A", "#FACC15"] },
    },
};

const aspectRatioPerImageShape = {
    type: "array",
    items: {
        type: "object",
        properties: {
            aspectRatio: { type: "string", enum: ["9:16", "1:1", "16:9"] },
            numberOfImages: { type: "number", example: 1 },
        },
    },
    example: [
        { aspectRatio: "1:1", numberOfImages: 1 },
        { aspectRatio: "9:16", numberOfImages: 1 },
    ],
};

// AI Ads (ai_ads) — creative ads with reference images
exports.aiAdsImagePayload = {
    type: "object",
    required: ["type", "brandInfo", "userInputs"],
    properties: {
        type: { type: "string", enum: ["ai_ads"] },
        brandInfo: brandInfoShape,
        userInputs: {
            type: "object",
            required: ["userPrompt", "aspectRatioPerImage", "Model"],
            properties: {
                userPrompt: { type: "string", example: "hero shot of our new sneakers on a marble pedestal" },
                ReferenceImages: { type: "array", items: { type: "string" }, example: [] },
                competitorReferenceImage: { type: "string", example: "" },
                aspectRatioPerImage: aspectRatioPerImageShape,
                Model: {
                    type: "string",
                    enum: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5", "gpt-image-2", "seedream-5.0-lite", "ADSGPT-3.0", "ADSGPT-2.0", "ADSGPT-1.0"],
                    example: "gemini-3.1-flash-image-preview",
                },
            },
        },
    },
};

// Lifestyle — human model with product
exports.lifestyleImagePayload = {
    type: "object",
    required: ["type", "brandInfo", "userInputs"],
    properties: {
        type: { type: "string", enum: ["lifestyle"] },
        brandInfo: brandInfoShape,
        userInputs: {
            type: "object",
            required: ["userPrompt", "productDescription", "aspectRatioPerImage", "Model"],
            properties: {
                userPrompt: { type: "string", example: "person enjoying our matte black water bottle on a morning run" },
                productDescription: { type: "string", example: "matte black insulated stainless steel water bottle, 32oz" },
                modelDescription: {
                    type: "object",
                    properties: {
                        age: { type: "string", example: "late 20s" },
                        gender: { type: "string", example: "any" },
                        language: { type: "string", example: "english" },
                        ethnicity: { type: "string", example: "diverse" },
                        mood: { type: "string", example: "energetic" },
                        wardrobe: { type: "string", example: "athleisure" },
                        modelReferenceImages: { type: "array", items: { type: "string" }, example: [] },
                    },
                },
                keyVisuals: { type: "array", items: { type: "string" }, example: [] },
                aspectRatioPerImage: aspectRatioPerImageShape,
                Model: {
                    type: "string",
                    enum: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5", "gpt-image-2", "seedream-5.0-lite", "ADSGPT-3.0", "ADSGPT-2.0", "ADSGPT-1.0"],
                    example: "gemini-3.1-flash-image-preview",
                },
            },
        },
    },
};

// Product Shot — commercial product photography
exports.productShotImagePayload = {
    type: "object",
    required: ["type", "brandInfo", "userInputs"],
    properties: {
        type: { type: "string", enum: ["product_shot"] },
        brandInfo: {
            ...brandInfoShape,
            properties: {
                ...brandInfoShape.properties,
                brandColors: { type: "array", items: { type: "string" }, example: ["#0F172A"] },
            },
        },
        userInputs: {
            type: "object",
            required: ["userPrompt", "productName", "productDescription", "productImages", "aspectRatioPerImage", "Model"],
            properties: {
                userPrompt: { type: "string", example: "hero studio shot" },
                productName: { type: "string", example: "Acme Bottle" },
                productDescription: { type: "string", example: "matte black insulated bottle, 32oz" },
                productImages: {
                    type: "array",
                    items: { type: "string" },
                    example: ["https://example.com/bottle-front.png"],
                },
                aspectRatioPerImage: {
                    ...aspectRatioPerImageShape,
                    example: [{ aspectRatio: "1:1", numberOfImages: 1 }],
                },
                Model: {
                    type: "string",
                    enum: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5", "gpt-image-2", "seedream-5.0-lite", "ADSGPT-3.0", "ADSGPT-2.0", "ADSGPT-1.0"],
                    example: "gemini-3.1-flash-image-preview",
                },
            },
        },
    },
};

// Apps / SaaS — conversion-focused app screenshot ads
exports.appsSaasImagePayload = {
    type: "object",
    required: ["type", "brandInfo", "userInputs"],
    properties: {
        type: { type: "string", enum: ["apps_saas"] },
        brandInfo: {
            ...brandInfoShape,
            properties: {
                ...brandInfoShape.properties,
                brandColors: { type: "array", items: { type: "string" }, example: ["#6366F1"] },
            },
        },
        userInputs: {
            type: "object",
            required: ["userPrompt", "productName", "productDescription", "productImages", "aspectRatioPerImage", "Model"],
            properties: {
                userPrompt: { type: "string", example: "premium landing-page hero" },
                productName: { type: "string", example: "Acme Tasks" },
                productDescription: { type: "string", example: "kanban board with realtime collaboration" },
                productImages: {
                    type: "array",
                    items: { type: "string" },
                    example: ["https://example.com/screenshot.png"],
                },
                aspectRatioPerImage: {
                    ...aspectRatioPerImageShape,
                    example: [{ aspectRatio: "16:9", numberOfImages: 1 }],
                },
                Model: {
                    type: "string",
                    enum: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5", "gpt-image-2", "seedream-5.0-lite", "ADSGPT-3.0", "ADSGPT-2.0", "ADSGPT-1.0"],
                    example: "gemini-3.1-flash-image-preview",
                },
            },
        },
    },
};

// Brand Awareness — identity-first creative
exports.brandAwarenessImagePayload = {
    type: "object",
    required: ["type", "brandInfo", "userInputs"],
    properties: {
        type: { type: "string", enum: ["brand_awareness"] },
        brandInfo: brandInfoShape,
        userInputs: {
            type: "object",
            required: ["userPrompt", "aspectRatioPerImage", "Model"],
            properties: {
                userPrompt: { type: "string", example: "evoke calm, premium, refined identity" },
                productName: { type: "string", example: "" },
                productDescription: { type: "string", example: "" },
                productImages: { type: "array", items: { type: "string" }, example: [] },
                aspectRatioPerImage: {
                    ...aspectRatioPerImageShape,
                    example: [{ aspectRatio: "1:1", numberOfImages: 1 }],
                },
                Model: {
                    type: "string",
                    enum: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5", "gpt-image-2", "seedream-5.0-lite", "ADSGPT-3.0", "ADSGPT-2.0", "ADSGPT-1.0"],
                    example: "gemini-3.1-flash-image-preview",
                },
            },
        },
    },
};

// Python callback — image result update
exports.updateImageResultPayload = {
    type: "object",
    required: ["imageStatus", "userId"],
    properties: {
        model: { type: "string", example: "gemini-3.1-flash-image-preview" },
        url: { type: "string", format: "uri", example: "https://cdn.example.com/generated-image.jpg" },
        error: { type: "string", nullable: true, example: null },
        imageStatus: { type: "number", enum: [200, 400, 500, 529], example: 200 },
        userId: { type: "string", example: "user_123456" },
        inputTokens: { type: "number", example: 150 },
        outputTokens: { type: "number", example: 200 },
    },
};
