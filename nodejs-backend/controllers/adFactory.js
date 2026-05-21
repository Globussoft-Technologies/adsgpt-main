const logger = require("../utils/logger");
const Redis = require("ioredis");
const Campaign = require("../Module/adFactory/adFactory");
const CampaignHistory = require("../Module/adFactory/adFactoryHistory");
const { default: axios } = require("axios");
const { adFactoryValidators } = require("../Validations/adfactory.validator");
const { handleCreditDeduction } = require("../sockets/setupSockets");
const { TokenDecode } = require("../services/authService");
const { features } = require("../utils/features");
const AD_FACTORY_API = process.env.AD_FACTORY_PYTHON_API;
const { s3Client } = require("../storage/s3");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { deleteImageFromS3 } = require("../utils/cron");
const archiver = require("archiver");
const brandNameLists = require("../Module/brandNames/brandNamesSchema");
const UnifiedCreditController = require("./UnifiedCreditController");
const GeneratedMediaController = require("./generatedMedia.controller");
const modelPricingConfig = require("../config/modelPricingConfig");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
 const AdCreativeImages = require("../Module/adCreative/adCreativeImages");

// const getFileName = (extension) => `${Date.now()}${extension}`;

exports.createCampaign = async (req, res) => {
  /**
     * #swagger.tags = ['Ad Factory']
     * #swagger.description = 'Create a New Campaign'
 * #swagger.tags = ['Ad Factory']
 * #swagger.description = 'Create or update draft data'
 /*  #swagger.parameters['Access Routess'] = {
                                in: 'body',
                                description: 'create new campaign',
                                required: true,
                                schema: { $ref: "#/definitions/createCampaignPayload" }
                                
        } */

  /* #swagger.security = [{
                  "BearerAuth": []
        }] */
  try {
    const { userId, campaignName } = req.body;
    if (!userId || !campaignName) {
      return res.status(400).json({
        success: false,
        message: "userId and campaignName are required",
      });
    }
    const existingCampaign = await Campaign.findOne({
      userId,
      "metadata.campaignName": campaignName,
    });

    if (existingCampaign) {
      return res.status(409).json({
        success: false,
        message: "Campaign name already exists for this user",
        campaignId: existingCampaign?.metadata?.campaignId,
      });
    }
    const campaign = new Campaign({
      userId,
      metadata: {
        campaignName,
      },
    });

    await campaign.save();
    return res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      campaignId: campaign.metadata.campaignId,
    });
  } catch (error) {
    console.error("Create Campaign Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getCampaignByUserId = async (req, res) => {
  /*  
    #swagger.tags = ['Ad Factory']
    #swagger.description = 'Retrieve campaign details by User ID'
    #swagger.parameters['userId'] = {
        in: 'path',
        description: 'Retrieve campaign details by User ID',
        required: true,
        type: 'string'
    }
    #swagger.responses[200] = {
        description: 'Campaign data retrieved successfully'
    }
    #swagger.responses[404] = {
        description: 'No campaign found for the given user ID'
    }
    #swagger.security = [{
        "BearerAuth": [],
        "SecretKey": []
    }]
  */
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const campaigns = await Campaign.find({ userId }).sort({ updatedAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Campaigns fetched successfully",
      data: campaigns,
    });
  } catch (error) {
    console.error("Get Campaign Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getCampaignByUserCampaignId = async (req, res) => {
  /*  
    #swagger.tags = ['Ad Factory']
    #swagger.description = 'Retrieve campaign details by User ID and Campaign ID'
      
    #swagger.parameters['userId'] = {
        in: 'path',
        description: 'User ID',
        required: true,
        type: 'string'
    }
    #swagger.parameters['campaignId'] = {
        in: 'path',
        description: 'Campaign ID',
        required: true,
        type: 'string'
    }

    #swagger.responses[200] = {
        description: 'Campaign data retrieved successfully'
    }
    #swagger.responses[404] = {
        description: 'No campaign found for the given user ID and campaign ID'
    }
    #swagger.security = [{
        "BearerAuth": [],
        "SecretKey": []
    }]
  */

  try {
    const { userId, campaignId } = req.params;

    if (!userId || !campaignId) {
      return res.status(400).json({
        success: false,
        message: "userId and campaignId are required",
      });
    }

    const campaign = await Campaign.findOne({ userId, _id: campaignId })
      .populate({
        path: "history",
        select: {
          "previousData.results": 1,
          version: 1,
          createdAt: 1,
        },
      })
      .lean();

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "No campaign found for the given userId and campaignId",
      });
    }
    const historyWithCounts = (campaign?.history || [])?.map((h) => {
      const results = h?.previousData?.results || {};

      return {
        version: h.version,
        createdAt: h.createdAt,
        textCount: Array.isArray(results.text) ? results.text.length : 0,
        imageCount: Array.isArray(results.image) ? results.image.length : 0,
        videoCount: Array.isArray(results.video) ? results.video.length : 0,
      };
    });
    campaign.history = historyWithCounts;
    return res.status(200).json({
      success: true,
      message: "Campaign fetched successfully",
      data: campaign,
    });
  } catch (error) {
    console.error("Get Campaign Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getCampaignHistoryByUserCampaignId = async (req, res) => {
  /*
   #swagger.tags = ['Ad Factory']
   #swagger.description = 'Retrieve campaign version history by User ID and Campaign ID'
     
   #swagger.parameters['userId'] = {
       in: 'path',
       description: 'User ID',
       required: true,
       type: 'string'
   }
   #swagger.parameters['campaignId'] = {
       in: 'path',
       description: 'Campaign ID',
       required: true,
       type: 'string'
   }

   #swagger.responses[200] = {
       description: 'Campaign history retrieved successfully'
   }
   #swagger.responses[404] = {
       description: 'No campaign history found for the given user ID and campaign ID'
   }
   #swagger.security = [{
       "BearerAuth": [],
       "SecretKey": []
   }]
 */
  try {
    const { userId, campaignId } = req.params;

    if (!userId || !campaignId) {
      return res.status(400).json({
        success: false,
        message: "userId and campaignId are required",
      });
    }
    const history = await CampaignHistory.find({ userId, campaignId }).sort({
      version: -1,
    });

    if (!history || history?.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "No campaign history found for the given userId and campaignId",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Campaign history fetched successfully",
      data: history,
    });
  } catch (error) {
    console.error("Get Campaign Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.getAdFactoryGeneratedCountsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // total count form campaign (text , image , video)
    const campaignTotals = await Campaign.aggregate([
      { $match: { userId } },
      {
        $project: {
          textCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$results.text", []] },
                as: "t",
                cond: {
                  $and: [
                    { $eq: ["$$t.status", 200] },
                    { $ne: ["$$t.data", null] },
                    { $ne: ["$$t.data", ""] },
                  ],
                },
              },
            },
          },
          imageCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$results.image", []] },
                as: "i",
                cond: {
                  $and: [
                    { $eq: ["$$i.status", 200] },
                    { $ne: ["$$i.data", null] },
                    { $ne: ["$$i.data", ""] },
                  ],
                },
              },
            },
          },
          videoCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$results.video", []] },
                as: "v",
                cond: {
                  $and: [
                    { $eq: ["$$v.status", 200] },
                    { $ne: ["$$v.data", null] },
                    { $ne: ["$$v.data", ""] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          text: { $sum: "$textCount" },
          image: { $sum: "$imageCount" },
          video: { $sum: "$videoCount" },
        },
      },
      { $project: { _id: 0 } },
    ]);

    // total count from history (text, image, video)
    const historyTotals = await CampaignHistory.aggregate([
      { $match: { userId } },
      {
        $project: {
          textCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$previousData.results.text", []] },
                as: "t",
                cond: {
                  $and: [
                    { $eq: ["$$t.status", 200] },
                    { $ne: ["$$t.data", null] },
                    { $ne: ["$$t.data", ""] },
                  ],
                },
              },
            },
          },
          imageCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$previousData.results.image", []] },
                as: "i",
                cond: {
                  $and: [
                    { $eq: ["$$i.status", 200] },
                    { $ne: ["$$i.data", null] },
                    { $ne: ["$$i.data", ""] },
                  ],
                },
              },
            },
          },
          videoCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$previousData.results.video", []] },
                as: "v",
                cond: {
                  $and: [
                    { $eq: ["$$v.status", 200] },
                    { $ne: ["$$v.data", null] },
                    { $ne: ["$$v.data", ""] },
                  ],
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          text: { $sum: "$textCount" },
          image: { $sum: "$imageCount" },
          video: { $sum: "$videoCount" },
        },
      },
      { $project: { _id: 0 } },
    ]);

    // campaign image count by model

    const campaignImageByModel = await Campaign.aggregate([
      { $match: { userId } },
      {
        $project: {
          imageCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$results.image", []] },
                as: "i",
                cond: {
                  $and: [
                    { $eq: ["$$i.status", 200] },
                    { $ne: ["$$i.data", null] },
                    { $ne: ["$$i.data", ""] },
                  ],
                },
              },
            },
          },
          imageModel: {
            $let: {
              vars: {
                imageService: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$services.servicesSelected",
                        as: "s",
                        cond: { $eq: ["$$s.serviceName", "image"] },
                      },
                    },
                    0,
                  ],
                },
              },
              in: "$$imageService.serviceParams.model",
            },
          },
        },
      },
      {
        $match: {
          imageCount: { $gt: 0 },
          imageModel: { $nin: [null, "auto"] },
        },
      },
      {
        $group: {
          _id: "$imageModel",
          count: { $sum: "$imageCount" },
        },
      },
    ]);

    // ---- History image count by model
    const historyImageByModel = await CampaignHistory.aggregate([
      { $match: { userId } },
      {
        $project: {
          imageCount: {
            $size: {
              $filter: {
                input: { $ifNull: ["$previousData.results.image", []] },
                as: "i",
                cond: {
                  $and: [
                    { $eq: ["$$i.status", 200] },
                    { $ne: ["$$i.data", null] },
                    { $ne: ["$$i.data", ""] },
                  ],
                },
              },
            },
          },
          imageModel: {
            $let: {
              vars: {
                imageService: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: "$previousData.services.servicesSelected",
                        as: "s",
                        cond: { $eq: ["$$s.serviceName", "image"] },
                      },
                    },
                    0,
                  ],
                },
              },
              in: "$$imageService.serviceParams.model",
            },
          },
        },
      },
      {
        $match: {
          imageCount: { $gt: 0 },
          imageModel: { $nin: [null, "auto"] },
        },
      },
      {
        $group: {
          _id: "$imageModel",
          count: { $sum: "$imageCount" },
        },
      },
    ]);

    // merging both count history and campaign
    const imageByModelMap = {};

    campaignImageByModel.forEach(({ _id, count }) => {
      imageByModelMap[_id] = (imageByModelMap[_id] || 0) + count;
    });

    historyImageByModel.forEach(({ _id, count }) => {
      imageByModelMap[_id] = (imageByModelMap[_id] || 0) + count;
    });

    const imageByModel = Object.entries(imageByModelMap).map(
      ([model, count]) => ({ model, count }),
    );

    const totalImageGenerated = imageByModel.reduce(
      (sum, item) => sum + item.count,
      0,
    );

    // response
    const c = campaignTotals[0] || { text: 0, image: 0, video: 0 };
    const h = historyTotals[0] || { text: 0, image: 0, video: 0 };

    return res.status(200).json({
      success: true,
      message: "AdFactory generated counts fetched successfully",
      data: {
        totalTextGenerated: c.text + h.text,
        totalImageGenerated,
        totalVideoGenerated: c.video + h.video,
        imageByModel,
      },
    });
  } catch (error) {
    console.error("Get AdFactory Counts Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.deleteCampaign = async (req, res) => {
  /*  
    #swagger.tags = ['Ad Factory']
    #swagger.description = 'Delete a campaign by User ID and Campaign ID'
      
    #swagger.parameters['userId'] = {
        in: 'path',
        description: 'User ID',
        required: true,
        type: 'string'
    }
    #swagger.parameters['campaignId'] = {
        in: 'path',
        description: 'Campaign ID',
        required: true,
        type: 'string'
    }

    #swagger.responses[200] = {
        description: 'Campaign deleted successfully'
    }
    #swagger.responses[404] = {
        description: 'No campaign found for the given user ID and campaign ID'
    }
    #swagger.security = [{
        "BearerAuth": [],
        "SecretKey": []
    }]
  */

  try {
    const { userId, campaignId } = req.params;

    if (!userId || !campaignId) {
      return res.status(400).json({
        success: false,
        message: "userId and campaignId are required",
      });
    }

    const campaign = await Campaign.findOne({ userId, _id: campaignId });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "No campaign found for the given userId and campaignId",
      });
    }
    if (campaign?.results?.image && Array.isArray(campaign?.results?.image)) {
      for (const img of campaign?.results?.image) {
        try {
          const key = img?.data;
          if (key) {
            let parts = key?.split("/");
            parts.shift();
            let newKey = parts.join("/");
            await deleteImageFromS3(newKey);
          }
        } catch (err) {
          console.error(
            "Failed to delete image from Campaign S3:",
            img?.data,
            err,
          );
        }
      }
    }

    const histories = await CampaignHistory.find({ campaignId });

    for (const history of histories) {
      const prev = history?.previousData;

      if (prev?.results?.image && Array.isArray(prev.results.image)) {
        for (const img of prev.results.image) {
          try {
            const key = img?.data;
            if (key) {
              let parts = key?.split("/");
              parts.shift();
              let newKey = parts.join("/");
              await deleteImageFromS3(newKey);
            }
          } catch (err) {
            console.error(
              "Failed to delete image from History S3:",
              img?.data,
              err,
            );
          }
        }
      }
    }

    // Delete all related history documents
    await CampaignHistory.deleteMany({ campaignId });
    await Campaign.deleteOne({ _id: campaignId });
    return res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error) {
    console.error("Delete Campaign Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.sendAdFactoryRequest = async (
  campaignId,
  subscriptionTypeKey,
  subscriptionTypeValue,
) => {
  try {
    const campaign = await Campaign.findOne({
      "metadata.campaignId": campaignId,
    }).lean();

    if (!campaign) {
      return { error: "Campaign not found" };
    }

    const requiredNodes = [
      "brandInfo",
      "objectives",
      "assets",
      "distribution",
      "services",
    ];

    const isAllNodesSuccess = requiredNodes.every(
      (node) => campaign[node] && campaign[node].status === "success",
    );
    if (!isAllNodesSuccess) {
      return {
        message: "Not all nodes are completed",
        allNodesSuccess: false,
      };
    }
    const { results, ...campaignWithoutResults } = campaign;
    const payload = {
      ...campaignWithoutResults,
      metadata: {
        ...campaignWithoutResults.metadata,
        userId: campaign.userId,
        userData: {
          userId: campaign.userId,
          subscriptionTypeKey,
          subscriptionTypeValue,
        },
      },
    };
    try {
      logger.info(`Sending payload to python ${JSON.stringify(payload)}`);
      const pythonResponse = await axios.post(AD_FACTORY_API, payload);
      return {
        message: "All nodes completed, sent to Python team",
        allNodesSuccess: true,
        pythonResponse: pythonResponse?.data,
      };
    } catch (error) {
      logger.error(`Error processing services from adfactory api: ${error}`);
      console.error("Error processing services from adfactory api", error);
      this.updateErrorResult(campaignId);
      return {
        error: error.message,
        allNodesSuccess: false,
      };
    }
  } catch (error) {
    logger.error("Error processing services update:", error.message);
    console.error("Error processing services update:", error.message);
    return {
      error: error.message,
      allNodesSuccess: false,
    };
  }
};

exports.storeAdFactoryHistory = async (existingCampaign) => {
  try {
    const latestVersion = await CampaignHistory.findOne({
      campaignId: existingCampaign._id.toString(),
    })
      .sort({ version: -1 })
      .select("version")
      .lean();

    const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

    const history = await CampaignHistory.create({
      campaignId: existingCampaign._id.toString(),
      userId: existingCampaign.userId,
      campaignRef: existingCampaign._id,
      previousData: existingCampaign,
      version: nextVersion,
    });

    await Campaign.updateOne(
      { _id: existingCampaign._id },
      {
        $push: { history: history._id },
        $set: { status: "edit-in-progress" },
      },
    );

    return {
      error: false,
      message: "History created",
      version: nextVersion,
      historyId: history._id,
    };
  } catch (error) {
    logger.error("Error processing services update:", error.message);
    console.error("Error processing services update:", error.message);
    return {
      error: error.message,
    };
  }
};
exports.updateErrorResult = async (campaignId) => {
  try {
    logger.info(`Ad Factory Error Result: ${JSON.stringify(campaignId)}`);
    const errorPayload = {
      status: 400,
      data: "",
      error: "Generation failed due to an internal server error",
      timestamp: new Date(),
    };

    let updatedCampaign = await Campaign.findOneAndUpdate(
      {
        "metadata.campaignId": campaignId,
      },
      {
        $set: {
          // TEXT
          "results.text.$[t]": errorPayload,

          // IMAGE
          "results.image.$[i]": errorPayload,

          // VIDEO
          "results.video.$[v]": errorPayload,

          // OVERALL STATUS
          "results.status": "success",
          status: "success",
        },
      },
      {
        arrayFilters: [
          { "t.status": null },
          { "i.status": null },
          { "v.status": null },
        ],
        new: true,
      },
    );
    if (!updatedCampaign?.results) {
      return {
        success: false,
        message: "Campaign not found",
      };
    }

    const { text, image, video } = updatedCampaign.results;

    // Emit results per type
    if (Array.isArray(text) && text.length) {
      this.emitCampaignResult(campaignId, "text", text);
    }

    if (Array.isArray(image) && image.length) {
      this.emitCampaignResult(campaignId, "image", image);
    }

    if (Array.isArray(video) && video.length) {
      this.emitCampaignResult(campaignId, "video", video);
    }
    return {
      success: true,
      message: `Error result updated successfully`,
      data: updatedCampaign.results,
    };
  } catch (error) {
    console.error("Result Error update:", error);
    logger.error(`Result Error update ${error}`);
    return {
      success: false,
      message: "Server error",
      error: error.message,
    };
  }
};
exports.validateCredits = async (user, subscriptionTypeKey, data) => {
  try {
    // Step 1: Extract service params (qty + model)
    const getService = (name) =>
      data?.servicesSelected?.find((s) => s.serviceName === name) || {};

    const getParams = (name) => ({
      qty: Number(getService(name)?.serviceParams?.quantity) || 0,
      model: getService(name)?.serviceParams?.model || null,
    });

    const textParams = getParams("text");
    const imageParams = getParams("image");
    const videoParams = getParams("video");

    // Step 2: Calculate required credits using UnifiedCreditController
    const requiredText =
      textParams.qty * UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");
    const requiredImage =
      imageParams.qty *
      UnifiedCreditController.getModelDeduction(imageParams.model);
    const requiredVideo =
      videoParams.qty *
      UnifiedCreditController.getModelDeduction(videoParams.model);

    const totalRequired = requiredText + requiredImage + requiredVideo;

    if (totalRequired <= 0) return { code: 200, success: true };

    // Step 3: Check credits using UnifiedCreditController
    const userId = `${user?.created_from}-${user?.user_id || user?.userId}`;
    const creditCheck = await UnifiedCreditController.checkCredits(
      userId,
      totalRequired,
    );

    if (!creditCheck.isAllowed) {
      return {
        code: 400,
        success: false,
        message: creditCheck.message,
        required: totalRequired,
        available: Math.max(
          0,
          creditCheck.totalAllowed - creditCheck.currentUsage,
        ),
      };
    }

    return { code: 200, success: true };
  } catch (error) {
    logger.error("Error in credit checking:", error);
    console.error("Error in credit checking:", error);
    return { success: false, message: "Internal error in credit checking" };
  }
};

exports.updateCampaign = async (req, res) => {
  /*  
    #swagger.tags = ['Ad Factory']
    #swagger.description = 'Update an existing Campaign'
    #swagger.parameters['Ad Factory'] = {
        in: 'body',
        description: 'Update the existing Campaign data',
        required: true,
        schema: { $ref: "#/definitions/updateCampaignPayload" }
    }
    #swagger.security = [{
        "BearerAuth": []
    }]
  */

  try {
    const { campaignId, nodeType, data } = req.body;
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Access token missing" });
    }
    const user = TokenDecode(token);
    const [subscriptionTypeKey, subscriptionTypeValue] =
      Object.entries(user?.userSubscriptionType || {})[0] || [];
    if (!campaignId || !nodeType || !data) {
      return res.status(400).json({
        success: false,
        message: "campaignId, nodeType and data are required",
      });
    }

    const allowedNodes = [
      "metadata",
      "brandInfo",
      "objectives",
      "assets",
      "distribution",
      "services",
      "status",
      "creatives",
    ];

    if (!allowedNodes.includes(nodeType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid nodeType provided",
      });
    }

    if (adFactoryValidators[nodeType]) {
      const { error } = adFactoryValidators[nodeType].validate(data);

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          details: error.details,
        });
      }
    }

    if (nodeType == "services") {
      const verifyUserCredits = await this.validateCredits(
        user,
        subscriptionTypeKey,
        data,
      );
      if (verifyUserCredits?.code == 400) {
        return res.status(400).json({
          success: false,
          message: verifyUserCredits?.message,
          type: verifyUserCredits?.type,
          required: verifyUserCredits?.required,
          available: verifyUserCredits?.available,
        });
      }
      const existingCampaign = await Campaign.findOne({
        "metadata.campaignId": campaignId,
      }).lean();
      if (existingCampaign?.status == "success") {
        this.storeAdFactoryHistory(existingCampaign);
      }
    }

    // const existingCampaign = await Campaign.findOne({ "metadata.campaignId": campaignId }).lean();
    // if (existingCampaign?.status == "success") {
    //   this.storeAdFactoryHistory(existingCampaign)
    // }
    // nodetype creatives validation and update
    if (nodeType === "creatives") {
      // 1️ Basic payload guard
      if (!data || typeof data !== "object") {
        return res.status(400).json({
          success: false,
          message: "Creative object is required",
        });
      }

      const { creativeId } = data;

      if (!creativeId) {
        return res.status(400).json({
          success: false,
          message: "creativeId is required",
        });
      }

      // 2️ Ensure campaign exists
      const campaign = await Campaign.findOne({
        "metadata.campaignId": campaignId,
      });

      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      // 3️ Prevent duplicate creativeId
      const exists = (campaign.creatives || []).some(
        (c) => c.creativeId === creativeId,
      );

      // if (exists) {
      //   return res.status(409).json({
      //     success: false,
      //     message: `creativeId already exists: ${creativeId}`,
      //   });
      // }

      // 4️ Push creative
      const updatedCampaign = await Campaign.findOneAndUpdate(
        { "metadata.campaignId": campaignId },
        {
          $push: {
            creatives: data,
          },
          $set: {
            "creatives.status": "edit-in-progress",
          },
        },
        { new: true },
      );

      return res.status(200).json({
        success: true,
        message: "Creative saved successfully",
        data,
      });
    }

    if (nodeType === "brandInfo" && data?.brandId) {
      const brandId = data?.brandId;
      await brandNameLists.updateOne(
        {
          "brands.id": brandId,
        },
        {
          $addToSet: {
            "brands.$.campaignIds": campaignId,
          },
        },
      );
    }

    if (nodeType === "status") {
      if (!data?.status) {
        return res.status(400).json({
          success: false,
          message: "status is required",
        });
      }

      const updatedCampaign = await Campaign.findOneAndUpdate(
        { "metadata.campaignId": campaignId },
        {
          $set: {
            "creatives.status": data.status,
          },
        },
        { new: true },
      );

      if (!updatedCampaign) {
        return res.status(404).json({
          success: false,
          message: "Campaign not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Creatives status updated successfully",
        data: {
          creativesStatus: updatedCampaign.creatives?.status,
        },
      });
    }

    const updateObj = {};
    Object.keys(data).forEach((key) => {
      updateObj[`${nodeType}.${key}`] = data[key];
    });
    updateObj[`${nodeType}.status`] = "success";
    const updatedCampaign = await Campaign.findOneAndUpdate(
      { "metadata.campaignId": campaignId },
      { $set: updateObj },
      { new: true },
    );
    if (!updatedCampaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    let pythonResult = null;

    if (nodeType === "services") {
      const servicesSelected =
        updatedCampaign?.services?.servicesSelected || [];

      if (servicesSelected?.length) {
        const results = { text: [], image: [], video: [] };

        for (const { serviceName, serviceParams } of servicesSelected) {
          if (!results.hasOwnProperty(serviceName)) continue;
          const quantity = serviceParams?.quantity || 0;
          if (quantity <= 0) continue;
          results[serviceName] = Array.from({ length: quantity }, () => ({}));
        }

        await Campaign.updateOne(
          { "metadata.campaignId": campaignId },
          {
            $set: {
              results: {
                ...results,
              },
            },
          },
        );
      }

      pythonResult = await this.sendAdFactoryRequest(
        campaignId,
        subscriptionTypeKey,
        subscriptionTypeValue,
      );
      return res.status(200).json({
        success: true,
        message: `${nodeType} updated successfully`,
        pythonResult,
      });
    }
    return res.status(200).json({
      success: true,
      message: `${nodeType} updated successfully`,
    });
  } catch (error) {
    console.error("Update Campaign Node Error:", error);
    logger.error("Update Campaign Node Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.updateCreativeByCreativeId = async (req, res) => {
  try {
    const { campaignId, creativeId } = req.params;
    const data = req.body;

    if (!campaignId || !creativeId || !data || Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        message: "campaignId, creativeId and update data are required",
      });
    }

    // Ensure campaign + creative exists
    const campaign = await Campaign.findOne({
      "metadata.campaignId": campaignId,
      "creatives.creativeId": creativeId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign or Creative not found",
      });
    }

    // Build update fields dynamically
    const updateFields = {};
    Object.keys(data).forEach((key) => {
      updateFields[`creatives.$.${key}`] = data[key];
    });

    const updatedCampaign = await Campaign.findOneAndUpdate(
      {
        "metadata.campaignId": campaignId,
        "creatives.creativeId": creativeId,
      },
      {
        $set: updateFields,
      },
      { new: true },
    );
    const { error } = adFactoryValidators.creatives.validate(data);

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Creative updated successfully",
      data: updatedCampaign.creatives.find((c) => c.creativeId === creativeId),
    });
  } catch (error) {
    console.error("Update Creative Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.deleteCreativeByCreativeId = async (req, res) => {
  try {
    const { campaignId, creativeId } = req.params;

    if (!campaignId || !creativeId) {
      return res.status(400).json({
        success: false,
        message: "campaignId and creativeId are required",
      });
    }

    const campaign = await Campaign.findOne({
      "metadata.campaignId": campaignId,
    });

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const exists = (campaign.creatives || []).some(
      (c) => c.creativeId === creativeId,
    );

    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "Creative not found",
      });
    }

    const updatedCampaign = await Campaign.findOneAndUpdate(
      { "metadata.campaignId": campaignId },
      {
        $pull: { creatives: { creativeId } },
        // $set: { status: "edit-in-progress" },
      },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Creative deleted successfully",
      data: updatedCampaign.creatives,
    });
  } catch (error) {
    console.error("Delete Creative Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.emitCampaignResult = async (campaignId, type, result) => {
  try {
    if (!global.io) {
      console.error("Socket.IO not initialized");
      return;
    }

    global.io.to(campaignId).emit("adFactoryResponse", {
      campaignId,
      type,
      result,
    });

    console.log(`Sent update to campaign ${campaignId}`);
  } catch (error) {
    console.log("Error in sending data to adfactory", error);
  }
};

exports.updateGenerationResult = async (req, res) => {
  /*  
    #swagger.tags = ['Ad Factory']
    #swagger.description = 'Update an existing Campaign'
    #swagger.parameters['Ad Factory'] = {
        in: 'body',
        description: 'Update the existing Campaign data',
        required: true,
        schema: { $ref: "#/definitions/updateCampaignResult" }
    }
    #swagger.security = [{
        "BearerAuth": []
    }]
    #swagger.parameters['x-secret-key'] = {
        in: 'header',
        description: 'Secret key for authentication',
        required: true,
        type: 'string'
    }
  */

  try {
    const { campaignId, type, result, userData } = req.body;
    logger.info(`Ad Factory Result: ${JSON.stringify(req.body)}`);
    if (!campaignId || !type || !result) {
      return res.status(400).json({
        success: false,
        message: "campaignId, type,status, and result are required",
      });
    }
    const allowedTypes = ["text", "image", "video"];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid result type. Must be one of text, image, video.",
      });
    }

    const resultArray = Array.isArray(result) ? result : [result];
    let updatedCampaign;
    for (const resItem of result) {
      const resultEntry = {
        status: resItem.status ?? 200,
        data: resItem.data ?? "",
        error: resItem.error ?? null,
        timestamp: new Date(),
        prompt: resItem?.prompt || "",
      };

      updatedCampaign = await Campaign.findOneAndUpdate(
        {
          "metadata.campaignId": campaignId,
          [`results.${type}.status`]: null,
        },
        {
          $set: {
            [`results.${type}.$`]: resultEntry,
            "results.status": "in-progress",
            status: "in-progress",
          },
          $inc: {
            "services.servicesSelected.$[service].generated": 1,
          },
        },
        {
          new: true,
          arrayFilters: [{ "service.serviceName": type }],
        },
      );
    }

    if (!updatedCampaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const allCompleted = updatedCampaign?.services?.servicesSelected?.every(
      (srv) => srv.generated >= srv.serviceParams?.quantity,
    );
    if (allCompleted) {
      updatedCampaign.results.status = "success";
      updatedCampaign.status = "success";
      await updatedCampaign.save();
      console.log(`Campaign ${campaignId} generation completed`);
    }
    
    handleCreditDeduction(resultArray, type, userData, campaignId)
    this.emitCampaignResult(campaignId, type, resultArray)

    // --- Save successful image results to GeneratedCount (for stats) and
    // GeneratedMedia (for credit accounting parity with Ad Studio). Without
    // the GeneratedMedia write, AdFactory deductions are invisible from the
    // per-user usage dashboard and `used_subscription_credits` appears to
    // drift higher than the media totals.
    if (type === "image") {
      for (const item of resultArray) {
        if (item.status !== 200 || !item.data) continue;

        const modelIdentifier = item?.model || "auto";
        const finalUrl =
          typeof item.data === "string"
            ? item.data
            : item.data?.base_image || item.data?.data || item.data?.url || "";

        // 1. Stats counter (existing behavior)
        const countRecord = new GeneratedCount({
          userId: userData.userId,
          type: "image",
          url: finalUrl,
          model: modelIdentifier,
        });
        countRecord.save().catch(() => {});

        // 2. GeneratedMedia row — mirrors the per-item credit + USD cost so
        // dashboards can sum AdFactory usage alongside Ad Studio.
        const creditDeduction =
          UnifiedCreditController.getModelDeduction(modelIdentifier) || 0;
        const inputTokens = item?.usage?.input_tokens || 0;
        const outputTokens = item?.usage?.output_tokens || 0;
        const cost = modelPricingConfig.getImageCost(
          modelIdentifier,
          inputTokens,
          outputTokens,
        );

        GeneratedMediaController.saveGeneratedMedia({
          userId: userData.userId,
          model: modelIdentifier,
          type: "image",
          image: finalUrl,
          video: "",
          credit_deduction: creditDeduction,
          cost,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `${type} result updated successfully`,
      data: updatedCampaign.results[type],
    });
  } catch (error) {
    console.error("Result update error:", error);
    logger.error(`Result update error:: ${error}`);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.uploadImageFromUrl = async (req, res) => {
  try {
    const userId = req.body.userId;
    const file = req.file;

    // Required fields
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!file) {
      return res.status(400).json({ error: "file is required" });
    }

    // 1. Convert file to buffer (multer already gives this)
    const buffer = file.buffer;

    // 2. Generate file name
    const fileName = `${Date.now()}.webp`;

    // 3. Upload to S3
    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `creatives/${userId}/${fileName}`,
      Body: buffer,
      ContentType: file.mimetype || "image/webp",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    const finalUrl = `/${uploadParams.Key}`;

    // 4. Send final response (AdFactory expects this)
    return res.status(200).json({
      data: finalUrl,
    });
  } catch (error) {
    console.error("Error in uploadImageFromUrl:", error);
    return res.status(500).json({ error: "Image upload failed" });
  }
};

exports.downLoadZipImages = async (req, res) => {
  try {
    const { image_urls } = req.body;
    if (!image_urls || !Array.isArray(image_urls)) {
      return res.status(400).json({ error: "image_urls must be an array" });
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=images.zip");

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error(err);
      res.status(500).end();
    });

    archive.pipe(res);

    for (let i = 0; i < image_urls.length; i++) {
      const url = image_urls[i];

      try {
        const response = await axios({
          method: "GET",
          url,
          responseType: "stream",
        });

        const ext = url.split(".").pop().split("?")[0];
        const fileName = `image_${i + 1}.${ext}`;

        archive.append(response.data, { name: fileName });
      } catch (err) {
        console.error(`Failed to fetch ${url}`);
      }
    }

    await archive.finalize();
  } catch (error) {
    logger.error("Error in downloading Zip:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}


exports.saveEditedAdImage = async (req, res) => {
  try {
  
    const { userId, campaignId, historyId, contextType, prompt, imageUrl } = req.body;

    if (!userId || !campaignId || !imageUrl) {
      return res.status(400).json({ success: false, message: "userId, campaignId and imageUrl are required" });
    }

    const finalUrl = imageUrl;


    // 2. Prepare the data entry for Ad Factory results
    const resultEntry = {
      status: 200,
      data: finalUrl,
      error: null,
      timestamp: new Date(),
      prompt: prompt || "Edited image",
    };

    // 3. Logic to check type and push to the correct place
    if (contextType === "history" && historyId) {
      // PUSH TO HISTORY: Prepend so the newest edit appears first in the list
      await CampaignHistory.updateOne(
        { _id: historyId, campaignId },
        {
          $push: {
            "previousData.results.image": {
              $each: [resultEntry],
              $position: 0
            }
          }
        }
      ).catch(err => console.error("Failed to push to History:", err));
    } else {
      // PUSH TO CURRENT: Prepend so the newest edit appears first
      await Campaign.updateOne(
        { "metadata.campaignId": campaignId },
        {
          $push: {
            "results.image": {
              $each: [resultEntry],
              $position: 0
            }
          }
        }
      ).catch(err => console.error("Failed to push to Campaign:", err));
    }

    // Also save to gallery so it appears in getGalleryImages
    try {
      await AdCreativeImages.findOneAndUpdate(
        { image_url: finalUrl, user_id: userId },
        { 
          image_url: finalUrl, 
          user_id: userId, 
          type: 2  // 2 = saved/edited image
        },
        { new: true, upsert: true }
      );
    } catch (galleryErr) {
      console.error("Warning: Failed to save image to gallery:", galleryErr);
      // Continue anyway - gallery save is secondary
    }

    return res.status(200).json({
      success: true,
      message: "Edited image saved and associated successfully",
      data: finalUrl
    });

  } catch (error) {
    console.error("saveEditedAdImage Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
