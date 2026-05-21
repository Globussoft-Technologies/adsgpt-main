const {
  generateVideoRequestSchema,
  updateResultSchema,
  updatePromptPercentageSchema,
  inputSchemasByType,
  generateSceneSchema,
  regenerateSceneSchema,
  aiAdsBrandSchema,
  aiAdsProductSchema,
} = require("../Validations/videoValidator");
const VideoGeneration = require("../Module/videoGeneration/videoModel");
const UnifiedCreditController = require("./UnifiedCreditController");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { s3Client } = require("../storage/s3");
const axios = require("axios");
const archiver = require("archiver");
const logger = require("../utils/logger");

const Avatar = require("../Module/videoGeneration/avatarModel");
const modelPricingConfig = require("../config/modelPricingConfig");
const GeneratedMediaController = require("./generatedMedia.controller");

const getFileName = (extension) => `${Date.now()}${extension}`;

const emitCreditStatus = async (userId) => {
  try {
    const creditStatus = await UnifiedCreditController.getCreditStatus(userId);
    const payload = {
      creditsUsed: creditStatus.used_credits,
      totalCredits: creditStatus.total_credits,
      remainingCredits: creditStatus.remaining_credits,
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

    // Check MongoDB if user has enough credits
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );
    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];
    // Total credits user has left
    const userRemainingCredits = unifiedCheck.remainingCredits || 0;

    // * STEP 3: Permission logic based on remaining credits
    if (unifiedCheck.isAllowed) {
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

          // Delete the record since the job never reached python
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
    } else if (userRemainingCredits >= videoMinCount) {
      // Condition 2: User doesn't have enough for ALL videos, but could have made at least ONE video
      return res.status(400).json({
        success: false,
        error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
      });
    } else {
      // Condition 3: User doesn't even have enough for a single video
      return res.status(403).json({
        success: false,
        error: "Not enough credits",
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
    if (videoStatus === 400 || videoStatus === 500 || videoStatus === 529)
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

    const video = await VideoGeneration.findOneAndUpdate(
      { _id: sessionId },
      updateQuery,
      { new: true, lean: true },
    );

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video record not found",
      });
    }

    // Deduct credits if video is completed
    if (videoStatus === 200) {
      const rawDuration = resultData?.duration || "0s";
      const durationInSeconds = parseInt(rawDuration.replace("s", ""), 10) || 0;

      // credits per second (via model deduction)
      const creditPerSecond = UnifiedCreditController.getModelDeduction(
        resultData?.model,
      );

      const totalCreditsToDeduct = durationInSeconds * creditPerSecond;

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

      // Store in mongo for admin analytics and user history
      const actualVideoCost = modelPricingConfig.getVideoCost(
        resultData?.model,
        durationInSeconds,
      );

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
    }

    // emit to frontend (using userId room so it works across all tabs/reconnections)
    // video is lean (plain JS), so spreading is safe — no Mongoose internals leak
    if (global.io) {
      global.io.to(video?.userId).emit("videoCreated", {
        _id: video._id,
        video: {
          ...video,
          url: watermark ? resultData?.watermarkUrl : resultData?.url || "",
        },
        userId: video?.userId,
      });
    }

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
      // status: { $ne: "failed" },
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

    const formattedVideos = videos.map((v) => {
      return {
        ...v,
        results: [
          {
            ...v.results[0],
            url:
              plan === "8"
                ? v?.results?.[0]?.waterMarkUrl || v?.results?.[0]?.url
                : v?.results?.[0]?.url,
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

    // Check MongoDB if user has enough credits
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );

    // Total credits user has left
    const userRemainingCredits = unifiedCheck.remainingCredits || 0;

    // * STEP 3: Permission logic based on remaining credits
    if (unifiedCheck.isAllowed) {
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
    } else if (userRemainingCredits >= videoMinCount) {
      // Condition 2: User doesn't have enough for ALL videos, but could have made at least ONE video
      return res.status(400).json({
        success: false,
        error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
      });
    } else {
      // Condition 3: User doesn't even have enough for a single video
      return res.status(400).json({
        success: false,
        error: "Not enough credits",
      });
    }
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

    // Check MongoDB if user has enough credits
    const unifiedCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequiredCredits,
    );

    // Total credits user has left
    const userRemainingCredits = unifiedCheck.remainingCredits || 0;
    const plan = Object.keys(req.user?.userSubscriptionType || {})[0];

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

    if (unifiedCheck.isAllowed) {
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
    } else if (userRemainingCredits >= videoMinCount) {
      return res.status(400).json({
        success: false,
        error: `You have only ${userRemainingCredits} credits left, which is not enough for ${numberOfVideos} videos which requires ${totalRequiredCredits} credits. Please reduce the number of videos or upgrade your plan.`,
      });
    } else {
      return res.status(403).json({
        success: false,
        error: "Not enough credits",
      });
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
    // Credit check (same formula as regular video types)
    const durationSec = Number(String(inputs.duration).replace("s", "")) || 0;
    const totalRequired =
      durationSec * UnifiedCreditController.getModelDeduction(inputs.model) * (inputs.numberOfVideos || 1);
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

    await VideoGeneration.findByIdAndUpdate(sessionId, { status: "processing" });

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
      segments,
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

        // Mark only the segments that were being regenerated as failed.
        // The rest of the session is untouched — frontend keeps showing all
        // other scenes intact, and only the failed segments show Retry.
        if (Array.isArray(segments)) {
          for (const seg of segments) {
            const segNum = seg?.segmentNumber;
            if (segNum == null) continue;
            // Only mark imageFailed if the regenerate type was image-related.
            // Text-only regen failures don't currently have a scene-level flag,
            // so they fall back to the toast via the action's catch.
            const regenType = seg?.regenerate;
            if (regenType === "image" || regenType === "both") {
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

      const existingScenes = record.scenes || [];
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
        { $set: { scenes: updatedScenes, status: "processing" } },
        { new: true }
      );

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
        status: "processing",
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

      if (isComplete) {
        await VideoGeneration.findByIdAndUpdate(sessionId, { status: "completed" });
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
    } = req.body;

    logger.info(
      `[AI Ads] Received video callback for sessionId ${sessionId}: videoStatus=${videoStatus}`
    );

    const record = await VideoGeneration.findOne({
      _id: sessionId,
      "inputs.type": "ai_ads",
    });
    if (!record) {
      return res.status(404).json({ success: false, error: "AI Ads session not found" });
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
            },
          },
        },
        { new: true }
      );

      // Deduct credits
      const creditPerSecond = UnifiedCreditController.getModelDeduction(model);
      const totalCreditsToDeduct = durationInSeconds * creditPerSecond;

      await UnifiedCreditController.deductCredits(userId, totalCreditsToDeduct, {
        model,
        service_type: "ai_ads",
        duration: durationInSeconds,
        resolution: "standard",
        session_id: sessionId,
        chat_id: record._id.toString(),
      });

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

    // Credit check (same formula as all other video types)
    const durationSec = Number(String(record.inputs.duration).replace("s", "")) || 0;
    const totalRequired =
      durationSec *
      UnifiedCreditController.getModelDeduction(record.inputs.model) *
      (record.inputs.numberOfVideos || 1);
    const creditCheck = await UnifiedCreditController.checkCredits(userId, totalRequired);

    if (!creditCheck.isAllowed) {
      const remaining = creditCheck.remainingCredits || 0;
      if (remaining > 0) {
        return res.status(400).json({
          success: false,
          error: `Not enough credits. You need ${totalRequired} but only have ${remaining}.`,
        });
      }
      return res.status(403).json({ success: false, error: "Not enough credits" });
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

    // Build flat scenes array from DB record
    const scenesForPython = (record.scenes || dbScenes || []).map(s => {
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
