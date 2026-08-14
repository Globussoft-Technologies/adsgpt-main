const {
    generateImageRequestSchema,
    updateImageResultSchema,
    inputSchemasByType,
} = require("../Validations/imageValidator");
const ImageGeneration = require("../Module/imageGeneration/imageModel");
const UnifiedCreditController = require("./UnifiedCreditController");
const mongoose = require("mongoose");
const axios = require("axios");
const logger = require("../utils/logger");
const modelPricingConfig = require("../config/modelPricingConfig");
const modelConfigurationService = require("../services/modelConfigurationService");
const GeneratedMediaController = require("./generatedMedia.controller");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
const { notifyUser } = require("../services/push/notifyUser");
const { trackBackendGA4Event } = require("../utils/ga4");

// Format Joi validation errors into user-friendly messages
const formatValidationError = (errorDetails) => {
    return errorDetails
        .map((d) => {
            const field = d.path.join(".");
            if (d.type === "any.required") {
                return `${field} is required`;
            }
            if (d.type === "any.empty") {
                return `${field} cannot be empty`;
            }
            return d.message.replace(/"/g, "").replace(/\s*[\\/]+\s*/g, " ");
        })
        .join("; ");
};

// Maps the new Python-aligned payload to the existing flat DB schema format
const buildDbInputs = (value) => {
    const { type, brandInfo, userInputs } = value;
    const totalImages = userInputs.aspectRatioPerImage.reduce((sum, r) => sum + r.numberOfImages, 0);

    // Resolve model to get its label
    const modelEntry = modelConfigurationService.getRuntimeModel(userInputs.Model);
    const modelLabel = modelEntry ? (modelEntry.displayName || modelEntry.label) : null;

    const dbInputs = {
        type,
        model: userInputs.Model,
        modelLabel,
        quality: userInputs.quality || "high",
        numberOfImages: totalImages,
        aspectRatio: userInputs.aspectRatioPerImage[0]?.aspectRatio,
        aspectRatioPerImage: userInputs.aspectRatioPerImage,
        userPrompt: userInputs.userPrompt,
        brandName: brandInfo?.brandName,
        brandDescription: brandInfo?.brandDescription,
        brandLogo: brandInfo?.brandLogo,
        brandImages: brandInfo?.brandImages || [],
        brandColors: brandInfo?.brandColors || [],
    };

    switch (type) {
        case "lifestyle":
            dbInputs.productDescription = userInputs.productDescription;
            dbInputs.modelDescription = userInputs.modelDescription
                ? JSON.stringify(userInputs.modelDescription)
                : "";
            dbInputs.keyVisualImages = userInputs.keyVisuals || [];
            break;
        case "product_shot":
            dbInputs.productName = userInputs.productName;
            dbInputs.productDescription = userInputs.productDescription;
            dbInputs.productImages = userInputs.productImages || [];
            break;
        case "apps_saas":
            dbInputs.productName = userInputs.productName;
            dbInputs.productDescription = userInputs.productDescription;
            dbInputs.productScreenshots = userInputs.productImages || [];
            break;
        case "brand_awareness":
            dbInputs.referenceImages = userInputs.productImages || [];
            break;
        case "ai_ads":
            dbInputs.referenceImages = userInputs.ReferenceImages || [];
            dbInputs.competitorAd = userInputs.competitorReferenceImage || "";
            break;
        case "recreate_ads":
            dbInputs.referenceImages = userInputs.ReferenceImages || [];
            dbInputs.competitorAd = userInputs.competitorReferenceImage;
            break;
    }

    return dbInputs;
};

const emitCreditStatus = async (userId) => {
    try {
        const creditStatus = await UnifiedCreditController.getCreditStatus(userId);
        const payload = {
            creditsUsed: creditStatus.used_credits,
            totalCredits: creditStatus.total_credits,
            remainingCredits: creditStatus.remaining_credits,
            frozenCredits: creditStatus.frozen_credits,
            settledCredits: creditStatus.settled_credits,
            subscription: creditStatus.subscription,
            rollover: creditStatus.rollover,
            topup: creditStatus.topup,
        };
        if (global.io) {
            try {
                global.io.to(userId).emit("credits", payload);
                console.log(`[Socket] Emitted credits update for userId: ${userId}`);
            } catch (socketErr) {
                console.error(`[Socket] Failed to emit credits: ${socketErr.message}`);
            }
        } else {
            console.warn("[Socket] global.io not available - credits emit skipped");
        }
    } catch (error) {
        console.error("Error emitting credit status:", error);
    }
};

exports.generateImage = async (req, res) => {
    try {
        /* #swagger.tags = ['Image Generation']
           #swagger.summary = 'Submit image generation request'
           #swagger.description = 'Dynamic API handling lifestyle, product_shot, apps_saas, brand_awareness, ai_ads, and recreate_ads image types. Each type has different required fields inside userInputs. <br/><br/>`userInputs.quality` is optional: `low | medium | high | ultra_high` (default `high`; `ultra_high` is only supported by Nano Banana 2). <br/>`aspectRatioPerImage[].aspectRatio` accepts: 1:1, 4:5, 9:16, 2:3, 3:4, 16:9, 21:9, 3:2, 4:3, 5:4, 1:4, 4:1, 1:8, 8:1 (per-model subset — see /usage/model-credit-value?media=ad_creative).'
           #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        examples: {
                            "AI Creatives": {
                                value: {
                                    type: "ai_ads",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "premium everyday goods",
                                        brandLogo: "",
                                        brandImages: [],
                                        brandColors: ["#0F172A", "#FACC15"]
                                    },
                                    userInputs: {
                                        userPrompt: "hero shot of our new sneakers on a marble pedestal",
                                        ReferenceImages: [],
                                        competitorReferenceImage: "",
                                        aspectRatioPerImage: [
                                            { aspectRatio: "1:1", numberOfImages: 2 },
                                            { aspectRatio: "9:16", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview",
                                        quality: "high"
                                    }
                                }
                            },
                            "Lifestyle Ads": {
                                value: {
                                    type: "lifestyle",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "premium everyday goods",
                                        brandLogo: "",
                                        brandImages: [],
                                        brandColors: ["#0F172A", "#FACC15"]
                                    },
                                    userInputs: {
                                        userPrompt: "person enjoying our matte black water bottle on a morning run",
                                        productDescription: "matte black insulated stainless steel water bottle, 32oz",
                                        modelDescription: {
                                            age: "late 20s",
                                            gender: "any",
                                            language: "english",
                                            ethnicity: "diverse",
                                            mood: "energetic",
                                            wardrobe: "athleisure",
                                            modelReferenceImages: []
                                        },
                                        keyVisuals: [],
                                        aspectRatioPerImage: [
                                            { aspectRatio: "1:1", numberOfImages: 1 },
                                            { aspectRatio: "9:16", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview"
                                    }
                                }
                            },
                            "Product Shot": {
                                value: {
                                    type: "product_shot",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "premium everyday goods",
                                        brandLogo: "",
                                        brandImages: [],
                                        brandColors: ["#0F172A"]
                                    },
                                    userInputs: {
                                        userPrompt: "hero studio shot",
                                        productName: "Acme Bottle",
                                        productDescription: "matte black insulated bottle, 32oz",
                                        productImages: ["https://example.com/bottle-front.png"],
                                        aspectRatioPerImage: [
                                            { aspectRatio: "1:1", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview"
                                    }
                                }
                            },
                            "SaaS Ads": {
                                value: {
                                    type: "apps_saas",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "task management",
                                        brandLogo: "",
                                        brandImages: [],
                                        brandColors: ["#6366F1"]
                                    },
                                    userInputs: {
                                        userPrompt: "premium landing-page hero",
                                        productName: "Acme Tasks",
                                        productDescription: "kanban board with realtime collaboration",
                                        productImages: ["https://example.com/screenshot.png"],
                                        aspectRatioPerImage: [
                                            { aspectRatio: "16:9", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview"
                                    }
                                }
                            },
                            "Brand Awareness": {
                                value: {
                                    type: "brand_awareness",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "premium everyday goods",
                                        brandLogo: "",
                                        brandImages: [],
                                        brandColors: ["#0F172A", "#FACC15"]
                                    },
                                    userInputs: {
                                        userPrompt: "evoke calm, premium, refined identity",
                                        productName: "",
                                        productDescription: "",
                                        productImages: [],
                                        aspectRatioPerImage: [
                                            { aspectRatio: "1:1", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview"
                                    }
                                }
                            },
                            "Recreate Ads": {
                                value: {
                                    type: "recreate_ads",
                                    brandInfo: {
                                        brandName: "Acme",
                                        brandDescription: "premium everyday goods",
                                        brandLogo: "https://cdn.example.com/acme-logo.png",
                                        brandImages: [],
                                        brandColors: ["#0F172A", "#FACC15"]
                                    },
                                    userInputs: {
                                        userPrompt: "recreate this ad with our sneakers and brand voice",
                                        ReferenceImages: ["https://cdn.example.com/our-sneaker.png"],
                                        competitorReferenceImage: "https://cdn.example.com/competitor-ad.jpg",
                                        aspectRatioPerImage: [
                                            { aspectRatio: "1:1", numberOfImages: 1 }
                                        ],
                                        Model: "gemini-3.1-flash-image-preview"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        */

        console.log("[generateImage]  Request received:", JSON.stringify({ type: req.body?.type, brandName: req.body?.brandInfo?.brandName, aspectRatios: req.body?.userInputs?.aspectRatioPerImage }, null, 2));

        const requestType = req.body?.type;
        const optionalBrandNameTypes = ["recreate_ads", "ai_ads", "lifestyle", "product_shot", "apps_saas"];
        if (!optionalBrandNameTypes.includes(requestType) && (!req.body?.brandInfo?.brandName || req.body.brandInfo.brandName.trim() === "")) {
            console.error("[generateImage] brandName is empty");
            return res.status(400).json({
                success: false,
                error: "brandName is required",
            });
        }

        const { error, value } = generateImageRequestSchema.validate(req.body);

        if (error) {
            console.error("[generateImage]  Validation FAILED:", error.details);
        } else {
            console.log("[generateImage]  Validation PASSED");
        }

        if (error) {
            const inputType = req.body?.type;
            const specificSchema = inputSchemasByType[inputType];

            if (specificSchema) {
                const { error: specificError } = specificSchema.validate(
                    req.body,
                    { abortEarly: false }
                );
                if (specificError) {
                    const fieldErrors = formatValidationError(specificError.details);
                    console.error(`[generateImage] Validation failed for type ${inputType}:`, fieldErrors);
                    return res.status(400).json({ success: false, error: fieldErrors });
                }
            }

            const fieldErrors = formatValidationError(error.details);
            console.error("[generateImage] Schema validation failed:", fieldErrors);
            return res.status(400).json({ success: false, error: fieldErrors });
        }

        // Validate user authentication
        if (!req.user || !req.user.user_id) {
            console.error("[generateImage] User not authenticated. req.user:", req.user, "Headers:", req.headers);
            return res.status(401).json({
                success: false,
                error: "Authentication required. Please provide valid JWT token.",
            });
        }

        // Get user ID from multiple possible locations
        let userId = req.user?.user_id || req.user?.id || req.user?.userId;

        if (!userId) {
            console.error("[generateImage] User ID not found. req.user:", req.user);
            return res.status(401).json({
                success: false,
                error: "Authentication failed: User ID not found in token",
            });
        }
        console.log(`[generateImage] Authenticated user: ${userId}`);

        // Quality picker is now enabled on the creative surfaces, so the client
        // sends the chosen quality. The force-HIGH override below is cancelled —
        // the sent quality flows through to buildDbInputs, the Python payload,
        // and credit charging. Validation defaults quality to "high" if absent,
        // so records/charging stay safe when no choice arrives.
        // value.userInputs.quality = "high";

        const selectedModel = value.userInputs.Model;
        // LEGACY (pre-quality, flat top-level rate) — kept for reference:
        // const imageCreditCost = UnifiedCreditController.getModelDeduction(selectedModel);
        // Quality-aware charge. quality is forced "high" just above, so image
        // models are billed at their high tier; tier-less models fall back to
        // the flat rate inside getModelDeductionByQuality.
        const imageCreditCost = UnifiedCreditController.getModelDeductionByQuality(
            selectedModel,
            value.userInputs.quality,
        );
        const totalImages = value.userInputs.aspectRatioPerImage.reduce(
            (sum, r) => sum + r.numberOfImages,
            0
        );
        const totalRequiredCredits = totalImages * imageCreditCost;

        const imageData = {
            userId,
            inputs: buildDbInputs(value),
            status: "pending",
        };

        const image = await ImageGeneration.create(imageData);
        const imageId = image._id.toString();

        // Atomic freeze — receipt key is imageId; the result handler settles/releases.
        const freeze = await UnifiedCreditController.freezeCredits({
            userId,
            reservationKey: imageId,
            amount: totalRequiredCredits,
            meta: {
                service_type: "image_gen",
                model: selectedModel,
                imageType: value.type,
                totalImages,
            },
        });

        if (!freeze.ok) {
            await ImageGeneration.deleteOne({ _id: imageId });
            if (freeze.reason === "NO_BASE_PLAN") {
                return res.status(403).json({
                    success: false,
                    error: "An active subscription plan is required.",
                });
            }
            if (freeze.reason === "INSUFFICIENT") {
                return res.status(402).json({
                    success: false,
                    error: `Insufficient credits. You need ${totalRequiredCredits} credits for ${totalImages} image(s) but only have ${freeze.remaining}.`,
                });
            }
            return res.status(503).json({
                success: false,
                error: "Could not reserve credits. Please try again.",
            });
        }

        const pythonPayload = {
            brandInfo: value.brandInfo,
            userInputs: value.userInputs,
            sessionId: imageId,
            userId,
        };

        

        const typeToApiUrl = {
            lifestyle: process.env.LIFESTYLE_IMAGE_PYTHON_API,
            product_shot: process.env.PRODUCT_SHOT_IMAGE_PYTHON_API,
            apps_saas: process.env.APPS_SAAS_IMAGE_PYTHON_API,
            brand_awareness: process.env.BRAND_AWARENESS_IMAGE_PYTHON_API,
            ai_ads: process.env.AI_ADS_IMAGE_PYTHON_API,
            recreate_ads: process.env.RECREATE_ADS_IMAGE_PYTHON_API,
        };

        const targetApi = typeToApiUrl[value.type];

        if (targetApi) {
            try {
                if (value.type === "lifestyle") {
                    trackBackendGA4Event("ad_creative_lifestyle_ad", {
                        user_id: userId,
                        feature: "ad_creative",
                        action_name: "lifestyle_ad_requested",
                        source: "lifestyle_ad_form",
                        success: true,
                    });
                } else if (value.type === "product_shot") {
                    trackBackendGA4Event("ad_creative_product_shot", {
                        user_id: userId,
                        feature: "ad_creative",
                        action_name: "product_shot_requested",
                        source: "product_shot_form",
                        success: true,
                    });
                } else if (value.type === "brand_awareness") {
                    trackBackendGA4Event("ad_creative_brand_awareness", {
                        user_id: userId,
                        feature: "ad_creative",
                        action_name: "brand_awareness_requested",
                        source: "brand_awareness_form",
                        success: true,
                    });
                } else if (value.type === "apps_saas") {
                    trackBackendGA4Event("ad_creative_apps_saas", {
                        user_id: userId,
                        feature: "ad_creative",
                        action_name: "apps_saas_requested",
                        source: "apps_saas_form",
                        success: true,
                    });
                } else if (value.type === "recreate_ads") {
                    trackBackendGA4Event("ad_library", {
                        user_id: userId,
                        feature: "ad_library",
                        action_name: "ad_library_recreate_requested",
                        source: "ad_library_recreate_form",
                        success: true,
                    });
                }
                console.log(`[generateImage]  Sending to Python API: ${targetApi}`);
                console.log(`[generateImage]  Payload:`, JSON.stringify({ type: value.type, brandName: value.brandInfo.brandName, sessionId: imageId }, null, 2));

                const pythonResponse = await axios.post(targetApi, pythonPayload);

                if (pythonResponse.status === 200) {
                    console.log(`[generateImage]  Python API responded with 200`);

                    await ImageGeneration.updateOne(
                        { _id: imageId },
                        { $set: { status: "processing" } }
                    );
                }
            } catch (err) {
                console.error(`[Python API] Failed - ${value.type} - sessionId: ${imageId} - Status: ${err.response?.status}`);
                console.error(`[Python API] Error:`, err.response?.data?.error || err.message);

                // Python rejected → refund freeze + clean up.
                await UnifiedCreditController.releaseCredits(imageId);
                await ImageGeneration.deleteOne({ _id: imageId });

                // Extract error from Python API response
                const pythonApiError = err.response?.data?.error || err.message;
                const httpStatus = err.response?.status || 500;

                return res.status(httpStatus).json({
                    success: false,
                    error: pythonApiError,
                });
            }
        } else {
            console.error(`[Python API] No API configured for type: ${value.type}`);
            // No Python API configured → release the freeze rather than leak it.
            await UnifiedCreditController.releaseCredits(imageId);
        }

        return res.status(201).json({
            success: true,
            message: "Image generation request submitted successfully",
            data: image,
        });
    } catch (err) {
        console.error("[generateImage] Error:", err.message);
        console.error("[generateImage] Stack:", err.stack);
        res.status(500).json({
            success: false,
            error: err.message || "An error occurred while processing your request",
        });
    }
};

// Persist a client-side edited image (e.g. the MySpace logo editor's
// "Save as new") as a brand-new completed record so it survives a refresh
// and shows up in GET /image/all alongside generated images.
//
// No credits are charged — the composite was produced client-side and the
// file is already on S3; this is purely a DB insert. The new record clones
// the source image's `inputs` (authoritative + schema-valid) so the card's
// Info tooltip and Recreate behave exactly like the source.
exports.saveEditedImage = async (req, res) => {
    try {
        /* #swagger.tags = ['Image Generation']
           #swagger.summary = 'Save a client-side edited image as a new record' */
        const userId = req.user?.user_id || req.user?.id || req.user?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: "Authentication required" });
        }

        const { url, sourceImageId, inputs: bodyInputs, aspectRatio } = req.body || {};
        if (!url || typeof url !== "string") {
            return res.status(400).json({ success: false, error: "url is required" });
        }

        // Prefer the source record's inputs (authoritative); fall back to the
        // inputs the client carried over from the original generation.
        let inputs = null;
        if (sourceImageId && mongoose.Types.ObjectId.isValid(sourceImageId)) {
            const source = await ImageGeneration.findOne({ _id: sourceImageId, userId }).lean();
            if (source?.inputs) inputs = source.inputs;
        }
        if (!inputs) inputs = bodyInputs;
        if (!inputs || !inputs.type || !inputs.model) {
            return res.status(400).json({
                success: false,
                error: "Could not resolve source image inputs",
            });
        }

        const record = await ImageGeneration.create({
            userId,
            status: "completed",
            creativeType: "logo_edited",
            model: inputs.model,
            inputs,
            results: [
                {
                    generatedImageUrl: url,
                    status: "completed",
                    aspectRatio: aspectRatio || inputs.aspectRatio,
                },
            ],
        });

        return res.status(201).json({ success: true, data: record });
    } catch (err) {
        console.error("[saveEditedImage] Error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.getProcessingCount = async (req, res) => {
    try {
        const filter = { status: "processing", userId: req.user.user_id };
        const count = await ImageGeneration.countDocuments(filter);

        res.json({
            success: true,
            count,
        });
    } catch (err) {
        console.error("[getProcessingCount] Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateImageResult = async (req, res) => {
    try {
        /* #swagger.tags = ['Image Generation']
           #swagger.summary = 'Update image generation results from Python worker'
           #swagger.description = 'Called by Python worker after image generation completes. Requires secret key. Updates the image record status and deducts credits on success.'
           #swagger.parameters['sessionId'] = {
               in: 'path',
               required: true,
               type: 'string',
               description: 'Session ID (Image ID) of the image to update'
           }
           #swagger.requestBody = {
                required: true,
                content: {
                    "application/json": {
                        examples: {
                            "Success": {
                                value: {
                                    model: "gemini-3.1-flash-image-preview",
                                    url: "https://cdn.example.com/generated-image-001.jpg",
                                    imageStatus: 200,
                                    userId: "user_123456",
                                    inputTokens: 150,
                                    outputTokens: 200,
                                    error: null
                                }
                            },
                            "Error": {
                                value: {
                                    model: "gemini-3.1-flash-image-preview",
                                    url: "",
                                    imageStatus: 500,
                                    userId: "user_123456",
                                    inputTokens: 150,
                                    outputTokens: 0,
                                    error: "Failed to generate image: insufficient GPU memory"
                                }
                            }
                        }
                    }
                }
            }
           #swagger.responses[200] = { description: 'Image result updated successfully' }
           #swagger.responses[404] = { description: 'Image record not found' }
           #swagger.responses[400] = { description: 'Invalid request payload' }
        */

        const { error, value } = updateImageResultSchema.validate(req.body, {
            abortEarly: false,
        });

        if (error) {
            const fieldErrors = error.details.map((d) => d.message).join("; ");
            return res.status(400).json({
                success: false,
                error: fieldErrors,
            });
        }

        logger.info(
            `Received image result update for sessionId ${value.sessionId}: ${JSON.stringify(
                value
            )}`
        );

        const {
            taskId,
            userId,
            sessionId,
            creativeType,
            model,
            type,
            status,
            error: callbackError,
            images,
            timing,
            queuedAt,
            completedAt,
        } = value;

        // Map status values to DB enum
        let dbStatus = "failed";
        let imageStatus = "failed";
        if (status === "completed") {
            dbStatus = "completed";
            imageStatus = "completed";
        }
        if (status === "pending") {
            dbStatus = "processing";
            imageStatus = "processing";
        }

        // Add status to each image result
        const imagesWithStatus = (images || []).map((img) => ({
            ...img,
            status: imageStatus,
        }));

        const updateQuery = {
            $push: {
                results: {
                    $each: imagesWithStatus,
                },
            },
            $set: {
                status: dbStatus,
                taskId,
                creativeType,
                model,
                error: callbackError,
                // Note: timing, queuedAt, completedAt, and imageBytes are accepted in validation
                // but intentionally NOT stored in the database per design decision
            },
        };

        console.log(
            `[credits] updateImageResult ENTER session=${sessionId} status=${status} model=${model} imagesCount=${images?.length || 0}`,
        );

        // Capture PRE-update doc so we can detect duplicate callbacks: if the
        // record was already terminal, a prior callback already settled or
        // released the freeze. Running again would NO_RECEIPT-fallthrough into
        // deductCredits and double-charge.
        const priorDoc = await ImageGeneration.findOneAndUpdate(
            { _id: sessionId },
            updateQuery,
            { new: false, lean: true }
        );

        if (!priorDoc) {
            console.warn(
                `[credits] updateImageResult 404 session=${sessionId} — no image record`,
            );
            return res.status(404).json({
                success: false,
                error: "Image record not found",
            });
        }

        // Duplicate-callback guard. If the record was already terminal, a
        // prior callback already settled or released the freeze. Running
        // again would NO_RECEIPT-fallthrough into deductCredits → double-charge.
        const priorTerminal =
            priorDoc.status === "completed" || priorDoc.status === "failed";

        // Reconstruct the post-update view for the downstream emit/log code.
        const image = {
            ...priorDoc,
            status: dbStatus,
            results: [...(priorDoc.results || []), ...imagesWithStatus],
        };

        if (priorTerminal) {
            console.warn(
                `[credits] updateImageResult DUPLICATE session=${sessionId} ` +
                    `prior_status=${priorDoc.status} new_status=${status} ` +
                    `— skipping credit work`,
            );
            // Re-emit to the socket only (reconnected web tabs may have missed
            // the first emit). No push here — the original callback already
            // pushed, and re-pushing would double-buzz the app.
            await notifyUser(image?.userId, {
                event: "imageCreated",
                socketPayload: {
                    _id: image._id,
                    image: {
                        ...image,
                        url: images?.[0]?.generatedImageUrl || "",
                    },
                    userId: image?.userId,
                },
            });
            return res.status(200).json({ success: true, duplicate: true });
        }

        // Settle the freeze on success, release on failure.
        if (status === "completed" && images && images.length > 0) {
            // Charge only for the images that ACTUALLY succeeded. A request
            // that asked for N images may return any mix of N successes and
            // failures — releasePartial will keep `successfulCount × cost`
            // debited and refund the rest of the freeze in one atomic step.
            //
            // Source of truth: `generatedImageUrl`. If Python returns a URL,
            // the image was generated and is usable. The `error` field can
            // carry non-fatal info (e.g. "status 401: Unauthorized" from a
            // secondary call) without invalidating the result — we DO NOT
            // check it here, otherwise a quirky-but-valid image is refunded.
            const successfulImages = images.filter(
                (img) => !!img?.generatedImageUrl,
            );
            const failedCount = images.length - successfulImages.length;
            // LEGACY (pre-quality, flat top-level rate) — kept for reference:
            // const perImage = UnifiedCreditController.getModelDeduction(model);
            // Quality-aware charge — read the quality persisted on the record
            // (buildDbInputs stores userInputs.quality, defaulting to "high").
            const perImage = UnifiedCreditController.getModelDeductionByQuality(
                model,
                priorDoc?.inputs?.quality,
            );
            const totalCreditsToDeduct = perImage * successfulImages.length;
            const totalPromptTokens = images.reduce((sum, img) => sum + (img.promptTokens || 0), 0);
            const totalCompletionTokens = images.reduce((sum, img) => sum + (img.completionTokens || 0), 0);

            console.log(
                `[credits] updateImageResult settle session=${sessionId} ` +
                    `requested=${priorDoc?.inputs?.numberOfImages || "?"} ` +
                    `received=${images.length} successful=${successfulImages.length} ` +
                    `failed=${failedCount} chargeAmount=${totalCreditsToDeduct}`,
            );

            const settleResult = await UnifiedCreditController.releasePartial(
                sessionId,
                totalCreditsToDeduct,
            );
            if (!settleResult.ok && settleResult.reason === "NO_RECEIPT") {
                await UnifiedCreditController.deductCredits(
                    userId,
                    totalCreditsToDeduct,
                    {
                        model,
                        service_type: "ad_image",
                        item_count: successfulImages.length,
                        duration: timing?.totalMs || 0,
                        resolution: "standard",
                        session_id: sessionId,
                        chat_id: image._id.toString(),
                    }
                );
            }

            const actualImageCost = modelPricingConfig.getImageCostByQuality(
                model,
                priorDoc?.inputs?.quality,
                totalPromptTokens,
                totalCompletionTokens
            );
            // Only persist GeneratedMedia / GeneratedCount rows for actually
            // successful images. Failed items shouldn't show up in the user
            // dashboard as "generated", and shouldn't inflate credit_deduction.
            for (const img of successfulImages) {
                GeneratedMediaController.saveGeneratedMedia({
                    userId,
                    model,
                    type: "image",
                    image: img?.generatedImageUrl || "",
                    video: "",
                    credit_deduction: perImage,
                    cost: actualImageCost,
                    quality: priorDoc?.inputs?.quality || "high",
                    duration: timing?.totalMs || 0,
                });
                const newCount = new GeneratedCount({
                    userId: userId,
                    type: "image",
                    url: img?.generatedImageUrl,
                    model: model,
                });
                newCount.save().catch(() => {});
            }

            
        } else if (status === "completed" || status === "failed" || status === "error") {
            // Terminal status that didn't settle above (e.g. "completed" with
            // 0 images, or any failure) → refund the freeze in full. Leaving
            // the receipt dangling would let the sweep cron refund a settled
            // generation 60 minutes later. Intermediate statuses like "pending"
            // intentionally fall through — they're partial updates, freeze stays.
            await UnifiedCreditController.releaseCredits(sessionId);
        }

        if (priorDoc?.inputs?.type === "lifestyle") {
            if (status === "completed" && images && images.length > 0) {
                trackBackendGA4Event("ad_creative_lifestyle_ad", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "lifestyle_ad_generated",
                    source: "lifestyle_ad_studio",
                    success: true,
                });
            } else {
                trackBackendGA4Event("ad_creative_lifestyle_ad", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "lifestyle_ad_failed",
                    source: "lifestyle_ad_studio",
                    success: false,
                });
            }
        } else if (priorDoc?.inputs?.type === "product_shot") {
            if (status === "completed" && images && images.length > 0) {
                trackBackendGA4Event("ad_creative_product_shot", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "product_shot_generated",
                    source: "product_shot_studio",
                    success: true,
                });
            } else {
                trackBackendGA4Event("ad_creative_product_shot", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "product_shot_failed",
                    source: "product_shot_studio",
                    success: false,
                });
            }
        } else if (priorDoc?.inputs?.type === "brand_awareness") {
            if (status === "completed" && images && images.length > 0) {
                trackBackendGA4Event("ad_creative_brand_awareness", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "brand_awareness_generated",
                    source: "brand_awareness_studio",
                    success: true,
                });
            } else {
                trackBackendGA4Event("ad_creative_brand_awareness", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "brand_awareness_failed",
                    source: "brand_awareness_studio",
                    success: false,
                });
            }
        } else if (priorDoc?.inputs?.type === "apps_saas") {
            if (status === "completed" && images && images.length > 0) {
                trackBackendGA4Event("ad_creative_apps_saas", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "apps_saas_generated",
                    source: "apps_saas_studio",
                    success: true,
                });
            } else {
                trackBackendGA4Event("ad_creative_apps_saas", {
                    user_id: userId,
                    feature: "ad_creative",
                    action_name: "apps_saas_failed",
                    source: "apps_saas_studio",
                    success: false,
                });
            }
        } else if (priorDoc?.inputs?.type === "recreate_ads") {
            if (status === "completed" && images && images.length > 0) {
                trackBackendGA4Event("ad_library", {
                    user_id: userId,
                    feature: "ad_library",
                    action_name: "ad_library_recreate_generated",
                    source: "ad_library_recreate_studio",
                    success: true,
                });
            } else {
                trackBackendGA4Event("ad_library", {
                    user_id: userId,
                    feature: "ad_library",
                    action_name: "ad_library_recreate_failed",
                    source: "ad_library_recreate_studio",
                    success: false,
                });
            }
        }

        // Notify over websocket (web + foreground app) and, when the image
        // actually succeeded, FCM push (backgrounded/closed native apps).
        const imageSucceeded = !!images?.[0]?.generatedImageUrl;
        await notifyUser(image?.userId, {
            event: "imageCreated",
            socketPayload: {
                _id: image._id,
                image: {
                    ...image,
                    url: images?.[0]?.generatedImageUrl || "",
                },
                userId: image?.userId,
            },
            push: imageSucceeded
                ? {
                      title: "Image ready 🎨",
                      body: "Your generated image is ready. Tap to view it.",
                      data: { type: "image", id: image._id?.toString() || "" },
                  }
                : undefined,
        });

        emitCreditStatus(userId);

        return res.status(200).json({
            success: true,
            data: image,
        });
    } catch (err) {
        console.error("Error in updateImageResult:", err);
        logger.error(
            `Error in updateImageResult for sessionId ${req?.params?.sessionId}: ${err.message}`,
            { error: err }
        );
        return res.status(500).json({
            success: false,
            error: err.message,
        });
    }
};

