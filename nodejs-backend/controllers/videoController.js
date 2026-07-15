const {
  generateVideoRequestSchema,
  updateResultSchema,
  updatePromptPercentageSchema,
  inputSchemasByType,
  generateSceneSchema,
  regenerateSceneSchema,
  aiAdsBrandSchema,
  aiAdsProductSchema,
  regenerateVoiceSchema,
  selectVersionSchema,
} = require("../Validations/videoValidator");
const VideoGeneration = require("../Module/videoGeneration/videoModel");
const UnifiedCreditController = require("./UnifiedCreditController");
const {
  getExtraDeduction,
  getExtraCostPerSecond,
} = require("../config/modelRegistry");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../storage/s3");
const axios = require("axios");
const archiver = require("archiver");
const logger = require("../utils/logger");

const Avatar = require("../Module/videoGeneration/avatarModel");
const modelPricingConfig = require("../config/modelPricingConfig");
const { notifyUser } = require("../services/push/notifyUser");
const GeneratedMediaController = require("./generatedMedia.controller");

const getFileName = (extension) => `${Date.now()}${extension}`;

const AI_ADS_REGEN_IMAGE_CREDIT =
  parseFloat(process.env.AI_ADS_REGEN_IMAGE_CREDIT_DEDUCTION) || 2;

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
      global.io.to(userId).emit("credits", payload);
    }
  } catch (error) {
    console.error("Error emitting credit status:", error);
  }
};

