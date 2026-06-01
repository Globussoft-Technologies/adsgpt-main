require("dotenv").config();
const setupSockets = require("./setupSockets");
const {
  saveSocketId,
  clearSocketIds,
  handleAdCopyResponse,
  sendAdCopyRequest,
} = require("../controllers/adCopy");
const logger = require("../utils/logger");
const {
  updateAdCreativeConversation,
  updateAdVideoConversation,
  updateAdCopyConversation,
} = require("../controllers/newHistory");
const buildFeatureObject = require("../utils/featureObjectBuilder");
const UnifiedCreditController = require("../controllers/UnifiedCreditController");
const { sendCreativeRequest } = require("../controllers/adStudio");

const initializeSockets = (Socket, pub, sub) => {
  Socket.on("connection", async (socket) => {
    // * 1. On connection build the feature object
    const plan = Object.keys(socket.user?.userSubscriptionType)[0];
    let featureObject = await buildFeatureObject(socket.user?.user_id);

    // * 2. On connection send the feature object to the client
    if (socket?.user.token) {
      socket.user.featureObject = featureObject;
      const enabledCreative = process.env.ENABLE_CREATIVE || "";
      const enabledVideo = process.env.ENABLE_VIDEO || "";
      const allowedPlans = enabledCreative
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p !== "");
      const allowedVideoPlans = enabledVideo
        ?.split(",")
        ?.map((p) => p.trim())
        ?.filter((p) => p !== "");
      socket.user.isAdCreativeActive =
        allowedPlans.includes(plan) ||
        process.env.ACCESS_ADCREATIVE_ALL === "true";
      socket.user.isAdVideo = allowedVideoPlans?.includes(plan);
      socket.emit(socket.user.token, socket.user);

      // Get credit status from MongoDB (no more Redis)
      const creditStatus = await UnifiedCreditController.getCreditStatus(
        socket.user.user_id,
      );

      Socket.to(socket.id).emit("credits", {
        creditsUsed: creditStatus.used_credits,
        totalCredits: creditStatus.total_credits,
        remainingCredits: creditStatus.remaining_credits,
        frozenCredits: creditStatus.frozen_credits,
        settledCredits: creditStatus.settled_credits,
        subscription: creditStatus.subscription,
        rollover: creditStatus.rollover,
        topup: creditStatus.topup,
      });
      // Save the socket id of user, to publish the data back to the same user
      const userId = socket?.user?.user_id;
      const socketId = socket.id;
      await saveSocketId(userId, socketId);
    }

    // ! 3. Old Chatbot - To be reworked properly
    socket.on("chat", async (data) => {
      try {
        // STEP 1: Determine feature object & prompt limit
        let featureObject = await buildFeatureObject(data.uid);

        // Attach feature object and socket ID
        data.featureObject = featureObject;
        data.socket_id = socket?.id;

        // STEP 2: Freeze the expected chat cost. ChatResponse handler
        // (setupSockets.js) settles via legacy deductCredits today — when
        // ADSGPT-TEXT is set to 0 (default), this is a free no-op freeze.
        const modelDeduction =
          UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");

        const freeze = await UnifiedCreditController.freezeCredits({
          userId: data.uid,
          reservationKey: data?.chatId,
          amount: modelDeduction,
          meta: { service_type: "chat", chatId: data?.chatId },
        });

        if (freeze.ok) {
          pub.publish("chatRequest", JSON.stringify(data));
          return;
        }

        // Freeze failed → send the existing limit response.
        const limitMessage =
          freeze.reason === "INSUFFICIENT"
            ? `You have exceeded your unified credit limit. Required: ${freeze.required}, remaining: ${freeze.remaining}. Please check your subscription plan.`
            : "We couldn't reserve credits for this request. Please try again.";

        const response = {
          uid: data?.uid,
          chatId: data.chatId || "unknown",
          sessionId: data.sessionId || "unknown",
          message: limitMessage,
          chatAdsData: [],
          advertiser: [],
          token: data.token,
          timestamp: new Date().toISOString(),
          responseBy: "adsgpt",
          isFinalResponse: false,
          limit: true,
          socket_id: socket?.id,
        };

        pub.publish("chatResponse", JSON.stringify(response));
        pub.publish(
          "resolve",
          JSON.stringify({
            uid: data?.uid,
            token: socket?.user?.token || "",
            chatId: "",
            sessionId: "",
            allowChat: true,
            socket_id: socket?.id,
          }),
        );
      } catch (error) {
        console.error("Error handling chat event:", error);
      }
    });

    // * 4. Ad Copy Unlimited
    socket.on("adCopyRequest", async (message) => {
      logger.info(`Ad Copy Request: ${JSON.stringify(message)}`);
      try {
        // STEP 1: Determine feature object & prompt limit
        let featureObject = await buildFeatureObject(message.user_id);

        // STEP 2: Attach feature object to message
        message.featureObject = featureObject;
        message.socket_id = socket?.id;

        // STEP 3: Require an active base subscription plan — users with
        // only lifetime top-up credits cannot generate until they subscribe.
        const hasBasePlan = await UnifiedCreditController.hasActiveBasePlan(
          message.user_id,
        );
        if (!hasBasePlan) {
          const noPlanResponse = {
            adCopyText:
              "Sorry, you don't have a base plan to use this feature. Please subscribe to a base plan to continue.",
            user_id: message?.user_id,
            session_id: message?.sessionId,
            isLastChunk: true,
            socket_id: socket?.id,
            limit: true,
            plan_status: "no_base_plan",
            chatId: message?.chatId,
            sessionId: message?.sessionId,
          };
          handleAdCopyResponse(noPlanResponse, Socket);
          updateAdCopyConversation(noPlanResponse);
          return;
        }

        // STEP 4: Freeze the expected credit cost atomically. The response
        // handler (handleAdCopyFullResponse) will settle on success or
        // release on failure, keyed by chatId.
        const perCopy =
          UnifiedCreditController.getModelDeduction("ADSGPT-TEXT");
        const numCopies = Number(message?.no_of_ad_copies) || 1;
        const totalRequired = perCopy * numCopies;

        const freeze = await UnifiedCreditController.freezeCredits({
          userId: message.user_id,
          reservationKey: message?.chatId,
          amount: totalRequired,
          meta: { service_type: "ad_copy", chatId: message?.chatId },
        });

        if (freeze.ok) {
          await sendAdCopyRequest(message);
          return;
        }

        // Freeze failed — surface the right UX.
        if (freeze.reason === "INSUFFICIENT") {
          const adCopyMessage = `🚫 **Credit Limit Exceeded!** 🚫

            You need ${freeze.required} credits but only ${freeze.remaining} remain.

            🔔 Next Steps:
            Please review your subscription plan for more details on your available limits and how to upgrade if needed.

            Thank you for using our service! 😊`;

          const expireCopyResponse = {
            adCopyText: adCopyMessage,
            user_id: message?.user_id,
            session_id: message?.sessionId,
            isLastChunk: true,
            socket_id: socket?.id,
            limit: true,
            chatId: message?.chatId,
            sessionId: message?.sessionId,
          };
          handleAdCopyResponse(expireCopyResponse, Socket);
          updateAdCopyConversation(expireCopyResponse);
        } else {
          // CONTENDED / RECEIPT_WRITE_FAILED / MISSING_KEY / NO_USER
          logger.error(
            `Ad Copy freeze failed (${freeze.reason}) for user ${message?.user_id}`,
          );
          const errResponse = {
            adCopyText:
              "We couldn't reserve credits for this request. Please try again.",
            user_id: message?.user_id,
            session_id: message?.sessionId,
            isLastChunk: true,
            socket_id: socket?.id,
            limit: true,
            chatId: message?.chatId,
            sessionId: message?.sessionId,
          };
          handleAdCopyResponse(errResponse, Socket);
        }
      } catch (error) {
        console.error("Error in adCopyRequest handler:", error);
      }
    });

    // * 5. Ad Creative
    socket.on("adCreativeRequest", async (message) => {
      logger.info(`Ad Creative Request: ${JSON.stringify(message)}`);
      try {
        // STEP 1: Determine feature object & prompt limit
        let featureObject = await buildFeatureObject(message.user_id);

        message.featureObject = featureObject;
        message.socket_id = socket?.id;

        // STEP 2: Require an active base subscription plan — users with only
        // lifetime top-up credits cannot generate until they subscribe.
        const hasBasePlan = await UnifiedCreditController.hasActiveBasePlan(
          message.user_id,
        );
        if (!hasBasePlan) {
          const numberOfAdsCreative = message.num_images || 1;
          const textResponse = {
            starting_acknowledgement:
              "Sorry, you don't have a base plan to use this feature. Please subscribe to a base plan to continue.",
            ad_copies: {},
            user_id: message?.user_id,
            token: message?.token,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            type: "text",
            plan_status: "no_base_plan",
            chatId: message?.chatId,
          };
          for (let i = 1; i <= numberOfAdsCreative; i++) {
            textResponse.ad_copies[`ad_copy_${i}`] =
              `Headline: Subscribe to Continue\n\nDescription: A base plan is required to generate ad creatives.`;
          }

          const imageResponse = {
            user_id: message?.user_id,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            token: message?.token,
            images: Array(numberOfAdsCreative).fill("planExpired"),
            type: "image",
            chatId: message?.chatId,
          };

          Socket.to(socket?.id).emit("adCreativeResponse", textResponse);
          Socket.to(socket?.id).emit("adCreativeResponse", imageResponse);
          await updateAdCreativeConversation(textResponse);
          updateAdCreativeConversation(imageResponse);
          return;
        }

        // STEP 3: Model-based credit logic
        const selectedModel = message?.model;
        const modelMinCount =
          UnifiedCreditController.getModelDeduction(selectedModel);
        const numberOfAdsCreative = message.num_images;
        const totalRequiredCredits = numberOfAdsCreative * modelMinCount;

        // STEP 4: Freeze the full requested cost atomically. Response handler
        // (adStudio.handleAdCreativeResponse) settles on success and may also
        // release for any items that failed. Regenerate requests are free
        // re-rolls — they skip the freeze entirely (mirrors the legacy
        // `if (!data.isRegenerate)` guard on the deduct path).
        // if (message?.isRegenerate) {
        //   await sendCreativeRequest(message);
        //   return;
        // }

        const freeze = await UnifiedCreditController.freezeCredits({
          userId: message?.user_id,
          reservationKey: message?.chatId,
          amount: totalRequiredCredits,
          meta: {
            service_type: "ad_creative",
            model: selectedModel,
            num_images: numberOfAdsCreative,
          },
        });

        if (freeze.ok) {
          // If Python rejects the request synchronously (network error, down),
          // release the freeze immediately — the async response handler that
          // would normally settle/release will never fire.
          const sent = await sendCreativeRequest(message);
          if (!sent?.ok && message?.chatId) {
            await UnifiedCreditController.releaseCredits(message?.chatId);
          }
          return;
        }

        // Freeze failed → mirror the existing partial / no-credits UX.
        const userCreativeCountUnified = freeze.remaining || 0;
        const maxCreativesAllowedUnified = modelMinCount
          ? Math.floor(userCreativeCountUnified / modelMinCount)
          : 0;

        if (freeze.reason === "INSUFFICIENT" && userCreativeCountUnified >= modelMinCount) {
          const textResponse = {
            starting_acknowledgement: `You have only ${userCreativeCountUnified} credit${userCreativeCountUnified > 1 ? "s" : ""} left. For the selected model each creative costs ${modelMinCount} credit${modelMinCount > 1 ? "s" : ""}. Based on this, you can generate up to ${maxCreativesAllowedUnified} creative${maxCreativesAllowedUnified > 1 ? "s" : ""} at a time. Please reduce the number of creatives to ${maxCreativesAllowedUnified}`,
            ad_copies: {},
            user_id: message?.user_id,
            token: message?.token,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            type: "text",
            plan_status: "model_expired",
            chatId: message?.chatId,
          };

          for (let i = 1; i <= numberOfAdsCreative; i++) {
            textResponse.ad_copies[`ad_copy_${i}`] =
              `Headline: Upgrade to Continue\n\nDescription: Renew your plan today to unlock premium ad Creative features`;
          }

          const imageResponse = {
            user_id: message?.user_id,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            token: message?.token,
            images: Array(numberOfAdsCreative).fill("planExpired"),
            type: "image",
            chatId: message?.chatId,
          };

          Socket.to(socket?.id).emit("adCreativeResponse", textResponse);
          Socket.to(socket?.id).emit("adCreativeResponse", imageResponse);
          await updateAdCreativeConversation(textResponse);
          updateAdCreativeConversation(imageResponse);
        }
        // Condition 3: User has no credits
        else {
          const textResponse = {
            starting_acknowledgement:
              "Your plan has expired or you have insufficient credits. Renew now to continue accessing premium ad Creative services.",
            ad_copies: {},
            user_id: message?.user_id,
            token: message?.token,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            type: "text",
            plan_status: "expired",
            chatId: message?.chatId,
          };

          for (let i = 1; i <= numberOfAdsCreative; i++) {
            textResponse.ad_copies[`ad_copy_${i}`] =
              `Headline: Upgrade to Continue\n\nDescription: Renew your plan today to unlock premium ad Creative features`;
          }

          const imageResponse = {
            user_id: message?.user_id,
            sessionId: message?.sessionId,
            socket_id: socket?.id,
            token: message?.token,
            images: Array(numberOfAdsCreative).fill("planExpired"),
            type: "image",
            chatId: message?.chatId,
          };

          Socket.to(socket?.id).emit("adCreativeResponse", textResponse);
          Socket.to(socket?.id).emit("adCreativeResponse", imageResponse);
          await updateAdCreativeConversation(textResponse);
          updateAdCreativeConversation(imageResponse);
        }
      } catch (error) {
        console.error("Error in adCreativeRequest handler:", error);
      }
    });

    // * 6. Ad Creative Video
    socket.on("adCreativeVideoRequest", async (message) => {
      logger.info(`Ad CreativeVideo Request: ${JSON.stringify(message)}`);
      try {
        // STEP 1: Determine feature object & prompt limit
        let featureObject = await buildFeatureObject(message?.session?.userId);

        message.featureObject = featureObject;
        message["session"]["socketId"] = socket?.id;

        // STEP 2: Model-based credit logic
        const selectedModel = message?.query?.model;
        const videoMinCount =
          (Number(message?.query?.duration?.replace("s", "")) || 0) *
          UnifiedCreditController.getModelDeduction(selectedModel);
        const numberOfAdsVideo = message?.query?.numberOfVideos;
        const totalRequiredCredits = numberOfAdsVideo * videoMinCount;

        // STEP 3: Freeze the full requested cost. Response handler
        // (handleAdCreativeVideoResponse) settles on success / releases on
        // failure, keyed by the session's chatId.
        const freeze = await UnifiedCreditController.freezeCredits({
          userId: message.session?.userId,
          reservationKey: message?.session?.chatId,
          amount: totalRequiredCredits,
          meta: {
            service_type: "ad_video",
            model: selectedModel,
            duration: message?.query?.duration,
            num_videos: numberOfAdsVideo,
          },
        });

        if (freeze.ok) {
          pub.publish("adCreativeVideoRequest", JSON.stringify(message));
          return;
        }

        const userCreativeCountUnified = freeze.remaining || 0;

        if (freeze.reason === "INSUFFICIENT" && userCreativeCountUnified >= videoMinCount) {
          const videoResponse = {
            session: {
              userId: message?.session?.userId,
              chatId: message?.session?.chatId,
              sessionId: message?.session?.sessionId,
              socketId: message?.session.socketId,
              token: message?.session?.token,
              timestamp: message?.session?.timestamp,
            },
            queryResult: {
              videoUrl: Array(numberOfAdsVideo).fill("creditErr"),
              numVideos: numberOfAdsVideo,
              type: "video",
            },
            plan_status: "num_video_expired",
          };
          Socket.to(socket?.id).emit("adCreativeVideoResponse", videoResponse);
          updateAdVideoConversation(videoResponse);
        }
        // Condition 3: User has no credits
        else {
          const videoResponse = {
            session: {
              userId: message?.session?.userId,
              chatId: message?.session?.chatId,
              sessionId: message?.session?.sessionId,
              socketId: message?.session.socketId,
              token: message?.session?.token,
              timestamp: message?.session?.timestamp,
            },
            queryResult: {
              videoUrl: Array(numberOfAdsVideo).fill("planExpired"),
              numVideos: numberOfAdsVideo,
              type: "video",
            },
            plan_status: "expired",
          };
          Socket.to(socket?.id).emit("adCreativeVideoResponse", videoResponse);
          updateAdVideoConversation(videoResponse);
        }
      } catch (error) {
        logger.info(`Error in adCreativeVideoRequest handler::`, error);
        console.error("Error in adCreativeVideoRequest handler:", error);
      }
    });

    // * 7. Ad Factory
    socket.on("adFactoryRequest", (campaignId) => {
      if (campaignId) {
        socket.join(campaignId);
        console.log(`Socket ${socket.id} joined campaign room ${campaignId}`);
      }
    });

    // * 8. Disconnect
    socket.on("disconnect", async () => {
      await clearSocketIds(socket.id);
    });
  });

  sub.on("message", (channel, message) => {
    const parsedMessage = JSON.parse(message);
    setupSockets.handleChatResponse(parsedMessage, channel, Socket);
  });

  return Socket;
};

module.exports = initializeSockets;
