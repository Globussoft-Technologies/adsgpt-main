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

const parseLink = (body = {}) => {
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!/^(https?:\/\/\S+|\/[^/\s][^\s]*)$/i.test(link)) {
    return { error: "link must be an image or video URL or root-relative path." };
  }
  return { link };
};

const mediaLinkFilter = (link) => ({
  $or: [
    { image: link }, { video: link },
    { "image.url": link }, { "image.base_image": link },
    { "image.base_image_with_logo": link }, { "video.url": link },
    { "video.videoUrl": link }, { "video.cleanVideoUrl": link },
  ],
});

const fail = (res, status, code, error) =>
  res.status(status).json({ ok: false, code, error });

// POST /adsgpt/privacy/content-reports  { link, reason }
// Reports one of the user's generated images/videos and hides it straight
// away, so it disappears from their lists. `reason` is the user's own words.
// Admins see reports read-only.
const reportContent = async (req, res) => {
  try {
    const parsedLink = parseLink(req.body);
    if (parsedLink.error) return fail(res, 400, "INVALID_LINK", parsedLink.error);
    const { link } = parsedLink;
    const parsed = parseReason(req.body);
    if (parsed.error) return fail(res, 400, "INVALID_REASON", parsed.error);

    const userId = String(req.user?.user_id || "").replace(/^GPT-/, "");
    const ownerIds = [userId, `GPT-${userId}`];
    const media = await GeneratedMedia.findOne({
      userId: { $in: ownerIds },
      ...mediaLinkFilter(link),
    }).select("userId is_reported").lean();
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

    return res.json({ ok: true, link, reported: true });
  } catch (error) {
    logger.error("[reportContent] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to report content.");
  }
};

module.exports = { reportContent, MAX_REASON, ownsMedia, parseReason, parseLink, mediaLinkFilter };
