// loaderClient — the blurred "something is coming" GIF shown while a clip renders.
//
// Standalone by design, and unlike anything else in this folder: no job, no
// session, no webhook, no SSE. One POST, one 201 with a link, ten minutes of
// life. Nothing here needs recovering, because there is nothing durable to
// recover — if the link expires or the call fails, the UI shows its own
// placeholder and the render is unaffected.
//
// ── Why Node builds it rather than the browser ──────────────────────────────
// The loader endpoint takes `image_urls` and FETCHES them server-side. That is
// a fetch-on-behalf primitive, and the contract says so: an SSRF guard blocks
// private ranges, but a caller should still never be able to choose the
// addresses. So the browser sends a `boardId` and nothing else, and the URLs
// come from the keyframes WE stored for that board. A client cannot point this
// at anything it was not already allowed to see.

const axios = require("axios");
const OnboardingSession = require("../../Module/onboarding/onboardingSession");
const { absolutise } = require("./mediaUrls");
const { createFlowLog } = require("../../utils/flowLog");

// Blur, resize and encode of up to a dozen images, answered inline. Measured
// well under two seconds for the two keyframes we send.
const CREATE_TIMEOUT_MS = 20_000;

// The clip is 9:16 and the loader stands in for it in the same box, so any
// other ratio would letterbox at the swap. `duration_s` is the full
// there-and-back loop; a slow drift reads as "working", a fast one as a glitch.
const LOADER_DEFAULTS = Object.freeze({
  preset: "standard",
  aspect_ratio: "9:16",
  resolution: "360p",
  duration_s: 3,
});

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * The public links for one board's keyframes.
 *
 * `absolutise` prefers the durable media store over Python's own 24h copy,
 * which is what we want here for a second reason beyond permanence: the loader
 * service has to reach these itself, and the CDN is the address least likely to
 * be firewalled from wherever it runs.
 */
function keyframeUrls(board) {
  return (board?.images || [])
    .filter((img) => img?.status === "ready")
    .map((img) => absolutise(img).src)
    .filter((src) => /^https?:\/\//i.test(src))
    // The contract's ceiling is 12; a storyboard has two. The slice is here so
    // a future board with more frames cannot turn into a 400.
    .slice(0, 12);
}

/**
 * Builds a loader GIF for one board.
 *
 * Returns `{ ok: true, loader }` where `loader.url` is absolute and ready for
 * an `<img src>`, or `{ ok: false, reason }`. Never throws: this is decoration
 * for a screen that must keep working without it.
 */
async function buildBoardLoader({ userId, sessionId, boardId }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return { ok: false, reason: "not_configured" };
  if (!userId || !sessionId || !boardId) return { ok: false, reason: "bad_request" };

  const log = createFlowLog("loader", { session: sessionId, user: userId });

  const session = await OnboardingSession.findOne({ sessionId, userId })
    .select("storyboards.result")
    .lean();
  if (!session) return { ok: false, reason: "not_found" };

  // `id` on a storyboard; `board_id` is what the video and image payloads call
  // it when they refer back. See the same note in `videoClient`.
  const board = (session.storyboards?.result?.storyboards || []).find((b) => b?.id === boardId);
  if (!board) return { ok: false, reason: "unknown_board" };

  const imageUrls = keyframeUrls(board);
  // A board whose keyframes never rendered has nothing to blur. Not an error —
  // the caller falls back to its own shimmer, which is what it shows for the
  // first stretch anyway.
  if (!imageUrls.length) return { ok: false, reason: "no_images" };

  try {
    log.ds("out", "loader");

    const { data } = await axios.post(
      `${baseUrl}/api/v1/loaders/`,
      { ...LOADER_DEFAULTS, image_urls: imageUrls },
      { headers: { "Content-Type": "application/json" }, timeout: CREATE_TIMEOUT_MS }
    );

    const raw = data?.url;
    if (!raw) return { ok: false, reason: "upstream_error" };

    // Root-relative unless the deployment sets a link base. Prepending blindly
    // would produce a doubled origin on the deployments that already send an
    // absolute one.
    const url = /^https?:\/\//i.test(raw) ? raw : `${baseUrl}${raw.startsWith("/") ? "" : "/"}${raw}`;

    // The link is logged too. It dies in ten minutes, so this is the only
    // record that a loader was ever served for a given render — and "did the
    // GIF actually build?" is otherwise unanswerable after the fact.
    log.info("built", { board: boardId, frames: data.frame_count, bytes: data.bytes, url });

    return {
      ok: true,
      loader: {
        url,
        // The client stops using the link at this moment rather than waiting to
        // be handed a 410 — a broken image in the middle of a render reads as
        // the render itself having broken.
        expiresAt: data.expires_at || null,
        width: data.width,
        height: data.height,
        durationS: data.duration_s,
      },
    };
  } catch (error) {
    const status = error?.response?.status;
    log.warn("build.failed", {
      status,
      board: boardId,
      // 422 names every unusable image; worth having in the log, since the
      // cause is our own stored keyframes rather than anything the user did.
      message: error?.response?.data?.error || error.message,
    });
    return { ok: false, reason: status === 501 ? "not_configured" : "upstream_error" };
  }
}

module.exports = { buildBoardLoader, _internals: { keyframeUrls, LOADER_DEFAULTS } };
