/**
 * waitForVideoThumbnail — poll Meta's `/{video_id}/thumbnails` edge until
 * the encoder produces a poster image (or we hit a sensible timeout).
 *
 * Why this exists: Meta needs `image_url` (or `image_hash`) on every
 * video_data block (subcode 1443226 / "Your ad needs a video thumbnail").
 * The /act_X/advideos upload returns immediately and Meta encodes the
 * video asynchronously; thumbnails arrive AFTER encoding completes.
 * Small clips usually finish in <6s, but anything longer or the API
 * being slow pushes us past whatever the calling code waited for.
 *
 * `uploadVideoFromUrl()` already polls for ~6s waiting for `status=ready`,
 * but Meta sometimes marks the video ready before the thumbnail list is
 * populated. This helper is the second-chance, called by both the wizard
 * (metaAdLauncherV2.buildAdCreativeOr400) and the Ad Factory
 * (adControllerV2.createAdV2) right before creative assembly.
 *
 * 8 attempts × 3000ms = 24s ceiling. Returns the preferred thumbnail
 * URI (or the first available), or null if nothing showed up in time.
 * Caller decides what to do with null (the wizard surfaces a clean 400
 * with retry-after copy; the Ad Factory lets Meta's own rejection
 * propagate so the user sees the real error).
 */

const bizSdk = require("facebook-nodejs-business-sdk");

async function waitForVideoThumbnail(videoId, opts = {}) {
  if (!videoId) return null;
  const { maxAttempts = 8, delayMs = 3000 } = opts;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const api = bizSdk.FacebookAdsApi.getDefaultApi();
      const r = await api.call("GET", [videoId, "thumbnails"], {
        fields: "uri,is_preferred",
      });
      const thumbs = r?.data || r?._data?.data || [];
      const preferred = thumbs.find((t) => t.is_preferred) || thumbs[0];
      if (preferred?.uri) return preferred.uri;
    } catch (_) {
      /* Meta sometimes 500s mid-encoding — swallow and retry. The caller
         surfaces a clean error if all attempts fail. */
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

module.exports = { waitForVideoThumbnail };
