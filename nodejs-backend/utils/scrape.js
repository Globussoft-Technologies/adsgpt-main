const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("node:url");
const { generateJson, MODELS } = require("../services/ai/geminiClient");
const { redisClient: redis } = require("../db/redis");

// Use Gemini to analyze and extract structured data from text
async function analyzeContentWithGemini(mainText) {
  const prompt = `
    You are an AI that extracts structured insights from website content.
    Given the following text, return JSON with three fields:

    {
      "aiSummary": "A detailed overview of about 1000 characters describing the website/page in depth.",
      "aiTargetAudiences": ["list of target audiences"],
      "aiKeyFeatures": ["list of key features, offerings, or benefits"]
    }

    Text:
    ${mainText}
  `;

  // Unparseable output degrades to null insights (the scrape still returns);
  // a genuine API failure still propagates to the caller as it did before.
  try {
    const { json } = await generateJson({ model: MODELS.LITE, prompt });
    return json;
  } catch (e) {
    if (e.code !== "GEMINI_INVALID_JSON") throw e;
    console.error("⚠️ Could not parse JSON, raw output:", e.rawText);
    return null;
  }
}

// Convert relative URLs to absolute based on base URL
function toAbsolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

// Extract main text content from the page
function extractMainText($) {
  const textBlocks = [];

  $("h1, h2, h3, p, li").each((i, el) => {
    const txt = $(el).text().trim();
    if (txt && txt.length > 25) {
      textBlocks.push(txt);
    }
  });

  return textBlocks;
}

// URL validation
function isValidUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return u.href; // already valid
  } catch {
    // If invalid, assume https://
    return `https://${pageUrl}`;
  }
}

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/98.0",
  "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  // Add more from lists like https://developers.whatismybrowser.com/useragents/explore/
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

async function scrapePage(pageUrl) {
  pageUrl = normalizeUrl(pageUrl);

  // 1. Validate URL
  if (!isValidUrl(pageUrl)) {
    throw new Error("Invalid URL. Please provide a valid http/https link.");
  }

  // 2. Check cache first
  const cacheKey = `scraped:${pageUrl}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 3. Fetch page
  let res;
  try {
    res = await axios.get(pageUrl, {
      // Updated headers in Axios get:
      headers: {
        "User-Agent": getRandomUserAgent(), // From above
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
        Referer: "https://www.google.com",
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
  } catch (err) {
    throw new Error(`Failed to fetch URL: ${err.message}`);
  }

  const html = res.data;
  const $ = cheerio.load(html);

  // 4. Extract metadata
  const meta = {
    title: $("title").first().text() || null,
    description:
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      null,
    ogTitle: $('meta[property="og:title"]').attr("content") || null,
    ogImage: toAbsolute(
      $('meta[property="og:image"]').attr("content") || "",
      pageUrl
    ),
    favicon: toAbsolute(
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      "",
      pageUrl
    ),
  };

  // 5. Extract images
  const images = new Set();
  $("img").each((i, el) => {
    const src =
      $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy");
    const abs = toAbsolute(src, pageUrl);
    if (abs) images.add(abs);
  });

  // inside scrapePage, after collecting images:
  const validImages = Array.from(images).filter(
    (src) =>
      src &&
      !src.startsWith("data:image/svg+xml") && // remove placeholder SVGs
      (src.startsWith("http://") || src.startsWith("https://")) // keep only valid URLs
  );

  // 6. Extract videos
  const videos = new Set();
  $("video").each((i, el) => {
    const src = $(el).attr("src");
    if (src) videos.add(toAbsolute(src, pageUrl));
    $(el)
      .find("source")
      .each((j, s) => {
        const src2 = $(s).attr("src");
        if (src2) videos.add(toAbsolute(src2, pageUrl));
      });
  });

  // 7. Extract iframes
  const iframes = [];
  $("iframe").each((i, el) => {
    const src = $(el).attr("src");
    if (src) iframes.push(toAbsolute(src, pageUrl));
  });

  // 8. Extract icons
  const icons = new Set();
  $("link[rel]").each((i, el) => {
    const rel = ($(el).attr("rel") || "").toLowerCase();
    if (
      [
        "icon",
        "shortcut icon",
        "apple-touch-icon",
        "apple-touch-icon-precomposed",
      ].includes(rel)
    ) {
      const href = $(el).attr("href");
      const abs = toAbsolute(href, pageUrl);
      if (abs) icons.add(abs);
    }
  });

  // 9. Extract main text content
  const mainText = extractMainText($);

  // 10. Generate AI insights
  const aiInsights = mainText ? await analyzeContentWithGemini(mainText) : null;

  // 11. Extract social media links
  const socialDomains = [
    "facebook.com",
    "twitter.com",
    "linkedin.com",
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "pinterest.com",
    "snapchat.com",
  ];

  const socialLinks = new Set();

  $("a[href]").each((i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const abs = toAbsolute(href, pageUrl);
    if (!abs) return;

    for (const domain of socialDomains) {
      if (abs.includes(domain)) {
        socialLinks.add(abs);
        break;
      }
    }
  });

  const result = {
    url: pageUrl,
    meta,
    mainText,
    aiInsights,
    images: validImages,
    videos: Array.from(videos),
    iframes,
    icons: Array.from(icons),
    socialLinks: Array.from(socialLinks),
  };

  // 12. Cache result for 24 hours
  await redis.setex(cacheKey, 86400, JSON.stringify(result));

  return result;
}

async function scrapePage2(pageUrl) {
  try {
 
    pageUrl = normalizeUrl(pageUrl);

    const response = await axios.post(
      process.env.PYTHON_SCRAPER_BRANDIQ,
      { website_url: pageUrl },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const brandInfo = response?.data?.brandInfo || {};
    const objectives = response?.data?.objectives || {};

    const images = Array.isArray(brandInfo?.brandImages)
      ? brandInfo.brandImages
      : [];

    const brandLogo = Array.isArray(brandInfo?.brandLogo)
      ? brandInfo.brandLogo
      : [];

    const result = {
      url: pageUrl,
      meta: {
        title: brandInfo?.brandName || "",
        description: brandInfo?.brandDescription || "",
        ogTitle: brandInfo?.brandName || "",
        ogImage: "",
        favicon: "",
      },
      mainText: [],
      aiInsights: {
        aiSummary: brandInfo?.brandDescription || "",
        aiTargetAudiences:
          objectives?.targetAudience || [],
        aiKeyFeatures: [],
        // Industry category from the Python brand-iq scraper (one of the 45,
        // defaults to "General"). The BrandIQ form reads aiInsights.category
        // to prefill the Category dropdown.
        category: brandInfo?.category || "",
      },
      // Also expose at top level for convenience / other consumers.
      category: brandInfo?.category || "",
      brandLogo,
      images,
      videos: [],
      iframes: [],
      icons: [],
      socialLinks: [],
    };

    return result;
  } catch (error) {
    throw error;
  }
}

module.exports = { scrapePage, scrapePage2 };