exports.getAllImages = async (req, res) => {
    try {
        /* #swagger.tags = ['Image Generation']
           #swagger.summary = 'Get all image generation records for current user'
           #swagger.description = 'Retrieve paginated list of image generation records. Filter by type, model, status, and date range.'
           #swagger.parameters['type'] = {
               in: 'query',
               type: 'string',
               description: 'Filter by image type',
               enum: ['lifestyle', 'product_shot', 'apps_saas', 'brand_awareness', 'ai_ads']
           }
           #swagger.parameters['model'] = {
               in: 'query',
               type: 'string',
               description: 'Filter by model canonical key (e.g. gemini-3.1-flash-image-preview)'
           }
           #swagger.parameters['status'] = {
               in: 'query',
               type: 'string',
               description: 'Filter by generation status',
               enum: ['pending', 'processing', 'completed', 'failed']
           }
           #swagger.parameters['skip'] = {
               in: 'query',
               type: 'number',
               description: 'Pagination offset',
               example: 0
           }
           #swagger.parameters['limit'] = {
               in: 'query',
               type: 'number',
               description: 'Pagination limit',
               example: 10
           }
           #swagger.parameters['startDate'] = {
               in: 'query',
               type: 'string',
               description: 'Filter from date (DD-MM-YYYY)',
               example: '01-01-2024'
           }
           #swagger.parameters['endDate'] = {
               in: 'query',
               type: 'string',
               description: 'Filter until date (DD-MM-YYYY)',
               example: '31-12-2024'
           }
        */

        const {
            type,
            model,
            status,
            skip = 0,
            limit = 10,
            startDate,
            endDate,
        } = req.query;

        const filter = {
            userId: req.user.user_id,
        };

        if (type) filter["inputs.type"] = type;
        if (model) filter["inputs.model"] = model;
        if (status) filter.status = status;

        if (startDate || endDate) {
            filter.updatedAt = {};

            if (startDate) {
                const [day, month, year] = startDate.split("-");
                filter.updatedAt.$gte = new Date(year, month - 1, day);
            }

            if (endDate) {
                const [day, month, year] = endDate.split("-");
                filter.updatedAt.$lte = new Date(year, month - 1, day, 23, 59, 59, 999);
            }
        }

        const query = ImageGeneration.find(filter).sort({ updatedAt: -1 }).lean();

        if (skip) query.skip(parseInt(skip));
        if (limit) query.limit(parseInt(limit));

        const totalCount = await ImageGeneration.countDocuments(filter);
        const images = await query.exec();

        res.json({
            success: true,
            totalCount,
            data: images,
        });
    } catch (err) {
        console.error("Error in getAllImages:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

exports.getImageById = async (req, res) => {
    try {
        /* #swagger.tags = ['Image Generation']
           #swagger.summary = 'Get image generation record by ID'
           #swagger.description = 'Retrieve a specific image generation record by its ID. User can only access their own images.'
           #swagger.parameters['imageId'] = {
               in: 'path',
               required: true,
               type: 'string',
               description: 'MongoDB ID of the image generation record'
           }
           #swagger.responses[200] = {
               description: 'Image record retrieved successfully',
               schema: {
                   type: 'object',
                   properties: {
                       success: { type: 'boolean' },
                       data: {
                           type: 'object',
                           properties: {
                               _id: { type: 'string' },
                               userId: { type: 'string' },
                               inputs: { type: 'object' },
                               status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
                               results: { type: 'array' },
                               createdAt: { type: 'string', format: 'date-time' },
                               updatedAt: { type: 'string', format: 'date-time' }
                           }
                       }
                   }
               }
           }
           #swagger.responses[400] = { description: 'Image ID is required' }
           #swagger.responses[404] = { description: 'Image not found or user does not have access' }
        */

        const { imageId } = req.params;
        // Get user ID from multiple possible locations
        let userId = req.user?.user_id || req.user?.id || req.user?.userId;

        if (!userId) {
            console.error("[generateImage] User ID not found. req.user:", req.user);
            return res.status(401).json({
                success: false,
                error: "Authentication failed: User ID not found in token",
            });
        }

        if (!imageId) {
            return res.status(400).json({
                success: false,
                error: "Image ID is required",
            });
        }

        const image = await ImageGeneration.findOne({
            _id: imageId,
            userId,
        }).lean();

        if (!image) {
            return res.status(404).json({
                success: false,
                error: "Image not found or you do not have access to this image",
            });
        }

        res.json({
            success: true,
            data: image,
        });
    } catch (err) {
        console.error("Error in getImageById:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};
