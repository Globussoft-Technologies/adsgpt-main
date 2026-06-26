const axios = require("axios");
const { GOOGLE_CTA_LABELS } = require("../config/googleCtaConfig");

const IMAGE_ASSET_FIELD_TYPES =
  "'MARKETING_IMAGE', 'SQUARE_MARKETING_IMAGE', 'PORTRAIT_MARKETING_IMAGE', 'LOGO', 'LANDSCAPE_LOGO', 'COMPANION_BANNER'";

/** Smaller field set used when the full ads GAQL query is rejected by Google. */
const MINIMAL_AD_SELECT_FIELDS = `
  ad_group_ad.ad.id,
  ad_group_ad.ad.name,
  ad_group_ad.ad.type,
  ad_group_ad.status,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.ad.responsive_search_ad.descriptions,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.responsive_display_ad.long_headline,
  ad_group_ad.ad.responsive_display_ad.call_to_action_text,
  ad_group_ad.ad.image_ad.image_url,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.policy_summary.review_status,
  ad_group.id,
  ad_group.name,
  campaign.id,
  campaign.name
`;

const STANDARD_AD_SELECT_FIELDS = `
  ad_group_ad.ad.id,
  ad_group_ad.ad.name,
  ad_group_ad.ad.type,
  ad_group_ad.status,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.tracking_url_template,
  ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.ad.responsive_search_ad.descriptions,
  ad_group_ad.ad.responsive_search_ad.path1,
  ad_group_ad.ad.responsive_search_ad.path2,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.responsive_display_ad.long_headline,
  ad_group_ad.ad.responsive_display_ad.business_name,
  ad_group_ad.ad.responsive_display_ad.call_to_action_text,
  ad_group_ad.ad.responsive_display_ad.marketing_images,
  ad_group_ad.ad.responsive_display_ad.square_marketing_images,
  ad_group_ad.ad.responsive_display_ad.logo_images,
  ad_group_ad.ad.responsive_display_ad.square_logo_images,
  ad_group_ad.ad.image_ad.image_url,
  ad_group_ad.ad.image_ad.name,
  ad_group_ad.ad.video_responsive_ad.headlines,
  ad_group_ad.ad.video_responsive_ad.descriptions,
  ad_group_ad.ad.video_responsive_ad.videos,
  ad_group_ad.ad.video_responsive_ad.companion_banners,
  ad_group_ad.ad.video_responsive_ad.call_to_actions,
  ad_group_ad.ad.demand_gen_video_responsive_ad.headlines,
  ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions,
  ad_group_ad.ad.demand_gen_video_responsive_ad.videos,
  ad_group_ad.ad.demand_gen_video_responsive_ad.business_name,
  ad_group_ad.ad.demand_gen_video_responsive_ad.logo_images,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.policy_summary.review_status,
  ad_group.id,
  ad_group.name,
  campaign.id,
  campaign.name
`;

function flattenTextAsset(item) {
  if (item == null) return "";
  if (typeof item === "string") return item;
  return item?.text != null ? String(item.text) : "";
}

function getImageAssetUrl(asset) {
  const imgData = asset?.imageAsset || asset?.image_asset;
  return imgData?.fullSize?.url || imgData?.full_size?.url || null;
}

function extractAssetResourceName(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.asset || entry.resourceName || entry.resource_name || null;
}

function formatCtaLabel(val) {
  if (!val) return null;
  const key = String(val).toUpperCase().replace(/ /g, "_");
  return GOOGLE_CTA_LABELS[key] || String(val);
}

function extractYoutubeVideoId(videos) {
  const list = videos || [];
  return (
    list[0]?.asset?.youtubeVideoAsset?.youtubeVideoId
    || list[0]?.asset?.youtube_video_asset?.youtube_video_id
    || null
  );
}

