const GeneratedMedia = require("../../Module/generatedMedia/generated.media");
const ImageGeneration = require("../../Module/imageGeneration/imageModel");
const VideoGeneration = require("../../Module/videoGeneration/videoModel");
const logger = require("../../utils/logger");

const MAX_REASON = 500;

// generatedMedia.userId is whatever req.user.user_id was at save time, which
// may be "1234" or "GPT-1234". Compare on the bare numeric form.
const bareUserId = (id) => String(id || "").replace(/^GPT-/, "");
const ownsMedia = (media, userId) => !!bareUserId(userId) && bareUserId(media?.userId) === bareUserId(userId);
const ownerIdsFor = (userId) => {
  const bare = bareUserId(userId);
  return bare ? [bare, `GPT-${bare}`] : [];
};

// ---- Links --------------------------------------------------------------------
// Media is stored as a path ("/creatives/GPT-409/1.webp") or a full URL
// ("https://contents.adsgpt.io/creatives/GPT-409/1.webp"), and the apps send
// whichever they display. Links are compared on the path so both match.

const toMediaPath = (link) => {
  if (typeof link !== "string") return "";
  const value = link.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname;
    } catch {
      return value;
    }
  }
  return value.split(/[?#]/)[0];
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches the stored value whether it is the path or a full URL to it.
const linkMatcher = (link) => new RegExp(`^(https?://[^/]+)?${escapeRegex(toMediaPath(link))}([?#].*)?$`, "i");

const mediaLinkFilter = (link) => {
  const match = linkMatcher(link);
  return {
    $or: [
      { image: match }, { video: match },
      { "image.url": match }, { "image.base_image": match },
      { "image.base_image_with_logo": match }, { "video.url": match },
      { "video.videoUrl": match }, { "video.cleanVideoUrl": match },
    ],
  };
};

// Every link the user reported, as stored and as a path.
const getReportedMediaLinks = async (userId) => {
  const ownerIds = ownerIdsFor(userId);
  if (!ownerIds.length) return new Set();
  const [media, images, videos] = await Promise.all([
    GeneratedMedia.find({ userId: { $in: ownerIds }, is_reported: true }).select("image video").lean(),
    ImageGeneration.find({ userId: { $in: ownerIds }, "results.is_reported": true })
      .select("results.generatedImageUrl results.is_reported")
      .lean(),
    VideoGeneration.find({ userId: { $in: ownerIds }, "results.is_reported": true })
      .select("results.url results.waterMarkUrl results.is_reported")
      .lean(),
  ]);
  const links = [
    ...media.flatMap((m) => [
      m.image, m.image?.url, m.image?.base_image, m.image?.base_image_with_logo,
      m.video, m.video?.url, m.video?.videoUrl, m.video?.cleanVideoUrl,
    ]),
    ...images.flatMap((d) => (d.results || []).filter((r) => r.is_reported).map((r) => r.generatedImageUrl)),
    ...videos.flatMap((d) => (d.results || []).filter((r) => r.is_reported).flatMap((r) => [r.url, r.waterMarkUrl])),
  ].filter((value) => typeof value === "string" && value);
  return new Set(links.flatMap((link) => [link, toMediaPath(link)]));
};

// Is this url one of the reported links (in any stored form)?
const isReportedLink = (reported, url) =>
  !!url && reported.size > 0 && (reported.has(url) || reported.has(toMediaPath(url)));

// The reported links as regexes, for a Mongo `$in` that hides them in a query.
const reportedLinkMatchers = (reported) =>
  [...new Set([...reported].map(toMediaPath).filter(Boolean))].map(linkMatcher);

// ---- Input --------------------------------------------------------------------

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

const fail = (res, status, code, error) =>
  res.status(status).json({ ok: false, code, error });

// Marks matching results inside imagegenerations / videogenerations, for media
// that has no generatedmedias row. Returns "reported" | "already" | "missing".
const reportGenerationResult = async (ownerIds, link, reason) => {
  const match = linkMatcher(link);
  const report = { is_reported: true, report_reason: reason, reported_at: new Date() };
  const $set = Object.fromEntries(Object.entries(report).map(([k, v]) => [`results.$[item].${k}`, v]));
  const sources = [
    { model: ImageGeneration, fields: ["generatedImageUrl"] },
    { model: VideoGeneration, fields: ["url", "waterMarkUrl"] },
  ];
  for (const { model, fields } of sources) {
    for (const field of fields) {
      const owner = { userId: { $in: ownerIds } };
      if (await model.exists({ ...owner, results: { $elemMatch: { [field]: match, is_reported: true } } })) {
        return "already";
      }
      const found = await model.find({ ...owner, results: { $elemMatch: { [field]: match } } }).select("_id").lean();
      if (!found.length) continue;
      const result = await model.updateMany(
        { ...owner, results: { $elemMatch: { [field]: match } } },
        { $set },
        { arrayFilters: [{ [`item.${field}`]: match }] },
      );
      return result.matchedCount ? "reported" : "already";
    }
  }
  return "missing";
};

// POST /adsgpt/privacy/content-reports  { link, reason }
// Reports one of the user's generated images/videos by its link (a path or a
// full URL) and hides it from their lists straight away. `reason` is the
// user's own words. Admins see reports read-only.
const reportContent = async (req, res) => {
  try {
    const parsedLink = parseLink(req.body);
    if (parsedLink.error) return fail(res, 400, "INVALID_LINK", parsedLink.error);
    const { link } = parsedLink;
    const parsed = parseReason(req.body);
    if (parsed.error) return fail(res, 400, "INVALID_REASON", parsed.error);

    const ownerIds = ownerIdsFor(req.user?.user_id);
    if (!ownerIds.length) return fail(res, 404, "MEDIA_NOT_FOUND", "Generated media not found.");
    const filter = { userId: { $in: ownerIds }, ...mediaLinkFilter(link) };
    const media = await GeneratedMedia.find(filter).select("userId is_reported").lean();

    if (media.some((item) => ownsMedia(item, req.user?.user_id))) {
      if (media.some((item) => item.is_reported)) {
        return fail(res, 409, "ALREADY_REPORTED", "This item was already reported and is hidden.");
      }
      const result = await GeneratedMedia.updateMany(
        { ...filter, is_reported: { $ne: true } },
        { $set: { is_reported: true, report_reason: parsed.reason, reported_at: new Date() } },
      );
      if (!result.matchedCount) {
        return fail(res, 409, "ALREADY_REPORTED", "This item was already reported and is hidden.");
      }
      return res.json({ ok: true, link, reported: true });
    }

    // No generatedmedias row: report it on the generation record instead.
    const outcome = await reportGenerationResult(ownerIds, link, parsed.reason);
    if (outcome === "missing") return fail(res, 404, "MEDIA_NOT_FOUND", "Generated media not found.");
    if (outcome === "already") {
      return fail(res, 409, "ALREADY_REPORTED", "This item was already reported and is hidden.");
    }
    return res.json({ ok: true, link, reported: true });
  } catch (error) {
    logger.error("[reportContent] error:", error);
    return fail(res, 500, "INTERNAL_ERROR", "Failed to report content.");
  }
};

module.exports = {
  reportContent,
  // Shared with the media lists that hide reported links, and the tests.
  MAX_REASON,
  ownsMedia,
  parseReason,
  parseLink,
  mediaLinkFilter,
  toMediaPath,
  getReportedMediaLinks,
  isReportedLink,
  reportedLinkMatchers,
};
