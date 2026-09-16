const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('../utils/logger');

puppeteer.use(StealthPlugin());

/**
 * Extract direct playable CDN .mp4 stream URL from an Instagram Reel/Post URL
 * @param {string} rawUrl - Full Instagram Reel/Post URL
 * @returns {Promise<{ originalUrl: string, playableUrl: string }>}
 */
async function resolveInstagramVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid Instagram URL provided');
  }

  const match = rawUrl.match(/(?:instagram\.com|instagr\.am)\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (!match || !match[1]) {
    throw new Error('Could not extract shortcode from Instagram URL');
  }

  const shortcode = match[1];
  logger.info(`[mediaResolverService] Resolving Instagram media for shortcode: ${shortcode}`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    let videoUrl = null;

    // Listen to network responses for video streams (.mp4 or video/mp4)
    page.on('response', async (response) => {
      try {
        const resUrl = response.url();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();

        if (resUrl.includes('.mp4') || contentType.includes('video/mp4')) {
          if (!videoUrl && !resUrl.includes('placeholder')) {
            videoUrl = resUrl;
          }
        }

        // Check API / GraphQL responses for video_url or video_versions
        if (resUrl.includes('graphql') || resUrl.includes('/api/v1/')) {
          try {
            const text = await response.text();
            const matchMp4 =
              text.match(/https?:\\\/\\\/[^"'\s\\]+\.mp4[^"'\s\\]*/i) ||
              text.match(/https?:[^"'\s\\]+\.mp4[^"'\s\\]*/i);
            if (matchMp4 && !videoUrl) {
              videoUrl = matchMp4[0]
                .replace(/\\u0026/g, '&')
                .replace(/\\\//g, '/')
                .replace(/\\/g, '');
            }
          } catch (e) {
            // ignore stream parse errors
          }
        }
      } catch (e) {
        // ignore response event errors
      }
    });

    // Navigate to embed page (gracefully catch frame detachment during client redirects)
    try {
      await page.goto(`https://www.instagram.com/reel/${shortcode}/embed/`, {
        waitUntil: 'networkidle2',
        timeout: 10000,
      });
    } catch (navErr) {
      logger.warn(`[mediaResolverService] Navigation notice: ${navErr.message}`);
    }

    // Check DOM if videoUrl wasn't already caught by response listener
    if (!videoUrl) {
      try {
        await page.waitForSelector('video', { timeout: 6000 });
        const domSrc = await page.$eval('video', (el) => el.src);
        if (domSrc && domSrc.startsWith('http')) {
          videoUrl = domSrc;
        }
      } catch (e) {
        // fallback check
      }
    }

    if (!videoUrl) {
      throw new Error('Video stream URL could not be resolved from Instagram');
    }

    logger.info(`[mediaResolverService] Successfully resolved Instagram video URL for ${shortcode}`);
    return {
      originalUrl: rawUrl.trim(),
      playableUrl: videoUrl,
    };
  } catch (err) {
    logger.error(`[mediaResolverService] Failed to resolve Instagram URL (${rawUrl}): ${err.message}`);
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // ignore close errors
      }
    }
  }
}

module.exports = {
  resolveInstagramVideoUrl,
};
