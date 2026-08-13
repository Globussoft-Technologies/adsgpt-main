const draftCount = require("./../controllers/Draft");
const chats = require("./../controllers/Chats");
const adsCopyChat = require("./../controllers/adCopy");
const { handleResponse } = require("../controllers/adCopy");
const {
  TokenDecode,
  deleteKeysFromObject,
  restrictChartBottomeBasedOnSubscription,
} = require("../services/authService");
const { features } = require("../utils/features");
const logger = require("../utils/logger");
const {
  updateAdCopyConversation,
  updateAdCreativeConversation,
  updateAdVideoConversation,
  saveEmulatorHistory,
} = require("../controllers/newHistory");
const UnifiedCreditController = require("../controllers/UnifiedCreditController");
const GeneratedMediaController = require("../controllers/generatedMedia.controller");
const creditConfig = require("../config/creditConfig");
const modelPricingConfig = require("../config/modelPricingConfig");

/**
 * Helper: emit updated credit status to a socket
 */
const emitCreditStatus = async (userId, socketId, socket) => {
  try {
    const creditStatus = await UnifiedCreditController.getCreditStatus(userId);
    if (socketId) {
      socket.to(socketId).emit("credits", {
        creditsUsed: creditStatus.used_credits,
        totalCredits: creditStatus.total_credits,
        remainingCredits: creditStatus.remaining_credits,
        frozenCredits: creditStatus.frozen_credits,
        settledCredits: creditStatus.settled_credits,
        subscription: creditStatus.subscription,
        rollover: creditStatus.rollover,
        topup: creditStatus.topup,
      });
    }
  } catch (error) {
    console.error("Error emitting credit status:", error);
  }
};

// Function to stream ad copy response chunks to the client
const handleAdCopyResponse = async (data, socket) => {
  try {
    if (data?.socket_id) {
      socket.to(data?.socket_id).emit("adCopyResponse", {
        user_id: data?.user_id,
        sessionId: data?.session_id,
        socket_id: data?.socket_id,
        result: data?.adCopyText,
        isLastChunk: data?.isLastChunk,
        limit: data?.limit ?? false,
        chatId: data?.chatId,
      });
    }
  } catch (error) {
    console.error("Error in responseToNode event:", error);
  }
};

// Function to handle the final ad copy response, deduct credits, and emit updated credits
const handleAdCopyFullResponse = async (data, socket) => {
  try {
    if (data?.socket_id) {
      // STEP 1: Send the final response to the client
      const payload = {
        adCopyText: data.adCopyText,
        user_id: data.user_id,
        sessionId: data.sessionId,
        response_by: "adsGpt",
        sentPayload: data?.sentPayload,
        response: true,
      };

      socket.to(data?.socket_id).emit("finalAdCopyResponse", payload);
      logger.info(`Ad Copy Response: ${JSON.stringify(payload)}`);

      // Freeze was keyed by chatId in sockets/index.js adCopyRequest.
      const reservationKey =
        data?.sentPayload?.chatId || data?.chatId || null;

      if (data?.error) {
        // Generation failed → release the entire freeze.
        if (reservationKey) {
          await UnifiedCreditController.releaseCredits(reservationKey);
        }
      } else {
        const actualCharged =
          (data?.sentPayload?.no_of_ad_copies || 0) *
          UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");

        if (reservationKey) {
          // releasePartial keeps `actualCharged` debited and refunds the rest;
          // falls through to deductCredits if no receipt was created (legacy path).
          const result = await UnifiedCreditController.releasePartial(
            reservationKey,
            actualCharged,
          );
          if (!result.ok && result.reason === "NO_RECEIPT" && actualCharged > 0) {
            await UnifiedCreditController.deductCredits(
              data.user_id,
              actualCharged,
              {
                service_type: "ad_copy",
                item_count: actualCharged,
                platform: data?.sentPayload?.platform,
                session_id: data.sessionId,
                chat_id: data?.sentPayload?.chatId,
              },
            );
          }
        } else if (actualCharged > 0) {
          await UnifiedCreditController.deductCredits(
            data.user_id,
            actualCharged,
            {
              service_type: "ad_copy",
              item_count: actualCharged,
              platform: data?.sentPayload?.platform,
              session_id: data.sessionId,
              chat_id: data?.sentPayload?.chatId,
            },
          );
        }
      }

      // STEP 2: Send the credits to the client
      await emitCreditStatus(data.user_id, data.socket_id, socket);
    }
  } catch (error) {
    console.error("Error creating chat:", error);
    logger.error(`Error in adCopyResponse event: ${error}`);
  }
};

