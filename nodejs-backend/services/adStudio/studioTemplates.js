// studioTemplates — DS templates matched to one of the user's brands, for the
// Ad Creative (image) and Ad Video (video) home galleries.
//
// Contract: AD_STUDIO_API_CONTRACT.md §1. Same DS route onboarding uses
// (`recommend-templates`), but with INLINE brand context instead of an
// onboarding session: the brand's name/description go in `description`, its
// product images in `image_urls`.
//
// ── Why a fixed `session_id` ────────────────────────────────────────────────
// DS accepts any id alongside inline context. Sending `adstudio-<brandId>` on
// every call for a brand means DS's own 10-minute video cache hits on repeat
// calls, and the job callback DS posts afterwards can be recognised by its
// prefix and dropped (controllers/Ai/jobWebhookController.js `receive`) —
// without storing anything. See docs/ai/modules/adstudio/DECISIONS.md ADS-001.
//
// ── Why nothing is persisted ────────────────────────────────────────────────
// Templates are a read, and their media links rotate between runs. They live in
// a 10-minute in-process cache here and in Redux on the client; `refresh`
// bypasses both.

const crypto = require("crypto");
const axios = require("axios");
const brandNameLists = require("../../Module/brandNames/brandNamesSchema");
const { createSseParser } = require("../onboarding/templateBridge");
const { createFlowLog } = require("../../utils/flowLog");

// Page sizes — both legs are infinite scroll (image since 2026-10-06):
//   image — 20 per page. See "Image paging" below for how pages are served.
//   video — `skip`-paged by DS. 10 per page keeps each wait ~2s. Dev DS
//           currently caps the video pool at 20 per brand, so that is two
//           pages today; the end is simply a page shorter than asked for.
const IMAGE_PAGE = 30;
const VIDEO_PAGE = 10;

// ── Image paging ────────────────────────────────────────────────────────────
// Every image page asks DS with `skip` + `limit`. Today DS ignores `skip` on
// the image leg (contract "(7)": "dropped (reset to 0) once the image leg also
// runs"; verified live 2026-10-06 — skip 0 and skip 5 returned the same 5).
// So the first page past 0 is checked: if it starts with page 0's first
// template, DS ignored `skip`, and pages are cut from one cached ranked list
// of up to IMAGE_POOL_MAX (DS's `limit` ceiling when `image` is true) instead.
// That verdict is kept IMAGE_SKIP_RECHECK_MS, then checked again — so once DS
// ships image `skip`, paging moves to DS with no code change here.
const IMAGE_POOL_MAX = 100;
const IMAGE_SKIP_RECHECK_MS = 30 * 60 * 1000;
const imageSkip = { ignored: false, checkedAt: 0 }; // process-wide; DS behaviour, not per user

// Contract §"How long it takes": video often takes the full 30s upstream, so
// clients must wait at least 45s. This bounds the whole stream, not the accept.
const STREAM_TIMEOUT_MS = 45_000;

const CACHE_TTL_MS = 10 * 60 * 1000;

// Contract bounds on inline context.
const MAX_DESCRIPTION = 4000;
const MAX_IMAGE_URLS = 10;

// Video-leg score floor. DS's own default (0.65 on dev) returned `no_match`
// with 0 videos for ordinary brands — the best match was ~0.61 (verified
// 2026-09-30; 0.25 and 0.5 both return 20). Same env var and default as
// onboarding's templateBridge, so both features move together.
const DEFAULT_VIDEO_THRESHOLD = 0.25;
function resolveVideoThreshold() {
  const value = Number(process.env.TEMPLATE_MATCH_THRESHOLD);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_VIDEO_THRESHOLD;
}

// Ad Studio video templates open in Clone Your Ad, which refuses a source
// longer than 60s (CloneYourAdPage.jsx validateSourceDuration: it rejects
// Math.round(sec) > 60). Those templates are hidden here — for Ad Studio
// only; onboarding shows every length. A template with no `duration_sec` is
// kept, since Clone Your Ad still measures the file itself when it loads.
const MAX_VIDEO_SECONDS = 60;
function fitsCloneYourAd(item) {
  return item.duration_sec == null || Math.round(item.duration_sec) <= MAX_VIDEO_SECONDS;
}