function collectEmbeddedAssetRefs(standardResults) {
  const refs = new Set();
  for (const r of standardResults) {
    const ad = (r.adGroupAd || r.ad_group_ad)?.ad || {};
    const rda = ad.responsiveDisplayAd || ad.responsive_display_ad || {};
    const vra = ad.videoResponsiveAd || ad.video_responsive_ad || {};
    const dga = ad.demandGenVideoResponsiveAd || ad.demand_gen_video_responsive_ad || {};
    const imageLists = [
      rda.marketingImages, rda.marketing_images,
      rda.squareMarketingImages, rda.square_marketing_images,
      rda.logoImages, rda.logo_images,
      rda.squareLogoImages, rda.square_logo_images,
      vra.companionBanners, vra.companion_banners,
      dga.logoImages, dga.logo_images,
      vra.videos, dga.videos,
    ];
    for (const arr of imageLists) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const ref = extractAssetResourceName(item);
        if (ref) refs.add(ref);
      }
    }
  }
  return [...refs];
}

function lookupAssetUrl(ref, assetUrlMap) {
  if (!ref || !assetUrlMap) return null;
  if (assetUrlMap[ref]) return assetUrlMap[ref];
  const idMatch = String(ref).match(/assets\/(\d+)/);
  return idMatch ? assetUrlMap[idMatch[1]] || null : null;
}

function resolveEmbeddedImageUrl(rda, vra, dga, assetUrlMap) {
  const imageLists = [
    rda.marketingImages, rda.marketing_images,
    rda.squareMarketingImages, rda.square_marketing_images,
    rda.logoImages, rda.logo_images,
    rda.squareLogoImages, rda.square_logo_images,
    vra.companionBanners, vra.companion_banners,
    dga.logoImages, dga.logo_images,
  ];
  for (const arr of imageLists) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const url = lookupAssetUrl(extractAssetResourceName(item), assetUrlMap);
      if (url) return url;
    }
  }
  return null;
}

function extractCallToAction(rda, vra, dga) {
  const rdaText = rda.callToActionText || rda.call_to_action_text;
  if (rdaText) return rdaText;

  const vraCtas = vra.callToActions || vra.call_to_actions || [];
  const firstVraCta = vraCtas[0];
  if (firstVraCta) {
    const text = firstVraCta.text || firstVraCta.callToActionText || firstVraCta.call_to_action_text;
    if (text) return text;
    const action = firstVraCta.action || firstVraCta.callToActionType || firstVraCta.call_to_action_type;
    if (action) return formatCtaLabel(action);
  }

  const dgaCtas = dga.callToActions || dga.call_to_actions || [];
  const firstDgaCta = dgaCtas[0];
  if (firstDgaCta) {
    const asset = firstDgaCta.asset || firstDgaCta.callToActionAsset || firstDgaCta.call_to_action_asset;
    const action = asset?.callToActionType || asset?.call_to_action_type;
    if (action) return formatCtaLabel(action);
  }

  return null;
}

function buildAdImageMapFromAssetResults(imageAssetResults) {
  const adImageMap = {};
  imageAssetResults.forEach((r) => {
    const adId = String((r.adGroupAd || r.ad_group_ad)?.ad?.id || "");
    const url = getImageAssetUrl(r.asset || {});
    if (adId && url && !adImageMap[adId]) adImageMap[adId] = url;
  });
  return adImageMap;
}

async function fetchGoogleAssetUrlMap(tid, headers, assetRefs) {
  const map = {};
  if (!assetRefs?.length) return map;

  const ids = [...new Set(
    assetRefs
      .map((ref) => String(ref).match(/assets\/(\d+)/)?.[1])
      .filter(Boolean),
  )];
  if (!ids.length) return map;

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const resp = await axios.post(
      `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`,
      {
        query: `
          SELECT
            asset.resource_name,
            asset.image_asset.full_size.url,
            asset.youtube_video_asset.youtube_video_id
          FROM asset
          WHERE asset.id IN (${chunk.join(",")})
        `,
      },
      { headers },
    ).catch(() => ({ data: [] }));

    const results = resp.data?.[0]?.results || [];
    results.forEach((r) => {
      const asset = r.asset || {};
      const resourceName = asset.resourceName || asset.resource_name;
      const imageUrl = getImageAssetUrl(asset);
      const ytId = asset.youtubeVideoAsset?.youtubeVideoId
        || asset.youtube_video_asset?.youtube_video_id;
      const idMatch = resourceName && String(resourceName).match(/assets\/(\d+)/);
      if (ytId) {
        const videoUrl = `https://www.youtube.com/watch?v=${ytId}`;
        const thumbUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
        if (resourceName) {
          map[`video:${resourceName}`] = videoUrl;
          map[resourceName] = thumbUrl;
        }
        if (idMatch) {
          map[`video:${idMatch[1]}`] = videoUrl;
          map[idMatch[1]] = thumbUrl;
        }
      } else if (imageUrl) {
        if (resourceName) map[resourceName] = imageUrl;
        if (idMatch) map[idMatch[1]] = imageUrl;
      }
    });
  }

  return map;
}

