const mongoose = require("mongoose");

// Must stay in sync with the ratios the adcreatives Go service supports
// (python-backend/adcreatives/internal/providers/catalog.go).
const SUPPORTED_ASPECT_RATIOS = ["1:1", "4:5", "9:16", "2:3", "3:4", "16:9", "21:9", "3:2", "4:3", "5:4"];

const resultSchema = new mongoose.Schema(
    {
        generatedImageUrl: { type: String },
        aspectRatio: { type: String, enum: SUPPORTED_ASPECT_RATIOS },
        prompt: { type: String, default: "" },
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        imageBytes: { type: Number, default: 0 },
        error: { type: String, default: null },
        status: { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
    },
    { _id: false }
);

const imageSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
        },

        status: {
            type: String,
            enum: ["pending", "processing", "completed", "failed"],
            default: "pending",
        },

        // Callback metadata from Python
        taskId: { type: String },
        creativeType: { type: String },
        model: { type: String },
        error: { type: String, default: null },
        timing: {
            generationMs: { type: Number, default: 0 },
            s3UploadMs: { type: Number, default: 0 },
            totalMs: { type: Number, default: 0 },
        },
        queuedAt: { type: Date },
        completedAt: { type: Date },

        inputs: {
            // =========================
            // CORE
            // =========================
            type: {
                type: String,
                enum: ["lifestyle", "product_shot", "apps_saas", "brand_awareness", "ai_ads", "recreate_ads"],
                required: true,
            },

            model: { type: String, required: true },
            modelLabel: { type: String }, // Human-readable label (e.g., "Nano Banana Pro", "Gemini Flash")
            quality: { type: String, enum: ["low", "medium", "high"], default: "medium" },
            numberOfImages: { type: Number, required: true },
            aspectRatio: {
                type: String,
                enum: SUPPORTED_ASPECT_RATIOS,
            },

            aspectRatioPerImage: [
                {
                    aspectRatio: {
                        type: String,
                        enum: SUPPORTED_ASPECT_RATIOS,
                    },
                    numberOfImages: Number,
                }
            ],

            userPrompt: String,
            instructions: String,

            // =========================
            // PRODUCT
            // =========================
            productUrl: String,
            productName: String,
            productDescription: String,

            productImages: { type: [String], default: [] },
            productScreenshots: { type: [String], default: [] },
            referenceImages: { type: [String], default: [] },
            modelReferenceImages: { type: [String], default: [] },
            keyVisualImages: { type: [String], default: [] },

            // =========================
            // MODEL DETAILS (LIFESTYLE)
            // =========================
            modelDescription: String,

            modelDetails: {
                type: {
                    age: { type: String },
                    gender: { type: String },
                    ethnicity: { type: String },
                    language: { type: String },
                    mood: { type: String },
                    wardrobe: { type: String },
                },
                default: {},
            },

            // =========================
            // BRAND
            // =========================
            brandName: String,
            brandLogo: String,
            brandDescription: String,

            brandImages: { type: [String], default: [] },
            brandColors: { type: [String], default: [] },
            targetPlatforms: { type: [String], default: [] },
            // =========================
            // AI ADS
            // =========================
            prompt: String,
            brandVoice: {
                id: String,
                url: String,
            },
            referenceUrl: String,
            competitorAd: String,

            // =========================
            // MISC
            // =========================
            promotion: String,
            notes: String,
        },

        results: [resultSchema],

        isMigrated: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("ImageGeneration", imageSchema);