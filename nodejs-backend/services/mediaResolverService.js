const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

/**
 * Image extension regex to reject static photo/image URLs immediately
 */
const IMAGE_URL_REGEX = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff|heic|ico)(\?.*)?$/i;

/**
 * Detect available Chrome/Chromium executable on Linux, Windows, or Docker
 */
function getExecutablePath() {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    process.env.CHROMIUM_PATH,
  ];

  for (const envPath of envPaths) {
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }
  }

  const commonPaths = [
    // Standard Linux paths (Ubuntu, Debian, CentOS, Staging/Production)
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome-unstable',
    '/usr/bin/google-chrome-beta',
    '/usr/lib/chromium/chromium',
    '/usr/bin/brave-browser',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    // Standard Windows paths
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return undefined; // Let Puppeteer use default bundled path if present
}

/**
 * Extract Instagram shortcode from various Instagram URL formats
 */
function getInstagramShortcode(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:reel|reels|p|tv|share\/reel|share\/p)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

/**
 * Clean URL and remove DASH chunk slice query parameters
 */
function cleanMediaUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\/g, '')
    .replace(/[?&]bytestart=\d+/gi, '')
    .replace(/[?&]byteend=\d+/gi, '');
}

/**
 * Fast-path HTTP metadata extractor for social platforms if Chrome is unavailable or to speed up resolution
 */
