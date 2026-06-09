const { GoogleGenerativeAI } = require('@google/generative-ai');
const brandNameLists = require('../Module/brandNames/brandNamesSchema');
const { buildCompetitorDiscoveryPrompt, KEYWORD_VERSION } = require('../AI/Prompts/competitorDiscoveryPrompt');
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Structured output schema for Gemini ─────────────────────────────────

const responseSchema = {
  type: 'object',
  properties: {
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          relevanceScore: { type: 'number' },
        },
        required: ['name'],
      },
    },
    keywords: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          category: { type: 'string' },
          volume: { type: 'string' },
        },
        required: ['term'],
      },
    },
  },
  required: ['competitors', 'keywords'],
};

// ── Async enrichment (fire-and-forget) ──────────────────────────────────

async function runDiscoveryJob(userId, brandId) {
  let user;
  let brand;

  try {
    user = await brandNameLists.findOne({ user_id: userId });
    if (!user) {
      // console.log(`[runDiscoveryJob] User not found: ${userId}`);
      return;
    }
    brand = user.brands.find(b => b.id === brandId);
    if (!brand) {
      // console.log(`[runDiscoveryJob] Brand not found: ${brandId}`);
      return;
    }

    // Idempotency guard: if already READY, skip
    if (brand.discoveryJob?.status === 'READY') {
      // console.log(`[runDiscoveryJob] Already READY for brand ${brandId}, skipping.`);
      return;
    }

    brand.discoveryJob = {
      status: 'PENDING',
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      keywordVersion: KEYWORD_VERSION,
    };
    await user.save();

    // console.log(`[runDiscoveryJob] Started for brand ${brandId}`);

    // ── 1. Gemini keyword generation ───────────────────────────────────
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.3,
      },
    });

    const prompt = buildCompetitorDiscoveryPrompt({
      brandName: brand.brandName,
      brandDescription: brand.brandDescription,
      websiteUrl: brand.websiteUrl,
      region: brand.region,
    });

    const llmResult = await model.generateContent(prompt);
    const rawText = llmResult?.response?.text?.() || '';

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new Error(`Gemini JSON parse failed: ${err.message}. Raw: ${rawText.substring(0, 200)}`);
    }

    const competitors = (parsed?.competitors || [])
      .filter(c => c.name && typeof c.name === 'string')
      .slice(0, 25)
      .map(c => ({
        name: c.name.trim(),
        domain: c.domain || null,
        relevanceScore: typeof c.relevanceScore === 'number' ? c.relevanceScore : 0,
        source: 'gemini',
        addedAt: new Date(),
      }));

    let keywords = (parsed?.keywords || [])
      .filter(k => k.term && typeof k.term === 'string')
      .slice(0,25)
      .map(k => ({
        term: k.term.trim(),
        category: ['brand', 'product', 'general', 'intent'].includes(k.category) ? k.category : 'general',
        volume: ['high', 'medium', 'low'].includes(k.volume) ? k.volume : null,
        source: 'gemini',
        addedAt: new Date(),
      }));

    // Fallback: if Gemini returns empty keywords, fall back to brand name
    if (keywords.length === 0) {
      keywords.push({
        term: brand.brandName,
        category: 'brand',
        volume: null,
        source: 'fallback',
        addedAt: new Date(),
      });
    }

    brand.competitors = competitors;
    brand.keywords = keywords;

    // console.log(`[runDiscoveryJob] Brand ${brandId}: ${competitors.length} competitors, ${keywords.length} keywords`);

    // ── 2. Test PAS connectivity (optional validation) ─────────────────
    // We no longer cache ads in MongoDB; they are fetched on-demand from ES.
    // Just verify the brand has competitors/keywords for discovery.
    // console.log(`[runDiscoveryJob] Brand ${brandId}: ${competitors.length} competitors, ${keywords.length} keywords generated`);

    brand.lastFetchedAt = new Date();
    brand.discoveryJob = {
      status: 'READY',
      startedAt: brand.discoveryJob.startedAt,
      completedAt: new Date(),
      errorMessage: null,
      keywordVersion: KEYWORD_VERSION,
    };
    await user.save();

    // console.log(`[runDiscoveryJob] SUCCESS for brand ${brandId}: discovery data ready`);
  } catch (err) {
    // console.error(`[runDiscoveryJob] FAILED for brand ${brandId}:`, err.message);
    try {
      if (!user) user = await brandNameLists.findOne({ user_id: userId });
      if (user) {
        const b = user.brands.find(x => x.id === brandId);
        if (b) {
          b.discoveryJob = {
            status: 'FAILED',
            startedAt: b.discoveryJob?.startedAt || new Date(),
            completedAt: new Date(),
            errorMessage: err.message,
            keywordVersion: KEYWORD_VERSION,
          };
          await user.save();
        }
      }
    } catch (e) {
      // console.error(`[runDiscoveryJob] Failed to save error state for brand ${brandId}:`, e.message);
    }
  }
}

