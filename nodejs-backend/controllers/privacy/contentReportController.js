const mongoose = require("mongoose");
const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const logger = require("../../utils/logger");

const MAX_REASON = 500;

// generatedMedia.userId is whatever req.user.user_id was at save time, which
// may be "1234" or "GPT-1234". Compare on the bare numeric form.
const bareUserId = (id) => String(id || "").replace(/^GPT-/, "");
const ownsMedia = (media, userId) => !!bareUserId(userId) && bareUserId(media?.userId) === bareUserId(userId);

// The user writes their own reason; there is no fixed list.
// Returns { error } or { reason }.
const parseReason = (body = {}) => {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { error: "reason is required" };
  if (reason.length > MAX_REASON) return { error: `reason must be at most ${MAX_REASON} characters` };
  return { reason };
};

const fail = (res, status, code, error) =>
  res.status(status).json({ ok: false, code, error });

// POST /adsgpt/privacy/content-reports  { generatedMediaId, reason }
// Reports one of the user's generated images/videos and hides it straight
// away, so it disappears from their lists. `reason` is the user's own words.
// Admins see reports read-only.
const reportContent = async (req, res) => {
  try {
    const { generatedMediaId } = req.body || {};
    if (!mongoose.isValidObjectId(generatedMediaId)) {
      return fail(res, 400, "INVALID_ID", "generatedMediaId is required.");
    }
    const parsed = parseReason(req.body);
    if (parsed.error) return fail(res, 400, "INVALID_REASON", parsed.error);

    const media = await GeneratedMedia.findById(generatedMediaId).select("userId is_reported").lean();
    if (!media || !ownsMedia(media, req.user?.user_id)) {
      return fail(res, 404, "MEDIA_NOT_FOUND", "Generated media not found.");
    }
    // Reported items are already hidden; the app should just hide it too.
    if (media.is_reported) {
      return fail(res, 409, "ALREADY_REPORTED", "This item was already reported and is hidden.");
    }

    await GeneratedMedia.updateOne(
      { _id: media._id },
      { $set: { is_reported: true, report_reason: parsed.reason, reported_at: new Date() } },
    );

    return res.json({ ok: true, generatedMediaId: String(media._id), reported: true });
  } catch (error) {
    logger.error("[reportContent] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to report content.");
  }
};

module.exports = { reportContent, MAX_REASON, ownsMedia, parseReason };
