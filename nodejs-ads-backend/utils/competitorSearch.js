require('dotenv').config();
const clients = require('../DB/connectCompetitor');
const logger = require('../controllers/Loggers/logs');

// ── Platform-specific ES configs (senior: use different variables) ──────

const PLATFORM_CONFIGS = {
  facebook: {
    index: process.env.COMPETITOR_INDEX_FB || 'search_mix',
    adIdField: 'facebook_ad.id',
    postOwner: 'facebook_ad_post_owners.post_owner_name',
    postOwnerImage: 'facebook_ad_post_owners.post_owner_image',
    adTitle: 'facebook_ad_variants.title',
    adText: 'facebook_ad_variants.text',
    newsfeedDescription: 'facebook_ad_variants.newsfeed_description',
    firstSeen: 'facebook_ad.post_date',
    lastSeen: 'facebook_ad.last_seen',
    adType: 'facebook_ad.type',
    adUrl: 'facebook_ad_meta_data.destination_url',
    imageUrl: 'new_nas_image_url',
    fallbackImage: 'facebook_ad_variants.image_url_original',
    imageExistsFields: ['new_nas_image_url', 'facebook_ad_variants.image_url_original'],
    validImageFields: ['new_nas_image_url'],
    popularity: 'facebook_ad.popularity.current',
    categoryName: 'facebook.category',
    subCategoryName: 'facebook.subCategory',
    categoryId: 'category_id',
    subCategoryId: 'subCategory_id',
  },
  instagram: {
    index: process.env.COMPETITOR_INDEX_IG || 'instagram_search_mix',
    adIdField: 'instagram_ad.id',
    postOwner: 'instagram_ad_post_owners.post_owner_name',
    postOwnerImage: 'instagram_ad_post_owners.post_owner_image',
    adTitle: 'instagram_ad_variants.title',
    adText: 'instagram_ad_variants.text',
    newsfeedDescription: 'instagram_ad_variants.newsfeed_description',
    firstSeen: 'instagram_ad.post_date',
    lastSeen: 'instagram_ad.last_seen',
    adType: 'instagram_ad.type',
    adUrl: 'instagram_ad_meta_data.destination_url',
    imageUrl: 'thumbnail',
    fallbackImage: 'image_url_original',
    videoUrl: 'image_url_original',
    imageExistsFields: ['thumbnail', 'instagram_ad_variants.image_url_original'],
    validImageFields: ['thumbnail'],
    popularity: 'instagram_ad.popularity.current',
    categoryName: 'instagram.category',
    subCategoryName: 'instagram.subCategory',
    categoryId: 'category_id',
    subCategoryId: 'subCategory_id',
  },
  youtube: {
    index: process.env.COMPETITOR_INDEX_YT || 'youtube_ads_data',
    adIdField: 'ad_id',
    postOwner: 'post_owner',
    postOwnerImage: 'post_owner_image',
    adTitle: 'ad_title',
    adText: 'ad_text',
    newsfeedDescription: 'newsfeed_description',
    firstSeen: 'first_seen',
    lastSeen: 'last_seen',
    adType: 'ad_type',
    adUrl: 'destination_url',
    imageUrl: 'thumbnail_url',
    fallbackImage: 'ad_image_or_video',
    videoUrl: 'nas_video_url',
    imageExistsFields: ['thumbnail_url', 'ad_image_or_video', 'new_nas_image_url'],
    validImageFields: ['thumbnail_url', 'new_nas_image_url'],
    popularity: 'popularity.current',
    categoryName: 'category',
    subCategoryName: 'subCategory',
    categoryId: 'category_id',
    subCategoryId: 'subCategory_id',
  },
  google: {
    index: process.env.COMPETITOR_INDEX_GG || 'google_ads_data',
    adIdField: 'id',
    postOwner: 'post_owner_name',
    postOwnerIsKeyword: true,
    postOwnerImage: 'post_owner_image',
    adTitle: 'title',
    adText: 'text',
    newsfeedDescription: 'newsfeed_description',
    firstSeen: 'first_seen',
    lastSeen: 'last_seen',
    adType: 'type',
    adUrl: 'destination_url',
    imageUrl: 'image_url',
    fallbackImage: 'new_nas_image_url',
    imageExistsFields: ['image_url', 'new_nas_image_url'],
    validImageFields: ['image_url', 'new_nas_image_url'],
    popularity: null,
    categoryName: 'category',
    subCategoryName: 'subCategory',
    categoryId: 'category_id',
    subCategoryId: 'subCategory_id',
  }
};