// ── PAS / ElasticSearch proxy ───────────────────────────────────────────

async function fetchAdsFromPas(keywords, competitors = [], authHeader = null) {
  const keywordTerms = keywords.map(k => k.term);
  const competitorNames = competitors.map(c => c.name).filter(Boolean);
  
  // Merge competitors + keywords, remove duplicates
  const allSearchTerms = [...new Set([...competitorNames, ...keywordTerms])];
  
  if (allSearchTerms.length === 0) return [];

  const url = `${process.env.NODE_ADS_BACKEND_URL}/ads/search`;

  // console.log(`[fetchAdsFromPas] Calling: ${url}`);
  // console.log(`[fetchAdsFromPas] Keywords: ${allSearchTerms.length}, Competitors: ${competitorNames.length}`);
  // console.log(`[fetchAdsFromPas] API Key present: ${!!process.env.NODE_ADS_API_KEY}`);

  try {
    const response = await axios.post(
      url,
      {
        keywords: allSearchTerms,
        competitors: competitorNames,  // Send separately for ES boosting
        platform: 'all',               // Search ALL platforms (fb, insta, yt, google)
        page: 1,
        limit: 500,
        sortBy: 'date',
        sortOrder: 'desc',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader && { Authorization: authHeader }),
        },
        timeout: 30000,
      }
    );

    const data = response.data?.data || [];

    // Map PAS response shape to our schema
    return data.map(ad => ({
      adId: ad.ad_id || ad.adId,
      platform: ad.platform,
      advertiserName: ad.advertiser_name || ad.advertiserName || null,
      advertiserDomain: ad.advertiser_domain || ad.advertiserDomain || null,
      thumbnailUrl: ad.thumbnail_url || ad.thumbnailUrl || ad.creativeUrl || null,
      creativeUrl: ad.creative_url || ad.creativeUrl || null,
      adTitle: ad.ad_title || ad.adTitle || null,
      adDescription: ad.ad_description || ad.adDescription || null,
      category: ad.category || null,
      subCategory: ad.subCategory || ad.sub_category || null,
      categoryId: ad.categoryId ? String(ad.categoryId) : (ad.category_id ? String(ad.category_id) : null),
      subCategoryId: ad.subCategoryId ? String(ad.subCategoryId) : (ad.sub_category_id ? String(ad.sub_category_id) : null),
      firstSeen: ad.first_seen || ad.firstSeen || ad.date_seen || null,
      lastSeen: ad.last_seen || ad.lastSeen || null,
      matchedKeywords: ad.matched_keywords || ad.matchedKeywords || [],
      esScore: ad._score || ad.esScore || null,
      fetchedAt: new Date(),
    }));
  } catch (err) {
    console.error(`[fetchAdsFromPas] ERROR: ${err.message}`);
    if (err.response) {
      console.error(`[fetchAdsFromPas] Response status: ${err.response.status}`);
      console.error(`[fetchAdsFromPas] Response data: ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      console.error(`[fetchAdsFromPas] No response received. Request failed. URL: ${url}`);
    }
    return []; // Return empty on failure so brand doesn't get stuck
  }
}

// ── Read API: GET competitor ads ────────────────────────────────────────

async function getCompetitorAds(req, res) {
  try {
    const { brandId } = req.params;
    const {
      platform,
      category,
      categoryId,
      subCategoryId,
      dateFrom,
      dateTo,
      sort = 'newest',
    } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, parseInt(req.query.pageSize, 10) || 24);

    const userId = req.query.userId || req.user?.id;

    if (!userId || !brandId) {
      return res.status(400).json({ message: 'userId and brandId are required' });
    }

    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const brand = user.brands.find(b => b.id === brandId);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    const job = brand.discoveryJob || {};

    // If still processing, return early
    if (job.status === 'PENDING') {
      return res.status(202).json({
        brandId,
        status: 'PENDING',
        message: 'Competitor discovery is still in progress.',
      });
    }

    // If failed, surface error state
    if (job.status === 'FAILED') {
      return res.status(200).json({
        brandId,
        status: 'FAILED',
        message: job.errorMessage || 'Discovery failed. Please try again.',
        lastFetchedAt: brand.lastFetchedAt,
      });
    }

    // ── Fetch ads on-demand from PAS (ElasticSearch) ───────────────────
    const keywords = brand.keywords || [];
    const competitors = brand.competitors || [];
    // Fetch ads from PAS (ElasticSearch)

    // Auto-trigger discovery if no data exists yet
    if (keywords.length === 0 && competitors.length === 0) {
      if (job.status !== 'PENDING') {
        brand.discoveryJob = {
          status: 'PENDING',
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
          keywordVersion: KEYWORD_VERSION,
        };
        await user.save();
        // Fire-and-forget discovery job
        runDiscoveryJob(userId, brandId);
      }
      return res.status(202).json({
        brandId,
        status: 'PENDING',
        message: 'Competitor discovery is in progress.',
      });
    }

    let ads = await fetchAdsFromPas(keywords, competitors, req.headers.authorization);
    // console.log('[getCompetitorAds] brandId:', brandId, 'total fetched ads:', ads.length, 'platform:', platform, 'dateFrom:', dateFrom, 'dateTo:', dateTo);

    if (platform) {
      let platforms;
      if (Array.isArray(platform)) {
        platforms = platform;
      } else if (typeof platform === 'string' && platform.includes(',')) {
        platforms = platform.split(',');
      } else {
        platforms = [platform];
      }
      ads = ads.filter(ad => platforms.includes(ad.platform));
      // console.log('[getCompetitorAds] after platform filter:', ads.length, 'platforms:', platforms);
    }

    if (category) {
      const categories = Array.isArray(category) ? category : [category];
      ads = ads.filter(ad => categories.includes(ad.category));
    }

    if (categoryId) {
      const catIds = (Array.isArray(categoryId) ? categoryId : categoryId.split(',')).map(String);
      ads = ads.filter(ad => catIds.includes(String(ad.categoryId)));
    }

    if (subCategoryId) {
      const subIds = (Array.isArray(subCategoryId) ? subCategoryId : subCategoryId.split(',')).map(String);
      ads = ads.filter(ad => subIds.includes(String(ad.subCategoryId)));
    }

    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;
      ads = ads.filter(ad => {
        const d = ad.firstSeen ? new Date(ad.firstSeen) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    // Sort
    if (sort === 'newest') {
      ads.sort((a, b) => new Date(b.firstSeen || 0) - new Date(a.firstSeen || 0));
    } else if (sort === 'oldest') {
      ads.sort((a, b) => new Date(a.firstSeen || 0) - new Date(b.firstSeen || 0));
    }

    const totalCount = ads.length;
    const start = (page - 1) * pageSize;
    const paginated = ads.slice(start, start + pageSize);

    // Build dynamic filter options from the FULL unfiltered set
    const allPlatforms = [...new Set(ads.map(a => a.platform).filter(Boolean))];

    // Build category tree from ads that have category data
    const categoryMap = new Map();
    for (const ad of ads) {
      if (!ad.categoryId || !ad.category) continue;
      if (!categoryMap.has(ad.categoryId)) {
        categoryMap.set(ad.categoryId, {
          id: ad.categoryId,
          name: ad.category,
          subcategories: new Map(),
        });
      }
      const cat = categoryMap.get(ad.categoryId);
      if (ad.subCategoryId && ad.subCategory && !cat.subcategories.has(ad.subCategoryId)) {
        cat.subcategories.set(ad.subCategoryId, {
          id: ad.subCategoryId,
          name: ad.subCategory,
        });
      }
    }
    const categoryTree = Array.from(categoryMap.values()).map(c => ({
      ...c,
      subcategories: Array.from(c.subcategories.values()),
    }));

    const responsePayload = {
      brandId,
      status: totalCount > 0 ? 'READY' : 'EMPTY',
      lastFetchedAt: brand.lastFetchedAt,
      page: Number(page),
      pageSize: Number(pageSize),
      totalCount,
      filtersAvailable: {
        platforms: allPlatforms,
        categories: categoryTree,
      },
      ads: paginated,
    };
    // Response payload ready
    return res.status(200).json(responsePayload);
  } catch (err) {
    // console.error('getCompetitorAds error:', err);
    return res.status(500).json({ message: err.message || 'Failed to fetch competitor ads' });
  }
}

// ── Refresh API: re-run discovery ───────────────────────────────────────

async function refreshCompetitorAds(req, res) {
  try {
    const { brandId } = req.params;
    const userId = req.body.userId || req.user?.id;

    if (!userId || !brandId) {
      return res.status(400).json({ message: 'userId and brandId are required' });
    }

    const user = await brandNameLists.findOne({ user_id: userId });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const brand = user.brands.find(b => b.id === brandId);
    if (!brand) return res.status(404).json({ message: 'Brand not found' });

    // Reset and re-trigger
    brand.discoveryJob = {
      status: 'PENDING',
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      keywordVersion: KEYWORD_VERSION,
    };
    await user.save();

    // Fire-and-forget
    runDiscoveryJob(userId, brandId);

    return res.status(202).json({
      brandId,
      status: 'PENDING',
      message: 'Discovery refresh started.',
    });
  } catch (err) {
    // console.error('refreshCompetitorAds error:', err);
    return res.status(500).json({ message: err.message || 'Failed to refresh' });
  }
}

module.exports = {
  runDiscoveryJob,
  getCompetitorAds,
  refreshCompetitorAds,
  fetchAdsFromPas,
};