exports.generateVideo = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Submit video generation request'
       #swagger.description = 'Dynamic API handling UGC, B-Roll, Avatar, and Clone types using nested inputs.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: 'object',
                        required: ['inputs'],
                        properties: {
                            inputs: {
                                oneOf: [
                                    { $ref: "#/components/schemas/ugc_Payload" },
                                    { $ref: "#/components/schemas/broll_Payload" },
                                    { $ref: "#/components/schemas/avatar_Payload" },
                                    { $ref: "#/components/schemas/clone_Payload" }
                                ]
                            }
                        }
                    }
                }
            }
        } 
      */

    // * STEP 1 : Validate the request body using Joi schema
    const { error, value } = generateVideoRequestSchema.validate(req.body);

    if (error) {
      // If the generic alternatives error fires, re-validate against the
      // specific type schema so we can surface the exact failing fields.
      const inputType = req.body?.inputs?.type;
      const specificSchema = inputSchemasByType[inputType];

      if (specificSchema) {
        const { error: specificError } = specificSchema.validate(
          req.body.inputs,
          { abortEarly: false },
        );
        if (specificError) {
          const fieldErrors = specificError.details
            .map((d) => d.message)
            .join("; ");
          return res.status(400).json({ success: false, error: fieldErrors });
        }
      }

      // Fallback: type is missing or not one of the allowed values
      return res
        .status(400)
        .json({ success: false, error: error.details[0].message });
    }

    const { inputs } = value;
    const userId = req.user.user_id; // Extracted from authenticateJWT middleware

    // * STEP 2: Model-based credit logic
    const selectedModel = inputs.model; // e.g., 'veo-3.1-fast'
    const durationNum = Number(inputs.duration.replace("s", "")) || 0; // Duration in seconds

    // Calculate how many credits 1 video takes: duration * model_multiplier
    const videoMinCount =
      durationNum * UnifiedCreditController.getModelDeduction(selectedModel);

    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;

    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];

    // * STEP 3: Permission logic based on remaining credits
    // Create the record in MongoDB with 'pending' status first
    // This is better because it allows us to:
    // 1. Enforce sessionId uniqueness early
    // 2. Track the request even if the Python API call fails
    const videoData = {
      userId: userId,
      inputs: { ...inputs, watermark: plan == "8" ? true : false },
      status: "pending",
    };

    const video = await VideoGeneration.create(videoData);
    const videoId = video._id.toString();

    console.log(
      `[credits] generateVideo ENTER user=${userId} videoId=${videoId} ` +
        `model=${selectedModel} duration=${inputs.duration} numVideos=${numberOfVideos} ` +
        `totalRequired=${totalRequiredCredits}`,
    );

    // Freeze the full requested cost atomically (race-safe). Keyed by videoId
    // so updateVideoResult can settle/release using the same key.
    const freeze = await UnifiedCreditController.freezeCredits({
      userId,
      reservationKey: videoId,
      amount: totalRequiredCredits,
      meta: {
        service_type: "ad_video",
        model: selectedModel,
        duration: inputs.duration,
        numberOfVideos,
      },
    });

    if (!freeze.ok) {
      // Couldn't freeze — clean up the placeholder record and bail.
      await VideoGeneration.deleteOne({ _id: videoId });

      if (freeze.reason === "NO_BASE_PLAN") {
        return res.status(403).json({
          success: false,
          error: "An active subscription plan is required to generate video.",
        });
      }
      if (freeze.reason === "INSUFFICIENT") {
        return res.status(402).json({
          success: false,
          error: "Insufficient credits",
          required: totalRequiredCredits,
          remaining: freeze.remaining,
        });
      }
      return res.status(503).json({
        success: false,
        error: "Could not reserve credits for this request. Please try again.",
      });
    }

    {
      // Freeze succeeded — proceed to Python.
      // * Send to python based on type
      const pythonPayload = {
        sessionId: videoId,
        inputs: inputs,
        subscription: req.user?.userSubscriptionType,
        userId: userId,
        watermark: plan == "8" ? true : false,
      };

      const typeToApiUrl = {
        broll: process.env.BROLL_PYTHON_API,
        ugc: process.env.UGC_PYTHON_API,
        avatar: process.env.AVATAR_PYTHON_API,
        clone: process.env.CLONE_PYTHON_API,
        ai_ads: process.env.AI_ADS_PYTHON_API,
      };

      const targetApi = typeToApiUrl[inputs.type];

      if (targetApi) {
        try {
          const pythonResponse = await axios.post(targetApi, pythonPayload);

          if (pythonResponse.status === 200) {
            await VideoGeneration.updateOne(
              { _id: videoId },
              { $set: { status: "processing" } },
            );
          }
        } catch (err) {
          console.error(
            `Error sending ${inputs.type} request to python:`,
            err.message,
          );

          // Python never accepted the job — refund the freeze and clean up.
          await UnifiedCreditController.releaseCredits(videoId);
          await VideoGeneration.deleteOne({ _id: videoId });

          return res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      } else {
        console.log(`No Python API configured for type: ${inputs.type}`);
      }

      // * Send success response
      return res.status(200).json({
        success: true,
        message: "Video generation request submitted successfully",
        data: video,
      });
    }
  } catch (err) {
    console.error("Error in generateVideo:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateVideoResult = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Update video generation results from Python worker'
       #swagger.description = 'Called by Python worker after video generation completes. Requires secret key. Updates the video record status and deducts credits on success.'
       #swagger.parameters['sessionId'] = {
           in: 'path',
           required: true,
           type: 'string',  
           description: 'Session ID of the video to update'
       }
       #swagger.requestBody = {
           required: true,
           content: {
               "application/json": {
                   schema: { $ref: "#/components/schemas/updateVideoResultPayload" }
               }
           }
       }
    */

    const { sessionId } = req.params;

    const { error, value } = updateResultSchema.validate(req.body, {
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
      `Received video result update for sessionId ${sessionId}: ${JSON.stringify(
        value,
      )}`,
    );
    const { videoStatus, userId, watermark, ...resultData } = value;

    // map python status -> video status
    let finalStatus;

    if (videoStatus === 200) finalStatus = "completed";
    if (
      videoStatus === 400 ||
      videoStatus === 429 ||
      videoStatus === 500 ||
      videoStatus === 529
    )
      finalStatus = "failed";

    const updateQuery = {
      $push: {
        results: {
          ...resultData,
          waterMarkUrl: watermark ? resultData?.watermarkUrl : "",
          videoStatus,
          error: resultData?.error || "",
        },
      },
    };

    if (finalStatus) {
      updateQuery.$set = { status: finalStatus };
    }

    console.log(
      `[credits] updateVideoResult ENTER session=${sessionId} videoStatus=${videoStatus} model=${resultData?.model} duration=${resultData?.duration}`,
    );

    // Capture PRE-update status so we can detect duplicate callbacks from
    // Python. If we used { new: true }, we couldn't tell whether THIS call
    // flipped the record to terminal — and a second callback would silently
    // double-charge via the NO_RECEIPT fallback to deductCredits.
    const priorDoc = await VideoGeneration.findOneAndUpdate(
      { _id: sessionId },
      updateQuery,
      { new: false, lean: true },
    );

    if (!priorDoc) {
      console.warn(
        `[credits] updateVideoResult 404 session=${sessionId} — no video record`,
      );
      return res.status(404).json({
        success: false,
        error: "Video record not found",
      });
    }

    const alreadyTerminal =
      priorDoc.status === "completed" || priorDoc.status === "failed";

    // Reconstruct the post-update view for downstream code that emits to the
    // socket. We don't re-query — the update has already happened, and the
    // emit only needs the surface fields.
    const video = {
      ...priorDoc,
      status: finalStatus || priorDoc.status,
      results: [
        ...(priorDoc.results || []),
        {
          ...resultData,
          waterMarkUrl: watermark ? resultData?.watermarkUrl : "",
          videoStatus,
          error: resultData?.error || "",
        },
      ],
    };

    if (alreadyTerminal) {
      console.warn(
        `[credits] updateVideoResult DUPLICATE session=${sessionId} ` +
          `prior_status=${priorDoc.status} new_videoStatus=${videoStatus} ` +
          `— skipping credit work to avoid double-charge`,
      );
      if (videoStatus === 200) {
        // Re-emit to the socket only — a prior callback already pushed, so
        // re-pushing would double-buzz the app.
        await notifyUser(video?.userId, {
          event: "videoCreated",
          socketPayload: {
            _id: video._id,
            video: {
              ...video,
              url: watermark ? resultData?.watermarkUrl : resultData?.url || "",
            },
            userId: video?.userId,
          },
        });
      }
      return res.json({ success: true, data: video, duplicate: true });
    }

    // Settle the freeze on success; release it on failure.
    // The reservation_key is the videoId (sessionId), set by generateVideo.
    if (videoStatus === 200) {
      const rawDuration = resultData?.duration || "0s";
      const durationInSeconds = parseInt(rawDuration.replace("s", ""), 10) || 0;

      // credits per second (via model deduction)
      const creditPerSecond = UnifiedCreditController.getModelDeduction(
        resultData?.model,
      );

      // Some video types (e.g. Clone Yourself) freeze an extra per-second
      // surcharge on top of the base model rate (see generateCloneVideo).
      // Look it up by the video's own type instead of hardcoding "clone",
      // so this settlement stays correct if other types get a surcharge
      // registered in modelRegistry.js later — no hardcoded type check to
      // maintain here.
      const detectionCredit = getExtraDeduction(
        resultData?.model,
        priorDoc.inputs?.type,
      );

      const totalCreditsToDeduct = durationInSeconds * (creditPerSecond + detectionCredit);

      // Keep `totalCreditsToDeduct` debited; refund anything the freeze held
      // beyond that (e.g. user requested 30s, Python returned 20s).
      const settleResult = await UnifiedCreditController.releasePartial(
        sessionId,
        totalCreditsToDeduct,
      );
      if (!settleResult.ok && settleResult.reason === "NO_RECEIPT") {
        await UnifiedCreditController.deductCredits(
          userId,
          totalCreditsToDeduct,
          {
            model: resultData?.model,
            service_type: "ad_video",
            item_count: 1,
            duration: durationInSeconds,
            resolution: "standard",
            session_id: sessionId,
            chat_id: video._id.toString(),
          },
        );
      }

      // Store in mongo for admin analytics and user history.
      // Clone flow costs more at the provider level than the base model;
      // add the per-second USD surcharge from the registry so admin
      // dashboards don't under-report clone spend.
      const baseVideoCost = modelPricingConfig.getVideoCost(
        resultData?.model,
        durationInSeconds,
      );
      const extraCostPerSec =
        priorDoc.inputs?.type === "clone"
          ? getExtraCostPerSecond(resultData?.model, "clone")
          : 0;
      const actualVideoCost = baseVideoCost + extraCostPerSec * durationInSeconds;

      GeneratedMediaController.saveGeneratedMedia({
        userId: userId,
        model: resultData?.model,
        type: "video",
        image: "",
        video: resultData?.url || "",
        credit_deduction: totalCreditsToDeduct,
        cost: actualVideoCost,
        duration: durationInSeconds,
      });
    } else {
      // Any non-success videoStatus is terminal — the Joi schema only allows
      // {200, 400, 429, 500, 529}, all of which are final outcomes. Refund
      // the freeze in full. Leaving the receipt dangling would cause the
      // sweep cron to refund a successful generation 60 minutes later.
      await UnifiedCreditController.releaseCredits(sessionId);
    }

    // Notify over websocket (web + foreground app, using the userId room so it
    // works across all tabs/reconnections) and, on success, FCM push for
    // backgrounded/closed native apps. video is lean (plain JS), so spreading
    // is safe — no Mongoose internals leak.
    const videoSucceeded = videoStatus === 200;
    await notifyUser(video?.userId, {
      event: "videoCreated",
      socketPayload: {
        _id: video._id,
        video: {
          ...video,
          url: watermark ? resultData?.watermarkUrl : resultData?.url || "",
        },
        userId: video?.userId,
      },
      push: videoSucceeded
        ? {
            title: "Video ready 🎬",
            body: "Your generated video is ready. Tap to view it.",
            data: { type: "video", id: video._id?.toString() || "" },
          }
        : undefined,
    });

    emitCreditStatus(userId);

    return res.json({
      success: true,
      data: video, // already lean
    });
  } catch (err) {
    console.error("Error in updateVideoResult:", err);
    logger.error(
      `Error in updateVideoResult for sessionId ${req?.params?.sessionId}: ${err.message}`,
      { error: err },
    );
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.updatePromptPercentage = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Update prompt generation percentage'
       #swagger.description = 'Updates the promptPercentage field for a specific video session. Requires secret key.'
       #swagger.requestBody = {
           required: true,
           content: {
               "application/json": {
                   schema: {
                       type: 'object',
                       required: ['sessionId', 'userId', 'promptPercentage'],
                       properties: {
                           sessionId: { type: 'string', example: 'sess_broll_001' },
                           promptPercentage: { type: 'number', example: 50 }
                       }
                   }
               }
           }
       }
    */
    const { error, value } = updatePromptPercentageSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details[0].message,
      });
    }

    const { sessionId, promptPercentage } = value;

    const video = await VideoGeneration.findOneAndUpdate(
      { _id: sessionId },
      { $set: { promptPercentage } },
      { new: true, lean: true },
    );

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video record not found",
      });
    }

    // emit to frontend (using userId room so it works across all tabs/reconnections)
    if (global.io) {
      global.io.to(video?.userId).emit("videoProgress", {
        _id: video._id,
        promptPercentage: video.promptPercentage,
        userId: video?.userId,
      });
    }

    return res.json({
      success: true,
      data: {
        _id: video._id,
        promptPercentage: video.promptPercentage,
      },
    });
  } catch (err) {
    console.error("Error in updatePromptPercentage:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAllVideos = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Get all video generation records' 
       #swagger.parameters['type'] = { in: 'query', type: 'string' }
       #swagger.parameters['model'] = { in: 'query', type: 'string' }
       #swagger.parameters['status'] = { in: 'query', type: 'string' }
       #swagger.parameters['skip'] = { in: 'query', type: 'number' }
       #swagger.parameters['limit'] = { in: 'query', type: 'number' }
       #swagger.parameters['startDate'] = { in: 'query', type: 'string' }
       #swagger.parameters['endDate'] = { in: 'query', type: 'string' }
    */

    const { type, model, skip = 0, limit = 10, startDate, endDate } = req.query;

    const filter = {
      userId: req.user.user_id,
      status: { $ne: "copy" },
    };

    if (type) filter["inputs.type"] = type;
    if (model) filter["inputs.model"] = model;

    // ✅ Date filter on updatedAt
    if (startDate || endDate) {
      filter.updatedAt = {};

      if (startDate) {
        const [day, month, year] = startDate.split("-");
        filter.updatedAt.$gte = new Date(year, month - 1, day); // start of day
      }

      if (endDate) {
        const [day, month, year] = endDate.split("-");
        filter.updatedAt.$lte = new Date(year, month - 1, day, 23, 59, 59, 999); // end of day
      }
    }

    const query = VideoGeneration.find(filter)
      .sort({ updatedAt: -1 }) // 👈 also sorted by updatedAt
      .lean();

    if (skip) query.skip(parseInt(skip));
    if (limit) query.limit(parseInt(limit));

    const totalCount = await VideoGeneration.countDocuments(filter);
    const videos = await query.exec();
    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];

    // Watermark helper: plan "8" (free) sees the watermarked URL when present.
    const applyWm = plan === "8";
    const pickUrl = (r) => (applyWm ? r?.waterMarkUrl || r?.url : r?.url);

    const formattedVideos = videos.map((v) => {
      // AI Ads supports multiple switchable "versions" (voice regenerate).
      // Return the FULL results[] array + the version pointer so the frontend
      // can render results[version] as active and offer the rest in the
      // version switcher. All other types keep the legacy results[0] collapse.
      if (v?.inputs?.type === "ai_ads") {
        return {
          ...v,
          version: typeof v.version === "number" ? v.version : 0,
          results: (v.results || []).map((r) => ({ ...r, url: pickUrl(r) })),
        };
      }

      return {
        ...v,
        results: [
          {
            ...v.results[0],
            url: pickUrl(v?.results?.[0]),
          },
        ],
      };
    });

    res.json({
      success: true,
      totalCount,
      data: formattedVideos,
    });
  } catch (err) {
    console.error("Error in getAllVideos:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getVideoById = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Get video generation by ID '
       #swagger.parameters['id'] = { in: 'path', description: 'Video ID', required: true, schema: { type: 'string' } } */
    const { id } = req.params;

    const video = await VideoGeneration.findOne({
      _id: id,
      userId: req.user.user_id,
    }).lean();

    if (!video) {
      return res
        .status(404)
        .json({ success: false, error: "Video record not found" });
    }

    res.json({
      success: true,
      data: video,
    });
  } catch (err) {
    console.error("Error in getVideoById:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getProcessingCount = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Get count of all processing videos' 
      */

    const filter = { status: "processing", userId: req.user.user_id };

    const count = await VideoGeneration.countDocuments(filter);

    res.json({
      success: true,
      count,
    });
  } catch (err) {
    console.error("Error in getProcessingCount:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.uploadVideo = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Upload a video file to S3'
       #swagger.description = 'Uploads a video to S3 and returns the relative path. Requires a secret key.'
       #swagger.requestBody = {
           required: true,
           content: {
               "multipart/form-data": {
                   schema: {
                       type: "object",
                       required: ["userId", "video"],
                       properties: {
                           userId: {
                               type: "string",
                               description: "User ID for the upload path",
                               example: "GPT-409"
                           },
                           video: {
                               type: "string",
                               format: "binary",
                               description: "The video file to upload"
                           }
                       }
                   }
               }
           }
       }
       #swagger.responses[200] = {
           description: 'Video uploaded successfully',
           content: {
               "application/json": {
                   schema: {
                       type: "object",
                       properties: {
                           data: { type: "string", example: "/videos/GPT-409/1234567890.mp4" }
                       }
                   }
               }
           }
       }
       #swagger.responses[400] = { description: 'No video file received' }
       #swagger.responses[500] = { description: 'Internal server error' }
    */
    const userId = req?.body?.userId;
    const file = req.file;

    if (!file) {
      console.error("No Video file received");
      return res.status(400).json({ error: "No Video file received" });
    }

    const fileName = getFileName(".mp4");
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `videos/${userId}/${fileName}`,
      Body: file.buffer,
      ContentType: "video/mp4",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    const s3Url = `/${uploadParams.Key}`;
    return res.status(200).json({ data: s3Url });
  } catch (error) {
    console.error("Error in uploadVideo:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.uploadVoice = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Upload a voice file to S3'
       #swagger.description = 'Uploads a voice audio file to S3 and returns the relative path. Requires JWT authentication.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
           required: true,
           content: {
               "multipart/form-data": {
                   schema: {
                       type: "object",
                       required: ["userId", "voice"],
                       properties: {
                           userId: {
                               type: "string",
                               description: "User ID for the upload path",
                               example: "GPT-409"
                           },
                           voice: {
                               type: "string",
                               format: "binary",
                               description: "The voice audio file to upload"
                           }
                       }
                   }
               }
           }
       }
       #swagger.responses[200] = {
           description: 'Voice uploaded successfully',
           content: {
               "application/json": {
                   schema: {
                       type: "object",
                       properties: {
                           data: { type: "string", example: "/voices/GPT-409/1234567890.mp3" }
                       }
                   }
               }
           }
       }
       #swagger.responses[400] = { description: 'No voice file received' }
       #swagger.responses[500] = { description: 'Internal server error' }
    */
    const userId = req?.body?.userId;
    const file = req.file;

    if (!file) {
      console.error("No Voice file received");
      return res.status(400).json({ error: "No Voice file received" });
    }

    const fileName = getFileName(".mp3");
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `voices/${userId}/${fileName}`,
      Body: file.buffer,
      ContentType: "audio/mpeg",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));
    const s3Url = `/${uploadParams.Key}`;
    return res.status(200).json({ data: s3Url });
  } catch (error) {
    console.error("Error in uploadVoice:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.generateImageAndScript = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Submit request for image and script generation for Avatar type'
       #swagger.description = 'Accepts inputs for Avatar type, generates an image and script by calling Python APIs, and updates the record accordingly. This is a two-step process where the frontend first calls this endpoint to generate the image and script, and then calls the /generate-avatar-video endpoint to create the final video using those assets.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: 'object',
                        required: ['inputs'],
                        properties: { 
                            inputs:  { $ref: "#/components/schemas/avatar_Payload" }
                        }
                    }
                }
            }
        } 
      */
    // * STEP 1: Validate request body using avatarSchema
    const { error, value } = inputSchemasByType.avatar.validate(
      req.body.inputs,
      {
        abortEarly: false,
      },
    );

    if (error) {
      const fieldErrors = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: fieldErrors });
    }

    const inputs = value;
    const userId = req.user.user_id; // Extracted from authenticateJWT middleware

    // * STEP 2: Model-based credit logic
    const selectedModel = inputs.model; // e.g., 'veo-3.1-fast'
    const durationNum = Number(inputs.duration.replace("s", "")) || 0; // Duration in seconds

    // Calculate how many credits 1 video takes: duration * model_multiplier
    const videoMinCount =
      durationNum * UnifiedCreditController.getModelDeduction(selectedModel);

    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;

    // NOTE: no freeze here. generateImageAndScript is only the preview step
    // (generates image + script for user review) — the user hasn't committed
    // to spending video credits yet. The freeze happens at generateAvatarVideo,
    // which is the actual commit. This avoids leaked holds when users preview
    // a script and walk away.
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );

    const userRemainingCredits = unifiedCheck.remainingCredits || 0;

    if (!unifiedCheck.isAllowed) {
      if (userRemainingCredits >= videoMinCount) {
        return res.status(400).json({
          success: false,
          error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
        });
      }
      return res.status(400).json({ success: false, error: "Not enough credits" });
    }

    const video = await VideoGeneration.create({
      userId,
      inputs: value,
      status: "pending",
    });

    const videoId = video._id.toString();

    let avatarJson = null;
    if (inputs.avatarId && inputs.avatarType === "ai_library") {
      avatarJson = await Avatar.findById(inputs.avatarId).lean();
    }

    const pythonPayload = {
      sessionId: videoId,
      inputs: {
        ...inputs,
        avatarJson,
        images: inputs?.uploadedAvatars || [],
      },
      userId,
      subscription: req.user?.userSubscriptionType,
    };

    // * Call Python API to generate image and script
    await axios.post(
      process.env.AVATAR_IMAGE_SCRIPT_PYTHON_API,
      pythonPayload,
    );

    return res.status(200).json({
      success: true,
      message: "Script generation in progress",
      data: video,
    });
  } catch (err) {
    console.error("Error in generateImageAndScript:", err);

    if (err.response || err.code === "ECONNREFUSED") {
      return res.status(500).json({
        success: false,
        error: `Python API error: ${err.message}`,
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.regenerateScript = async (req, res) => {
  /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Submit request tp regerate script'
       #swagger.description = 'Accepts video ID and new tone, calls Python API to regenerate the script, updates the video record with the new script, and returns the updated record. This allows users to easily regenerate just the script with a different tone without having to go through the entire video generation process again.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: 'object',
                        required: ['inputs'],
                        properties: { 
                            id: { type: 'string', description: 'ID of the video record to update', example: '64a1f0e5c9d1b2a3f4e56789' },
                            tone: { type: 'string', description: 'New tone for script regeneration', example: 'friendly' }
                        }
                    }
                }
            }
        } 
      */
  try {
    const { id, tone } = req.body;

    // ✅ Validation
    if (!id || !tone) {
      return res.status(400).json({
        success: false,
        error: "id and tone are required",
      });
    }

    // ✅ Fetch video
    const video = await VideoGeneration.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video not found",
      });
    }

    // ✅ Prepare payload for Python
    const payload = {
      sessionId: video._id,
      userId: video.userId,
      inputs: {
        ...video.inputs,
        tone,
      },
      subscription: req.user?.userSubscriptionType,
    };

    // ✅ Call Python service
    const pythonResponse = await axios.post(
      process.env.AVATAR_SCRIPT_PYTHON_API,
      payload,
    );

    const data = pythonResponse.data;

    if (!data.success) {
      return res.status(500).json({
        success: false,
        error: data.error || "Python service failed",
      });
    }

    // ✅ Update DB (videoPrompt → generatedScript)
    video.generatedScript = data?.creativeBrief;
    video.inputs.tone = tone; // also store tone if needed
    await video.save();

    // ✅ Send response to frontend
    return res.status(200).json({
      success: true,
      message: data.message,
      data: {
        _id: video._id,
        generatedScript: video.generatedScript,
        tone,
      },
    });
  } catch (error) {
    console.error("Error in regenerateScript:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.updateImageAndScript = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Update generated image/script from Python worker'
       #swagger.description = 'Updates image, script, or both based on type.'
       #swagger.requestBody = {
           required: true,
           content: {
               "application/json": {
                   schema: {
                       type: 'object',
                       required: ['sessionId', 'type'],
                       properties: {
                           sessionId: { type: 'string', example: '6654abc...' },
                           type: { type: 'string', enum: ['image', 'text', 'both'] },
                           image: { type: 'string', example: 'https://...' },
                           text: { type: 'object', description: 'Generated script object' }
                       }
                   }
               }
           }
       }
    */

    const { sessionId, type, image, text, status, error } = req.body;

    if (status === 400 && error) {
      const updateFields = {
        generatedImage: "failed",
        generatedScript: "failed",
      };
      const video = await VideoGeneration.findByIdAndUpdate(
        sessionId,
        { $set: updateFields },
        { new: true, lean: true },
      );

      if (global.io) {
        global.io.to(video.userId).emit("imageScriptUpdate", {
          _id: video._id,
          userId: video.userId,
          ...updateFields,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Video generation failed, record updated",
      });
    }

    // ✅ Validate
    if (!sessionId || !type) {
      return res.status(400).json({
        success: false,
        error: "sessionId and type are required",
      });
    }

    if (type === "image" && !image) {
      return res.status(400).json({
        success: false,
        error: "image is required when type is 'image'",
      });
    }

    if (type === "text" && !text) {
      return res.status(400).json({
        success: false,
        error: "text is required when type is 'text'",
      });
    }

    if (type === "both" && (!image || !text)) {
      return res.status(400).json({
        success: false,
        error: "image and text are required when type is 'both'",
      });
    }

    // ✅ Build dynamic update object
    const updateFields = {};

    if (type === "image" || type === "both") {
      updateFields.generatedImage = image;
    }

    if (type === "text" || type === "both") {
      updateFields.generatedScript = text;
    }

    // ✅ Update DB
    const video = await VideoGeneration.findByIdAndUpdate(
      sessionId,
      { $set: updateFields },
      { new: true, lean: true },
    );

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video record not found",
      });
    }

    // emit to frontend (using userId room so it works across all tabs/reconnections)
    if (global.io) {
      global.io.to(video.userId).emit("imageScriptUpdate", {
        _id: video._id,
        userId: video.userId,
        ...updateFields,
      });
    }

    return res.status(200).json({
      success: true,
      data: video, // already lean
    });
  } catch (err) {
    console.error("Error in updateImageAndScript:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

exports.generateAvatarVideo = async (req, res) => {
  /* 
      #swagger.tags = ['Video Generation']
      #swagger.summary = 'Generate avatar video using generated image and script'
      #swagger.description = 'This endpoint is called after the image and script have been generated for an Avatar type video. It takes the video ID, fetches the generated image and script from the database, and sends them to the Python API to generate the final video. Optionally accepts a script in the request body to update before generating.'
      #swagger.parameters['id'] = { in: 'path', description: 'ID of the video record to generate', required: true, schema: { type: 'string' } }
      #swagger.requestBody = {
          required: false,
          content: {
              "application/json": {
                  schema: {
                      type: 'object',
                      properties: {
                          script: { type: 'object', description: 'Script object to store in DB before generating video' }
                      }
                  }
              }
          }
      }
  */
  try {
    const { id } = req.params;
    const { script } = req.body;
    const userId = req.user.user_id;

    // * STEP 1: Fetch the video record
    const video = await VideoGeneration.findOne({ _id: id, userId });

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Avatar generation record not found",
      });
    }

    // If script is provided in request, update it in DB
    if (script) {
      video.generatedScript = script;
      video.markModified("generatedScript"); // Required for Mixed type fields
      await video.save();
    }

    if (!video.generatedImage || !video.generatedScript) {
      return res.status(400).json({
        success: false,
        error: "Image and script not yet generated for this record",
      });
    }

    const inputs = video.inputs;

    // * STEP 2: Model-based credit logic
    const selectedModel = inputs.model; // e.g., 'veo-3.1-fast'
    const durationNum = Number(inputs.duration.replace("s", "")) || 0; // Duration in seconds

    // Calculate how many credits 1 video takes: duration * model_multiplier
    const videoMinCount =
      durationNum * UnifiedCreditController.getModelDeduction(selectedModel);

    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;

    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];

    console.log(
      `[credits] generateAvatarVideo ENTER user=${userId} videoId=${id} ` +
        `model=${selectedModel} duration=${inputs.duration} numVideos=${numberOfVideos} ` +
        `totalRequired=${totalRequiredCredits}`,
    );

    // Atomic freeze — this is the commit step (generateImageAndScript was
    // just preview). Keyed by the videoId so updateVideoResult settles/releases.
    const freeze = await UnifiedCreditController.freezeCredits({
      userId,
      reservationKey: id,
      amount: totalRequiredCredits,
      meta: {
        service_type: "ad_video",
        model: selectedModel,
        duration: inputs.duration,
        numberOfVideos,
        phase: "avatarVideo",
      },
    });

    if (!freeze.ok) {
      if (freeze.reason === "NO_BASE_PLAN") {
        return res.status(403).json({
          success: false,
          error: "An active subscription plan is required.",
        });
      }
      if (freeze.reason === "INSUFFICIENT") {
        return res.status(402).json({
          success: false,
          error: "Insufficient credits",
          required: totalRequiredCredits,
          remaining: freeze.remaining,
        });
      }
      return res.status(503).json({
        success: false,
        error: "Could not reserve credits. Please try again.",
      });
    }

    // * STEP 2: Send to Python for video generation
    const pythonPayload = {
      sessionId: id,
      inputs: {
        ...video.inputs,
        script: video.generatedScript,
        firstFrameUrl: video.generatedImage,
      },
      userId,
      subscription: req.user?.userSubscriptionType,
      watermark: plan == "8" ? true : false,
    };

    try {
      const pythonResponse = await axios.post(
        process.env.AVATAR_PYTHON_API,
        pythonPayload,
      );

      if (pythonResponse.status === 200) {
        await VideoGeneration.updateOne(
          { _id: id },
          { $set: { status: "processing" } },
        );

        return res.status(200).json({
          success: true,
          message: "Avatar video generation request submitted successfully",
          data: video,
        });
      }
    } catch (pythonErr) {
      // Python never accepted the job → refund the freeze.
      await UnifiedCreditController.releaseCredits(id);
      throw pythonErr;
    }
  } catch (err) {
    console.error("Error in generateAvatarVideo:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.downloadMediaZip = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Download multiple media files as a ZIP'
       #swagger.description = 'Accepts an array of URLs, fetches each file, and streams them back as a single ZIP archive.'
       #swagger.requestBody = {
           required: true,
           content: {
               "application/json": {
                   schema: {
                       type: 'object',
                       required: ['urls'],
                       properties: {
                           urls: { type: 'array', items: { type: 'string' }, example: ['https://...', 'https://...'] },
                           zipName: { type: 'string', example: 'videos.zip' }
                       }
                   }
               }
           }
       }
    */
    const { urls, zipName = "media.zip" } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "urls must be a non-empty array" });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 5 } });

    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    archive.pipe(res);

    await Promise.all(
      urls.map(async (url, index) => {
        const response = await axios({
          url,
          method: "GET",
          responseType: "stream",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        const fileName =
          url.split("/").pop().split("?")[0] || `file_${index + 1}`;
        archive.append(response.data, { name: fileName });
      }),
    );

    await archive.finalize();
  } catch (err) {
    console.error("Error in downloadMediaZip:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
};

exports.downloadMedia = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Download media from URL'
       #swagger.description = 'Proxies a media URL and serves it as a download attachment to the frontend.'
       #swagger.parameters['url'] = { in: 'query', description: 'URL of the media to download', required: true, schema: { type: 'string' } }
    */
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const contentType =
      response.headers["content-type"] || "application/octet-stream";
    const fileName = url.split("/").pop().split("?")[0] || "download";

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", contentType);

    response.data.pipe(res);
  } catch (err) {
    console.error("Error in downloadMedia:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// -------------------------------------------------------------------------------
// AI Ads Controllers  (use VideoGeneration model ï¿½ no separate AiAds model)
// -------------------------------------------------------------------------------

// --- 1. generateScene ---------------------------------------------------------
exports.generateScene = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Step 1 — Generate AI Ads scenes'
       #swagger.description = 'Creates a VideoGeneration session (type=ai_ads), checks credits, and fires scene generation to the Python engine. Returns sessionId immediately. Listen for aiAdsScenesReady on Socket.io.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: { "application/json": { "schema": { "$ref": "#/components/schemas/aiAdsGenerateSceneProduct_Payload" } } }
       }
    */
    const { error, value } = generateSceneSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const msg = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: msg });
    }

    const { inputs, watermark } = value;
    const userId = req.user.user_id;
    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];
    const applyWatermark = plan === "8" ? true : (watermark ?? false);

    // Credit check (same formula as regular video types)
    const durationSec = Number(String(inputs.duration).replace("s", "")) || 0;
    const totalRequired = durationSec * UnifiedCreditController.getModelDeduction(inputs.model) * (inputs.numberOfVideos || 1);
    const unifiedCheck = await UnifiedCreditController.checkCredits(userId, totalRequired);

    if (!unifiedCheck.isAllowed) {
      const remaining = unifiedCheck.remainingCredits || 0;
      if (remaining > 0) {
        return res.status(400).json({
          success: false,
          error: `Not enough credits. You need ${totalRequired} but only have ${remaining}.`,
        });
      }
      return res.status(403).json({ success: false, error: "Not enough credits" });
    }

    const { brandName, productName, productDescription, ...restInputs } = inputs;
    const pythonInputs = {
      ...restInputs,
      // Frontend sends brandName (brand) or productName (product) → Python expects "name"
      ...(brandName || productName ? { name: brandName || productName } : {}),
      ...(productDescription ? { description: productDescription } : {}),
    };

    // Step 1: Validate inputs via Python before creating any record
    let validateRes;
    try {
      validateRes = await axios.post(process.env.AI_ADS_INPUT_VALIDATE_PYTHON_API, {
        inputs: pythonInputs,
      });
    } catch (err) {
      if (err.response) {
        return res.status(err.response.status).json(err.response.data);
      }
      return res.status(500).json({ error: err.message });
    }

    const { valid} = validateRes.data || {};

    // If validation fails , return Python response directly
    if (!valid) {
      return res.status(400).json(validateRes.data);
    }

    // Step 2: Create VideoGeneration record with type "ai_ads"
    const record = await VideoGeneration.create({
      userId,
      inputs: { ...inputs, type: "ai_ads" },
      watermark: applyWatermark,
      status: "pending",
    });

    const sessionId = record._id.toString();

    // Step 3: Fire-and-forget scene generation to Python
    const pythonPayload = { sessionId, userId, watermark: applyWatermark, inputs: pythonInputs, subscription: req.user?.userSubscriptionType };
    axios
      .post(process.env.AI_ADS_GENERATE_SCENE_PYTHON_API, pythonPayload)
      .catch((err) => {
        const pythonError = err.response?.data?.error || err.message;
        console.error("Error sending generate-scene to Python:", pythonError);
        logger.error(`[AI Ads] generate-scene python call failed: ${pythonError}`);
        VideoGeneration.findByIdAndUpdate(sessionId, {
          status: "failed",
        }).catch(() => { });
        if (global.io) {
          // Initial generation failure → whole session is dead → frontend shows full-page error
          global.io.to(userId).emit("aiAdsScenesFailed", {
            sessionId,
            event: "sessionFailed",
            error: pythonError,
          });
        }
      });

    return res.status(200).json({
      success: true,
      message: "Scene generation in progress. Listen on socket 'aiAdsScenesReady'.",
      sessionId,
      data: record,
    });
  } catch (err) {
    console.error("Error in generateScene:", err);
    logger.error(`[AI Ads] generateScene error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 2. regenerateScene -------------------------------------------------------
exports.regenerateScene = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Step 1b — Regenerate specific AI Ads scenes'
       #swagger.description = 'Re-generates one or more scenes of an existing AI Ads session. Use to refresh images, scripts, or both. Results arrive via aiAdsScenesReady socket event.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: { "application/json": { "schema": { "$ref": "#/components/schemas/aiAdsRegenerateScene_Payload" } } }
       }
    */
    const { error, value } = regenerateSceneSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const msg = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: msg });
    }

    const { sessionId, segments } = value;
    const userId = req.user.user_id;

    // Find existing record
    const record = await VideoGeneration.findOne({
      _id: sessionId,
      userId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }
    const inputs = record.inputs || {};
    const scenes =
      record.scenes?.length
        ? record.scenes
        : record.inputs?.scenes || [];

    // ── Derive authoritative `deduct` flag per segment from the DB ─────────
    // The frontend sends a `deduct` hint based on what it renders, but the DB
    // is the source of truth. We OVERRIDE the frontend's claim with the DB
    // state to prevent cheating in both directions:
    //   - Frontend claims deduct:false on a scene that DOES have a
    //     frameImageUrl → backend forces deduct:true (would-be cheat blocked).
    //   - Frontend claims deduct:true on a scene that has NO frameImageUrl →
    //     backend forces deduct:false (refunds an honest mistake; frontend
    //     and backend should agree, this just makes the backend defensive).
    const sceneBySegment = new Map(
      (scenes || []).map((s) => {
        const sceneObj = typeof s.toObject === "function" ? s.toObject() : s;
        return [sceneObj.segmentNumber, sceneObj];
      })
    );
    const validatedSegments = segments.map((seg) => {
      const prior = sceneBySegment.get(seg.segmentNumber);
      const hasPriorImage = !!prior?.frameImageUrl;
      // Authoritative: deduct iff the DB shows a prior successful image.
      return { ...seg, deduct: hasPriorImage };
    });

    // Upfront credit check — only segments that are (a) image-related and
    // (b) validated-billable count toward credits required.
    const billableSegments = validatedSegments.filter(
      (seg) =>
        (seg.regenerate === "image" || seg.regenerate === "both") &&
        seg.deduct === true
    );
    const creditsNeeded = billableSegments.length * AI_ADS_REGEN_IMAGE_CREDIT;

    // Atomic freeze for this regen request. updateSceneResult finds the
    // receipt via meta.regenSessionId and settles with the actual successful
    // billable count. The key embeds a timestamp+nonce so concurrent regens
    // on the same session each get their own reservation (FIFO settle).
    let regenReservationKey = null;
    if (creditsNeeded > 0) {
      regenReservationKey = `regen:${sessionId}:${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const freeze = await UnifiedCreditController.freezeCredits({
        userId,
        reservationKey: regenReservationKey,
        amount: creditsNeeded,
        meta: {
          service_type: "ai_ads_scene_regen",
          regenSessionId: sessionId,
          perScene: AI_ADS_REGEN_IMAGE_CREDIT,
          expectedBillable: billableSegments.length,
        },
      });
      if (!freeze.ok) {
        if (freeze.reason === "NO_BASE_PLAN") {
          return res.status(403).json({
            success: false,
            error: "An active subscription plan is required.",
          });
        }
        if (freeze.reason === "INSUFFICIENT") {
          return res.status(400).json({
            success: false,
            error: `Not enough credits. You need ${creditsNeeded} but only have ${freeze.remaining}.`,
          });
        }
        return res.status(503).json({
          success: false,
          error: "Could not reserve credits. Please try again.",
        });
      }
    }


    // Match generateScene python payload formatting
    const {
      brandName,
      productName,
      productDescription,
      ...restInputs
    } = inputs;

    const pythonInputs = {
      ...restInputs,
      ...(brandName || productName ? { name: brandName || productName } : {}),
      ...(productDescription ? { description: productDescription } : {}),
    };

    // Build flat scenes array for Python (combined image + text per segment)
    const scenesPayload = (scenes || []).map(s => {
      const scene = typeof s.toObject === "function" ? s.toObject() : { ...s };
      return {
        segmentNumber: scene.segmentNumber,
        goal: scene.goal,
        durationSeconds: scene.durationSeconds,
        frameImageUrl: scene.frameImageUrl,
        sceneDescription: scene.sceneDescription,
        audioDirection: scene.audioDirection,
        tone: scene.tone,
        indianAccent: scene.indianAccent,
        script: scene.script,
      };
    });

    const pythonPayload = {
      sessionId,
      userId,
      // Use validatedSegments so Python receives the corrected deduct flag.
      // Python must echo each segment's `deduct` back in the callback per
      // segment (under image[*].deduct on success, image[*].deduct on
      // partial_error). See updateSceneResult for how it's consumed.
      segments: validatedSegments,
      inputs: pythonInputs,
      scenes: scenesPayload,
    };

    // Fire-and-forget to Python
    axios
      .post(process.env.AI_ADS_REGENERATE_SCENE_PYTHON_API, pythonPayload)
      .catch(async (err) => {
        const pythonError = err.response?.data?.error || err.message;
        console.error("Error sending regenerate-scene to Python:", pythonError);
        logger.error(`[AI Ads] regenerate-scene python call failed: ${pythonError}`);
        await VideoGeneration.findByIdAndUpdate(sessionId, {
          status: "pending",
        }).catch(() => { });

        // Python rejected the job → refund the freeze immediately.
        if (regenReservationKey) {
          await UnifiedCreditController.releaseCredits(regenReservationKey).catch(
            (e) =>
              logger.error(
                `[AI Ads] regen freeze release failed for ${regenReservationKey}: ${e.message}`,
              ),
          );
        }

        // Mark only the segments that were being regenerated as failed.
        // The rest of the session is untouched — frontend keeps showing all
        // other scenes intact, and only the failed segments show Retry.
        // Two outcomes per failed segment:
        //   (a) Scene HAD a prior image (validatedSegments[*].deduct === true)
        //       → preserve old image; emit aiAdsSceneRegenFailed for toast.
        //   (b) Scene had NO prior image → mark imageFailed; emit
        //       aiAdsScenesFailed/sceneImageFailed so failure card renders.
        if (Array.isArray(validatedSegments)) {
          for (const seg of validatedSegments) {
            const segNum = seg?.segmentNumber;
            if (segNum == null) continue;
            const regenType = seg?.regenerate;
            const isImageRelated = regenType === "image" || regenType === "both";

            if (isImageRelated && seg.deduct === true) {
              // (a) Preserve old image. No DB write to imageFailed.
              if (global.io) {
                global.io.to(userId).emit("aiAdsSceneRegenFailed", {
                  sessionId,
                  segmentNumber: segNum,
                  error: pythonError,
                });
              }
              continue;
            }

            if (isImageRelated) {
              // (b) Scene never had a successful image — mark imageFailed.
              await VideoGeneration.updateOne(
                { _id: sessionId, "scenes.segmentNumber": segNum },
                {
                  $set: {
                    "scenes.$.imageFailed": true,
                    "scenes.$.imageError": pythonError,
                  },
                }
              ).catch(() => { });
            }
            if (global.io) {
              global.io.to(userId).emit("aiAdsScenesFailed", {
                sessionId,
                event: "sceneImageFailed",
                segmentNumber: segNum,
                error: pythonError,
              });
            }
          }
        } else if (global.io) {
          // Fallback — segments array missing for some reason. Emit session-level
          // failure so frontend at least surfaces the error somehow.
          global.io.to(userId).emit("aiAdsScenesFailed", {
            sessionId,
            event: "sessionFailed",
            error: pythonError,
          });
        }
      });

    return res.status(200).json({
      success: true,
      message: "Scene regeneration in progress. Listen on socket 'aiAdsScenesReady'.",
      sessionId,
    });
  } catch (err) {
    console.error("Error in regenerateScene:", err);
    logger.error(`[AI Ads] regenerateScene error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};



// --- 4. Python Callback — Scene Result -----------------------------------------
// Dispatches by (type, imageStatus, success) into one of the 5 Python scenarios:
//   1) type="text"  → save all scenes (frameImageUrl=null), status="processing"
//   2) type="image" + imageStatus="partial"  → patch frameImageUrl on one scene
//   3) type="image" + imageStatus="complete" → patch final frame + status="completed"
//   4) type="error" + imageStatus="partial_error" → mark scene.imageFailed, session continues
//   5) type="error" + status=400/success=false → full pipeline crash, status="failed"
// Regenerate callbacks (isRegenerate=true) take a separate smart-merge path.
exports.updateSceneResult = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = '[Python Callback] Scene result'
       #swagger.description = 'Called by the Python AI engine during scene generation. Fires incrementally: once with type=text (all scenes, no images), then per-image with type=image + imageStatus=partial|complete, plus error variants. Stores scenes in DB and emits aiAdsScenesReady / aiAdsScenesFailed with an "event" discriminator.'
       #swagger.security = []
       #swagger.requestBody = {
         required: true,
         content: { "application/json": { "schema": { "$ref": "#/components/schemas/aiAdsSceneResultCallback_Payload" } } }
       }
    */
    const { sessionId } = req.params;
    const {
      status,         // 200 success, 400 full crash
      image,          // [{ segmentNumber, frameImageUrl }]
      text,           // [{ segmentNumber, goal, ..., script[] }]
      totalSegments,
      totalDuration,
      characterGender, // "female" | "male" — resolved by Python during blueprint
      type,           // "text" | "image" | "error" | "both"
      imageStatus,    // "" | "partial" | "complete" | "partial_error"
      error,
      success,
      isRegenerate,
    } = req.body;

    logger.info(
      `[AI Ads] Scene callback ${sessionId}: type=${type}, imageStatus=${imageStatus}, status=${status}`
    );

    const record = await VideoGeneration.findOne({
      _id: sessionId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }

    // ───── Regenerate path (smart merge per-scene, per-type) ────────────────
    if (isRegenerate === true) {
      // Build prior-state lookup BEFORE any merge so we can decide:
      //   - per-segment credit deduction (echoed `deduct` from Python)
      //   - regen-failure UX: preserve old image vs mark as failed
      const existingScenes = record.scenes || [];
      const priorSceneByNum = new Map();
      existingScenes.forEach((s) => {
        const sceneObj = typeof s.toObject === "function" ? s.toObject() : s;
        priorSceneByNum.set(sceneObj.segmentNumber, sceneObj);
      });

      // ── Regen failure guard ──────────────────────────────────────────────
      // Python reports the regen failed for one or more segments. Two
      // outcomes per segment:
      //   (a) Scene HAD a prior frameImageUrl → preserve the old image in
      //       DB, do NOT set imageFailed; emit aiAdsSceneRegenFailed so the
      //       frontend can show a toast without flipping the card to the
      //       error view.
      //   (b) Scene had NO prior image (initial-failure recovery) → mark
      //       imageFailed and emit aiAdsScenesFailed/sceneImageFailed so the
      //       frontend keeps the failure card visible with a Retry button.
      const regenFailed =
        type === "error" || success === false || status === 400;
      if (regenFailed) {
        const failedSegNums = Array.isArray(image)
          ? image.map((img) => img?.segmentNumber).filter((n) => n != null)
          : [];

        if (failedSegNums.length === 0) {
          // No per-segment info — treat as session-level regen failure.
          if (global.io) {
            global.io.to(record.userId).emit("aiAdsSceneRegenFailed", {
              sessionId,
              error: error || "Regeneration failed",
            });
          }
          return res.json({ success: true, message: "Regen failure recorded" });
        }

        for (const segNum of failedSegNums) {
          const prior = priorSceneByNum.get(segNum);
          const hadPriorImage = !!prior?.frameImageUrl;

          if (hadPriorImage) {
            // (a) Preserve old image; no DB write to imageFailed.
            if (global.io) {
              global.io.to(record.userId).emit("aiAdsSceneRegenFailed", {
                sessionId,
                segmentNumber: segNum,
                error: error || "Failed to regenerate this scene",
              });
            }
          } else {
            // (b) Scene never had a working image — mark imageFailed.
            await VideoGeneration.updateOne(
              { _id: sessionId, "scenes.segmentNumber": segNum },
              {
                $set: {
                  "scenes.$.imageFailed": true,
                  "scenes.$.imageError": error || "Image generation failed",
                },
              }
            );
            if (global.io) {
              global.io.to(record.userId).emit("aiAdsScenesFailed", {
                sessionId,
                event: "sceneImageFailed",
                segmentNumber: segNum,
                error: error || "Image generation failed for this scene",
              });
            }
          }
        }
        return res.json({ success: true, message: "Regen failure recorded" });
      }

      const segmentMap = new Map();

      if (Array.isArray(text)) {
      text.forEach((t) => {
        segmentMap.set(t.segmentNumber, { ...t });
      });
      }

      if (Array.isArray(image)) {
        image.forEach((img) => {
          const existing = segmentMap.get(img.segmentNumber) || {};
        segmentMap.set(img.segmentNumber, {
          ...existing,
          ...img,
        });
        });
      }

      const processedScenes = Array.from(segmentMap.values()).sort(
        (a, b) => a.segmentNumber - b.segmentNumber
      );

      const updatedScenes = existingScenes.map((existingScene) => {
        const existing = typeof existingScene.toObject === "function"
          ? existingScene.toObject()
          : { ...existingScene };
        const regen = processedScenes.find(
          (r) => r.segmentNumber === existing.segmentNumber
        );
        if (!regen) return existing;

        const regenType = type || "both";
        if (regenType === "image") {
          return {
            ...existing,
            frameImageUrl: regen.frameImageUrl ?? existing.frameImageUrl,
            sceneDescription: regen.sceneDescription ?? existing.sceneDescription,
            imageFailed: false,
            imageError: null,
          };
        }
        if (regenType === "text") {
          return {
            ...existing,
            script: regen.script ?? existing.script,
            audioDirection: regen.audioDirection ?? existing.audioDirection,
            goal: regen.goal ?? existing.goal,
            durationSeconds: regen.durationSeconds ?? existing.durationSeconds,
            sceneDescription: regen.sceneDescription ?? existing.sceneDescription,
            tone: regen.tone ?? existing.tone,
            indianAccent: regen.indianAccent ?? existing.indianAccent,
          };
        }
        return { ...existing, ...regen, imageFailed: false, imageError: null };
      });

      const updatedRecord = await VideoGeneration.findByIdAndUpdate(
        sessionId,
        { $set: { scenes: updatedScenes, status: "pending" } },
        { new: true }
      );

      // Per-segment credit deduction.
      //   - Skip if Python returned no new frameImageUrl for the segment.
      //   - Trust `deduct` echoed by Python (validated at regenerateScene
      //     against DB). Fallback: if `deduct` is missing from the echo,
      //     derive from the prior DB state (hadPriorImage → deductible).
      let billableCount = 0;
      const billingTrace = [];
      if (Array.isArray(image)) {
        for (const img of image) {
          if (!img || !img.frameImageUrl) {
            billingTrace.push({ seg: img?.segmentNumber, decision: "skip:no-new-url" });
            continue;
          }
          const hadPriorImage = !!priorSceneByNum.get(img.segmentNumber)?.frameImageUrl;
          const shouldDeduct =
            img.deduct === true ||
            (img.deduct === undefined && hadPriorImage);
          if (!shouldDeduct) {
            billingTrace.push({ seg: img.segmentNumber, decision: "skip:free-retry" });
            continue;
          }
          billingTrace.push({ seg: img.segmentNumber, decision: "billable" });
          billableCount += 1;
        }
      }
      logger.info(
        `[AI Ads] Regen ${sessionId} billing: ${JSON.stringify(billingTrace)}, total=${billableCount}`
      );

      // Settle the regen freeze: the oldest reservation for this session
      // gets `billableCount × AI_ADS_REGEN_IMAGE_CREDIT` debited; the rest of
      // its hold is refunded (covers partial-failure refunds for free).
      // If no receipt exists (legacy in-flight regen), fall back to deduct.
      try {
        const actualCharge = billableCount * AI_ADS_REGEN_IMAGE_CREDIT;
        const settleResult = await UnifiedCreditController.settleByMeta(
          { "meta.regenSessionId": sessionId },
          actualCharge,
        );
        if (!settleResult.ok && settleResult.reason === "NO_RECEIPT") {
          if (billableCount > 0) {
            await UnifiedCreditController.deductCredits(
              record.userId,
              actualCharge,
              {
                model: record.inputs?.model,
                service_type: "ai_ads_scene_regen_image",
                session_id: sessionId,
              },
            );
          }
        }
        emitCreditStatus(record.userId).catch(() => {});
      } catch (deductErr) {
        logger.error(
          `[AI Ads] regenerate credit settle failed for ${sessionId}: ${deductErr.message}`
        );
      }

      if (global.io) {
        global.io.to(record.userId).emit("aiAdsScenesReady", {
          sessionId,
          event: "regenerated",
          scenes: processedScenes,
          totalSegments: updatedRecord.totalSegments,
          totalDuration: updatedRecord.totalDuration,
        });
      }
      return res.json({ success: true, message: "Scene regenerated" });
    }

    // ───── Scenario 5: full pipeline crash ──────────────────────────────────
    const isFullCrash =
      type === "error" &&
      (!imageStatus || imageStatus === "") &&
      (success === false || status === 400);
    if (isFullCrash) {
      await VideoGeneration.findByIdAndUpdate(sessionId, { status: "failed" });
      // Refund every active regen freeze for this session — no scenes
      // succeeded so all reserved credits are returned in full.
      await UnifiedCreditController.releaseByMeta({
        "meta.regenSessionId": sessionId,
      });
      if (global.io) {
        global.io.to(record.userId).emit("aiAdsScenesFailed", {
          ...req.body,
          sessionId,
          event: "sessionFailed",
          error: error || "Scene generation failed",
        });
      }
      return res.json({ success: true, message: "Session failure recorded" });
    }

    // ───── Scenario 4: per-scene image failure (session continues) ──────────
    if (type === "error" && imageStatus === "partial_error" && Array.isArray(image)) {
      for (const imgData of image) {
        await VideoGeneration.updateOne(
          { _id: sessionId, "scenes.segmentNumber": imgData.segmentNumber },
          {
            $set: {
              "scenes.$.imageFailed": true,
              "scenes.$.imageError": error || "Image generation failed",
            },
          }
        );
        if (global.io) {
          // Spread the full Python payload first so frontend has all context
          // (type, imageStatus, image[], text[], totalSegments, etc.), then
          // overlay our discriminators on top.
          global.io.to(record.userId).emit("aiAdsScenesFailed", {
            ...req.body,
            sessionId,
            event: "sceneImageFailed",
            segmentNumber: imgData.segmentNumber,
            error: error || "Image generation failed for this scene",
          });
        }
      }
      return res.json({ success: true, message: "Scene image failure recorded" });
    }

    // ───── Scenario 1: text callback — create all scenes (no frames yet) ────
    if (type === "text" && Array.isArray(text) && text.length > 0) {
      const scenes = text.map((t) => ({
        ...t,
        frameImageUrl: null,
        imageFailed: false,
        imageError: null,
      }));

      const textUpdate = {
        scenes,
        totalSegments: totalSegments || scenes.length,
        totalDuration: totalDuration || record.totalDuration,
        status: "pending",
      };
      if (characterGender) {
        textUpdate["inputs.characterGender"] = characterGender;
      }

      const updatedRecord = await VideoGeneration.findByIdAndUpdate(
        sessionId,
        { $set: textUpdate },
        { new: true }
      );

      if (global.io) {
        global.io.to(record.userId).emit("aiAdsScenesReady", {
          sessionId,
          event: "text",
          scenes: updatedRecord.scenes,
          totalSegments: updatedRecord.totalSegments,
          totalDuration: updatedRecord.totalDuration,
        });
      }
      return res.json({ success: true, message: "Text scenes saved" });
    }

    // ───── Scenarios 2 & 3: image callback (partial or complete) ────────────
    if (type === "image" && Array.isArray(image) && image.length > 0) {
      const isComplete = imageStatus === "complete";

      for (const imgData of image) {
        await VideoGeneration.updateOne(
          { _id: sessionId, "scenes.segmentNumber": imgData.segmentNumber },
          {
            $set: {
              "scenes.$.frameImageUrl": imgData.frameImageUrl,
              "scenes.$.imageFailed": false,
              "scenes.$.imageError": null,
            },
          }
        );
        if (global.io) {
          global.io.to(record.userId).emit("aiAdsScenesReady", {
            sessionId,
            event: isComplete ? "imageComplete" : "imagePartial",
            segmentNumber: imgData.segmentNumber,
            frameImageUrl: imgData.frameImageUrl,
          });
        }
      }

      return res.json({ success: true, message: `Image ${imageStatus || "patch"} saved` });
    }

    // ───── Fallback — unrecognized callback shape ────────────────────────────
    logger.warn(
      `[AI Ads] Unrecognized scene callback for ${sessionId}: type=${type}, imageStatus=${imageStatus}, status=${status}`
    );
    return res.json({ success: true, message: "Callback received but not actionable" });
  } catch (err) {
    console.error("Error in updateSceneResult:", err);
    logger.error(
      `[AI Ads] updateSceneResult error for ${req.params.sessionId}: ${err.message}`
    );
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 5. Python Callback ï¿½ AI Ads Video Result ---------------------------------
exports.updateAiAdsVideoResult = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = '[Python Callback] Video result'
       #swagger.description = 'Called by the Python AI engine when video generation completes. Protected by secret key — NOT called by the frontend. Stores result in results[].url (same field as ugc/broll/avatar/clone) and emits aiAdsVideoReady via Socket.io.'
       #swagger.security = []
       #swagger.requestBody = {
         required: true,
         content: { "application/json": { "schema": { "$ref": "#/components/schemas/aiAdsVideoResultCallback_Payload" } } }
       }
    */
    const { sessionId } = req.params;
    const {
      userId: pythonUserId,
      videoStatus,        // 200 = success, 400/500/529 = error
      url,                // merged video URL (empty string on error)
      duration,           // string e.g. "30" (seconds)
      model: pythonModel, // e.g. "veo-3.1-fast"
      error,              // error message (empty string on success)
      watermark,          // boolean — whether watermark was applied
      watermarkUrl,       // watermarked video URL (empty string if no watermark)

      // ── Voice-regenerate fields (present only when isVoiceRegenerate) ───────
      // The finished voice re-render lands on THIS same callback, distinguished
      // by isVoiceRegenerate. These populate the new per-version results[].aiAds.
      isVoiceRegenerate,  // true = voice re-render callback, not first-time video
      regenType,          // "voice" | "translate" | "rewrite"
      voiceProvider,      // voice used for this version
      voiceId,
      voiceName,
      language,           // this version's language (Python owns the value)
      scenes,             // structured per-version script (mirrors scenes[].script)
    } = req.body;

    logger.info(
      `[AI Ads] Received video callback for sessionId ${sessionId}: videoStatus=${videoStatus}`
    );

    console.log(
      `[credits] updateAiAdsVideoResult ENTER session=${sessionId} videoStatus=${videoStatus}`,
    );

    const record = await VideoGeneration.findOne({
      _id: sessionId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      console.warn(
        `[credits] updateAiAdsVideoResult 404 session=${sessionId} — no AI Ads record`,
      );
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }

    // ── Voice-regenerate branch ────────────────────────────────────────────
    // Handled BEFORE the status-based duplicate guard below: doc.status stays
    // "completed" throughout a voice regen, so that guard would otherwise
    // swallow this callback. Dedupe instead on regenState — a stray/duplicate
    // callback finds regenState !== "processing". version is NOT moved here;
    // the user commits it via /ai-ads/select-version ("Keep this one").
    if (isVoiceRegenerate) {
      if (record.regenState !== "processing") {
        console.warn(
          `[AI Ads] voice callback ignored session=${sessionId} regenState=${record.regenState}`,
        );
        return res.json({ success: true, duplicate: true });
      }

      const vModel = pythonModel || record.inputs?.model;
      const vDuration = Number(duration) || 0;

      if (videoStatus === 200) {
        // Build the new version's state. Prefer Python's callback body when
        // present; otherwise fall back to the stash Node captured at request
        // time (pendingRegen). scenes: prefer Python's re-rendered script, else
        // the stashed base script.
        const pending = record.pendingRegen
          ? (record.pendingRegen.toObject
              ? record.pendingRegen.toObject()
              : record.pendingRegen)
          : {};
        const aiAds = {
          regenType: regenType || pending.regenType || null,
          voiceProvider: voiceProvider ?? pending.voiceProvider ?? null,
          voiceId: voiceId ?? pending.voiceId ?? null,
          voiceName: voiceName ?? pending.voiceName ?? null,
          language: language ?? pending.language ?? null,
          scenes:
            Array.isArray(scenes) && scenes.length ? scenes : pending.scenes || [],
        };

        // Built once — reused for the $push and the socket payload so the
        // frontend can append the new version without a refetch.
        const newResult = {
          url: url || null,
          waterMarkUrl: watermarkUrl || null,
          model: vModel || null,
          duration: String(vDuration || ""),
          videoStatus: 200,
          error: null,
          aiAds,
        };

        const updated = await VideoGeneration.findByIdAndUpdate(
          sessionId,
          {
            // status + version intentionally untouched — clear guard + stash.
            $set: { regenState: "idle", pendingRegen: null },
            $push: { results: newResult },
          },
          { new: true },
        );

        // Index of the entry we just appended. The frontend previews this one;
        // the version pointer only moves on an explicit select-version.
        const newIndex = (updated?.results?.length || 1) - 1;

        // NOTE: voice regen is FREE today — no freeze/settle. When billing is
        // switched on, deduct here keyed on regenType (voice < translate/rewrite)
        // and record generated-media history, mirroring the initial-video path.

        if (global.io) {
          global.io.to(record.userId).emit("aiAdsVoiceReady", {
            sessionId,
            index: newIndex,
            regenType: regenType || null,
            totalDuration: vDuration,
            // Carry the new version so the client appends without a refetch.
            // waterMarkUrl included raw — the client applies plan-based watermark.
            result: newResult,
          });
        }
        return res.json({
          success: true,
          message: "AI Ads voice result processed",
          index: newIndex,
        });
      }

      // Failure — nothing was frozen (free), so no credit release. Reset the
      // guard + clear the stash so the user can retry, and surface to the UI.
      await VideoGeneration.findByIdAndUpdate(sessionId, {
        regenState: "failed",
        pendingRegen: null,
      });
      if (global.io) {
        global.io.to(record.userId).emit("aiAdsVoiceFailed", {
          sessionId,
          event: "voiceRegenFailed",
          videoStatus: videoStatus || 500,
          error: error || "Voice regeneration failed",
        });
      }
      return res.json({ success: true, message: "AI Ads voice failure processed" });
    }

    // Duplicate-callback guard. If the record is already in a terminal state,
    // a prior callback already settled or released the freeze. Running again
    // would NO_RECEIPT-fallthrough into deductCredits and double-charge.
    if (record.status === "completed" || record.status === "failed") {
      console.warn(
        `[credits] updateAiAdsVideoResult DUPLICATE session=${sessionId} ` +
          `prior_status=${record.status} new_videoStatus=${videoStatus} ` +
          `— skipping credit work`,
      );
      return res.json({ success: true, duplicate: true });
    }

    // Resolve fields — use Python body first, fall back to DB record
    const userId = pythonUserId || record.userId;
    const model = pythonModel || record.inputs?.model;

    // Parse duration from Python string (e.g. "30") to number
    const durationInSeconds = Number(duration) || 0;

    // videoStatus === 200 means success
    const isSuccess = videoStatus === 200;

    if (isSuccess) {
      await VideoGeneration.findByIdAndUpdate(
        sessionId,
        {
          $set: {
            status: "completed",
            totalDuration: durationInSeconds || record.totalDuration,
            // First render is version 0 and the default the pointer shows.
            version: 0,
          },
          // Push into results[] — same field frontend reads for ugc/broll/avatar/clone
          $push: {
            results: {
              url: url || null,
              waterMarkUrl: watermarkUrl || null,
              model: model || null,
              duration: String(durationInSeconds || ""),
              videoStatus: 200,
              error: null,
              // Mirror the original voice + structured script so version 0 is a
              // proper, labeled entry in the switcher (regenType=null = original).
              aiAds: {
                regenType: null,
                voiceProvider: record.inputs?.voiceProvider ?? null,
                voiceId: record.inputs?.voiceId ?? null,
                voiceName: record.inputs?.voiceName ?? null,
                language: record.inputs?.voiceFilters?.language ?? null,
                scenes: (record.scenes || []).map((s) => ({
                  segmentNumber: s.segmentNumber,
                  durationSeconds: s.durationSeconds,
                  script: s.script,
                })),
              },
            },
          },
        },
        { new: true }
      );

      // Settle the freeze: keep the cost of the actual delivered duration,
      // refund the rest (e.g. Python returned a shorter clip than reserved).
      const creditPerSecond = UnifiedCreditController.getModelDeduction(model);
      const totalCreditsToDeduct = durationInSeconds * creditPerSecond;

      const settleResult = await UnifiedCreditController.releasePartial(
        sessionId,
        totalCreditsToDeduct,
      );
      if (!settleResult.ok && settleResult.reason === "NO_RECEIPT") {
        await UnifiedCreditController.deductCredits(userId, totalCreditsToDeduct, {
          model,
          service_type: "ai_ads",
          duration: durationInSeconds,
          resolution: "standard",
          session_id: sessionId,
          chat_id: record._id.toString(),
        });
      }

      // Save to generated media history
      const actualCost = modelPricingConfig.getVideoCost(model, durationInSeconds);
      GeneratedMediaController.saveGeneratedMedia({
        userId,
        model,
        type: "video",
        image: "",
        video: url || "",
        credit_deduction: totalCreditsToDeduct,
        cost: actualCost,
        duration: durationInSeconds,
      });

      if (global.io) {
        global.io.to(record.userId).emit("aiAdsVideoReady", {
          sessionId,
          totalDuration: durationInSeconds,
        });
      }

      emitCreditStatus(userId);
    } else {
      // Failure path → refund the freeze fully. Safe no-op if already released.
      await UnifiedCreditController.releaseCredits(sessionId);
      // Error cases: 400 (safety), 429 (voice gen failed), 500 (general), 529 (overload)
      const isVoiceFailure = videoStatus === 429;
      const failureMessage = isVoiceFailure
        ? (error || "Voice generation failed")
        : (error || "Video generation failed");

      await VideoGeneration.findByIdAndUpdate(sessionId, {
        status: "failed",
      });
      if (global.io) {
        global.io.to(record.userId).emit("aiAdsVideoFailed", {
          sessionId,
          event: isVoiceFailure ? "voiceFailed" : "videoFailed",
          videoStatus: videoStatus || 500,
          error: failureMessage,
        });
      }
      emitCreditStatus(userId);
    }

    return res.json({ success: true, message: "AI Ads video result processed" });
  } catch (err) {
    console.error("Error in updateAiAdsVideoResult:", err);
    logger.error(
      `[AI Ads] updateAiAdsVideoResult error for ${req.params.sessionId}: ${err.message}`
    );
    return res.status(500).json({ success: false, error: err.message });
  }
};


// --- 3. generateAiAdsVideo (Step 2 — dedicated, mirrors generateAvatarVideo) ------
exports.generateAiAdsVideo = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Step 2 — Generate AI Ads video from finalized scenes'
       #swagger.description = 'Dedicated step-2 endpoint (mirrors generateAvatarVideo). Finds the existing session created in generate-scene, checks credits, and fires video generation to the Python engine. Results arrive via aiAdsVideoReady Socket.io event.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['sessionId'] = { in: 'path', required: true, schema: { type: 'string' }, description: 'Session ID returned from generate-scene' }
    */
    const { sessionId } = req.params;
    const userId = req.user.user_id;

    // Find the existing session created during generate-scene
    const record = await VideoGeneration.findOne({
      _id: sessionId,
      userId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }

    // Atomic freeze — this is the commit (generateScene was just preview).
    // Keyed by sessionId; updateAiAdsVideoResult settles/releases.
    const durationSec = Number(String(record.inputs.duration).replace("s", "")) || 0;
    const totalRequired =
      durationSec *
      UnifiedCreditController.getModelDeduction(record.inputs.model) *
      (record.inputs.numberOfVideos || 1);

    const freeze = await UnifiedCreditController.freezeCredits({
      userId,
      reservationKey: sessionId,
      amount: totalRequired,
      meta: { service_type: "ai_ads", model: record.inputs.model },
    });

    if (!freeze.ok) {
      if (freeze.reason === "NO_BASE_PLAN") {
        return res.status(403).json({
          success: false,
          error: "An active subscription plan is required.",
        });
      }
      if (freeze.reason === "INSUFFICIENT") {
        return res.status(400).json({
          success: false,
          error: `Not enough credits. You need ${totalRequired} but only have ${freeze.remaining}.`,
        });
      }
      return res.status(503).json({
        success: false,
        error: "Could not reserve credits. Please try again.",
      });
    }

    await VideoGeneration.findByIdAndUpdate(sessionId, { status: "processing" });

    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];
    const applyWatermark = plan === "8" ? true : (record.watermark ?? false);
    // Validate env before calling Python
    if (!process.env.AI_ADS_PYTHON_API) {
      return res.status(500).json({
        success: false,
        error: "AI Ads Python API not configured",
      });
    }

    // Build inputs for Python — rename frontend fields to Python-expected names
    const { brandName, productName, productDescription, scenes: dbScenes, ...restInputs } = record.inputs;
    const inputsForPython = {
      ...restInputs,
      ...(brandName || productName ? { name: brandName || productName } : {}),
      ...(productDescription ? { description: productDescription } : {}),
    };

    // Script-override map from the request body. Frontend sends the user's
    // edited scripts (per scene) here. Keyed by segmentNumber.
    const scriptOverrideBySegment = new Map();
    if (Array.isArray(req.body?.scenes)) {
      for (const s of req.body.scenes) {
        if (s?.segmentNumber != null && Array.isArray(s.script)) {
          scriptOverrideBySegment.set(s.segmentNumber, s.script);
        }
      }
    }

    // Persist the edited scripts to DB FIRST so the record matches what gets
    // sent to Python. await so any read after this point sees fresh data.
    if (scriptOverrideBySegment.size > 0) {
      await Promise.all(
        Array.from(scriptOverrideBySegment.entries()).map(([segNum, script]) =>
          VideoGeneration.updateOne(
            { _id: sessionId, "scenes.segmentNumber": segNum },
            { $set: { "scenes.$.script": script } }
          ).catch((err) => {
            logger.error(
              `[AI Ads] failed to persist script override for ${sessionId} seg ${segNum}: ${err.message}`
            );
          })
        )
      );
    }

    // Build flat scenes array — use override script if present, else the
    // (now-already-saved) DB script.
    const scenesForPython = (record.scenes || dbScenes || []).map(s => {
      const scene = typeof s.toObject === "function" ? s.toObject() : { ...s };
      const overrideScript = scriptOverrideBySegment.get(scene.segmentNumber);
      return {
        segmentNumber: scene.segmentNumber,
        goal: scene.goal,
        durationSeconds: scene.durationSeconds,
        frameImageUrl: scene.frameImageUrl,
        sceneDescription: scene.sceneDescription,
        audioDirection: scene.audioDirection,
        tone: scene.tone,
        indianAccent: scene.indianAccent,
        script: overrideScript || scene.script,
      };
    });

    // Fire-and-forget to Python
    axios
      .post(process.env.AI_ADS_PYTHON_API, {
        sessionId,
        userId,
        watermark: applyWatermark,
        // inputs: inputsForPython,
        // scenes: scenesForPython,
        subscription: req.body.subscription || { plan: "pro", credits: "100" }, // Use provided or defaults
        inputs: {
          ...inputsForPython,
          scenes: scenesForPython,
        },
      })
      .catch((err) => {
        console.error("[AI Ads] generate-video python call failed:", err.message);
        logger.error(`[AI Ads] generate-video python call failed: ${err.message}`);
        VideoGeneration.findByIdAndUpdate(sessionId, {
          status: "failed",
        }).catch(() => { });
        // Python rejected — refund the freeze so credits aren't stuck.
        UnifiedCreditController.releaseCredits(sessionId).catch((e) =>
          logger.error(`[AI Ads] freeze release failed for ${sessionId}: ${e.message}`),
        );
        if (global.io) {
          global.io.to(userId).emit("aiAdsVideoFailed", { sessionId, error: err.message });
        }
      });

    return res.status(200).json({
      success: true,
      message: "Video generation in progress. Listen on socket 'aiAdsVideoReady'.",
      sessionId,
    });
  } catch (err) {
    console.error("Error in generateAiAdsVideo:", err);
    logger.error(`[AI Ads] generateAiAdsVideo error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 3b. copyAiAdsVideo (Recreate — clone an existing AI Ads session) -------------
// Clones an existing AI Ads VideoGeneration record into a brand-new document so
// "Recreate" produces a different _id even when the user does not edit the form.
// The clone carries over `inputs`, `scenes`, `totalSegments`, `totalDuration`,
// and `watermark`, but `results` and `videoSegments` start empty. Status is
// set to "copy" so the clone is hidden from getAllVideos (My Space) until the
// user actually triggers generation via /ai-ads/generate-video/:sessionId,
// which flips the status to "processing".
exports.copyAiAdsVideo = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Step 1c — Copy an existing AI Ads session for Recreate'
       #swagger.description = 'Creates a new VideoGeneration record by cloning an existing AI Ads session (inputs + scenes + scripts). The new record has status="copy" and is hidden from My Space until the user calls /ai-ads/generate-video/:sessionId on it. Use this so the Recreate flow always produces a new _id even when the form is unchanged.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['sessionId'] = { in: 'path', required: true, schema: { type: 'string' }, description: 'Session ID of the AI Ads record to copy' }
    */
    const { sessionId } = req.params;
    const userId = req.user.user_id;

    const original = await VideoGeneration.findOne({
      _id: sessionId,
      userId,
      "inputs.type": "ai_ads",
    }).lean();

    if (!original) {
      return res.status(404).json({
        success: false,
        error: "AI Ads session not found",
      });
    }

    // Strip Mongo internals so we can re-create cleanly.
    const {
      _id,
      createdAt,
      updatedAt,
      __v,
      results,
      videoSegments,
      generatedImage,
      generatedScript,
      promptPercentage,
      status,
      ...rest
    } = original;

    const copyData = {
      ...rest,
      userId,
      status: "copy",
      results: [],
      videoSegments: [],
      generatedImage: null,
      generatedScript: null,
      promptPercentage: 0,
    };

    const copy = await VideoGeneration.create(copyData);

    return res.status(200).json({
      success: true,
      message: "AI Ads session copied. Use the new sessionId for /ai-ads/generate-video.",
      sessionId: copy._id.toString(),
      data: copy,
    });
  } catch (err) {
    console.error("Error in copyAiAdsVideo:", err);
    logger.error(`[AI Ads] copyAiAdsVideo error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 3c. regenerateAiAdsVoice (voice-only re-render, no Veo) ------------------
// Redoes the voice-over on an already-generated ad. Operates RELATIVE to the
// currently selected version (results[doc.version]): that version's script is
// the base Python re-voices, so chained flows work (translate → then re-voice
// the translated script). `inputs` stays frozen as the original first-gen state.
// Voice regen is FREE today (no credit freeze); a hook is marked for future
// billing keyed on regenType.
//
// Unlike the other generate endpoints this AWAITS Python's accept/reject (it is
// NOT pure fire-and-forget) so the 400 already_in_language guard is forwarded to
// the client VERBATIM instead of surfacing as a generic 500. On accept (2xx),
// completion arrives async on the shared video-result callback (isVoiceRegenerate).
exports.regenerateAiAdsVoice = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Regenerate voice on an existing AI Ads video (voice-only, no Veo)'
       #swagger.description = 'Redoes the voice-over on a completed AI Ads ad. regenType selects the flow: voice (same script, new voice), translate (new language), rewrite (new script, same language). Appends a new results[] version; the pointer is only moved by /ai-ads/select-version. Forwards Python 400 already_in_language verbatim.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['sessionId'] = { in: 'path', required: true, schema: { type: 'string' } }
    */
    const { sessionId } = req.params;

    const { error, value } = regenerateVoiceSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details.map((d) => d.message).join(", "),
      });
    }

    const userId = req.user.user_id;

    const record = await VideoGeneration.findOne({
      _id: sessionId,
      userId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }

    // Only a finished video can have its voice regenerated.
    if (record.status !== "completed") {
      return res.status(400).json({
        success: false,
        error: "Voice can only be regenerated on a completed video.",
      });
    }

    // Concurrency guard — one voice regen at a time per session.
    if (record.regenState === "processing") {
      return res.status(409).json({
        success: false,
        error: "regen_in_progress",
        message: "A voice regeneration is already in progress for this ad.",
      });
    }

    if (!process.env.AI_ADS_REGENERATE_VOICE_PYTHON_API) {
      return res.status(500).json({
        success: false,
        error: "AI Ads regenerate-voice Python API not configured",
      });
    }

    // Base = the currently selected version. Its script is what Python re-voices.
    // Fall back to the doc's original scenes if the selected entry has no aiAds.
    const versionIdx =
      typeof record.version === "number" && record.results?.[record.version]
        ? record.version
        : 0;
    const baseVersion = record.results?.[versionIdx];
    // Plain-object copy — stashing live subdocs into pendingRegen can trip
    // Mongoose's "already has a parent" guard, so detach them first.
    const toPlainScenes = (arr) =>
      (arr || []).map((s) =>
        s && typeof s.toObject === "function"
          ? s.toObject()
          : {
              segmentNumber: s?.segmentNumber,
              durationSeconds: s?.durationSeconds,
              script: s?.script,
            },
      );
    const baseScenes = baseVersion?.aiAds?.scenes?.length
      ? toPlainScenes(baseVersion.aiAds.scenes)
      : toPlainScenes(record.scenes);

    const voiceDelta = value.inputs; // { voiceProvider, voiceId, voiceName, regenType, translateLang }

    // Build Python inputs: frozen original inputs (brand/images/frames/model) +
    // the selected version's script as the base + the new voice delta on top.
    const { brandName, productName, productDescription, scenes: _dropScenes, ...restInputs } =
      record.inputs.toObject ? record.inputs.toObject() : record.inputs;
    const inputsForPython = {
      ...restInputs,
      ...(brandName || productName ? { name: brandName || productName } : {}),
      ...(productDescription ? { description: productDescription } : {}),
      // voice delta overrides the frozen original voice
      voiceProvider: voiceDelta.voiceProvider,
      voiceId: voiceDelta.voiceId ?? "",
      voiceName: voiceDelta.voiceName ?? "",
      regenType: voiceDelta.regenType,
      translateLang: voiceDelta.translateLang ?? "",
      scenes: baseScenes,
    };

    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];
    const applyWatermark = plan === "8" ? true : (record.watermark ?? false);

    // Mark processing up front so a concurrent request 409s. Reset on reject.
    // Stash the voice delta + base script so the finished-callback can stamp the
    // new version now (before Python echoes metadata back). scenes here is the
    // BASE script — correct for "voice"; a stopgap for translate/rewrite until
    // Python returns the re-rendered script (callback prefers Python's scenes).
    record.regenState = "processing";
    record.pendingRegen = {
      regenType: voiceDelta.regenType,
      voiceProvider: voiceDelta.voiceProvider ?? null,
      voiceId: voiceDelta.voiceId ?? null,
      voiceName: voiceDelta.voiceName ?? null,
      language:
        voiceDelta.regenType === "translate"
          ? voiceDelta.translateLang || null
          : baseVersion?.aiAds?.language ?? null,
      scenes: baseScenes,
    };
    await record.save();

    try {
      await axios.post(process.env.AI_ADS_REGENERATE_VOICE_PYTHON_API, {
        sessionId,
        userId,
        watermark: applyWatermark,
        subscription:
          value.subscription || req.body.subscription || { plan: "pro", credits: "100" },
        inputs: inputsForPython,
      });

      // Python accepted → completion arrives on the video-result callback.
      return res.status(202).json({
        status: "processing",
        sessionId,
        message: "Voice regeneration started. Listen on socket 'aiAdsVoiceReady'.",
        regenType: voiceDelta.regenType,
      });
    } catch (pyErr) {
      // Nothing is running — roll back the guard + clear the stash.
      await VideoGeneration.findByIdAndUpdate(sessionId, {
        regenState: "idle",
        pendingRegen: null,
      }).catch(() => {});

      const status = pyErr.response?.status;
      const body = pyErr.response?.data;

      // Forward the already_in_language guard VERBATIM (do NOT convert to 500).
      if (status === 400) {
        return res.status(400).json(
          body || {
            error: "already_in_language",
            message: "This ad is already in the requested language.",
          },
        );
      }

      console.error("[AI Ads] regenerate-voice python call failed:", pyErr.message);
      logger.error(`[AI Ads] regenerate-voice python call failed: ${pyErr.message}`);
      return res.status(502).json({
        success: false,
        error: "Voice regeneration service failed. Please try again.",
      });
    }
  } catch (err) {
    console.error("Error in regenerateAiAdsVoice:", err);
    logger.error(`[AI Ads] regenerateAiAdsVoice error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 3d. selectAiAdsVersion ("Keep this one" / revert) -----------------------
// Moves the version pointer to a previously generated results[] entry. This is
// the ONLY action that changes what My Space shows; regenerated entries are
// appended but never auto-selected.
exports.selectAiAdsVersion = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Select which AI Ads version My Space shows (Keep this one / revert)'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.parameters['sessionId'] = { in: 'path', required: true, schema: { type: 'string' } }
    */
    const { sessionId } = req.params;

    const { error, value } = selectVersionSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.details.map((d) => d.message).join(", "),
      });
    }

    const userId = req.user.user_id;
    const record = await VideoGeneration.findOne({
      _id: sessionId,
      userId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
    }

    const count = record.results?.length || 0;
    if (value.version < 0 || value.version >= count) {
      return res.status(400).json({
        success: false,
        error: `Invalid version. Must be 0 <= version < ${count}.`,
      });
    }

    record.version = value.version;
    await record.save();

    return res.status(200).json({ success: true, version: record.version });
  } catch (err) {
    console.error("Error in selectAiAdsVersion:", err);
    logger.error(`[AI Ads] selectAiAdsVersion error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// --- 4. getAiAdsBrand --------------------------------------------------------
exports.getAiAdsBrand = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Extract brand intelligence from a script or brand name'
       #swagger.description = 'Provide either script (any text about the brand) or name (brand name), or both. Returns brand intelligence instantly.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             "schema": {
               "type": "object",
               "properties": {
                 "script": { "type": "string", "example": "Nike is a global sportswear brand..." },
                 "name": { "type": "string", "example": "Nike" }
               }
             },
             "example": { "script": "Nike is a global sportswear brand...", "name": "Nike" }
           }
         }
       }
    */
    const { error, value } = aiAdsBrandSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const msg = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: msg });
    }

    const pythonPayload = { script: value.script, name: value.name };

    const pythonResponse = await axios.post(
      process.env.AI_ADS_BRAND_PYTHON_API,
      pythonPayload
    );

    return res.status(pythonResponse.status).json(pythonResponse.data);
  } catch (err) {
    console.error("Error in getAiAdsBrand:", err);
    logger.error(`[AI Ads] getAiAdsBrand error: ${err.message}`);
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: err.message });
  }
};

// --- 5. getAiAdsProduct ------------------------------------------------------
exports.getAiAdsProduct = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Extract product intelligence from a script or product name'
       #swagger.description = 'Provide either script (any text about the product) or name (product name), or both. Returns product intelligence instantly.'
       #swagger.security = [{ "BearerAuth": [] }]
       #swagger.requestBody = {
         required: true,
         content: {
           "application/json": {
             "schema": {
               "type": "object",
               "properties": {
                 "script": { "type": "string", "example": "Nike Air Max 270 features a large Air unit..." },
                 "name": { "type": "string", "example": "Nike Air Max 270" }
               }
             },
             "example": { "script": "Nike Air Max 270 features a large Air unit...", "name": "Nike Air Max 270" }
           }
         }
       }
    */
    const { error, value } = aiAdsProductSchema.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const msg = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: msg });
    }

    const pythonPayload = { script: value.script, name: value.name };

    const pythonResponse = await axios.post(
      process.env.AI_ADS_PRODUCT_PYTHON_API,
      pythonPayload
    );

    return res.status(pythonResponse.status).json(pythonResponse.data);
  } catch (err) {
    console.error("Error in getAiAdsProduct:", err);
    logger.error(`[AI Ads] getAiAdsProduct error: ${err.message}`);
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: err.message });
  }
};
exports.generateImageAndScriptClone = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Submit request for image and script generation for Avatar type'
       #swagger.description = 'Accepts inputs for Avatar type, generates an image and script by calling Python APIs, and updates the record accordingly. This is a two-step process where the frontend first calls this endpoint to generate the image and script, and then calls the /generate-avatar-video endpoint to create the final video using those assets.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: 'object',
                        required: ['inputs'],
                        properties: { 
                            inputs:  { $ref: "#/components/schemas/avatar_Payload" }
                        }
                    }
                }
            }
        } 
      */
    // * STEP 1: Validate request body using avatarSchema
    const { error, value } = inputSchemasByType.clone.validate(
      req.body.inputs,
      {
        abortEarly: false,
      },
    );

    if (error) {
      const fieldErrors = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: fieldErrors });
    }

    const inputs = value;
    const userId = req.user.user_id; // Extracted from authenticateJWT middleware

    // * STEP 2: Model-based credit logic
    const selectedModel = inputs.model; // e.g., 'veo-3.1-fast'
    const durationNum = Number(inputs.duration.replace("s", "")) || 0; // Duration in seconds

    const detectionCredit = getExtraDeduction(selectedModel, "clone");

    // Calculate how many credits 1 video takes: duration * (model_multiplier + detection_credit)
    const videoMinCount =
      durationNum * (UnifiedCreditController.getModelDeduction(selectedModel) + detectionCredit);

    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;

    // NOTE: no freeze here. generateImageAndScript is only the preview step
    // (generates image + script for user review) — the user hasn't committed
    // to spending video credits yet. The freeze happens at generateAvatarVideo,
    // which is the actual commit. This avoids leaked holds when users preview
    // a script and walk away.
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );

    const userRemainingCredits = unifiedCheck.remainingCredits || 0;

    if (!unifiedCheck.isAllowed) {
      if (userRemainingCredits >= videoMinCount) {
        return res.status(400).json({
          success: false,
          error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
        });
      }
      return res.status(400).json({ success: false, error: "Not enough credits" });
    }

    const video = await VideoGeneration.create({
      userId,
      inputs: value,
      status: "pending",
    });

    const videoId = video._id.toString();

    const pythonPayload = {
      sessionId: videoId,
      userId,
      watermark: inputs.watermark ?? false,
      inputs: {
        person_images: inputs.uploadedAvatars || [],
        product_img: inputs.image ? [inputs.image] : [],
        productName: inputs.productName,
        promotion: inputs.promotion || "",
        duration: inputs.duration,
        aspectRatio: inputs.aspectRatio,
        tone: inputs.tone,
        notes: inputs.notes || "",
        voiceSampleUrl: inputs.voiceSampleUrl || null,
      },
    };

    // * Call Python API to generate clone avatar video
    const pythonResponse = await axios.post(
      process.env.CLONE_YOURSELF_IMAGE_SCRIPT_PYTHON_API,
      pythonPayload,
    );

    const pyData = pythonResponse.data;

    if (pyData.error) {
      return res.status(500).json({ success: false, error: pyData.error });
    }

    return res.status(200).json({
      success: true,
      sessionId: videoId,
      userId,
      status: pyData.status || "accepted",
      message: pyData.message || "Clone yourself generation started",
      data: video,
    });
  } catch (err) {
    console.error("Error in generateImageAndScriptClone:", err);

    if (err.response || err.code === "ECONNREFUSED") {
      return res.status(500).json({
        success: false,
        error: `Python API error: ${err.message}`,
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
};
exports.updateImageAndScriptClone = async (req, res) => {
  /*
    #swagger.tags = ['Video Generation']
    #swagger.summary = 'Callback: update generated image/script from Python clone worker'
    #swagger.description = 'Called by Python after script_generation step. Handles success and failure for type=image, type=text, or type=both. On failure only marks the relevant field(s) as failed. On text success also persists videoPrompt and duration.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: 'object',
            required: ['sessionId', 'type', 'status'],
            properties: {
              sessionId:   { type: 'string', example: '6654abc...' },
              type:        { type: 'string', enum: ['image', 'text', 'both'] },
              image:       { type: 'string', example: '/creatives/user_42/123.webp' },
              text:        { type: 'object', description: 'creativeBrief script object' },
              status:      { type: 'number', example: 200 },
              error:       { type: 'string', example: '' },
              videoPrompt: { type: 'string' },
              duration:    { type: 'number' }
            }
          }
        }
      }
    }
  */
  try {
    const { sessionId, type, image, text, status, error, videoPrompt, duration } = req.body;

    if (!sessionId || !type) {
      return res.status(400).json({ success: false, error: "sessionId and type are required" });
    }

    if (!["image", "text", "both"].includes(type)) {
      return res.status(400).json({ success: false, error: "type must be one of: image, text, both" });
    }

    if (status === undefined || status === null) {
      return res.status(400).json({ success: false, error: "status is required" });
    }

    // ── Failure path ──────────────────────────────────────────────────────────
    if (Number(status) !== 200 || (error && error !== "")) {
      const updateFields = { status: "failed" };
      if (type === "image" || type === "both") updateFields.generatedImage = "failed";
      if (type === "text"  || type === "both") updateFields.generatedScript = "failed";

      const video = await VideoGeneration.findByIdAndUpdate(
        sessionId,
        { $set: updateFields },
        { new: true, lean: true },
      );

      if (!video) {
        return res.status(404).json({ success: false, error: "Video record not found" });
      }

      if (global.io) {
        global.io.to(video.userId).emit("CloneImageScriptUpdate", {
          _id: video._id,
          userId: video.userId,
          status: "failed",
          error,
          ...updateFields,
        });
      }

      return res.status(200).json({ success: true, message: "Step failed, record updated", error });
    }

    // ── Success path — validate required fields ───────────────────────────────
    if (type === "image" && !image) {
      return res.status(400).json({ success: false, error: "image is required when type is 'image'" });
    }
    if (type === "text" && !text) {
      return res.status(400).json({ success: false, error: "text is required when type is 'text'" });
    }
    if (type === "both" && (!image || !text)) {
      return res.status(400).json({ success: false, error: "image and text are required when type is 'both'" });
    }

    // ── Build update ──────────────────────────────────────────────────────────
    const updateFields = {};

    if (type === "image" || type === "both") {
      updateFields.generatedImage = image;
    }
    if (type === "text" || type === "both") {
      updateFields.generatedScript = text;
      if (videoPrompt) updateFields.videoPrompt = videoPrompt;
      if (duration)    updateFields["inputs.duration"] = String(duration);
    }

    const video = await VideoGeneration.findByIdAndUpdate(
      sessionId,
      { $set: updateFields },
      { new: true, lean: true },
    );

    if (!video) {
      return res.status(404).json({ success: false, error: "Video record not found" });
    }

    if (global.io) {
      global.io.to(video.userId).emit("CloneImageScriptUpdate", {
        _id: video._id,
        userId: video.userId,
        ...updateFields,
      });
    }

    return res.status(200).json({ success: true, data: video });
  } catch (err) {
    console.error("Error in updateImageAndScriptClone:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
exports.regenerateScriptClone = async (req, res) => {
  /*
    #swagger.tags = ['Video Generation']
    #swagger.summary = 'Regenerate clone-yourself script with a new tone'
    #swagger.description = 'Accepts video ID and new tone, calls Python /api/v1/clone-yourself/script_generation, saves creativeBrief + tone to DB, and returns the updated script along with videoPrompt.'
    #swagger.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: 'object',
            required: ['id', 'tone'],
            properties: {
              id:   { type: 'string', description: 'ID of the video record', example: '64a1f0e5c9d1b2a3f4e56789' },
              tone: { type: 'string', description: 'New tone for script regeneration', example: 'Casual' }
            }
          }
        }
      }
    }
  */
  try {
    const { id, tone } = req.body;

    if (!id || !tone) {
      return res.status(400).json({ success: false, error: "id and tone are required" });
    }

    const video = await VideoGeneration.findById(id);
    if (!video) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }

    const inputs = video.inputs;
    const payload = {
      sessionId: video._id,
      userId: video.userId,
      watermark: video.watermark ?? false,
      inputs: {
        person_images: inputs.uploadedAvatars || [],
        product_img: inputs.image ? [inputs.image] : [],
        productName: inputs.productName,
        promotion: inputs.promotion || "",
        duration: inputs.duration,
        aspectRatio: inputs.aspectRatio,
        tone,
        notes: inputs.notes || "",
        voiceSampleUrl: inputs.voiceSampleUrl || null,
      },
    };

    const pythonResponse = await axios.post(
      process.env.CLONE_YOURSELF_SCRIPT_REGENERATION_PYTHON_API,
      payload,
    );

    const data = pythonResponse.data;

    if (!data.success || data.error) {
      return res.status(500).json({ success: false, error: data.error || "Python service failed" });
    }

    const updateFields = {
      generatedScript: data.creativeBrief,
      "inputs.tone": tone,
    };
    if (data.videoPrompt) updateFields.videoPrompt = data.videoPrompt;

    await VideoGeneration.findByIdAndUpdate(id, { $set: updateFields });

    return res.status(200).json({
      success: true,
      sessionId: video._id,
      userId: video.userId,
      creativeBrief: data.creativeBrief,
      videoPrompt: data.videoPrompt,
      duration: data.duration,
      tone: data.tone,
      message: data.message,
    });
  } catch (error) {
    console.error("Error in regenerateScriptClone:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
exports.generateCloneVideo = async (req, res) => {
  /*
      #swagger.tags = ['Video Generation']
      #swagger.summary = 'Generate Clone Yourself video using script and avatar images'
      #swagger.description = 'Called after script_generation is complete. Fetches the DB record, freezes credits, and sends the job to Python /api/v1/clone-yourself/generate_avatar.'
      #swagger.parameters['id'] = { in: 'path', description: 'ID of the video record to generate', required: true, schema: { type: 'string' } }
      #swagger.requestBody = {
          required: false,
          content: {
              "application/json": {
                  schema: {
                      type: 'object',
                      properties: {
                          script: { type: 'object', description: 'Script object to store in DB before generating video' }
                      }
                  }
              }
          }
      }
  */
  try {
    const { id } = req.params;
    const { script } = req.body;
    const userId = req.user.user_id;

    // * STEP 1: Fetch the video record
    const video = await VideoGeneration.findOne({ _id: id, userId });

    if (!video) {
      return res.status(404).json({
         success: false,
         error: "Clone video record not found" });
    }

    if (script) {
      video.generatedScript = script;
      video.markModified("generatedScript"); // Required for Mixed type fields
      await video.save();
    }

    if (!video.generatedScript) {
      return res.status(400).json({ success: false, error: "Script not yet generated for this record" });
    }

    const inputs = video.inputs;

    const selectedModel = inputs.model;
    const durationNum = Number(inputs.duration.replace("s", "")) || 0;
    
    const detectionCredit = getExtraDeduction(selectedModel, "clone");
    
    const videoMinCount = durationNum * (UnifiedCreditController.getModelDeduction(selectedModel) + detectionCredit);
    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;
    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];

    const freeze = await UnifiedCreditController.freezeCredits({
      userId,
      reservationKey: id,
      amount: totalRequiredCredits,
      meta: { service_type: "ad_video", model: selectedModel, duration: inputs.duration, numberOfVideos, phase: "cloneVideo" },
    });

    if (!freeze.ok) {
      if (freeze.reason === "NO_BASE_PLAN") {
        return res.status(403).json({
          success: false,
          error: "An active subscription plan is required."
        });
      }
      if (freeze.reason === "INSUFFICIENT") {
        return res.status(402).json({
          success: false,
          error: "Insufficient credits",
          required: totalRequiredCredits,
          remaining: freeze.remaining,
        });
      }
      return res.status(503).json({
        success: false,
        error: "Could not reserve credits. Please try again."
      });
    }

    // Normalize script items:
    // 1. Lowercase "Voice" → "voice"
    // 2. If user edited "text", sync voice field: keep [emotion] tag but replace spoken words with updated text
    const normalizeScriptItems = (items) =>
      (items || []).map((item) => {
        const normalized = { ...item };

        // Normalize key casing
        if ("Voice" in normalized && !("voice" in normalized)) {
          normalized.voice = normalized.Voice;
          delete normalized.Voice;
        }

        // Sync voice text with edited text (preserve [emotion] tag)
        if (normalized.voice && normalized.text) {
          const emotionMatch = normalized.voice.match(/^(\[.*?\])\s*/);
          if (emotionMatch) {
            const emotionTag = emotionMatch[1];
            const voiceText = normalized.voice.replace(/^(\[.*?\])\s*/, "").trim();
            if (voiceText !== normalized.text.trim()) {
              normalized.voice = `${emotionTag} ${normalized.text.trim()}`;
            }
          }
        }

        return normalized;
      });

    let scriptObject = Array.isArray(video.generatedScript)
      ? { script: video.generatedScript }
      : video.generatedScript || {};

    if (scriptObject.script && Array.isArray(scriptObject.script)) {
      scriptObject = { ...scriptObject, script: normalizeScriptItems(scriptObject.script) };
    }

    const pythonPayload = {
      sessionId: id,
      userId,
      watermark: plan == "8",
      subscription: req.user?.userSubscriptionType || null,
      inputs: {
        script: scriptObject,
        person_images: inputs.uploadedAvatars || [],
        product_img: inputs.image ? [inputs.image] : [],
        firstFrameUrl: video.generatedImage || null,
        videoPrompt: video.videoPrompt || null,
        duration: inputs.duration,
        aspectRatio: inputs.aspectRatio,
        productName: inputs.productName,
        promotion: inputs.promotion || "",
        model: inputs.model,
        voiceSampleUrl: inputs.voiceSampleUrl || null,
        existingVoiceId: inputs.voice || inputs.existingVoiceId || null,
      },
    };

    try {
      const pythonResponse = await axios.post(
        process.env.CLONE_YOURSELF_GENERATION_PYTHON_API,
        pythonPayload
      );
      const pyData = pythonResponse.data;

      if (pyData.error) {
        await UnifiedCreditController.releaseCredits(id);
        return res.status(500).json({ success: false, error: pyData.error });
      }

      if (pythonResponse.status === 200) {
        await VideoGeneration.updateOne({ _id: id }, { $set: { status: "processing" } });
        return res.status(200).json({
          success: true,
          sessionId: pyData.sessionId || id,
          jobId: pyData.jobId || null,
          status: pyData.status || "processing",
          message: pyData.message || "Clone yourself video generation started",
        });
      }
    } catch (pythonErr) {
      // Python never accepted the job → refund the freeze.
      await UnifiedCreditController.releaseCredits(id);
      throw pythonErr;
    }
  } catch (err) {
    console.error("Error in generateCloneVideo:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
exports.regenerateFrameClone = async (req, res) => {
  try {
    /* #swagger.tags = ['Video Generation']
       #swagger.summary = 'Submit request for image and script generation for Avatar type'
       #swagger.description = 'Accepts inputs for Avatar type, generates an image and script by calling Python APIs, and updates the record accordingly. This is a two-step process where the frontend first calls this endpoint to generate the image and script, and then calls the /generate-avatar-video endpoint to create the final video using those assets.'
       #swagger.requestBody = {
            required: true,
            content: {
                "application/json": {
                    schema: {
                        type: 'object',
                        required: ['inputs'],
                        properties: { 
                            inputs:  { $ref: "#/components/schemas/avatar_Payload" }
                        }
                    }
                }
            }
        } 
      */
    // * STEP 1: Validate request body using avatarSchema
    const { error, value } = inputSchemasByType.clone.validate(
      req.body.inputs,
      {
        abortEarly: false,
      },
    );

    if (error) {
      const fieldErrors = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ success: false, error: fieldErrors });
    }

    const inputs = value;
    const userId = req.user.user_id; // Extracted from authenticateJWT middleware

    // * STEP 2: Model-based credit logic
    const selectedModel = inputs.model; // e.g., 'veo-3.1-fast'
    const durationNum = Number(inputs.duration.replace("s", "")) || 0; // Duration in seconds

    const detectionCredit = getExtraDeduction(selectedModel, "clone");

    // Calculate how many credits 1 video takes: duration * (model_multiplier + detection_credit)
    const videoMinCount =
      durationNum * (UnifiedCreditController.getModelDeduction(selectedModel) + detectionCredit);

    const numberOfVideos = inputs.numberOfVideos;
    // Calculate total required credits for the entire batch
    const totalRequiredCredits = numberOfVideos * videoMinCount;

    // NOTE: no freeze here. generateImageAndScript is only the preview step
    // (generates image + script for user review) — the user hasn't committed
    // to spending video credits yet. The freeze happens at generateAvatarVideo,
    // which is the actual commit. This avoids leaked holds when users preview
    // a script and walk away.
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );

    const userRemainingCredits = unifiedCheck.remainingCredits || 0;

    if (!unifiedCheck.isAllowed) {
      if (userRemainingCredits >= videoMinCount) {
        return res.status(400).json({
          success: false,
          error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
        });
      }
      return res.status(400).json({ success: false, error: "Not enough credits" });
    }

    const existingSessionId = req.body.sessionId || req.body.videoId;
    if (!existingSessionId) {
      return res.status(400).json({ success: false, error: "sessionId is required" });
    }

    const existing = await VideoGeneration.findByIdAndUpdate(
      existingSessionId,
      { $set: { inputs: value, status: "pending", generatedImage: null } },
      { new: true }
    );
    if (!existing) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    const videoId = existingSessionId;

    const pythonPayload = {
      sessionId: videoId,
      userId,
      watermark: inputs.watermark ?? false,
      subscription: req.user?.userSubscriptionType || null,
      inputs: {
        type: "clone_yourself",
        person_images: inputs.uploadedAvatars || [],
        product_img: inputs.image ? [inputs.image] : [],
        productUrl: inputs.productUrl || null,
        productName: inputs.productName,
        promotion: inputs.promotion || "",
        duration: inputs.duration,
        aspectRatio: inputs.aspectRatio,
        tone: inputs.tone,
        notes: inputs.notes || "",
        model: inputs.model,
        voiceSampleUrl: inputs.voiceSampleUrl || null,
        existingVoiceId: inputs.existingVoiceId || null,
      },
    };

    const pythonResponse = await axios.post(
      process.env.CLONE_YOURSELF_FRAME_REGENERATE_PYTHON_API,
      pythonPayload,
    );

    const pyData = pythonResponse.data;
    if (!pyData.success) {
      await VideoGeneration.findByIdAndUpdate(videoId, {
        $set: { generatedImage: "failed" },
      });

      const errorMsg = pyData.error || pyData.message || "Unknown error";

      if (global.io) {
        global.io.to(userId).emit("CloneFrameRegenerate", {
          _id: videoId,
          userId,
          type: "image",
          status: 400,
          error: errorMsg,
          generatedImage: "failed",
        });
      }

      return res.status(400).json({ success: false, error: errorMsg });
    }

    return res.status(200).json({
      success: true,
      sessionId: videoId,
      userId,
      message: pyData.message,
    });
  } catch (err) {
    console.error("Error in regenerateFrameClone:", err);

    if (err.response || err.code === "ECONNREFUSED") {
      return res.status(500).json({
        success: false,
        error: `Python API error: ${err.message}`,
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
};