// ── Nested getter helper ────────────────────────────────────────────────

function getNested(obj, path, fallback = null) {
  if (!obj || !path) return fallback;
  // Try exact key first (ES uses flat dot-notation field names)
  if (obj[path] !== undefined) return obj[path];
  // Fallback to nested path
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined) ? acc[key] : fallback, obj);
}

// ── Media URL transformer ───────────────────────────────────────────────
// NAS paths like /pas-dev/stream/... need base URL prefix
// FB/IG CDN URLs often get blocked, so prefer NAS paths

function isValidMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.length < 10) return false;
  if (trimmed === 'null' || trimmed === 'undefined' || trimmed === 'None' || trimmed === 'NaN') return false;
  if (!trimmed.startsWith('http') && !trimmed.startsWith('/')) return false;
  // Reject URLs that are just a domain with no path (e.g. "https://ytimg.com/")
  if (trimmed.replace(/^https?:\/\//, '').replace(/\/$/, '').indexOf('/') === -1) return false;
  // Reject relative paths that aren't known NAS patterns
  // Only /pas-dev/stream/, /stream/, /pas-dev/, /PowerAdspy/ are valid local paths
  if (trimmed.startsWith('/') &&
      !trimmed.startsWith('/pas-dev/') &&
      !trimmed.startsWith('/stream/') &&
      !trimmed.startsWith('/PowerAdspy/')) {
    return false;
  }
  return true;
}

function isVideoFileUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  // Direct video file extensions
  if (/\.(mp4|mov|webm|mkv|avi|flv)(\?|$)/.test(lower)) return true;
  // Facebook video CDN domains (video-fra5-2.xx.fbcdn.net/... .mp4)
  if (lower.includes('video-') && lower.includes('.fbcdn.net')) return true;
  // Instagram video CDN
  if (lower.includes('.cdninstagram.com') && /\/(v|video)\//.test(lower)) return true;
  // YouTube direct video URLs (not thumbnails)
  if (lower.includes('youtube.com') && lower.includes('/videoplayback')) return true;
  if (lower.includes('googlevideo.com')) return true;
  // YouTube watch/shorts/live page URLs — these are web pages, not images
  if (lower.includes('youtube.com') && /\/(watch|shorts|live|embed)([\/?#]|$)/.test(lower)) return true;
  if (lower.includes('youtu.be')) return true;
  return false;
}

function isBlockedCdnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  // Facebook CDN URLs expire or get blocked by browsers
  if (lower.includes('fbcdn.net')) return true;
  // Instagram CDN URLs
  if (lower.includes('instagram.com') || lower.includes('cdninstagram.com')) return true;
  return false;
}

function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  const basename = lower.split('/').pop().split('?')[0];
  // Known placeholder/default image filenames
  const placeholders = [
    'defaultimage', 'default-image', 'default_img', 'default.jpg', 'default.png',
    'placeholder', 'placeholder-image', 'placeholder.jpg', 'placeholder.png',
    'no-image', 'noimage', 'no_image', 'noimg',
    'missing', 'missing-image', 'notfound', '404',
    'blank', 'empty', 'none', 'null',
    'dummy', 'sample', 'test',
    'bydefault', 'by_default', 'defaultads', 'default_ads',
    'generic', 'unknown', 'temp',
  ];
  return placeholders.some(p => basename.includes(p));
}

function transformMediaUrl(url) {
  if (!isValidMediaUrl(url)) return null;
  if (url.startsWith('http')) return url;

  // Local NAS paths - prepend media base URL
  // MEDIA_URL already ends with /pas-dev/stream/, so strip duplicate prefix from path
  const mediaBase = (process.env.MEDIA_URL || 'https://media.globussoft.com/pas-dev/stream/').replace(/\/$/, '');

  // Old Google paths (pasimages/) — images no longer exist on server
  if (url.startsWith('pasimages/')) {
    return null;
  }

  if (url.startsWith('/pas-dev/stream/')) {
    const cleanPath = url.replace(/^\/pas-dev\/stream/, '');
    return `${mediaBase}${cleanPath}`;
  }
  if (url.startsWith('/stream/')) {
    const cleanPath = url.replace(/^\/stream/, '');
    return `${mediaBase}${cleanPath}`;
  }
  if (url.startsWith('/pas-dev/')) {
    const cleanPath = url.replace(/^\/pas-dev/, '');
    return `${mediaBase}${cleanPath}`;
  }

  // /PowerAdspy/n2/... or /PowerAdspy/insta/... paths
  if (url.startsWith('/PowerAdspy/') || url.startsWith('PowerAdspy/')) {
    // Strip /PowerAdspy with optional /n2, /n3 etc.
    const cleanPath = url.replace(/^\/?PowerAdspy(\/n\d+)?/i, '');
    return `${mediaBase}${cleanPath}`;
  }

  return url;
}

// ── ISO date → ES date string ("yyyy-MM-dd HH:mm:ss") ───────────────────
// ES competitor indices store dates as "2024-01-01 12:30:00" (date type).
// Frontend sends ISO ("2024-01-01T00:00:00.000Z"); convert to that format.
function isoToEsDate(value) {
  if (!value) return null;
  const s = String(value);
  const t = s.indexOf('T');
  if (t === -1) return s.slice(0, 19);
  return `${s.slice(0, 10)} ${s.slice(t + 1, t + 9)}`;
}

// ── Flatten raw ES ad to common format ─────────────────────────────────

function flattenAd(ad, platform, config) {
  try {
    const rawId = getNested(ad, config.adIdField);
    const adId = rawId !== null && rawId !== undefined ? String(rawId) : null;
    if (!adId) return null;

    // Get media URL (try primary, then fallback)
    let mediaUrl = getNested(ad, config.imageUrl) || getNested(ad, config.fallbackImage);
    
    // Reject placeholder images, video files, and invalid URLs for thumbnails
    if (isPlaceholderImage(mediaUrl) || isVideoFileUrl(mediaUrl)) {
      mediaUrl = null;
    }
    
    // FB/IG CDN URLs (scontent.*.fbcdn.net, *.cdninstagram.com) get blocked
    // by browsers or expire. Only keep them if we find a NAS-hosted alternative.
    if (mediaUrl && isBlockedCdnUrl(mediaUrl)) {
      mediaUrl = getNested(ad, 'new_nas_image_url')
        || getNested(ad, 'thumbnail')
        || getNested(ad, 'nas_video_url')
        || getNested(ad, 'thumbnail_url')
        || null; // NO fallback to FB/IG CDN — those URLs are broken
    }
    
    // If primary is invalid or a video file, scan all known image fields for a valid IMAGE
    if (!isValidMediaUrl(mediaUrl) || isVideoFileUrl(mediaUrl)) {
      const candidateFields = [
        'new_nas_image_url',
        'thumbnail',
        'thumbnail_url',
        'image_url',
        'image_url_original',
        'ad_image_or_video',
        config.imageUrl,
        config.fallbackImage,
      ].filter(Boolean);
      for (const field of candidateFields) {
        const candidate = getNested(ad, field);
        if (
          isValidMediaUrl(candidate) &&
          !isVideoFileUrl(candidate) &&
          !isPlaceholderImage(candidate) &&
          !isBlockedCdnUrl(candidate)
        ) {
          mediaUrl = candidate;
          break;
        }
      }
    }
    
    const thumbnailUrl = transformMediaUrl(mediaUrl);

    // Video URL (for video ads)
    const adType = getNested(ad, config.adType);
    let videoUrlRaw = config.videoUrl ? getNested(ad, config.videoUrl) : null;
    // If configured video field is invalid, scan fallbacks
    if (!isValidMediaUrl(videoUrlRaw)) {
      const videoFallbacks = ['nas_video_url', 'video_url', 'new_nas_video_url'];
      for (const vf of videoFallbacks) {
        const candidate = getNested(ad, vf);
        if (isValidMediaUrl(candidate)) {
          videoUrlRaw = candidate;
          break;
        }
      }
    }
    const videoUrl = videoUrlRaw ? transformMediaUrl(videoUrlRaw) : null;

    // Require a valid image thumbnail for all ads.
    // Video ads also need a poster frame thumbnail — <img> can't render .mp4 files.
    if (!thumbnailUrl) return null;

    // For video ads, creativeUrl = video; for image ads, creativeUrl = thumbnail
    const creativeUrl = (adType === 'VIDEO' && videoUrl) ? videoUrl : thumbnailUrl;

    // Parse first_seen / last_seen (some are strings, some are epoch numbers)
    let firstSeen = getNested(ad, config.firstSeen);
    if (typeof firstSeen === 'number') {
      firstSeen = firstSeen > 0 ? new Date(firstSeen * 1000).toISOString() : null;
    }

    let lastSeen = getNested(ad, config.lastSeen);
    if (typeof lastSeen === 'number') {
      lastSeen = lastSeen > 0 ? new Date(lastSeen * 1000).toISOString() : null;
    }

    return {
      id: adId,
      adId: adId,
      platform: platform,
      network: platform,
      advertiserName: getNested(ad, config.postOwner),
      postOwner: getNested(ad, config.postOwner),
      postOwnerImage: transformMediaUrl(getNested(ad, config.postOwnerImage)),
      thumbnailUrl: thumbnailUrl,
      mediaUrl: mediaUrl,
      creativeUrl: creativeUrl,
      videoUrl: videoUrl,
      adTitle: getNested(ad, config.adTitle),
      adDescription: getNested(ad, config.newsfeedDescription) || getNested(ad, config.adText),
      adText: getNested(ad, config.adText),
      newsfeedDescription: getNested(ad, config.newsfeedDescription),
      category: getNested(ad, config.categoryName) || null,
      subCategory: getNested(ad, config.subCategoryName) || null,
      categoryId: getNested(ad, config.categoryId) ? String(getNested(ad, config.categoryId)) : null,
      subCategoryId: getNested(ad, config.subCategoryId) ? String(getNested(ad, config.subCategoryId)) : null,
      adType: adType,
      adUrl: getNested(ad, config.adUrl),
      destinationUrl: getNested(ad, config.adUrl),
      firstSeen: firstSeen,
      lastSeen: lastSeen,
      esScore: null,
      popularity: getNested(ad, config.popularity) || 0,
      impression: getNested(ad, 'facebook_ad.impression') || getNested(ad, 'instagram_ad.impression') || getNested(ad, 'impression') || 0,
      likes: getNested(ad, 'facebook_ad.likes') || getNested(ad, 'instagram_ad.likes') || getNested(ad, 'reactions.likes') || 0,
      comments: getNested(ad, 'facebook_ad.comments') || getNested(ad, 'instagram_ad.comments') || getNested(ad, 'comments') || 0,
      shares: getNested(ad, 'facebook_ad.shares') || getNested(ad, 'instagram_ad.shares') || 0,
      views: getNested(ad, 'instagram_ad.views') || getNested(ad, 'views') || 0,
      fetchedAt: new Date(),
    };
  } catch (err) {
    logger.error(`[flattenAd] Error flattening ${platform} ad: ${err.message}`);
    return null;
  }
}

// ── Main search function ────────────────────────────────────────────────

exports.searchAdsByKeywords = async (
  keywords = [],
  competitors = [],
  platform = 'all',
  page = 1,
  pageSize = 10,
  sortBy = 'date',
  sortOrder = 'desc',
  filters = {}
) => {
  // With Query 3, we need at least one of: keywords OR competitors
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
  const hasCompetitors = Array.isArray(competitors) && competitors.length > 0;
  if (!hasKeywords && !hasCompetitors) {
    return { ads: [], total: 0, hasMore: false };
  }

  const platformsToSearch = platform === 'all'
    ? Object.keys(PLATFORM_CONFIGS)
    : [platform];

  // Search each platform's index in PARALLEL, each paginated independently
  // at the ES level (from/size). Works whether the 4 platforms share a cluster
  // (dev) or live on separate clusters (prod) — we never cross-query indices.
  const searchPromises = platformsToSearch.map((plat) => {
    const config = PLATFORM_CONFIGS[plat];
    if (!config) return Promise.resolve({ ads: [], total: 0, rawCount: 0 });
    return searchSinglePlatform(
      keywords,
      competitors,
      config,
      plat,
      page,
      pageSize,
      sortBy,
      sortOrder,
      filters
    );
  });

  const resultsPerPlatform = await Promise.all(searchPromises);

  // Merge this page's results from every platform
  const merged = resultsPerPlatform.flatMap(r => r.ads);

  // Keep the combined ("All") batch coherent: sort the merged page by last_seen
  // (most-recently-active) in the user's chosen direction. (Single-platform
  // results are already ordered by ES; this only matters when platforms mix.)
  if (sortBy !== 'relevance') {
    const dir = sortOrder === 'asc' ? 1 : -1;
    merged.sort((a, b) => {
      const da = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const db = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return (da - db) * dir;
    });
  }

  // More pages exist if ANY platform still has docs beyond this page
  const hasMore = resultsPerPlatform.some(r => page * pageSize < (r.total || 0));
  const total = resultsPerPlatform.reduce((s, r) => s + (r.total || 0), 0);

  return { ads: merged, total, hasMore };
};

// ── Search a single platform index ──────────────────────────────────────

async function searchSinglePlatform(keywords = [], competitors = [], config, platform, page, limit, sortBy, sortOrder, filters = {}) {
  try {
    const { index } = config;
    const from = (page - 1) * limit;
    const keywordQuery = keywords.join(' ');
    const competitorNames = competitors.filter(c => c && typeof c === 'string');
    const isGoogle = config.postOwnerIsKeyword === true;

    // ── Build optimized ES query ──────────────────────────────────────────
    // Structure:
    //   must:  [competitor match REQUIRED]  → ads MUST be from a competitor
    //   should:[keyword match]              → boosts score but NOT required
    //   filter:[image exists]               → required, no scoring impact
    //
    // For multi-word competitor names (e.g., "New Balance", "Under Armour"),
    // we use match_phrase for precision to avoid partial word matches.

    const mustClauses = [];
    const shouldClauses = [];

    // ── 1. Competitor matching (REQUIRED) ──────────────────────────────────
    if (competitorNames.length > 0) {
      const competitorMatchClauses = [];

      if (isGoogle) {
        // Google: post_owner is a keyword field (exact). Use match_phrase_prefix
        // per competitor so a brand short-name also catches its official
        // sub-accounts (e.g. "lenovo" → "lenovo india", "lenovo.com").
        // Plain `terms` would only match the exact string and miss those.
        competitorNames.forEach(name => {
          competitorMatchClauses.push({
            match_phrase_prefix: { [config.postOwner]: { query: name, boost: 5.0 } }
          });
        });
      } else {
        // FB / IG / YT: post_owner is text → analyzed match
        // Split single-word vs multi-word for precision
        const singleWord = competitorNames.filter(c => !c.includes(' '));
        const multiWord = competitorNames.filter(c => c.includes(' '));

        // Single-word competitors: use match (catches variations like Nike → nike)
        if (singleWord.length > 0) {
          competitorMatchClauses.push({
            match: {
              [config.postOwner]: {
                query: singleWord.join(' '),
                operator: 'or',
                boost: 5.0
              }
            }
          });
        }

        // Multi-word competitors: use match_phrase for exact phrase matching
        // e.g., "Under Armour" only matches the full phrase, not just "Armour"
        multiWord.forEach(name => {
          competitorMatchClauses.push({
            match_phrase: {
              [config.postOwner]: {
                query: name,
                boost: 5.0
              }
            }
          });
        });
      }

      // NOTE: We intentionally do NOT match competitor names in ad CONTENT
      // (title/text). Doing so pulled in marketplace/reseller ads that merely
      // mention a competitor's product (e.g. an Amazon/Croma ad titled
      // "Dell Vostro Laptop"), which appeared for every brand. A competitor ad
      // = an ad whose ADVERTISER (post_owner) is the competitor.

      // Competitor must match on the advertiser (post_owner)
      mustClauses.push({
        bool: {
          should: competitorMatchClauses,
          minimum_should_match: 1
        }
      });
    }

    // ── 2. Keyword matching (boosts score, NOT required) ───────────────────
    if (keywordQuery) {
      shouldClauses.push({
        multi_match: {
          query: keywordQuery,
          fields: [
            config.adTitle,
            config.adText,
            config.newsfeedDescription
          ].filter(Boolean),
          type: 'best_fields',
          operator: 'or',
          boost: 2.0
        }
      });
    }

    // ── 3. Fallback: if no competitors, fall back to keyword-only search ──
    if (mustClauses.length === 0) {
      if (keywordQuery) {
        mustClauses.push({
          multi_match: {
            query: keywordQuery,
            fields: [
              config.adTitle,
              config.adText,
              config.newsfeedDescription
            ].filter(Boolean),
            type: 'best_fields',
            operator: 'or'
          }
        });
      } else {
        mustClauses.push({ match_all: {} });
      }
    }

    // ── 4. Filters ────────────────────────────────────────────────────────
    const filterClauses = [];

    // Require a VALID NAS-hosted image at the ES level.
    // Valid images are stored as NAS paths in two formats:
    //   /PowerAdspy/...      → tokenizes to "poweradspy"
    //   /pas-dev/stream/...  → tokenizes to "stream"
    // Matching these excludes CDN URLs (fbcdn/cdninstagram), old "pasimages/"
    // paths, and placeholders — so we stop fetching docs flattenAd would only
    // drop (e.g. FB: ~18k candidates → ~4.7k valid). flattenAd still runs its
    // own validation as a safety net.
    const validImageFields = config.validImageFields || config.imageExistsFields || [];
    const imageShould = [];
    for (const field of validImageFields) {
      imageShould.push({ match: { [field]: 'poweradspy' } });
      imageShould.push({ match: { [field]: 'stream' } });
    }
    if (imageShould.length > 0) {
      filterClauses.push({ bool: { should: imageShould, minimum_should_match: 1 } });
    }

    // Category / subcategory filter — category_id is a `text` field, so use
    // `match` (single-token numeric IDs match exactly). Multi-select: an array
    // of ids becomes a should-OR of match clauses; a single id stays a plain
    // match. Scalar + array inputs are merged & de-duped for back-compat.
    const buildIdFilter = (field, single, multi) => {
      if (!field) return null;
      const ids = [];
      if (Array.isArray(multi)) ids.push(...multi);
      if (single !== undefined && single !== null && single !== '') ids.push(single);
      const unique = [...new Set(ids.map((v) => String(v)).filter(Boolean))];
      if (unique.length === 0) return null;
      if (unique.length === 1) return { match: { [field]: unique[0] } };
      return {
        bool: {
          should: unique.map((id) => ({ match: { [field]: id } })),
          minimum_should_match: 1,
        },
      };
    };

    const catFilter = buildIdFilter(config.categoryId, filters.categoryId, filters.categoryIds);
    if (catFilter) filterClauses.push(catFilter);
    const subFilter = buildIdFilter(config.subCategoryId, filters.subCategoryId, filters.subCategoryIds);
    if (subFilter) filterClauses.push(subFilter);

    // Date range filter on the post/first-seen date field (ES `date` type,
    // stored as "yyyy-MM-dd HH:mm:ss"). Provide `format` so ES parses our value.
    if ((filters.dateFrom || filters.dateTo) && config.firstSeen) {
      const range = { format: 'yyyy-MM-dd HH:mm:ss' };
      if (filters.dateFrom) range.gte = isoToEsDate(filters.dateFrom);
      if (filters.dateTo) range.lte = isoToEsDate(filters.dateTo);
      filterClauses.push({ range: { [config.firstSeen]: range } });
    }

    // Assemble final query
    const query = {
      bool: {
        must: mustClauses,
        should: shouldClauses,
        filter: filterClauses
      }
    };

    // ── Sort ──────────────────────────────────────────────────────────────
    // When competitors are present, relevance is critical — sort by score first
    // so competitor-matched ads (boost 5) rank above keyword-only ads (boost 2).
    // Date becomes a tiebreaker. Without competitors, stick to pure date sort.
    // Sort by last_seen (most-recently-ACTIVE first) so the user sees ads the
    // competitor is currently running, not just newly-created ones. This drives
    // from/size pagination order. All returned ads already match a competitor
    // (must clause). `relevance` mode (not used by the UI today) keeps score-first.
    const sort = [];
    if (sortBy === 'relevance') {
      sort.push({ _score: { order: sortOrder } });
      sort.push({ [config.lastSeen]: { order: 'desc' } });
    } else {
      sort.push({ [config.lastSeen]: { order: sortOrder } });
    }

    // ── _source filter: only fetch fields we actually need ────────────────
    const _source = [
      config.adIdField,
      config.postOwner,
      config.postOwnerImage,
      config.adTitle,
      config.adText,
      config.newsfeedDescription,
      config.firstSeen,
      config.lastSeen,
      config.adType,
      config.adUrl,
      config.imageUrl,
      config.fallbackImage,
      config.videoUrl,
      config.popularity,
      config.categoryName,
      config.subCategoryName,
      config.categoryId,
      config.subCategoryId,
      'new_nas_image_url',
      'thumbnail',
      'nas_video_url',
      'thumbnail_url',
      'image_url',
      'image_url_original',
      'impression',
      'comments',
      'shares',
      'views',
      'likes',
      'reactions.likes',
    ].filter(Boolean);

    logger.info(`[searchAdsByKeywords] Searching ${platform} (${index}): keywords="${keywordQuery}" competitors=${competitorNames.length}`);

    const client = clients[platform];
    if (!client) {
      logger.error(`[searchAdsByKeywords] No ES client configured for platform: ${platform}`);
      return [];
    }

    let response;
    try {
      response = await client.search({
        index,
        from,                      // ← real pagination offset
        size: limit,               // ← only fetch this page's worth
        body: {
          query,
          sort,
          _source,
        },
        track_total_hits: true,    // Need total to know if more pages exist
        timeout: '15s',            // Kill slow queries
      });
    } catch (esErr) {
      console.error(`[searchAdsByKeywords] ES search failed for ${platform} (${index}): ${esErr.message}`);
      if (esErr.meta && esErr.meta.body) {
        console.error(`[searchAdsByKeywords] ES error body: ${JSON.stringify(esErr.meta.body)}`);
      }
      return { ads: [], total: 0, rawCount: 0 };
    }

    const hitsRoot = response?.hits || response?.body?.hits || {};
    const hits = hitsRoot.hits || [];
    const totalRaw = hitsRoot.total;
    const total = typeof totalRaw === 'object' ? (totalRaw?.value || 0) : (totalRaw || 0);

    logger.info(`[searchAdsByKeywords] ${platform}: ${hits.length} hits fetched (total=${total}, from=${from})`);

    // Flatten + dedupe
    const seen = new Set();
    const results = [];
    for (const hit of hits) {
      const flatAd = flattenAd(hit._source, platform, config);
      if (flatAd && flatAd.adId && !seen.has(flatAd.adId)) {
        seen.add(flatAd.adId);
        flatAd.esScore = hit._score;

        const sourceText = [
          getNested(hit._source, config.adTitle),
          getNested(hit._source, config.adText),
          getNested(hit._source, config.newsfeedDescription),
          getNested(hit._source, config.postOwner),
        ].filter(Boolean).join(' ').toLowerCase();

        flatAd.matchedKeywords = keywords.filter(kw =>
          sourceText.includes(kw.toLowerCase())
        );
        flatAd.matchedCompetitors = competitorNames.filter(comp =>
          sourceText.includes(comp.toLowerCase())
        );
        results.push(flatAd);
      }
    }

    return { ads: results, total, rawCount: hits.length };
  } catch (error) {
    logger.error(`[searchAdsByKeywords] Error on ${platform} (${config.index}): ${error.message}`);
    return { ads: [], total: 0, rawCount: 0 };
  }
}
