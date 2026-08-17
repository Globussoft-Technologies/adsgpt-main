const modelPricingConfig = require("../config/modelPricingConfig");
const { TokenDecode } = require("../services/authService");
const logger = require("../utils/logger");
const GeneratedMediaController = require("./generatedMedia.controller");
const { updateAdCreativeConversation } = require("./newHistory");
const UnifiedCreditController = require("./UnifiedCreditController");
const axios = require("axios");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
const { trackBackendGA4Event } = require("../utils/ga4");

exports.sendCreativeRequest = async (payload) => {
  try {
    trackBackendGA4Event('ad_studio', {
      user_id: payload?.user_id,
      feature: 'ad_creative',
      action_name: 'ad_creative_ai_creatives_requested',
      source: 'ai_creatives_form',
      success: true,
    });
    const apiUrl = process.env.CREATIVE_REQUEST_API;
    const response = await axios.post(apiUrl, payload);
    return { ok: true, data: response.data };
  } catch (error) {
    logger.error("Error in sendCreativeRequest:", error);
    return { ok: false, error: error.message };
  }
};

const emitResult = (userId, channel, data) => {
  if (global.io) {
    global.io.to(userId).emit(channel, data);
  }
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
    emitResult(userId, "credits", payload);
  } catch (error) {
    console.error("Error emitting credit status:", error);
  }
};

const handleAdCreativeResponse = async (data) => {
  try {
    const images = data?.images;
    const model = data?.model;
    const user_id = data?.user_id;
    // chatId is the freeze receipt key set by sockets/index.js adCreativeRequest.
    // Python echoes it back on `chatId` or inside `request_payload.chatId`.
    const reservationKey = data?.chatId || data?.request_payload?.chatId;

    // Validate images safely
    if (!Array.isArray(images) || images.length === 0) {
      // Full failure — release the entire freeze.
      if (reservationKey && !data?.isRegenerate) {
        await UnifiedCreditController.releaseCredits(reservationKey);
      }
      if (data?.socket_id) {
        emitResult(user_id, "adCreativeResponse", data);
      }
      logger.info(`Ad Creative Response (no images): ${JSON.stringify(data)}`);
      return;
    }

    // Count only successful images
    const successfulImages = images.filter((img) => {
      if (!img) return false;

      let url = "";

      if (typeof img === "string") {
        url = img;
      } else if (typeof img === "object") {
        url = img.base_image || img.data || "";
      }

      return url && url !== "failed" && url !== "400";
    });

    // If no successful images → release entire freeze, no charge.
    if (successfulImages.length === 0) {
      trackBackendGA4Event('ad_studio', {
        user_id,
        feature: 'ad_creative',
        action_name: 'ad_creative_ai_creatives_failed',
        source: 'ai_creatives_studio',
        success: false,
      });
      if (reservationKey && !data?.isRegenerate) {
        await UnifiedCreditController.releaseCredits(reservationKey);
      }
      if (data?.socket_id) {
        emitResult(user_id, "adCreativeResponse", data);
      }
      logger.info(
        `Ad Creative Response (no successful images): ${JSON.stringify(data)}`
      );
      return;
    }

    trackBackendGA4Event('ad_studio', {
      user_id,
      feature: 'ad_creative',
      action_name: 'ad_creative_ai_creatives_generated',
      source: 'ai_creatives_studio',
      success: true,
    });

    const creditPerImage = UnifiedCreditController.getModelDeduction(model);

    const totalCreditsToDeduct = creditPerImage * successfulImages.length;

    if (user_id && !data?.isRegenerate) {
      // Settle the freeze: keep the cost of successful images, refund the rest.
      // Falls back to legacy deductCredits if no reservation receipt exists
      // (e.g. a request that bypassed the sockets/index.js freeze path).
      if (reservationKey) {
        const result = await UnifiedCreditController.releasePartial(
          reservationKey,
          totalCreditsToDeduct,
        );
        if (!result.ok && result.reason === "NO_RECEIPT") {
          await UnifiedCreditController.deductCredits(
            user_id,
            totalCreditsToDeduct,
          );
        }
      } else {
        await UnifiedCreditController.deductCredits(
          user_id,
          totalCreditsToDeduct,
        );
      }

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
        outputTokens
      );

      for (const imgUrl of successfulImages) {
        // LEGACY: Still save to GeneratedMedia for admin panel/cost details
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

        // NEW: Save to refined Count module for cleanStats API
        const finalUrl =
          typeof imgUrl === "string"
            ? imgUrl
            : imgUrl?.base_image || imgUrl?.data || "";
        const newCount = new GeneratedCount({
          userId: user_id,
          type: "image",
          url: finalUrl,
          model: model,
        });
        newCount.save().catch(() => {});
      }

      await emitCreditStatus(user_id);
    }

    // Always emit response
    if (data?.socket_id) {
      emitResult(user_id, "adCreativeResponse", data);

      logger.info(`Ad Creative Response: ${JSON.stringify(data)}`);
    }
  } catch (error) {
    console.error("Error in adCreativeResponse event:", error);
    logger.error(`Error in adCreativeResponse event: ${error}`);
  }
};

exports.updateCreativeResult = async (req, res) => {
  try {
    logger.info(`Update creative raw result: ${JSON.stringify(req.body)}`);
    const data = req.body;

    await handleAdCreativeResponse(data);
    await updateAdCreativeConversation(data);
    return res
      .status(200)
      .json({ success: true, message: "Creative result updated successfully" });
  } catch (error) {
    console.error("Error in updateCreativeResult:", error);
    logger.error(`Error in updateCreativeResult: ${error}`);
    return res.status(500).json({ error: "Failed to update creative result" });
  }
};
