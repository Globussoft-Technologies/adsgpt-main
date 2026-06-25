require("dotenv").config();
const axios = require('axios');
const sharp = require('sharp');

exports.adsDataPayloadFormat = (uid, chatId, sessionId, data, token, socket_id) => {
  return {
    uid,
    chatId,
    sessionId,
    adsData: data || [],
    token,
    socket_id
  };
};

exports.formattedResponse = (
  uid,
  chatId,
  sessionId,
  statusName,
  status,
  data,
  end,
  start
) => {
  return [
    {
      uid,
      chatId,
      sessionId,
      [statusName]: status,
      timestamp: formatDateTime(),
    },
    data || {},
    { time_taken_in_secs: (end - start) / 1000 },
  ];
};

function formatDateTime() {
  const date = new Date();

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

const processOtherMedia = (otherMedia) => {
  if (otherMedia) {
    if (Array.isArray(otherMedia)) {
      return otherMedia;
    }
    if (typeof otherMedia === "string") {
      return [otherMedia];
    }
  }

  return [];
};

exports.processAdsAdata = async (esData, networks = []) => {
  try {
    const processedResults = await Promise.all(
      esData.map(async (ad) => {
        const onPlan = networks.includes(ad?.network);
        const isImageAd = ad?.adType === 'image';

        let mediaUrlf = "";
        let ifBlank = false;

        if (isImageAd) {
          mediaUrlf =
            ad?.mediaUrl?.startsWith("pasimages")
              ? `${process.env.MEDIA_URL}${ad?.mediaUrl}`
              : ad?.mediaUrl?.startsWith("https")
                ? ad?.mediaUrl
                : "";

          // ifBlank = await checkIfBlankImage(mediaUrlf);
          // if (ifBlank) return null; // Skip if image is blank
        }

        return {
          id: ad?.id || "",
          network: ad?.network || "",
          postOwner: ad?.postOwner || "",
          postOwnerImage: ad?.postOwnerImage ? `${process.env.MEDIA_URL}${ad?.postOwnerImage}` : "",
          postImage:
            onPlan ? `${process.env.MEDIA_URL}${ad?.mediaUrl}` : "",
          description: onPlan ? (ad?.adText || "") : "",
          newsfeedDescription: onPlan ? (ad?.newsfeedDescription || "") : "",
          adUrl: onPlan ? (ad?.adUrl || "") : "",
          category: onPlan ? (ad?.category || "") : "",
          adTitle: onPlan ? (ad?.adTitle?.toUpperCase() || "") : "",
          adType: onPlan ? (ad?.adType?.toUpperCase() || "") : "",
          open_in_pas: onPlan
            ? `${process.env.PAS_REDIRECT_URL}${ad?.network}/getAdDetails/${ad?.id}`
            : "",
          popularityIndex: onPlan ? (ad?.popularity || "") : "",
          othermedia: onPlan ? processOtherMedia(ad?.othermedia) : [],
          lastSeen: onPlan ? (ad?.lastSeen || "") : "",
          onPlan,
          thumbnail_url: ad?.thumbnail || ad?.thumbnails || ""
        };
      })
    );

    // Filter out null/undefined/empty objects
    return processedResults.filter(ad => ad && Object.keys(ad).length > 0);
  } catch (error) {
    console.error("Error processing ads data:", error);
    return [];
  }
};


const stripNasPrefix = (url) => {
  if (!url) return url;
  return url.replace(/^\/?PowerAdspy\/n\d+/i, "");
};

exports.processExploreAdsAdata = (esData) => {
  try {
    const results = Promise.all(esData.map(async (ad) => {
      if (!ad?.mediaUrl || ad?.mediaUrl.includes('pas')) return null;
      const transformMediaUrl = (url) => {
        if (!url) return "";
        if (url.startsWith("pasimages")) return `${process.env.MEDIA_URL}${url}`;
        if (url.startsWith("https")) return url;
        if (url.startsWith("/Power") || url.startsWith("Power")) return `${process.env.MEDIA_UR_NEW_NAS}${stripNasPrefix(url)}`;
        return "";
      };

      const rawMediaUrl = (url) => {
        if (!url) return "";
        if (url.startsWith("pasimages")) return url;
        if (url.startsWith("https")) return url;
        if (url.startsWith("/Power") || url.startsWith("Power")) return stripNasPrefix(url);
        return "";
      };

      let mediaUrlf = transformMediaUrl(ad?.mediaUrl);
      // let ifBlank = await checkIfBlankImage(mediaUrlf);
      let ifBlank = false

      if (!ifBlank) {
        let data = {
          id: ad?.id || "",
          network: ad?.network || "",
          postOwner: ad?.postOwner || "",
          postOwnerImage: transformMediaUrl(ad?.postOwnerImage),
          postImage: transformMediaUrl(ad?.mediaUrl),
          description: ad?.adText || "",
          newsfeedDescription: ad?.newsfeedDescription || "",
          adUrl: ad?.adUrl || "",
          adTitle: ad?.adTitle || "",
          adType: ad?.adType?.toUpperCase() || "",
          popularityIndex: ad?.popularity || "",
          lastSeen: ad?.lastSeen || "",
          type: ad?.type || "",
          otherMedia: Array.isArray(ad?.othermedia)
            ? ad.othermedia.map(media => rawMediaUrl(media))
            : []
        };
        return data;
      }
    }));
    return results;
  } catch (error) {
    // console.log(error);
  }
}



exports.processExploreAdsAdataPAS = async (esData, network) => {
  try {
     // console.log(esData);
    const mediaUrlBase = process.env.MEDIA_URL;
    const newNasMediaUrlBase = process.env.MEDIA_UR_NEW_NAS

    const results = await Promise.all(
      esData.map(async (ad) => {
        if (!ad?.image_video_url || ad?.image_video_url.includes('pas')) return null;

        const rawMediaUrls = ad.image_video_url.includes("||")
          ? ad.image_video_url.split("||").map((url) => url.trim()).filter(Boolean)
          : [ad.image_video_url];

        const processedMediaUrls = await Promise.all(
          rawMediaUrls.map(async (mediaUrl) => {
            if (!mediaUrl) return null;

            const formattedUrl = mediaUrl.startsWith("pasimages") || mediaUrl.startsWith("getMedia") || mediaUrl.startsWith("/PowerAdspy")
              ? mediaUrl.startsWith("/PowerAdspy")
                ? `${newNasMediaUrlBase}${stripNasPrefix(mediaUrl)}`
                : `${mediaUrlBase}${mediaUrl}`
              : `${mediaUrlBase}${mediaUrl}`;

            // if (await checkIfBlankImage(formattedUrl)) return null;

            const otherMediaUrl = mediaUrl.startsWith("/PowerAdspy") && !mediaUrl.includes("getMedia")
              ? stripNasPrefix(mediaUrl)
              : mediaUrl;

            return { raw: otherMediaUrl, formatted: formattedUrl };
          })
        );

        const validMediaUrls = processedMediaUrls.filter((item) => item?.formatted);
        if (!validMediaUrls.length) return null;

        let parsedMedia = ad?.ad_image_video || [];
        if (typeof parsedMedia === "string") {
          try {
            parsedMedia = JSON.parse(parsedMedia);
          } catch {
            parsedMedia = [];
          }
        }

        const filteredMedia = Array.isArray(parsedMedia)
          ? parsedMedia
              .filter((item) => item != null && item !== "")
              .map((media) => (media.startsWith("/PowerAdspy") && !media.includes("getMedia") ? stripNasPrefix(media) : media))
          : [];

        const otherMedia = rawMediaUrls.length > 1
          ? [...validMediaUrls.map((item) => item.raw), ...filteredMedia]
          : filteredMedia;

        if (Array.isArray(otherMedia) && otherMedia.length > 0 && otherMedia.some(media => media?.includes("pas"))) return null;

        return {
          id: ad?.id || "",
          network: network || "",
          postOwner: ad?.post_owner || "",
          postOwnerImage: ad?.post_owner_image
            ? ad.post_owner_image.startsWith("pasimages")
              ? `${mediaUrlBase}${ad.post_owner_image}`
              : ad.post_owner_image.includes("/Default")
                ? ad.post_owner_image
                : `${newNasMediaUrlBase}${stripNasPrefix(ad.post_owner_image)}`
            : "",
          postImage: validMediaUrls[0]?.formatted || "",
          description: ad?.ad_text || "",
          newsfeedDescription: ad?.news_feed_description || "",
          adUrl: ad?.ad_url || "",
          adTitle: ad?.ad_title || "",
          adType: otherMedia.length > 0 || filteredMedia.length > 0 ? "CAROUSAL_AD" : "IMAGE",
          popularityIndex: 0,
          lastSeen: ad?.lastSeen || "",
          type: ad?.type || "",
          otherMedia,
          popularity: ad?.popularity ?? 0, 
          impression: ad?.impression ?? 0
        };
      })
    );
    return results.filter(Boolean);
  } catch (error) {
    console.error("Error processing ads:", error);
    return [];
  }
};


// Transform the poweradspy unified /api/v1/common/ads/search `data[]` into the
// same camelCase shape the explore-ads clients already consume. Unlike
// processExploreAdsAdataPAS, the unified endpoint returns already-resolved full
// URLs (https://media.globussoft.com/pas-dev/...), so we must NOT re-prefix them
// or drop on `.includes('pas')` — we just keep rows that have a usable http image.
exports.processCommonAdsData = (data = [], network) => {
  try {
    if (!Array.isArray(data)) return [];

    return data
      .map((ad) => {
        const mediaUrls =
          typeof ad?.image_video_url === "string" && ad.image_video_url.includes("||")
            ? ad.image_video_url.split("||").map((u) => u.trim()).filter(Boolean)
            : ad?.image_video_url
            ? [ad.image_video_url]
            : [];

        const postImage = mediaUrls[0] || "";
        // Cards render <img>; drop rows without a usable image URL.
        if (!postImage || !postImage.startsWith("http")) return null;

        let extraMedia = ad?.ad_image_video;
        if (typeof extraMedia === "string") {
          try {
            extraMedia = JSON.parse(extraMedia);
          } catch {
            extraMedia = [];
          }
        }

        const otherMedia = [
          ...mediaUrls.slice(1),
          ...(Array.isArray(extraMedia) ? extraMedia.filter(Boolean) : []),
        ];

        return {
          id: ad?.id ?? ad?.ad_id ?? "",
          // Label by the requested network (one network per request). Needed for
          // gdn: Google Display ads come back as network:"youtube"
          // (ad_origin:"youtube_display"), but the user searched Google Display.
          network: network || ad?.network || "",
          postOwner: ad?.post_owner || "",
          postOwnerImage: ad?.post_owner_image || "",
          postImage,
          description: ad?.ad_text || "",
          newsfeedDescription: ad?.news_feed_description || "",
          adUrl: ad?.ad_url || "",
          adTitle: ad?.ad_title || "",
          adType: otherMedia.length > 0 ? "CAROUSAL_AD" : ad?.type || "IMAGE",
          popularityIndex: 0,
          lastSeen: ad?.last_seen || "",
          type: ad?.type || "",
          otherMedia,
          popularity: ad?.popularity ?? 0,
          impression: ad?.impression ?? 0,
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Error processing common ads:", error);
    return [];
  }
};


async function checkIfBlankImage(imageUrl, thresholdPercentage = 0.005) {
  try {

    const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    const metadata = await sharp(imageBuffer).metadata();
    let imageProcessor = sharp(imageBuffer).grayscale();
    if (metadata.width > 1000 || metadata.height > 1000) {
      imageProcessor = imageProcessor.resize(500);
    }
    const grayBuffer = await imageProcessor.toBuffer();
    const grayImage = await sharp(grayBuffer).raw().toBuffer();
    const nonWhitePixels = grayImage.filter(pixel => pixel < 250).length; 
    const totalPixels = metadata.width * metadata.height;
    const dynamicThreshold = thresholdPercentage * totalPixels;
    return (nonWhitePixels > dynamicThreshold && nonWhitePixels > 4 )? false : true;
  } catch (error) {
    return true;
  }
}