function mapGoogleStandardAdRow(r, { adImageMap = {}, assetUrlMap = {}, formatStatus }) {
  const aga = r.adGroupAd || r.ad_group_ad || {};
  const ad = aga.ad || {};
  const ag = r.adGroup || r.ad_group || {};
  const camp = r.campaign || {};
  const adType = ad.type || "";

  const rsa = ad.responsiveSearchAd || ad.responsive_search_ad || {};
  const rda = ad.responsiveDisplayAd || ad.responsive_display_ad || {};
  const vra = ad.videoResponsiveAd || ad.video_responsive_ad || {};
  const dga = ad.demandGenVideoResponsiveAd || ad.demand_gen_video_responsive_ad || {};
  const imageAd = ad.imageAd || ad.image_ad || {};
  const policySummary = aga.policySummary || aga.policy_summary || {};

  let headlines = [];
  let descriptions = [];
  if (adType === "RESPONSIVE_SEARCH_AD") {
    headlines = (rsa.headlines || []).map(flattenTextAsset).filter(Boolean);
    descriptions = (rsa.descriptions || []).map(flattenTextAsset).filter(Boolean);
  } else if (adType === "RESPONSIVE_DISPLAY_AD") {
    headlines = (rda.headlines || []).map(flattenTextAsset).filter(Boolean);
    descriptions = (rda.descriptions || []).map(flattenTextAsset).filter(Boolean);
  } else if (adType === "VIDEO_RESPONSIVE_AD" || adType === "DEMAND_GEN_VIDEO_RESPONSIVE_AD") {
    const source = adType === "DEMAND_GEN_VIDEO_RESPONSIVE_AD" ? dga : vra;
    headlines = (source.headlines || []).map(flattenTextAsset).filter(Boolean);
    descriptions = (source.descriptions || []).map(flattenTextAsset).filter(Boolean);
  }

  const finalUrls = ad.finalUrls || ad.final_urls || [];
  const adid = String(ad.id || "");
  const embeddedImageUrl = resolveEmbeddedImageUrl(rda, vra, dga, assetUrlMap);
  const imageUrl = imageAd.imageUrl || imageAd.image_url || adImageMap[adid] || embeddedImageUrl || null;

  const videoSource = adType === "DEMAND_GEN_VIDEO_RESPONSIVE_AD" ? dga.videos : vra.videos;
  const ytId = extractYoutubeVideoId(videoSource);
  let videoUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : null;
  let videoThumbnail = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : null;
  // If inline asset data wasn't present, resolve from the pre-fetched asset map
  if (!videoUrl && Array.isArray(videoSource)) {
    for (const item of videoSource) {
      const ref = extractAssetResourceName(item);
      if (!ref) continue;
      const resolved = assetUrlMap[`video:${ref}`]
        || (ref.match(/assets\/(\d+)/) ? assetUrlMap[`video:${ref.match(/assets\/(\d+)/)[1]}`] : null);
      if (resolved) {
        videoUrl = resolved;
        const idFromUrl = String(resolved).match(/[?&]v=([^&]+)/)?.[1];
        videoThumbnail = idFromUrl ? `https://i.ytimg.com/vi/${idFromUrl}/hqdefault.jpg` : null;
        break;
      }
    }
  }

  const longHeadlineSource = adType === "DEMAND_GEN_VIDEO_RESPONSIVE_AD" ? dga : rda;

  return {
    id: adid,
    adId: adid,
    name: ad.name || "",
    type: adType,
    status: formatStatus(aga.status),
    approvalStatus: (() => {
      const raw = policySummary.approvalStatus || policySummary.approval_status || null;
      if (raw && raw !== 'UNKNOWN' && raw !== 'UNSPECIFIED') return raw;
      // Derive from reviewStatus when approvalStatus is absent
      const rv = policySummary.reviewStatus || policySummary.review_status || null;
      if (rv === 'UNDER_REVIEW' || rv === 'REVIEW_IN_PROGRESS') return 'UNDER_REVIEW';
      // Default: enabled ad with no policy issues = APPROVED
      const st = String(aga.status || '').toUpperCase();
      if (st === 'ENABLED') return 'APPROVED';
      if (st === 'PAUSED') return null; // let status field drive Paused badge
      return raw;
    })(),
    reviewStatus: policySummary.reviewStatus || policySummary.review_status || null,
    headline: headlines[0] || "",
    headlines,
    description: descriptions[0] || "",
    descriptions,
    longHeadline: flattenTextAsset(longHeadlineSource.longHeadline || longHeadlineSource.long_headline) || null,
    businessName: flattenTextAsset(rda.businessName || rda.business_name || dga.businessName || dga.business_name) || null,
    callToAction: extractCallToAction(rda, vra, dga),
    path1: rsa.path1 || null,
    path2: rsa.path2 || null,
    finalUrl: finalUrls[0] || "",
    finalUrls,
    trackingUrlTemplate: ad.trackingUrlTemplate || ad.tracking_url_template || null,
    imageUrl: imageUrl || videoThumbnail,
    videoUrl,
    previewUrl: imageUrl || videoThumbnail,
    adGroupId: String(ag.id || ""),
    adGroupName: ag.name || "",
    campaignId: String(camp.id || ""),
    campaignName: camp.name || "",
    createdAt: aga.creationTime || aga.creation_time || null,
  };
}