async function extractViaHttp(url) {
  try {
    const isInstagram = /(?:instagram\.com|instagr\.am)/i.test(url);
    const isFacebook = /(?:facebook\.com|fb\.watch)/i.test(url);
    const isTwitter = /(?:twitter\.com|x\.com)/i.test(url);
    const isTikTok = /tiktok\.com/i.test(url);
    const isPinterest = /pinterest\.com/i.test(url);
    const isLinkedIn = /(?:linkedin\.com|lnkd\.in)/i.test(url);

    const mobileHeaders = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Mode': 'navigate',
    };

    // 1. Twitter / X fast extraction
    if (isTwitter) {
      const tweetId = url.match(/status\/(\d+)/i)?.[1];
      if (tweetId) {
        try {
          const fxRes = await axios.get(`https://api.fxtwitter.com/status/${tweetId}`, { timeout: 3500 });
          const videos = fxRes.data?.tweet?.media?.videos || fxRes.data?.tweet?.media?.all?.filter((m) => m.type === 'video');
          if (videos && videos.length > 0 && videos[0].url) {
            return videos[0].url;
          }
        } catch (e) {}

        try {
          const vxRes = await axios.get(`https://api.vxtwitter.com/status/${tweetId}`, { timeout: 3500 });
          const media = vxRes.data?.media_extended?.find((m) => m.type === 'video' || m.url?.includes('.mp4'));
          if (media && media.url) {
            return media.url;
          }
          if (vxRes.data?.mediaURLs && vxRes.data.mediaURLs[0]?.includes('.mp4')) {
            return vxRes.data.mediaURLs[0];
          }
        } catch (e) {}
      }
    }

    // 2. Facebook fast HTTP extraction (handles share links, reels, watch, videos)
    if (isFacebook) {
      try {
        const res = await axios.get(url, {
          headers: mobileHeaders,
          maxRedirects: 10,
          timeout: 4000,
        });

        const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

        // Check OpenGraph video tag
        const ogVideoMatch =
          html.match(/property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
          html.match(/content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i);

        if (ogVideoMatch && ogVideoMatch[1] && ogVideoMatch[1].startsWith('http')) {
          const cleanUrl = ogVideoMatch[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
          return cleanUrl;
        }

        // Check embedded fbcdn MP4 streams
        const mp4Matches =
          html.match(/https?:\\\/\\\/[^"'\s\\]*fbcdn\.net[^"'\s\\]*\.mp4[^"'\s\\]*/gi) ||
          html.match(/https?:[^"'\s\\]*fbcdn\.net[^"'\s\\]*\.mp4[^"'\s\\]*/gi);

        if (mp4Matches && mp4Matches.length > 0) {
          const cleanUrl = mp4Matches[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
          return cleanUrl;
        }
      } catch (fbErr) {
        logger.warn(`[mediaResolverService] Facebook fast extraction notice: ${fbErr.message}`);
      }
    }

    // 3. Instagram fast HTTP extraction
    if (isInstagram) {
      const shortcode = getInstagramShortcode(url);
      if (shortcode) {
        const endpoints = [
          `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
          `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
        ];

        for (const embedUrl of endpoints) {
          try {
            const res = await axios.get(embedUrl, {
              headers: mobileHeaders,
              timeout: 3500,
            });

            const html = res.data;
            const mp4Matches =
              html.match(/https?:\\\/\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi) ||
              html.match(/https?:[^"'\s\\]+\.mp4[^"'\s\\]*/gi);

            if (mp4Matches && mp4Matches.length > 0) {
              return mp4Matches[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
            }
          } catch (e) {}
        }
      }
    }

    // 4. LinkedIn fast HTTP extraction with bot user agent & progressiveStreams parsing
    if (isLinkedIn) {
      const botUserAgents = [
        'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Twitterbot/1.0',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ];

      for (const ua of botUserAgents) {
        try {
          const res = await axios.get(url, {
            headers: {
              'User-Agent': ua,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            maxRedirects: 10,
            timeout: 3500,
          });

          const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

          // Check for progressiveStreams / streamingLocations JSON structure
          try {
            const progMatch = html.match(/"progressiveStreams"\s*:\s*(\[[^\]]+\])/i);
            if (progMatch && progMatch[1]) {
              const streams = JSON.parse(progMatch[1]);
              for (const s of streams) {
                if (s.streamingLocations && s.streamingLocations.length > 0) {
                  const loc = s.streamingLocations[0].url;
                  if (loc && loc.startsWith('http')) return loc;
                }
              }
            }
          } catch (e) {}

          // Check OpenGraph video meta
          const ogVideoMatch =
            html.match(/property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
            html.match(/content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i);

          if (ogVideoMatch && ogVideoMatch[1] && ogVideoMatch[1].startsWith('http')) {
            const cleanUrl = ogVideoMatch[1].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
            if (!cleanUrl.includes('placeholder')) return cleanUrl;
          }

          // Check licdn / dms.licdn.com mp4 streams
          const dmsMatch =
            html.match(/https?:\\\/\\\/[^"'\s\\]*licdn\.com\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/i) ||
            html.match(/https?:\/\/[^"'\s<>]*licdn\.com\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
          if (dmsMatch) {
            return dmsMatch[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
          }
        } catch (liErr) {}
      }
    }

    // 5. TikTok / Pinterest OpenGraph video tag extraction
    if (isTikTok || isPinterest) {
      try {
        const res = await axios.get(url, { headers: mobileHeaders, timeout: 3500 });
        const html = res.data;
        const ogVideoMatch =
          html.match(/<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:video(?::secure_url)?["']/i);

        if (ogVideoMatch && ogVideoMatch[1] && ogVideoMatch[1].startsWith('http')) {
          return ogVideoMatch[1].replace(/&amp;/g, '&');
        }

        const mp4Matches = html.match(/https?:\\\/\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi) || html.match(/https?:[^"'\s\\]+\.mp4[^"'\s\\]*/gi);
        if (mp4Matches && mp4Matches.length > 0) {
          return mp4Matches[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
        }
      } catch (e) {}
    }
  } catch (e) {
    logger.warn(`[mediaResolverService] HTTP fallback notice: ${e.message}`);
  }
  return null;
}

/**
 * Universal media stream resolver using stealth browser automation + HTTP fast-path
 * Supports: Instagram, Facebook, TikTok, Twitter/X, Pinterest, LinkedIn, Direct CDNs
 * @param {string} rawUrl - Target video URL
 * @returns {Promise<{ originalUrl: string, playableUrl: string, platform: string, isDirectStream: boolean }>}
 */
async function resolveMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid URL provided');
  }

  const trimmed = rawUrl.trim();

  // 1. Reject image/photo URLs immediately
  if (IMAGE_URL_REGEX.test(trimmed)) {
    throw new Error('Invalid video source. Please enter a video URL or select a video from Gallery.');
  }

  // 2. Direct video URL passthrough (.mp4, .webm, .mov, .m4v)
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(trimmed)) {
    return {
      originalUrl: trimmed,
      playableUrl: trimmed,
      platform: 'direct',
      isDirectStream: true,
    };
  }

  // Identify platform & target embed/player URL
  let platform = 'generic';
  let targetEmbedUrl = trimmed;

  if (/(?:instagram\.com|instagr\.am)/i.test(trimmed)) {
    platform = 'instagram';
    const shortcode = getInstagramShortcode(trimmed);
    targetEmbedUrl = shortcode
      ? `https://www.instagram.com/reel/${shortcode}/`
      : trimmed;
  } else if (/(?:facebook\.com|fb\.watch)/i.test(trimmed)) {
    platform = 'facebook';
    targetEmbedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(trimmed)}&show_text=false`;
  } else if (/tiktok\.com/i.test(trimmed)) {
    platform = 'tiktok';
    const match = trimmed.match(/video\/(\d+)/i);
    targetEmbedUrl = match ? `https://www.tiktok.com/embed/v2/${match[1]}` : trimmed;
  } else if (/(?:twitter\.com|x\.com)/i.test(trimmed)) {
    platform = 'twitter';
  } else if (/pinterest\.com/i.test(trimmed)) {
    platform = 'pinterest';
  } else if (/(?:linkedin\.com|lnkd\.in)/i.test(trimmed)) {
    platform = 'linkedin';
  }

  logger.info(`[mediaResolverService] Resolving ${platform} media for URL: ${trimmed}`);

  // 3. Try fast-path HTTP extraction first
  const fastHttpUrl = await extractViaHttp(trimmed);
  if (fastHttpUrl) {
    logger.info(`[mediaResolverService] Resolved ${platform} URL via HTTP fast-path`);
    return {
      originalUrl: trimmed,
      playableUrl: fastHttpUrl,
      platform,
      isDirectStream: true,
    };
  }

  // 4. Stealth browser resolution with dynamic page inspection & stream sniffing
  let browser = null;
  try {
    const execPath = getExecutablePath();
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--mute-audio',
      ],
    };

    if (execPath) {
      launchOptions.executablePath = execPath;
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    let videoUrl = null;

    // Intercept video stream network responses (.mp4, video/mp4, dms.licdn.com, etc.)
    page.on('response', async (response) => {
      try {
        const resUrl = response.url();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();

        const isVideoStream =
          (resUrl.includes('.mp4') ||
            contentType.includes('video/mp4') ||
            contentType.includes('video/webm') ||
            contentType.includes('application/x-mpegurl')) &&
          !resUrl.includes('.jpg') &&
          !resUrl.includes('.jpeg') &&
          !resUrl.includes('.png') &&
          !resUrl.includes('.webp') &&
          !resUrl.includes('dst-jpg') &&
          !resUrl.includes('cover_frame') &&
          !resUrl.includes('placeholder') &&
          !resUrl.includes('thumb');

        if (isVideoStream) {
          if (!videoUrl) {
            videoUrl = resUrl;
          }
        }

        // Check JSON/API/GraphQL responses containing embedded progressive stream URLs
        if (
          resUrl.includes('graphql') ||
          resUrl.includes('/api/') ||
          resUrl.includes('ajax') ||
          resUrl.includes('feed') ||
          resUrl.includes('voyager')
        ) {
          try {
            const text = await response.text();
            // 1. Check progressiveStreams
            const progMatch = text.match(/"progressiveStreams"\s*:\s*(\[[^\]]+\])/i);
            if (progMatch && progMatch[1]) {
              const streams = JSON.parse(progMatch[1]);
              for (const s of streams) {
                if (s.streamingLocations && s.streamingLocations.length > 0) {
                  const loc = s.streamingLocations[0].url;
                  if (loc && loc.startsWith('http') && !videoUrl) {
                    videoUrl = loc;
                    return;
                  }
                }
              }
            }

            // 2. Check general MP4 in JSON
            const matchMp4 =
              text.match(/https?:\\\/\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/i) ||
              text.match(/https?:[^"'\s\\]+\.mp4[^"'\s\\]*/i);
            if (matchMp4 && !videoUrl) {
              videoUrl = matchMp4[0]
                .replace(/&amp;/g, '&')
                .replace(/\\u0026/g, '&')
                .replace(/\\\//g, '/')
                .replace(/\\/g, '');
            }
          } catch (e) {}
        }
      } catch (e) {}
    });

    const pageTimeout = platform === 'linkedin' ? 6500 : 5000;
    try {
      await page.goto(targetEmbedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: pageTimeout,
      });
    } catch (navErr) {
      logger.warn(`[mediaResolverService] Navigation warning (${platform}): ${navErr.message}`);
    }

    // If stream not immediately captured, trigger play or wait briefly for initial packet
    if (!videoUrl) {
      try {
        await page.evaluate(() => {
          const v = document.querySelector('video');
          if (v && v.play) {
            v.play().catch(() => {});
          }
          const elements = Array.from(
            document.querySelectorAll(
              'button, a, video, div[role="button"], .EmbeddedMedia, [aria-label*="Play"], [aria-label*="play"]'
            )
          );
          for (const el of elements) {
            if (
              el.getAttribute('aria-label')?.toLowerCase().includes('play') ||
              el.className?.includes?.('Play')
            ) {
              try {
                el.click();
                return;
              } catch (e) {}
            }
          }
        });
      } catch (e) {}

      // Wait up to 1500ms for network response stream to land
      for (let i = 0; i < 6 && !videoUrl; i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    // Inspect DOM for <video data-sources="...">, <video src="...">, <code> blocks, and LD+JSON
    if (!videoUrl) {
      try {
        const domResult = await page.evaluate(() => {
          const isValidVideoUrl = (u) =>
            u &&
            typeof u === 'string' &&
            u.startsWith('http') &&
            !u.startsWith('blob:') &&
            !u.includes('.jpg') &&
            !u.includes('.jpeg') &&
            !u.includes('.png') &&
            !u.includes('.webp') &&
            !u.includes('dst-jpg') &&
            !u.includes('cover_frame') &&
            !u.includes('placeholder') &&
            !u.includes('thumb');

          // 1. Inspect video elements & data-sources attribute (standard LinkedIn/Instagram pattern)
          const videos = Array.from(document.querySelectorAll('video'));
          for (const v of videos) {
            const dataSources = v.getAttribute('data-sources');
            if (dataSources) {
              try {
                const parsed = JSON.parse(dataSources);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  const candidate = parsed.find((s) => s.src || s.url) || parsed[0];
                  const url = candidate?.src || candidate?.url;
                  if (isValidVideoUrl(url)) return url;
                }
              } catch (e) {}
            }
            if (isValidVideoUrl(v.src)) return v.src;
            if (isValidVideoUrl(v.currentSrc)) return v.currentSrc;
            const sourceEl = v.querySelector('source');
            if (sourceEl && isValidVideoUrl(sourceEl.src)) return sourceEl.src;
          }

          // 2. Inspect <code> tags containing JSON (LinkedIn server-rendered metadata)
          const codes = Array.from(document.querySelectorAll('code'));
          for (const c of codes) {
            const text = c.textContent || '';
            if (text.includes('progressiveStreams') || text.includes('streamingLocations') || text.includes('dms.licdn.com')) {
              const progMatch = text.match(/"progressiveStreams"\s*:\s*(\[[^\]]+\])/i);
              if (progMatch && progMatch[1]) {
                try {
                  const streams = JSON.parse(progMatch[1]);
                  for (const s of streams) {
                    if (s.streamingLocations && s.streamingLocations.length > 0) {
                      const loc = s.streamingLocations[0].url;
                      if (loc && loc.startsWith('http')) return loc;
                    }
                  }
                } catch (e) {}
              }
              const dmsMatch = text.match(/https?:\\\/\\\/[^"'\s\\]*licdn\.com\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/i) ||
                               text.match(/https?:\/\/[^"'\s<>]*licdn\.com\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
              if (dmsMatch) {
                return dmsMatch[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
              }
            }
          }

          // 3. Inspect OpenGraph meta tag from DOM
          const og = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
          if (og && og.content && og.content.startsWith('http') && !og.content.includes('placeholder')) {
            return og.content;
          }

          return null;
        });

        if (domResult) {
          videoUrl = domResult;
        }
      } catch (e) {}
    }

    if (videoUrl) {
      const cleanPlayableUrl = cleanMediaUrl(videoUrl);
      logger.info(`[mediaResolverService] Successfully resolved ${platform} video stream URL`);
      return {
        originalUrl: trimmed,
        playableUrl: cleanPlayableUrl,
        platform,
        isDirectStream: true,
      };
    }
  } catch (err) {
    logger.warn(`[mediaResolverService] Browser resolution notice (${platform}): ${err.message}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }

  // 5. If no video stream could be extracted from this URL, reject as invalid video source
  logger.warn(`[mediaResolverService] No playable video stream found for ${platform} URL: ${trimmed}`);
  throw new Error(`Invalid video source. No playable video found at this URL. Please provide a link to a video.`);
}

module.exports = {
  resolveMediaUrl,
  resolveInstagramVideoUrl: resolveMediaUrl, // Backward compatibility alias
};
