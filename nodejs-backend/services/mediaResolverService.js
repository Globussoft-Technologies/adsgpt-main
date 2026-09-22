const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Image extension regex to reject static photo/image URLs immediately
 */
const IMAGE_URL_REGEX = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff|heic|ico)(\?.*)?$/i;

/**
 * Follow redirects for shortened or wrapper URLs to determine the actual destination URL
 */
async function followRedirects(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();

  // Domains known to use short links or redirects
  const isShortUrl = /(?:lnkd\.in|fb\.watch|t\.co|bit\.ly|vt\.tiktok\.com|vm\.tiktok\.com|pin\.it|tinyurl\.com|shorturl\.at|goo\.gl|ow\.ly)/i.test(trimmed);

  if (!isShortUrl) {
    return trimmed;
  }

  try {
    const res = await axios.get(trimmed, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
      timeout: 5000,
      validateStatus: () => true,
    });

    const destination = res.request?.res?.responseUrl || res.config?.url;
    if (destination && destination.startsWith('http')) {
      logger.info(`[mediaResolverService] Followed redirect from ${trimmed} to ${destination}`);
      return destination;
    }
  } catch (err) {
    logger.warn(`[mediaResolverService] Redirect resolution notice for ${trimmed}: ${err.message}`);
  }

  return trimmed;
}

/**
 * Helper to construct direct platform embed URLs as resilient fallback if Iframely API key is missing or unavailable.
 * Strictly verifies the domain before matching platform-specific paths.
 */
function getFallbackPlatformEmbed(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // 1. TikTok Video (domain must match tiktok.com)
  if (/tiktok\.com/i.test(trimmed)) {
    const match = trimmed.match(/video\/(\d+)/i) || trimmed.match(/v\/(\d+)/i);
    if (match && match[1]) {
      const embedUrl = `https://www.tiktok.com/embed/v2/${match[1]}`;
      return {
        iframeUrl: embedUrl,
        embedHtml: `<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`,
        platform: 'TikTok',
      };
    }
  }

  // 4. LinkedIn Video / Activity / Post (domain must match linkedin.com or lnkd.in)
  if (/(?:linkedin\.com|lnkd\.in)/i.test(trimmed)) {
    const activityMatch =
      trimmed.match(/activity-([0-9]{15,25})/i) ||
      trimmed.match(/urn:li:(?:ugcPost|activity):([0-9]{15,25})/i) ||
      trimmed.match(/ugcPost-([0-9]{15,25})/i) ||
      trimmed.match(/posts\/[a-zA-Z0-9_-]+-([0-9]{15,25})/i) ||
      trimmed.match(/feed\/update\/urn:li:(?:activity|ugcPost):([0-9]{15,25})/i) ||
      trimmed.match(/([0-9]{17,21})/);

    if (activityMatch && activityMatch[1]) {
      const embedUrl = `https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:${activityMatch[1]}`;
      return {
        iframeUrl: embedUrl,
        embedHtml: `<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`,
        platform: 'LinkedIn',
      };
    }
  }

  // 5. Twitter / X Video (domain must match twitter.com or x.com)
  if (/(?:twitter\.com|x\.com)/i.test(trimmed)) {
    const tweetMatch = trimmed.match(/status\/(\d+)/i);
    if (tweetMatch && tweetMatch[1]) {
      const embedUrl = `https://platform.twitter.com/embed/Tweet.html?id=${tweetMatch[1]}`;
      return {
        iframeUrl: embedUrl,
        embedHtml: `<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`,
        platform: 'Twitter',
      };
    }
  }

  // 6. Vimeo (domain must match vimeo.com)
  if (/vimeo\.com/i.test(trimmed)) {
    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoMatch && vimeoMatch[1]) {
      const embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
      return {
        iframeUrl: embedUrl,
        embedHtml: `<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`,
        platform: 'Vimeo',
      };
    }
  }

  // 7. Pinterest (domain must match pinterest.com or pin.it)
  if (/(?:pinterest\.com|pin\.it)/i.test(trimmed)) {
    const pinMatch = trimmed.match(/pin\/(\d+)/i);
    if (pinMatch && pinMatch[1]) {
      const embedUrl = `https://assets.pinterest.com/ext/embed.html?id=${pinMatch[1]}`;
      return {
        iframeUrl: embedUrl,
        embedHtml: `<iframe src="${embedUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>`,
        platform: 'Pinterest',
      };
    }
  }

  return null;
}