// Function to handle ad creative response, deduct credits based on successful images, and emit updated credits
const handleAdCreativeResponse = async (data, socket) => {
  try {
    const images = data?.images;
    const model = data?.model;
    const user_id = data?.user_id;

    // Validate images safely
    if (!Array.isArray(images) || images.length === 0) {
      if (data?.socket_id) {
        socket.to(data.socket_id).emit("adCreativeResponse", data);
      }
      logger.info(`Ad Creative Response (no images): ${JSON.stringify(data)}`);
      return;
    }

    // Count only successful images
    const successfulImages = images.filter(
      (img) => img && img !== "failed" && img !== "400",
    );

    if (successfulImages.length === 0) {
      if (data?.socket_id) {
        socket.to(data.socket_id).emit("adCreativeResponse", data);
      }
      logger.info(
        `Ad Creative Response (no successful images): ${JSON.stringify(data)}`,
      );
      return;
    }

    const creditPerImage = UnifiedCreditController.getModelDeduction(model);
    const totalCreditsToDeduct = creditPerImage * successfulImages.length;

    // NOTE: DB save (GeneratedMedia) is handled by Python hitting POST /createUsage
    // after generation completes — with tokens + image_urls.
    // Socket handler only deducts credits and delivers images to the frontend.

    const serviceType = "ad_creative";

    if (user_id && !data?.isRegenerate) {
      await UnifiedCreditController.deductCredits(
        user_id,
        totalCreditsToDeduct,
        {
          model,
          service_type: "ad_creative",
          item_count: successfulImages.length,
          aspect_ratio: data?.aspect_ratio,
          resolution: "standard",
          session_id: data?.sessionId,
          chat_id: data?.request_payload?.chatId,
        },
      );

      // Save each successful adCreative image to GeneratedMedia
      // Python does NOT call /createUsage for adCreativeImage, so count is saved here.
      // cost = 0 for now; will be real once Python sends tokens in socket payload.
      const inputTokens = data?.usage?.input_tokens || 0;
      const outputTokens = data?.usage?.output_tokens || 0;
      // const actualImageCost = modelPricingConfig.getImageCost(
      const actualImageCost = modelPricingConfig.getImageCostByQuality(
        model,
        data?.inputs?.quality,
        inputTokens,
        outputTokens,
      );

      for (const imgUrl of successfulImages) {
        GeneratedMediaController.saveGeneratedMedia({
          userId: user_id,
          model,
          type: "image",
          source: "adCreative", // tag so getUserGenerationStats can isolate cost separately
          image: imgUrl,
          video: "",
          credit_deduction: creditPerImage,
          cost: actualImageCost, // 0 now; auto-corrects once Python sends tokens via socket
          quality: data?.inputs?.quality || "high",
        });
      }

      await emitCreditStatus(user_id, data.socket_id, socket);
    }

    // Always emit response
    if (data?.socket_id) {
      socket.to(data.socket_id).emit("adCreativeResponse", data);
      logger.info(`Ad Creative Response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.error("Error in adCreativeResponse event:", error);
    logger.error(`Error in adCreativeResponse event: ${error}`);
  }
};

// Function to handle ad creative video response, deduct credits based on successful videos and duration, and emit updated credits
const handleAdCreativeVideoResponse = async (data, socket) => {
  try {
    const videos = data?.queryResult?.videoUrl;
    const user_id = data?.session?.userId;
    const socketId = data?.session?.socketId;
    const selectedModel = data?.queryResult?.model;
    // Freeze key used in sockets/index.js adCreativeVideoRequest:
    const reservationKey = data?.session?.chatId;

    // Validate videos safely
    if (!Array.isArray(videos) || videos.length === 0) {
      if (reservationKey) {
        await UnifiedCreditController.releaseCredits(reservationKey);
      }
      if (socketId) {
        socket.to(socketId).emit("adCreativeVideoResponse", data);
      }
      logger.info(
        `Ad Creative Video Response (no videos): ${JSON.stringify(data)}`,
      );
      return;
    }

    // Count only successful videos
    const successfulVideos = videos.filter(
      (vid) => vid && vid !== "failed" && vid !== "400" && vid !== 400,
    );

    if (successfulVideos.length === 0) {
      if (reservationKey) {
        await UnifiedCreditController.releaseCredits(reservationKey);
      }
      if (socketId) {
        socket.to(socketId).emit("adCreativeVideoResponse", data);
      }
      logger.info(
        `Ad Creative Video Response (no successful videos): ${JSON.stringify(data)}`,
      );
      return;
    }

    // Safely parse duration
    const rawDuration = data?.queryResult?.duration || "0s";
    let durationInSeconds = 0;
    if (typeof rawDuration === "string") {
      durationInSeconds = parseInt(rawDuration.replace(/[^\d]/g, ""), 10) || 0;
    } else if (typeof rawDuration === "number") {
      durationInSeconds = rawDuration;
    }

    const creditPerSecond =
      UnifiedCreditController.getModelDeduction(selectedModel);
    const creditsPerVideo = durationInSeconds * creditPerSecond;
    const totalCreditsToDeduct = creditsPerVideo * successfulVideos.length;

    // Store generated videos in GeneratedMedia collection
    const actualVideoCost = modelPricingConfig.getVideoCost(
      selectedModel,
      durationInSeconds,
    );
    for (const vidUrl of successfulVideos) {
      GeneratedMediaController.saveGeneratedMedia({
        userId: user_id,
        model: selectedModel,
        type: "video",
        image: "",
        video: vidUrl,
        credit_deduction: creditsPerVideo,
        cost: actualVideoCost,
        duration: durationInSeconds,
      });
    }

    if (user_id) {
      // Settle the freeze: keep cost of successful videos, refund the rest.
      // Falls back to legacy deductCredits if no receipt (e.g. pre-freeze request).
      if (reservationKey) {
        const result = await UnifiedCreditController.releasePartial(
          reservationKey,
          totalCreditsToDeduct,
        );
        if (!result.ok && result.reason === "NO_RECEIPT") {
          await UnifiedCreditController.deductCredits(
            user_id,
            totalCreditsToDeduct,
            {
              model: selectedModel,
              service_type: "ad_video",
              item_count: successfulVideos.length,
              duration: durationInSeconds,
              resolution: "standard",
              session_id: data?.session?.sessionId,
              chat_id: data?.session?.chatId,
            },
          );
        }
      } else {
        await UnifiedCreditController.deductCredits(
          user_id,
          totalCreditsToDeduct,
          {
            model: selectedModel,
            service_type: "ad_video",
            item_count: successfulVideos.length,
            duration: durationInSeconds,
            resolution: "standard",
            session_id: data?.session?.sessionId,
            chat_id: data?.session?.chatId,
          },
        );
      }

      await emitCreditStatus(user_id, socketId, socket);
    }

    // Always emit response
    if (socketId) {
      socket.to(socketId).emit("adCreativeVideoResponse", data);
      logger.info(`Ad Creative Video Response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.error("Error in adCreativeVideoResponse event:", error);
    logger.error(`Error in adCreativeVideoResponse event: ${error}`);
  }
};

// AdFactory per-batch hook: re-reads the user's credit status and pushes
// it to every socket joined to the campaign room. Runs after every Python
// result batch so the frontend updates live. Does NOT deduct credits —
// the actual settle happens once in `settleAdFactoryCampaign` on the final
// (allCompleted) batch. Kept exported as `handleCreditDeduction` so existing
// callers don't need rewiring; `emitCampaignCreditStatus` is the truer name.
const emitCampaignCreditStatus = async (_result, _type, userData, campaignId) => {
  try {
    if (!userData?.userId || !campaignId) return;

    // FETCH UPDATED VALUES (only for the emit — no deduction here)
    const creditStatus = await UnifiedCreditController.getCreditStatus(
      userData.userId,
    );

    // SOCKET RETRY (MAX 3)
    let sockets;
    for (let i = 0; i < 3; i++) {
      sockets = await global.io.in(campaignId).fetchSockets();

      if (sockets?.length) {
        break;
      }
      console.log(`No sockets for ${campaignId}, retrying... (${i + 1}/3)`);
      await new Promise((res) => setTimeout(res, 300));
    }

    if (!sockets?.length) {
      console.log(
        `No active sockets found for campaign ${campaignId} after 3 retries`,
      );
      return;
    }

    // EMIT UPDATED COUNTS
    sockets.forEach((socket) => {
      socket.emit("credits", {
        creditsUsed: creditStatus.used_credits,
        totalCredits: creditStatus.total_credits,
        remainingCredits: creditStatus.remaining_credits,
        frozenCredits: creditStatus.frozen_credits,
        settledCredits: creditStatus.settled_credits,
        subscription: creditStatus.subscription,
        rollover: creditStatus.rollover,
        topup: creditStatus.topup,
      });
    });
  } catch (error) {
    console.error("Error in deducting the credits", error);
  }
};

/**
 * Settle the AdFactory campaign freeze. Counts every successful item across
 * all result types on the campaign doc, multiplies by per-model cost, and
 * calls releasePartial — which charges exactly the actual cost and refunds
 * the unused portion of the freeze in a single atomic step.
 *
 * Idempotent: a second call with the receipt already gone is a NO_RECEIPT
 * no-op. The duplicate-callback guard in updateGenerationResult should make
 * that rare in practice.
 */
const settleAdFactoryCampaign = async (campaign, campaignId) => {
  try {
    let actualCharge = 0;
    let detailTrace = [];
    const services = campaign?.services?.servicesSelected || [];
    const resultsByType = campaign?.results || {};

    for (const srv of services) {
      const type = srv.serviceName; // "text" | "image" | "video"
      const arr = resultsByType?.[type];
      if (!Array.isArray(arr)) continue;

      // The model lives on the SERVICE (serviceParams.model), not on each
      // result item. Items only carry { status, data, error, prompt, timestamp }.
      const serviceModel =
        type === "text" ? "ADSGPT-TEXT" : srv?.serviceParams?.model;
      const perItem =
        UnifiedCreditController.getModelDeduction(serviceModel) || 0;

      const successful = arr.filter((it) => it?.status === 200);
      let typeCharge = 0;
      for (const item of successful) {
        let cost = perItem;
        if (type === "text") {
          const dataLength = Object.keys(item?.data || {}).length;
          cost = cost * dataLength;
        }
        if (cost > 0) typeCharge += cost;
      }
      actualCharge += typeCharge;
      detailTrace.push(
        `${type}(model=${serviceModel} success=${successful.length} perItem=${perItem} → ${typeCharge})`,
      );
    }

    const result = await UnifiedCreditController.releasePartial(
      `campaign:${campaignId}`,
      actualCharge,
    );
    console.log(
      `[credits] AdFactory campaign ${campaignId} settled: ` +
        `actualCharge=${actualCharge} [${detailTrace.join(", ")}] ` +
        `releaseResult=${JSON.stringify(result)}`,
    );
    return result;
  } catch (err) {
    console.error(
      `[credits] settleAdFactoryCampaign failed for ${campaignId}:`,
      err,
    );
  }
};

// ! To be reworked properly
const ChatResponse = async (parsedMessage, uidChannel, Socket) => {
  try {
    handleResponse(parsedMessage, Socket, uidChannel);

    if (parsedMessage?.isFinalResponse) {
      // Settle the chat freeze. Receipt key is the chatId set in
      // sockets/index.js chat handler. If no receipt (legacy chat), fall
      // back to legacy deductCredits.
      const reservationKey = parsedMessage?.chatId;
      const chatCost = UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");

      if (reservationKey) {
        const settleResult = await UnifiedCreditController.releasePartial(
          reservationKey,
          chatCost,
        );
        if (!settleResult.ok && settleResult.reason === "NO_RECEIPT" && chatCost > 0) {
          await UnifiedCreditController.deductCredits(
            parsedMessage?.uid,
            chatCost,
            {
              model: "ADSGPT-CHAT",
              service_type: "chat",
              message_length: parsedMessage?.message?.length || 0,
              session_id: parsedMessage?.sessionId,
              chat_id: parsedMessage?.chatId,
            },
          );
        }
      } else if (chatCost > 0) {
        await UnifiedCreditController.deductCredits(
          parsedMessage?.uid,
          chatCost,
          {
            model: "ADSGPT-CHAT",
            service_type: "chat",
            message_length: parsedMessage?.message?.length || 0,
            session_id: parsedMessage?.sessionId,
            chat_id: parsedMessage?.chatId,
          },
        );
      }

      await emitCreditStatus(
        parsedMessage?.uid,
        parsedMessage?.socket_id,
        Socket,
      );
    }
  } catch (error) {
    console.error("Error creating chat:", error);
  }
};

const handleAnalyticsChartTop = (
  parsedMessage,
  subscriptionTypeKey,
  Socket,
  created_from,
) => {
  if (created_from === "PAS") {
    handleResponse(parsedMessage, Socket, "analyticsChartTop");
  } else {
    const hasAccessToTopChart =
      features["Market analysis"]["plans"][subscriptionTypeKey];
    if (hasAccessToTopChart) {
      handleResponse(parsedMessage, Socket, "analyticsChartTop");
    }
  }
};

const handleAnalyticsChartBottom = (
  parsedMessage,
  subscriptionTypeKey,
  Socket,
  created_from,
) => {
  if (created_from === "PAS") {
    handleResponse(parsedMessage, Socket, "analyticsChartBottom");
  } else {
    const modifiedResponseChartBottom = restrictChartBottomeBasedOnSubscription(
      parsedMessage,
      features,
      subscriptionTypeKey,
    );
    handleResponse(modifiedResponseChartBottom, Socket, "analyticsChartBottom");
  }
};

const handleResolve = (parsedMessage, Socket) => {
  handleResponse(parsedMessage, Socket, "resolve");
};

const handleCurrentContext = (parsedMessage, Socket) => {
  handleResponse(parsedMessage, Socket, "currentContext");
};

const handleChatResponseEmit = (parsedMessage, Socket) => {
  ChatResponse(parsedMessage, "chatResponse", Socket);
};

const handleAdsData = (
  parsedMessage,
  subscriptionTypeKey,
  Socket,
  created_from,
) => {
  if (created_from === "PAS") {
    handleResponse(parsedMessage, Socket, "adsData");
  } else {
    const hasAccessToPopularityIndex =
      features["Popularity Index"]["plans"][subscriptionTypeKey];
    const responseToSend = hasAccessToPopularityIndex
      ? parsedMessage
      : deleteKeysFromObject(parsedMessage, ["popularityIndex"]);
    handleResponse(parsedMessage, Socket, "adsData");
  }
};

// Handle all the pub/sub response
const handleChatResponse = async (parsedMessage, channel, Socket) => {
  try {
    let user = null;
    let created_from = null;
    const userToken = parsedMessage?.token
      ? parsedMessage?.token
      : parsedMessage?.session?.token;
    const userSocketId = parsedMessage?.socket_id
      ? parsedMessage?.socket_id
      : parsedMessage?.session?.socketId;

    //Validate Socket and its ID
    // if (!Socket || !userSocketId || !isSocketIdLocal(userSocketId)) {
    //   return;
    // }

    // Validate and decode token if applicable
    if (!userToken) {
      console.error("Token is missing in parsedMessage for channel:", channel);
      return;
    }

    // Validate parsedMessage and channel
    if (!parsedMessage || typeof parsedMessage !== "object") {
      console.error("Invalid parsedMessage provided:", parsedMessage);
      return;
    }

    if (!channel || typeof channel !== "string") {
      console.error("Invalid channel provided:", channel);
      return;
    }
    // Initialize chunk storage if it doesn't exist
    if (!global.chunkStorage) {
      global.chunkStorage = new Map();
    }

    user = TokenDecode(userToken);
    if (!user) {
      console.error("Failed to decode user token.");
      return;
    }
    const [subscriptionTypeKey] =
      Object.entries(user?.userSubscriptionType || {})[0] || [];
    if (!subscriptionTypeKey) {
      console.error("Subscription type key is missing for the user.");
      return;
    }
    created_from = user?.customPlan ? "PAS" : user.created_from;
    if (!created_from) {
      console.error("User's 'created_from' field is missing.");
      return;
    }

    // * 2. Handle ad creative response
    if (channel == "adCreativeResponse") {
    }

    // Switch logic with added prevention checks
    switch (channel) {
      // ! START: To be reworked in the future for better structure and readability
      case "analyticsChartTop":
        const analyticsChartTop = {
          sessionId: parsedMessage?.sessionId,
          userId: parsedMessage?.uid,
          chatId: parsedMessage?.chatId,
          key: "analyticsChartTop",
          value: parsedMessage,
          type: "data",
        };

        saveEmulatorHistory(analyticsChartTop);
        handleAnalyticsChartTop(
          parsedMessage,
          subscriptionTypeKey,
          Socket,
          created_from,
        );
        break;

      case "analyticsChartBottom":
        const BottomChatPayload = {
          sessionId: parsedMessage?.sessionId,
          userId: parsedMessage?.uid,
          chatId: parsedMessage?.chatId,
          key: "analyticsChart",
          value: parsedMessage?.analyticsChart,
          type: "data",
        };
        saveEmulatorHistory(BottomChatPayload);
        handleAnalyticsChartBottom(
          parsedMessage,
          subscriptionTypeKey,
          Socket,
          created_from,
        );
        break;

      case "resolve":
        handleResolve(parsedMessage, Socket);
        break;

      case "currentContext":
        const currentContext = {
          sessionId: parsedMessage?.sessionId,
          userId: parsedMessage?.uid,
          chatId: parsedMessage?.chatId,
          key: "currentContext",
          value: parsedMessage,
          type: "data",
        };
        saveEmulatorHistory(currentContext);
        handleCurrentContext(parsedMessage, Socket);
        break;

      case "chatResponse":
        const streamKey = `${parsedMessage.sessionId}-${parsedMessage.chatId}`;

        if (!global.chunkStorage.has(streamKey)) {
          global.chunkStorage.set(streamKey, {
            fullMessage: "",
            metadata: {
              sessionId: parsedMessage.sessionId,
              userId: parsedMessage.uid,
              chatId: parsedMessage.chatId,
            },
          });
        }

        const streamData = global.chunkStorage.get(streamKey);

        if (parsedMessage.message) {
          streamData.fullMessage += parsedMessage.message;
        }

        if (parsedMessage?.isFinalResponse) {
          const payload = {
            sessionId: streamData.metadata.sessionId,
            userId: streamData.metadata.userId,
            chatId: streamData.metadata.chatId,
            key: "message",
            value: streamData.fullMessage,
            type: "response",
          };

          saveEmulatorHistory(payload);
          global.chunkStorage.delete(streamKey);
        }
        handleChatResponseEmit(parsedMessage, Socket);
        break;

      case "adsData":
        const adsData = {
          sessionId: parsedMessage?.sessionId,
          userId: parsedMessage?.uid,
          chatId: parsedMessage?.chatId,
          key: "adsData",
          value: parsedMessage,
          type: "data",
        };
        saveEmulatorHistory(adsData);
        handleAdsData(parsedMessage, subscriptionTypeKey, Socket, created_from);
        break;
      // ! END: To be reworked in the future for better structure and readability

      // * 1. Stream ad copy response
      case "adCopyResponse":
        await handleAdCopyResponse(parsedMessage, Socket);
        break;

      // * 2. Deduct credits and send final ad copy response
      case "finalAdCopyResponse":
        await handleAdCopyFullResponse(parsedMessage, Socket);
        await updateAdCopyConversation(parsedMessage);
        break;

      // * 3. Handle ad creative response
      case "adCreativeResponse":
        // Deduct credits based on successful images and emit the response with updated credits
        // await handleAdCreativeResponse(
        //   parsedMessage,
        //   Socket,
        //   subscriptionTypeKey,
        //   subscriptionTypeValue,
        // );
        // // Store in history
        // await updateAdCreativeConversation(parsedMessage);
        break;

      // * 4. Handle ad creative video response
      case "adCreativeVideoResponse":
        await handleAdCreativeVideoResponse(parsedMessage, Socket);
        await updateAdVideoConversation(parsedMessage);
        break;
      default:
        console.warn("Unknown channel received:", channel);
        break;
    }
  } catch (error) {
    console.error("Error handling chat response:", error);
    logger.error(`Error handling chat response:: ${error}`);
  }
};

// Utility function to validate if the socket ID belongs to this server
const isSocketIdLocal = (socketId) => {
  const namespace = "/";
  const sockets = global.io.of(namespace).sockets;
  return sockets.has(socketId);
};

module.exports = {
  getDraftDataCount: draftCount.getDraftDataCount,
  createChat: chats.createChat,
  createAdsCopyChat: adsCopyChat.createAdsCopyChat,
  handleChatResponse,
  // Legacy name kept as an alias so existing callers don't need rewiring.
  handleCreditDeduction: emitCampaignCreditStatus,
  emitCampaignCreditStatus,
  settleAdFactoryCampaign,
};
