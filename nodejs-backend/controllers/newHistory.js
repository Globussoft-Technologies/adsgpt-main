const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const History = require("../Module/newHistory/newHistory");
const logger = require("../utils/logger");
const { s3Client } = require("../storage/s3");
const {deleteImageFromS3} = require("../utils/cron")
const adCreativeImages = require("../Module/adCreative/adCreativeImages")
const adsCopyChats = require("../Module/adCopy/Chats")
const adsVideoChats = require("../Module/adVideo/adVideo")


exports.createHistory = async (req, res) => {
  try {
    const { sessionId, data, type } = req.body;
    const userId = req.user?.user_id || null;
    const ad = req.body?.ad;

    if (!sessionId || !data || !type || !userId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let history = await History.findOne({ sessionId });

    if (!history) {
      history = new History({
        sessionId,
        type,
        userId,
        conversations: [...data],
        ad: ad ? ad : {},
      });
    } else {
      history.conversations.push(...data);
      if (ad && Object.keys(ad).length > 0) {
        history.ad = ad;
      }
    }

    await history.save();

    return res.status(200).json(history);
  } catch (err) {
    logger.error(`Error creating history: ${err}`);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.updateAdCopyConversation = async (data) => {
  try {
    const sessionId = data?.sessionId;
    const conversationId = data?.chatId;

    await History.findOneAndUpdate(
      {
        sessionId,
        "conversations.id": conversationId,
      },
      {
        $set: {
          "conversations.$.message": data?.adCopyText,
          "conversations.$.complete": true,
        },
      },
      { new: true }
    );
  } catch (error) {
    logger.error(`Error updating adCopy history: ${error}`);
    throw error;
  }
};

exports.updateAdCreativeConversation = async (data) => {
  try {
    const { sessionId, chatId, type } = data;

    const history = await History.findOne({ sessionId });
    if (!history) throw new Error("History not found");

    const conversation = history.conversations.find((c) => c?.id === chatId);
    if (!conversation) throw new Error("Conversation not found");

    if (type === "text") {
      let ads = [...conversation.ads];

      // Add start/end acknowledgements
      if (data?.starting_acknowledgement) {
        conversation.start_message = data.starting_acknowledgement;
      }
      if (data?.end_acknowledgement) {
        conversation.end_message = data.end_acknowledgement;
      }

      // Handle ad copies
      if (data?.ad_copies && Object.keys(data.ad_copies).length > 0) {
        Object.values(data.ad_copies).forEach((ad, index) => {
          if (ads[index]) {
            ads[index] = {
              ...ads[index],
              text_ad: ad,
              text_complete: true,
            };
          }
        });
      } else {
        // Handle empty/error ad copies
        ads = ads.map((ad) => ({
          ...ad,
          text_ad: "Couldn't generate Ad Copy for this. Please try again...",
          text_complete: true,
        }));
      }

      // Update completion flags
      const allTextComplete = ads.every((ad) => ad?.text_complete);
      const allImageComplete = ads.every((ad) => ad?.image_complete);

      conversation.ads = ads;
      conversation.complete = allTextComplete && allImageComplete;
    }

    if (type === "image") {
      let images = Array.isArray(data?.images) ? data.images.slice(0, 50) : [];
      let num = Math.min(Math.max(1, parseInt(data?.num_images, 10) || 1), 50);
      const failedValue = images?.find(
        (img) => img == 'failed' || img == '400'
      );

      if (failedValue) {
        images = Array(num).fill(failedValue);
      }
      images.slice(0, 50).forEach((image, index) => {
        if (ads[index]) {
          ads[index] = {
            ...ads[index],
            image_ad: image?.base_image_with_logo || image,
            logo: image?.logo || "",
            base_image: image?.base_image || "",
            image_complete: true,
          };
        }
      });

      // Update completion flags
      const allTextComplete = ads.every((ad) => ad.text_complete);
      const allImageComplete = ads.every((ad) => ad.image_complete);

      conversation.ads = ads;
      conversation.complete = allTextComplete && allImageComplete;
    }

    // Use atomic update to avoid version conflict
    await History.updateOne(
      { sessionId, "conversations.id": chatId },
      { $set: { "conversations.$": conversation } }
    );
  } catch (error) {
    logger.error(`Error updating adCreative history: ${error}`);
    // throw error;
  }
};

exports.updateAdCopyConversationMessage = async (req, res) => {
  try {
    const sessionId = req?.body?.sessionId;
    const conversationId = req?.body?.chatId;
    const message = req?.body?.adCopyText;

    if (!sessionId || !conversationId || !message) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await exports.updateAdCopyConversation({
      sessionId,
      chatId: conversationId,
      adCopyText: message,
    });
    return res
      .status(200)
      .json({ message: "Ad copy conversation updated successfully" });
  } catch (error) {
    logger.error(`Error updating adCopy history message: ${error}`);
    return res
      .status(500)
      .json({ message: "Error updating adCopy history message" });
  }
};

exports.updateAdCreativeConversationMessage = async (req, res) => {
  try {
    const sessionId = req?.body?.sessionId;
    const conversationId = req?.body?.chatId;
    if (!sessionId || !conversationId) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const history = await History.findOne({ sessionId });
    if (!history) throw new Error("History not found");

    const botMsg = history.conversations.find((c) => c?.id === conversationId);
    if (!botMsg) throw new Error("Conversation not found");

    if (botMsg && !botMsg.complete) {
      let ads = [...botMsg.ads];
      botMsg.start_message = "Hey there! Here’s an ad creative for you.";
      ads.map((ad) => {
        ad.text_ad = "⚠️ Could not generate ad copy. Please try again.";
        ad.text_complete = true;
        ad.image_ad = "failed";
        ad.image_complete = true;
        return ad;
      });
      botMsg.ads = ads;
      botMsg.complete = true;

      history.markModified("conversations");
      await history.save();
    }
    return res
      .status(200)
      .json({ message: "Ad creative conversation updated successfully" });
  } catch (error) {
    logger.error(`Error updating adCreative history message: ${error}`);
    return res
      .status(500)
      .json({ message: "Error updating adCreative history message" });
  }
};

exports.updateCreativeFields = async (req, res) => {
  try {
    const { sessionId, chatId: conversationId, index, field, value } = req.body;

    if (
      sessionId == null ||
      conversationId == null ||
      index == null ||
      field == null
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Direct atomic update
    const updatePath = `conversations.$[conv].ads.${index}.${field}`;
    const history = await History.findOneAndUpdate(
      { sessionId },
      { $set: { [updatePath]: value } },
      {
        arrayFilters: [{ "conv.id": conversationId }],
        new: true,
      }
    );

    if (!history) throw new Error("History not found or conversation missing");

    return res
      .status(200)
      .json({ message: "Ad creative conversation updated successfully" });
  } catch (error) {
    logger.error(`Error updating adCreative history message: ${error}`);
    return res
      .status(500)
      .json({ message: "Error updating adCreative history message" });
  }
};

exports.getHistoryBySessionId = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.user_id || null;

    if (!sessionId || !userId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const history = await History.findOne({ sessionId, userId });

    if (!history) {
      return res.status(404).json({ message: "History not found" });
    }

    return res
      .status(200)
      .json({ message: "History retrieved successfully!", data: history });
  } catch (err) {
    logger.error(`Error fetching history: ${err}`);
    return res.status(500).json({ error: "Server error" });
  }
};


exports.deleteHistoryBySessionId = async (req, res) => {
  try {
    const sessionId = req.params?.sessionId;

    if (!sessionId) {
      return res.status(400).json({ message: "Session Id is required" });
    }

    // 1️ Fetch history 
    const history = await History.findOne({ sessionId });
    if (!history) {
      return res.status(404).json({ message: "History not found" });
    }

    const userId = history.userId; // IMPORTANT for AdCopy & AdVideo

    // 2️ Delete S3 assets
    for (const conv of history.conversations || []) {
      for (const ad of conv.ads || []) {
        const assets = [
          ad.image_ad,
          ad.base_image,
          ad.logo,
          ad.video_ad,
        ];

        for (const key of assets) {
          if (
            key &&
            typeof key === "string" &&
            key.length > 0 &&
            (key !== "failed" || key !== "400" || key !== 400)
          ) {
            const s3Key = key.startsWith("/") ? key.slice(1) : key;
          
            await deleteImageFromS3(s3Key);
            await adCreativeImages.deleteOne({ image_url: key });
          }
        }
      }
    }

    // 6️ Delete History 
    await History.deleteOne({ sessionId });

    return res.status(200).json({
      message:
        "History, gallery, adCopy, adVideo, and S3 assets deleted successfully",
      sessionId,
    });
  } catch (error) {
   
    logger.error(`Error deleting history: ${error}`);
    return res.status(500).json({ message: "Internal server error" });
  }
};



//this function is used to get the history titles
exports.getSidebarTitles = async (req, res) => {
  try {
    const { currentDate, type } = req.body;
    const userId = req?.user?.user_id || null;
    if (!currentDate || !userId) {
      return res
        .status(400)
        .json({ message: "currentDate and userId are required" });
    }

    const now = new Date(currentDate);
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const todayEnd = new Date(now.setHours(23, 59, 59, 999));

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(todayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayEnd);
    yesterdayEnd.setDate(todayEnd.getDate() - 1);

    const last7DaysStart = new Date(yesterdayStart);
    last7DaysStart.setDate(last7DaysStart.getDate() - 6);

    const pipeline = [
      { $match: { userId, type } },
      {
        $project: {
          title: 1,
          sessionId: 1,
          updatedAt: 1,
          category: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $gte: ["$updatedAt", todayStart] },
                      { $lte: ["$updatedAt", todayEnd] },
                    ],
                  },
                  then: "today",
                },
                {
                  case: {
                    $and: [
                      { $gte: ["$updatedAt", yesterdayStart] },
                      { $lte: ["$updatedAt", yesterdayEnd] },
                    ],
                  },
                  then: "yesterday",
                },
                {
                  case: {
                    $and: [
                      { $gte: ["$updatedAt", last7DaysStart] },
                      { $lt: ["$updatedAt", yesterdayStart] },
                    ],
                  },
                  then: "last7Days",
                },
              ],
              default: "older",
            },
          },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $group: { _id: "$category", chats: { $push: "$$ROOT" } } },
    ];

    const result = await History.aggregate(pipeline);
    const grouped = {
      today: [],
      yesterday: [],
      last7Days: [],
      older: [],
    };

    result.forEach((r) => {
      grouped[r._id] = r?.chats;
    });

    res.status(200).json({
      message: "History titles retrieved successfully!",
      titles: grouped,
    });
  } catch (err) {
    console.error("Error fetching sidebar history:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteImage = async (req, res) => {
  try {
    const imageUrl = req.body.image_url;
    if (!imageUrl) {
      return res.status(400).json({ message: "Image URL is required" });
    }
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: imageUrl,
    };

    await s3Client.send(new DeleteObjectCommand(params));
    return res.status(200).json({
      message: "Image deleted successfully!",
    });
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.updateAdVideoConversation = async (data) => {
  try {
    const chatId = data?.session?.chatId;
    const sessionId = data?.session?.sessionId;
    const type = data?.queryResult?.type;

    const history = await History.findOne({ sessionId });
    if (!history) throw new Error("History not found");

    const conversation = history.conversations.find((c) => c?.id === chatId);
    if (!conversation) throw new Error("Conversation not found");

    if (type === "video") {
      let ads = [...conversation.ads];
      let videos = data?.queryResult?.videoUrl;
      let num = data?.queryResult?.numVideos;
      const failedValue = videos?.find(
        (vid) => vid == "failed" || vid == "400"
      );

      if (failedValue) {
        videos = Array(num).fill(failedValue);
      }
      videos?.forEach((video, index) => {
        if (ads[index]) {
          ads[index] = {
            ...ads[index],
            video_ad: video,
            video_complete: true,
          };
        }
      });

      // Update completion flags
      const allVideoComplete = ads.every((ad) => ad.video_complete);

      conversation.ads = ads;
      conversation.complete = allVideoComplete;
    }

    history.markModified("conversations");
    await history.save();
  } catch (error) {
    logger.error(`Error updating adVideo history: ${error}`);
    throw error;
  }
};

exports.updateAdVideoConversationMessage = async (req, res) => {
  try {
    const sessionId = req?.body?.sessionId;
    const conversationId = req?.body?.chatId;
    if (!sessionId || !conversationId) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const history = await History.findOne({ sessionId });
    if (!history) throw new Error("History not found");

    const botMsg = history.conversations.find((c) => c?.id === conversationId);
    if (!botMsg) throw new Error("Conversation not found");

    if (botMsg && !botMsg.complete) {
      let ads = [...botMsg.ads];
      ads?.map((ad) => {
        ad.video_ad = "failed";
        ad.video_complete = true;
        return ad;
      });
      botMsg.ads = ads;
      botMsg.complete = true;

      history.markModified("conversations");
      await history.save();
    }
    return res
      .status(200)
      .json({ message: "Ad Video conversation updated successfully" });
  } catch (error) {
    logger.error(`Error updating ad Video history message: ${error}`);
    return res
      .status(500)
      .json({ message: "Error updating adVideo history message" });
  }
};

// exports.saveEmulatorHistory = async (data) => {
//   try {
//     const { sessionId, userId, chatId, key, value, type } = data;

//     if ( !userId || !key || !value) {
//       throw new Error("Missing required fields");
//     }

//     let history = await History.findOne({ sessionId });

//     if (history && type === "data") {
//       history.emulatorData = { ...history.emulatorData, [key]: value };
//     }
//     if (history && type === "response" && chatId) {
//       const botMsg = history.conversations.find((c) => c?.id === chatId);
//       if (botMsg) {
//         botMsg[key] = value;
//         history.markModified("conversations");
//       }
//     }

//     await history.save();
//   } catch (err) {
//     logger.error(`Error saving emulator history: ${err}`);
//     throw err;
//   }
// };


// Simple in-memory queue for sequential processing
const historyQueue = new Map();

exports.saveEmulatorHistory = async (data) => {
  try {
    const { sessionId, userId, chatId, key, value, type } = data;

    if (!userId || !key || value === undefined) {
      throw new Error("Missing required fields");
    }

    // Create a unique queue key for each session
    const queueKey = `${sessionId}-${type}-${key}`;

    // If there's already a pending operation for this key, wait for it
    if (historyQueue.has(queueKey)) {
      await historyQueue.get(queueKey);
    }

    // Create a new promise for this operation
    const operationPromise = (async () => {
      if (type === "data") {
        await History.findOneAndUpdate(
          { sessionId },
          {
            $set: {
              [`emulatorData.${key}`]: value,
              updatedAt: new Date(),
              userId: userId
            }
          },
          {
            upsert: true,
            new: true
          }
        );
      }
      else if (type === "response" && chatId) {
        await History.findOneAndUpdate(
          {
            sessionId,
            "conversations.id": chatId
          },
          {
            $set: {
              [`conversations.$[elem].${key}`]: value,
              updatedAt: new Date()
            }
          },
          {
            arrayFilters: [{ "elem.id": chatId }],
            new: true
          }
        );
      }
    })();

    // Store the promise in queue
    historyQueue.set(queueKey, operationPromise);

    // Wait for operation to complete
    await operationPromise;

    // Remove from queue when done
    historyQueue.delete(queueKey);

    console.log(`Successfully saved ${key} for session ${sessionId}`);

  } catch (err) {
    logger.error(`Error saving emulator history: ${err}`);
    console.error(`History save failed for key: ${key}`, err);
  }
};