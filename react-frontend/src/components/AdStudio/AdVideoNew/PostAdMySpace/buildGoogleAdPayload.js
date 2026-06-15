// Builds the request body for `postGoogleAd(adAccountId, payload)`.
// Pure function. Branches the `ads[0]` shape on the media's `isVideo`
// flag — DISPLAY (image) and DEMAND_GEN (video) need different fields.
// SEARCH ads aren't reachable from MySpace (no asset fits), so we
// don't model them here.
//
// Note: `adAccountId` is intentionally NOT included in the returned
// body — the caller passes it as a URL path segment to postGoogleAd.
export default function buildGoogleAdPayload({ selection, media, form }) {
  const isVideo = Boolean(media?.isVideo);

  const ad = isVideo
    ? {
        // DEMAND_GEN (video). Backend accepts videoUrl (direct MP4 —
        // auto-uploads to YouTube) OR youtubeVideoId (already on YT).
        // headline is REQUIRED per the create-ads spec (max 30 chars).
        // longHeadline / description / callToAction stay optional and
        // are only included when the user filled them in.
        videoUrl: media.url,
        finalUrl: form.linkUrl,
        headline: form.headline,
        ...(form.longHeadline ? { longHeadline: form.longHeadline } : {}),
        ...(form.description ? { description: form.description } : {}),
        ...(form.callToAction ? { callToAction: form.callToAction } : {}),
      }
    : {
        // DISPLAY (image). All four are required by the API.
        headline: form.headline,
        description: form.description,
        imageUrl: media.url,
        finalUrl: form.linkUrl,
        // CTA is optional for DISPLAY — only send when picked.
        ...(form.callToAction ? { callToAction: form.callToAction } : {}),
      };

  return {
    adAccountId: selection.adAccountId,
    adGroupId: selection.adGroupId,
    campaignId: selection.campaignId,
    ads: [ad],
  };
}