// When a whole DS page is filtered out, fetch the next one before answering.
// The dock asks for one page per list length (StudioTemplateDock.jsx
// maybeLoadMore), so returning an empty page that still has more after it
// would stop the scroll. This cap bounds the wait (~2s per page).
const MAX_DS_PAGES_PER_REQUEST = 3;

const cache = new Map(); // key → { items, fetchedAt, hasMore, nextSkip }
const inFlight = new Map(); // key → Promise, so two tabs asking at once make one DS call

class StudioTemplateError extends Error {
  constructor(message, { status = 500, code = "INTERNAL" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

// Brand images are stored as S3 keys and served under AWS_IMAGE_VIEW_URL, the
// same way controllers/brandNamesList.js builds them for the browser. DS
// downloads each one (6s budget per image), so only absolute http(s) links go.
function toPublicUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = process.env.AWS_IMAGE_VIEW_URL || "";
  const joined = `${base}${raw}`;
  return /^https?:\/\//i.test(joined) ? joined : "";
}

function buildContext(brand) {
  const parts = [brand.brandName, brand.brandDescription]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (brand.category) parts.push(`Category: ${brand.category}`);
  const description = parts.join(". ").slice(0, MAX_DESCRIPTION);

  const imageUrls = [...new Set((brand.imageUrls || []).map(toPublicUrl).filter(Boolean))].slice(
    0,
    MAX_IMAGE_URLS
  );

  // Brand name alone is not a description worth matching videos on.
  const hasDescription = Boolean(String(brand.brandDescription || "").trim());
  return { description, imageUrls, hasDescription };
}

// Part of the cache key, so editing a brand's description or images makes the
// next request miss instead of serving templates matched to the old brand.
function contextFingerprint({ description, imageUrls }) {
  return crypto.createHash("sha1").update(`${description}\n${imageUrls.join("\n")}`).digest("hex").slice(0, 12);
}

async function loadBrand(userId, brandId) {
  const doc = await brandNameLists
    .findOne({ user_id: userId, "brands.id": brandId }, { "brands.$": 1 })
    .lean();
  return doc?.brands?.[0] || null;
}

// One DS `result` event → the flat shape the galleries render. Returns null for
// a result of the other kind (we ask for one kind, but never trust that).
function toItem(event, media) {
  if (!event || event.kind !== media) return null;
  const body = event[media];
  const url = media === "video" ? body?.video_url : body?.image_url;
  if (!body?.template_id || !url) return null;
  const item = {
    template_id: body.template_id,
    kind: media,
    url,
    tags: Array.isArray(body.tags) ? body.tags : [],
    rank: Number(event.rank) || 0,
  };
  if (media === "video") {
    // Seconds (float) from DS; null when absent or unusable.
    const sec = Number(body.duration_sec);
    item.duration_sec = body.duration_sec != null && Number.isFinite(sec) && sec > 0 ? sec : null;
  }
  return item;
}

async function callDs({ userId, brandId, media, context, refresh, skip = 0, limit }) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    throw new StudioTemplateError("template service is not configured", { status: 503, code: "NOT_CONFIGURED" });
  }

  const body = {
    session_id: `adstudio-${brandId}`,
    user_id: userId,
    [media]: true,
    limit: limit || (media === "video" ? VIDEO_PAGE : IMAGE_PAGE),
  };
  if (media === "video") {
    body.threshold = resolveVideoThreshold();
    body.skip = skip;
  } else if (skip > 0) {
    body.skip = skip; // ignored by DS today; see "Image paging"
  }
  if (context.description) body.description = context.description;
  if (context.imageUrls.length) body.image_urls = context.imageUrls;

