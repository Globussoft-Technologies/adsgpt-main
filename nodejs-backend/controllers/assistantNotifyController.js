const { notifyUser } = require("../services/push/notifyUser");

/**
 * POST /adsgpt/notify/assistant-turn
 *
 * Body: { user_id, conversation_id, message_id?, image_count?, preview_image?, text? }
 *
 * Called by the Python agent when a chat turn finishes AFTER its browser
 * disconnected — the user hit "New Chat" or closed the tab mid-generation. The
 * turn keeps running server-side and persists its result, so the only thing
 * missing is telling the user it's ready.
 *
 * Delivery reuses the same dispatcher as image/video generation
 * (services/push/notifyUser.js): a socket emit to the user's room for web and
 * foregrounded apps, plus an FCM push for backgrounded/closed native apps.
 *
 * Service-to-service — secured by x-secret-key, no JWT.
 */
exports.assistantTurnComplete = async (req, res) => {
  /* #swagger.tags = ['AI Assistant']
     #swagger.summary = 'Notify a user that a detached assistant turn finished'
     #swagger.description = 'Called by the Python agent when a chat turn completes after the browser disconnected (New Chat / closed tab mid-generation). Emits assistantTurnCompleted to the user socket room and sends an FCM push. Secured by the x-secret-key header (no JWT).'
     #swagger.parameters['x-secret-key'] = {
       in: 'header', required: true, type: 'string'
     }
  */
  try {
    const {
      user_id: userId,
      conversation_id: conversationId,
      message_id: messageId = "",
      image_count: imageCount = 0,
      preview_image: previewImage = "",
      text = "",
      detached = false,
    } = req.body || {};

    if (!userId || !conversationId) {
      return res
        .status(400)
        .json({ success: false, message: "user_id and conversation_id are required" });
    }

    const images = Number(imageCount) || 0;
    const title = images > 0 ? "Your creative is ready" : "Your assistant reply is ready";
    const body =
      images > 0
        ? `${images} image${images > 1 ? "s" : ""} finished generating while you were away.`
        : text || "Your request finished while you were away.";

    await notifyUser(userId, {
      event: "assistantTurnCompleted",
      socketPayload: {
        conversationId,
        messageId,
        imageCount: images,
        previewImage,
        text,
        // The browser had already left when this finished. The web client uses
        // it to decide whether to raise an OS notification or just refresh.
        detached: !!detached,
      },
      push: {
        title,
        body,
        // The app deep-links back into the conversation on tap.
        data: { type: "assistantTurnCompleted", conversationId, messageId },
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(`[assistantNotify] failed: ${err.message}`);
    // Never make the agent retry a notification — the turn itself already
    // succeeded and was persisted.
    return res.status(500).json({ success: false, message: "notify failed" });
  }
};