function buildImageAssetGaql(whereClause) {
  return `
    SELECT
      ad_group_ad.ad.id,
      asset.id,
      asset.image_asset.full_size.url,
      asset.image_asset.mime_type,
      ad_group_ad_asset.field_type
    FROM ad_group_ad_asset
    WHERE ${whereClause}
      AND ad_group_ad_asset.field_type IN (${IMAGE_ASSET_FIELD_TYPES})
  `;
}

function gaqlErrorMessage(err) {
  return err?.response?.data?.[0]?.error?.message
    || err?.response?.data?.error?.message
    || JSON.stringify(err?.response?.data)
    || err?.message
    || "unknown";
}

async function fetchStandardAdResults(tid, headers, whereClause, { onError } = {}) {
  const url = `https://googleads.googleapis.com/v23/customers/${tid}/googleAds:searchStream`;
  const run = async (fields) => {
    const resp = await axios.post(url, {
      query: `SELECT ${fields} FROM ad_group_ad WHERE ${whereClause} AND ad_group_ad.status != 'REMOVED'`,
    }, { headers });
    return Array.isArray(resp.data) ? resp.data.flatMap(batch => batch?.results || []) : [];
  };

  try {
    return await run(STANDARD_AD_SELECT_FIELDS);
  } catch (err) {
    onError?.(`full GAQL failed, retrying minimal fields: ${gaqlErrorMessage(err)}`);
    try {
      return await run(MINIMAL_AD_SELECT_FIELDS);
    } catch (fallbackErr) {
      onError?.(`minimal GAQL failed: ${gaqlErrorMessage(fallbackErr)}`);
      return [];
    }
  }
}

module.exports = {
  IMAGE_ASSET_FIELD_TYPES,
  MINIMAL_AD_SELECT_FIELDS,
  STANDARD_AD_SELECT_FIELDS,
  fetchStandardAdResults,
  buildAdImageMapFromAssetResults,
  buildImageAssetGaql,
  collectEmbeddedAssetRefs,
  fetchGoogleAssetUrlMap,
  mapGoogleStandardAdRow,
  formatCtaLabel,
  flattenTextAsset,
};