/**
 * Universal media stream & embed resolver using Iframely with resilient embed fallback
 * Supports: Direct video files, YouTube, Instagram, Facebook, TikTok, X/Twitter, LinkedIn, Pinterest, Vimeo, and all Iframely-supported media
 * @param {string} rawUrl - Target video URL
 * @returns {Promise<{ originalUrl: string, playableUrl: string|null, embedHtml: string|null, iframeUrl: string|null, platform: string, isDirectStream: boolean, type: 'video'|'embed'|'youtube', meta: object }>}
 */
async function resolveMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid URL provided');
  }

  const originalTrimmed = rawUrl.trim();

  // 1. Reject image/photo URLs immediately
  if (IMAGE_URL_REGEX.test(originalTrimmed)) {
    throw new Error('Invalid video source. Please enter a video URL or select a video from Gallery.');
  }

  // 2. Direct video URL passthrough (.mp4, .webm, .mov, .m4v)
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(originalTrimmed)) {
    return {
      originalUrl: originalTrimmed,
      playableUrl: originalTrimmed,
      embedHtml: null,
      iframeUrl: null,
      platform: 'direct',
      isDirectStream: true,
      type: 'video',
      meta: {},
    };
  }

  // 3. YouTube link graceful handling
  if (/(?:youtube\.com|youtu\.be)/i.test(originalTrimmed)) {
    return {
      originalUrl: originalTrimmed,
      playableUrl: originalTrimmed,
      embedHtml: null,
      iframeUrl: null,
      platform: 'youtube',
      isDirectStream: false,
      type: 'youtube',
      meta: {},
    };
  }

  logger.info(`[mediaResolverService] Resolving media for URL: ${originalTrimmed}`);

  // 4. Resolve redirects to find actual destination URL (e.g. for lnkd.in, t.co, etc.)
  const targetUrl = await followRedirects(originalTrimmed);

  // 5. Query Iframely API if API key is present
  const apiKey = process.env.IFRAMELY_API_KEY || process.env.VITE_IFRAMELY_API_KEY || '';
  let iframelyData = null;

  if (apiKey) {
    const iframelyEndpoint = `https://iframe.ly/api/iframely?url=${encodeURIComponent(targetUrl)}&api_key=${apiKey}&iframe=1&omit_script=1`;

    try {
      const res = await axios.get(iframelyEndpoint, {
        timeout: 8000,
        headers: {
          'User-Agent': 'AdsGPTMediaResolver/1.0',
          Accept: 'application/json',
        },
        validateStatus: (status) => status < 500,
      });

      if (res.status === 200 && res.data && !res.data.error) {
        iframelyData = res.data;
      } else if (res.data?.error) {
        logger.warn(`[mediaResolverService] Iframely API error: ${res.data.error}`);
      }
    } catch (err) {
      logger.warn(`[mediaResolverService] Iframely /api/iframely request notice: ${err.message}`);
    }

    // Fallback to oEmbed endpoint if /api/iframely did not succeed
    if (!iframelyData) {
      try {
        const oembedEndpoint = `https://iframe.ly/api/oembed?url=${encodeURIComponent(targetUrl)}&api_key=${apiKey}&iframe=1&omit_script=1`;

        const oembedRes = await axios.get(oembedEndpoint, {
          timeout: 6000,
          headers: {
            'User-Agent': 'AdsGPTMediaResolver/1.0',
            Accept: 'application/json',
          },
          validateStatus: (status) => status < 500,
        });

        if (oembedRes.status === 200 && oembedRes.data && !oembedRes.data.error) {
          iframelyData = oembedRes.data;
        }
      } catch (oembedErr) {
        logger.warn(`[mediaResolverService] Iframely /api/oembed request notice: ${oembedErr.message}`);
      }
    }
  }

  // 6. If Iframely returned valid data, inspect playable stream vs embed
  if (iframelyData) {
    const links = Array.isArray(iframelyData.links) ? iframelyData.links : [];
    const meta = iframelyData.meta || {};
    const platformName = meta.site || meta.site_name || iframelyData.provider_name || 'external';

    // Check for direct playable video stream in links
    const directVideoLink = links.find((link) => {
      if (!link || !link.href) return false;
      const typeStr = (link.type || '').toLowerCase();
      const hrefStr = link.href.toLowerCase();

      const isVideoMime =
        typeStr.startsWith('video/') ||
        typeStr === 'application/x-mpegurl' ||
        typeStr === 'application/vnd.apple.mpegurl';

      const hasVideoExt = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(hrefStr);
      const isNotHtml = typeStr !== 'text/html' && !hrefStr.includes('/embed/') && !hrefStr.includes('iframe.ly/api/iframe');

      return (isVideoMime || hasVideoExt) && isNotHtml;
    });

    if (directVideoLink && directVideoLink.href) {
      logger.info(`[mediaResolverService] Resolved direct playable video stream for URL: ${originalTrimmed}`);
      return {
        originalUrl: originalTrimmed,
        playableUrl: directVideoLink.href,
        embedHtml: null,
        iframeUrl: null,
        platform: platformName,
        isDirectStream: true,
        type: 'video',
        meta: {
          title: meta.title || iframelyData.title || '',
          duration: directVideoLink.media?.duration || meta.duration || null,
          aspectRatio: directVideoLink.media?.['aspect-ratio'] || meta.aspect_ratio || null,
        },
      };
    }

    // Check for embed / player / HTML representation
    const playerLink = links.find((link) => {
      if (!link) return false;
      const rels = Array.isArray(link.rel) ? link.rel : [];
      const isPlayerRel = rels.includes('player') || rels.includes('app') || rels.includes('iframely');
      const isHtmlPlayer = link.type === 'text/html' && Boolean(link.href);
      return isPlayerRel || isHtmlPlayer;
    });

    let iframeUrl = playerLink?.href || null;
    if (!iframeUrl && iframelyData.html) {
      const match = iframelyData.html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (match) iframeUrl = match[1];
    }

    const embedHtml =
      iframelyData.html ||
      playerLink?.html ||
      (iframeUrl ? `<iframe src="${iframeUrl}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen frameborder="0"></iframe>` : null);

    if (iframeUrl || embedHtml) {
      logger.info(`[mediaResolverService] Resolved embed/preview via Iframely for URL: ${originalTrimmed}`);
      return {
        originalUrl: originalTrimmed,
        playableUrl: null,
        embedHtml: embedHtml || null,
        iframeUrl: iframeUrl || null,
        platform: platformName,
        isDirectStream: false,
        type: 'embed',
        meta: {
          title: meta.title || iframelyData.title || '',
          duration: playerLink?.media?.duration || meta.duration || null,
          aspectRatio: playerLink?.media?.['aspect-ratio'] || iframelyData.media?.['aspect-ratio'] || null,
        },
      };
    }
  }

  // 7. Resilient platform embed fallback based on destination and original URL
  const platformFallback = getFallbackPlatformEmbed(targetUrl) || getFallbackPlatformEmbed(originalTrimmed);
  if (platformFallback) {
    logger.info(`[mediaResolverService] Resolved platform embed preview for URL: ${originalTrimmed} -> ${platformFallback.platform}`);
    return {
      originalUrl: originalTrimmed,
      playableUrl: null,
      embedHtml: platformFallback.embedHtml,
      iframeUrl: platformFallback.iframeUrl,
      platform: platformFallback.platform,
      isDirectStream: false,
      type: 'embed',
      meta: {},
    };
  }

  // 8. If neither playable stream nor valid embed is available
  logger.warn(`[mediaResolverService] No usable stream or embed found for URL: ${originalTrimmed}`);
  throw new Error("Unable to preview this video. We couldn't load a preview for this video. Please try another URL or upload the video directly.");
}

module.exports = {
  resolveMediaUrl,
};