  // `refresh=1` is the documented cache bypass on the onboarding contract
  // (TEMPLATE_RECOMMENDATIONS_API_CONTRACT §Query parameters). The Ad Studio
  // guide does not list it; upstream ignores unknown query params.
  const url = `${baseUrl}/api/v1/onboarding/recommend-templates${refresh ? "?refresh=1" : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const response = await axios.post(url, body, {
      headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
      responseType: "stream",
      signal: controller.signal,
    });

    const items = [];
    let rawCount = 0;
    let done = false;
    let streamError = null;

    await new Promise((resolve, reject) => {
      const feed = createSseParser((event, data) => {
        if (event === "result") {
          rawCount += 1;
          const item = toItem(data, media);
          if (item) items.push(item);
        } else if (event === "done") done = true;
        else if (event === "error") streamError = data?.error || "template matching failed";
      });
      response.data.on("data", feed);
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    if (streamError || !done) {
      throw new StudioTemplateError(streamError || "template stream ended without a done event", {
        status: 502,
        code: "UPSTREAM_FAILED",
      });
    }

    items.sort((a, b) => a.rank - b.rank);
    // `rawCount` is how many results DS sent, before any filtering: DS's own
    // `skip` counts those, so paging must too.
    return { items, rawCount };
  } catch (error) {
    if (error instanceof StudioTemplateError) throw error;
    const timedOut = controller.signal.aborted;
    const message = timedOut
      ? "template matching timed out"
      : error?.response?.status
        ? `template matching was rejected (${error.response.status})`
        : error?.message || "template matching failed";
    throw new StudioTemplateError(message, {
      status: timedOut ? 504 : 502,
      code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILED",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Templates for one brand and one media kind.
 *
 * Called by controllers/adStudio/studioTemplateController.js. `userId` must come
 * from the verified JWT — it is both the brand ownership check and the DS
 * `user_id`.
 *
 * `skip` pages both legs (`nextSkip` from the previous answer). Video pages
 * are DS positions; image pages may be cut from a cached list (see "Image paging").
 *
 * Resolves `{ items, cached, fetchedAt, hasMore, nextSkip }`. Throws StudioTemplateError with an
 * HTTP `status` and a `code` the client switches on:
 *   BRAND_NOT_FOUND (404), NO_CONTEXT / NO_DESCRIPTION (422),
 *   NOT_CONFIGURED (503), UPSTREAM_FAILED (502), UPSTREAM_TIMEOUT (504).
 */
async function getBrandTemplates({ userId, brandId, media, refresh = false, skip = 0 }) {
  const page = Math.max(Number(skip) || 0, 0);
  const log = createFlowLog("adstudio.templates", { user: userId });

  const brand = await loadBrand(userId, brandId);
  if (!brand) throw new StudioTemplateError("brand not found", { status: 404, code: "BRAND_NOT_FOUND" });

  const context = buildContext(brand);
  // A bare brand name is not enough to match on, so it does not count here.
  if (!context.hasDescription && !context.imageUrls.length) {
    throw new StudioTemplateError("brand has no description or images", { status: 422, code: "NO_CONTEXT" });
  }
  // Contract: video matches on text only; image_urls without a description is a 400.
  if (media === "video" && !context.hasDescription) {
    throw new StudioTemplateError("video templates need a brand description", {
      status: 422,
      code: "NO_DESCRIPTION",
    });
  }

  const baseKey = `${userId}:${brandId}:${media}:${contextFingerprint(context)}`;
  const key = `${baseKey}:${page}`;
  const freshCache = (k) => {
    const hit = cache.get(k);
    return hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS ? hit : null;
  };

  if (!refresh) {
    const hit = freshCache(key);
    if (hit) {
      return { items: hit.items, cached: true, fetchedAt: hit.fetchedAt, hasMore: hit.hasMore, nextSkip: hit.nextSkip };
    }
  }

  // A refresh does not join a normal request already running: that one may be
  // answered from DS's cache, which is exactly what refresh is meant to skip.
  const flightKey = refresh ? `${key}:refresh` : key;
  if (inFlight.has(flightKey)) {
    return inFlight.get(flightKey);
  }

  const run = (async () => {
    // Failures were silent before (only "stored" was logged), which hid why
    // video requests never produced anything. Log the reason, then rethrow.
    const fetchPage = (skip, limit) =>
      callDs({ userId, brandId, media, context, refresh, skip, limit }).catch((error) => {
        log.error("failed", { media, code: error.code, message: error.message });
        throw error;
      });

    // One image page (see "Image paging"). Resolves { items, hasMore, nextSkip }.
    const imagePage = async () => {
      const poolKey = `${baseKey}:pool`;
      const paged = (items, more) => {
        const hasMore = more && items.length === IMAGE_PAGE;
        return { items, hasMore, nextSkip: hasMore ? page + items.length : null };
      };
      // The ranked list cut locally while DS ignores `skip` — fetched once, cached.
      const fromPool = async () => {
        let pool = !refresh && freshCache(poolKey);
        if (!pool) {
          pool = { items: (await fetchPage(0, IMAGE_POOL_MAX)).items, fetchedAt: Date.now() };
          cache.set(poolKey, pool);
        }
        const items = pool.items.slice(page, page + IMAGE_PAGE);
        return paged(items, page + items.length < pool.items.length);
      };

      if (page === 0) {
        if (refresh) cache.delete(poolKey); // ↻ re-ranks everything, so the old pool goes
        return paged((await fetchPage(0)).items, true);
      }
      if (imageSkip.ignored && Date.now() - imageSkip.checkedAt < IMAGE_SKIP_RECHECK_MS) return fromPool();

      // Ask DS for the page properly, then check it really skipped: a page that
      // starts with page 0's first template means `skip` was ignored.
      const { items } = await fetchPage(page);
      const first = freshCache(`${baseKey}:0`) || freshCache(poolKey);
      const firstId = first?.items?.[0]?.template_id || (await fetchPage(0, 1)).items[0]?.template_id;
      imageSkip.ignored = Boolean(items.length && firstId && items[0].template_id === firstId);
      imageSkip.checkedAt = Date.now();
      return imageSkip.ignored ? fromPool() : paged(items, true);
    };

    const answer = { items: [], hasMore: false, nextSkip: null };
    if (media === "image") {
      Object.assign(answer, await imagePage());
    } else {
      // Video: drop templates Clone Your Ad can't take (> 60s). If that empties
      // the page, go on to the next DS page (bounded). A DS page shorter than
      // asked for is the end of the pool. `nextSkip` is a DS position.
      let skip = page;
      let more = true;
      for (let calls = 0; more && !answer.items.length && calls < MAX_DS_PAGES_PER_REQUEST; calls += 1) {
        const { items, rawCount } = await fetchPage(skip);
        for (const item of items) if (fitsCloneYourAd(item)) answer.items.push(item);
        more = rawCount === VIDEO_PAGE;
        skip += rawCount;
      }
      answer.hasMore = more;
      answer.nextSkip = more ? skip : null;
    }

    const fetchedAt = Date.now();
    cache.set(key, { ...answer, fetchedAt });
    sweepCache();
    return { ...answer, cached: false, fetchedAt };
  })();

  inFlight.set(flightKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(flightKey);
  }
}

// Keeps a long-lived process from growing the cache without bound.
function sweepCache() {
  if (cache.size < 500) return;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.fetchedAt >= CACHE_TTL_MS) cache.delete(k);
}

/**
 * The brand's context as DS sees it, for other Ad Studio calls. Used by
 * services/adStudio/studioImageRender.js to send the same description as
 * `product_description` on a template render. Resolves null for a brand the
 * user does not own.
 */
async function loadBrandContext(userId, brandId) {
  const brand = await loadBrand(userId, brandId);
  if (!brand) return null;
  return { brand, ...buildContext(brand) };
}

module.exports = {
  getBrandTemplates,
  loadBrandContext,
  StudioTemplateError,
  _internals: { cache, inFlight, imageSkip, buildContext, toItem, toPublicUrl },
};
