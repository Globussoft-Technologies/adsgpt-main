// similarTemplates — "more like this" for ONE reference template.
//
// The fixed-anchor sibling of `templateBridge`. Where that one ranks a corpus
// against a brand brief and streams the answer, this ranks against an EXISTING
// template and answers in one plain JSON body — no SSE, no session.
//
// Contract: `TEMPLATE_RECOMMENDATIONS_API_CONTRACT (4).md`, §"Similar templates"
// and §"Direct image-template search". That document was REWRITTEN 2026-09-22;
// everything here is against the new shape.
//
// ── One upstream call, two legs ─────────────────────────────────────────────
//
//   video anchor → GET /templates/{id}/similar?video=true
//   image anchor → GET /templates/{id}/similar?image=true
//
// Both page with `skip`. There is deliberately NO fallback to
// `POST /image-templates/search`: that route has `limit` and no `skip`, so an
// image rail built on it could never page — and a client that tried would ask
// for page 2 for ever, which is precisely the runaway this file saw on
// 2026-09-22. One route, one shape, one paging story.
//
// If the image leg is not deployed on a given instance it answers 503, the
// caller reports it, and the rail falls back to the session's own templates
// exactly as it does for any other failure. That is a better failure than a
// rail that loads once and then silently cannot go further.
//
// ── Why the flatten lives here ──────────────────────────────────────────────
// Upstream answers in a RANKED shape — `results[]` of `{rank, kind, score,
// video|image}` — and every tile we render (the dock, and the sheet's rail)
// reads the FLAT shape `sessionMirror` stores. One upstream shape, one place
// that knows about it, and the browser keeps reading the only shape it ever has.

const axios = require("axios");
const { createFlowLog } = require("../../utils/flowLog");

// Upstream ranks and returns in one call — no stream to hold open — so this is
// the whole request, not just its acceptance.
const REQUEST_TIMEOUT_MS = 20_000;

// The contract's bound for this route: `limit` is `1..500`
// (`reftemplate.MaxLimit`), and unlike `recommend-templates` a `0` or negative
// value is a 400 rather than "use the default". We clamp so a hand-written
// query string cannot turn into an upstream rejection.
const MAX_LIMIT = 500;

// ── A cache, because upstream has none for this route ──────────────────────
// `recommend-templates` is cached upstream for ten minutes (contract §Caching).
// This route documents no cache at all, and it shows: a repeat call for the
// same anchor costs the same ~2.4s as the first, because the corpus is re-ranked
// every time. Ranking against a FIXED anchor is deterministic, so the answer is
// safe to hold — the only thing that changes it is the corpus itself.
//
// In-process on purpose: it is keyed by anchor+page, a session touches a handful
// of anchors, and the TTL retires entries faster than a user can accumulate
// them. If this ever needs to survive a restart or be shared across instances,
// it wants Redis — the same place templateBridge would look.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  // Cheap sweep so a long-lived process cannot grow this without bound.
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (now > v.expiresAt) cache.delete(k);
  }
}

// Just the filename, for the log. A full CDN URL is 140 characters of noise
// that pushes everything worth reading off the right of the terminal — and the
// tail is the only part that differs between two of them anyway.
const shortUrl = (url) => {
  const clean = String(url || "").split("?")[0];
  const tail = clean.slice(clean.lastIndexOf("/") + 1);
  return tail || clean;
};

function resolveBaseUrl() {
  return String(process.env.ONBOARDING_PYTHON_BASE_URL || "").replace(/\/+$/, "");
}

/**
 * A LAST-RESORT guess at which corpus an anchor belongs to.
 *
 * Only used when the caller did not say. Every template we render already
 * carries `media_type` — `sessionMirror` tags session templates with it and
 * `flattenResult` below tags search results — so the kind is a fact we hold,
 * and `kind` on the request is the answer that should be used.
 *
 * The guess reads the id's LENGTH: a video template's id is 16 hex characters
 * (`fb2fbaf3d6685e47`), an image creative's is its `sha256`, 64 (contract:
 * `image.template_id` is "the creative's sha256"). That is an observation of
 * DS's console, NOT something the contract promises — which is exactly why it
 * is the fallback and not the rule. If DS ever changes its id format, this
 * silently starts routing to the wrong corpus; `kind` cannot.
 */
const isImageAnchorId = (id) => /^[a-f0-9]{64}$/i.test(String(id || ""));

/**
 * Is this id usable as an anchor at all?
 *
 * `sessionMirror.normalizeTemplateResult` falls back to `image_url` when an
 * image creative arrives with no `sha256`, so a tile's `template_id` is
 * occasionally a URL. Sending that upstream is a guaranteed 400, and a 400 the
 * caller cannot act on is worse than not asking.
 */
function isAnchorId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 200) return false;
  // Anything with a slash, a colon or a dot is a URL or a path, not an id.
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * One upstream `results[]` item → the flat tile shape.
 *
 * The 2026-09-22 rewrite slimmed these objects to `template_id` / `score` /
 * `tags` / one url. `domain`, `content_type`, `video_kind_label`, `tone`,
 * `one_line_summary`, `duration_sec` and `preview_path` are NOT sent on this
 * route any more — the doc is explicit that the richer data still exists
 * server-side and is simply never put on this wire.
 */
function flattenResult(item) {
  if (!item || typeof item !== "object") return null;
  const kind = item.kind === "image" ? "image" : "video";
  const body = kind === "image" ? item.image : item.video;
  if (!body || typeof body !== "object") return null;

  const tags = Array.isArray(body.tags) ? body.tags : [];

  return {
    ...body,
    template_id: body.template_id || "",
    media_type: kind,
    // `tone` is what TemplateTile reads for a video tile's chips and `tags` for
    // an image one. Filling both from the one descriptive field upstream now
    // sends keeps the tile working without teaching it a second shape.
    tags,
    ...(kind === "video" ? { tone: tags } : {}),
    // NOT `score`. The contract is explicit that this route's score is the
    // candidate's own corpus's raw value — a video cosine (~0.3-0.9) and an
    // image RRF (~0.02-0.05) are not comparable, and neither has been through
    // any `recommended` floor. Passing it as `score` would let a tile badge
    // itself off a number that means something else.
    raw_score: item.score,
    recommended: false,
  };
}

/**
 * The similar route — the one that pages. Used for BOTH corpora; `image`
 * selects which. Returns the same envelope the caller returns, so the two legs
 * are interchangeable from outside.
 */
async function fetchViaSimilarRoute({
  templateId,
  limit,
  skip,
  searchId,
  onlyReady,
  image,
  flow,
}) {
  const baseUrl = resolveBaseUrl();
  const leg = image ? "image" : "video";

  const params = new URLSearchParams({
    video: image ? "false" : "true",
    image: image ? "true" : "false",
    limit: String(limit),
    skip: String(skip),
    // Undocumented in the contract, but DS's own console sends it
    // (`similar?limit=5&only_ready=true`). It restricts the corpus to templates
    // that are already processed — the only kind a recreate could use anyway.
    // A server that does not know the param ignores it.
    ...(onlyReady ? { only_ready: "true" } : {}),
    // Freezes the ranking across pages. Hand back what the previous page
    // returned and upstream resumes that ordering instead of re-ranking from
    // scratch — which is what makes page 2 genuinely the NEXT results rather
    // than a fresh top-N that mostly repeats page 1.
    ...(searchId ? { search_id: searchId } : {}),
  });

  const url = `${baseUrl}/api/v1/templates/${encodeURIComponent(templateId)}/similar?${params}`;

  flow.ds("out", "templates.similar", {
    leg,
    anchor: templateId,
    limit: params.get("limit"),
    skip: params.get("skip"),
    only_ready: params.get("only_ready") || "false",
    resumed: searchId ? "yes" : "no",
  });

  let response;
  const startedAt = Date.now();
  try {
    response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      // Read the body ourselves on every status: upstream's failures carry
      // `error` / `user_message`, and throwing them away to report a bare 502
      // loses the only line worth showing anyone.
      validateStatus: () => true,
    });
  } catch (error) {
    flow.error("upstream unreachable", { leg, anchor: templateId, message: error.message });
    return { ok: false, status: 502, error: "similar-template search is unavailable" };
  }

  if (response.status >= 400) {
    const body = response.data || {};
    flow.error("upstream refused", {
      leg,
      anchor: templateId,
      status: response.status,
      why: body.error || "",
    });
    return {
      ok: false,
      // 400 means WE sent something wrong and a retry will not help. 503 is kept
      // as itself because it means "this leg is not deployed here", which the
      // caller acts on differently. Everything else is a bad gateway.
      status: response.status === 400 ? 400 : response.status === 503 ? 503 : 502,
      error: body.user_message || body.error || "similar-template search failed",
    };
  }

  const results = Array.isArray(response.data?.results) ? response.data.results : [];
  const templates = results.map(flattenResult).filter((t) => t && t.template_id);

  // A leg that failed while the other succeeded is reported, not thrown: the
  // results that DID come back are still worth rendering.
  const warning = response.data?.video_error || response.data?.image_error || "";
  if (warning) flow.warn("partial result", { leg, anchor: templateId, warning });

  flow.ds("in", "templates.similar", {
    leg,
    anchor: templateId,
    status: response.status,
    ms: Date.now() - startedAt,
    count: templates.length,
    has_more: String(Boolean(response.data?.has_more)),
  });

  return {
    ok: true,
    templates,
    count: templates.length,
    // Upstream's own end-of-list signal, which beats guessing from a short
    // page: a page can come back short because a filter dropped rows, not
    // because the corpus ran out.
    hasMore: Boolean(response.data?.has_more),
    nextSkip: Number.isFinite(Number(response.data?.next_skip))
      ? Number(response.data.next_skip)
      : null,
    searchId: response.data?.search_id || "",
    warning,
  };
}

/**
 * Templates ranked against `templateId`.
 *
 * Returns `{ ok: true, templates, hasMore, nextSkip, searchId, warning }` or
 * `{ ok: false, status, error }`. The caller decides what a failure looks like
 * on screen; this only reports.
 */
async function fetchSimilarTemplates({
  templateId,
  limit = 8,
  skip = 0,
  searchId = "",
  // Which corpus this anchor belongs to: "image" | "video" | "" (unknown).
  // Taken from the template's own `media_type`, which every tile already
  // carries. Trusted because getting it wrong costs a 400 from upstream and
  // nothing else — it selects a corpus, it does not grant access to anything.
  kind = "",
  onlyReady = true,
  userId = "",
} = {}) {
  const flow = createFlowLog("similarTemplates", { user: userId });

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    return { ok: false, status: 503, error: "onboarding service base_url is not configured" };
  }

  // The caller's answer wins. The id-shape guess is only consulted when there
  // is no answer — see `isImageAnchorId`.
  const isImage = kind === "image" || (kind !== "video" && isImageAnchorId(templateId));
  const pageLimit = Math.min(Math.max(Number(limit) || 8, 1), MAX_LIMIT);
  const pageSkip = Math.max(Number(skip) || 0, 0);

  const key = `${isImage ? "img" : "vid"}|${templateId}|${pageLimit}|${pageSkip}|${searchId || ""}`;
  const cached = readCache(key);
  if (cached) {
    flow.ds("in", "templates.similar", {
      leg: isImage ? "image" : "video",
      anchor: templateId,
      skip: pageSkip,
      cache: "hit",
      ms: 0,
      count: cached.count,
    });
    return cached;
  }

  if (!isAnchorId(templateId)) {
    return { ok: false, status: 400, error: "templateId is not a usable anchor id" };
  }

  const result = await fetchViaSimilarRoute({
    templateId,
    limit: pageLimit,
    skip: pageSkip,
    searchId,
    onlyReady,
    image: isImage,
    flow,
  });

  // Only a clean answer is cached. A partial one (a leg errored) is not worth
  // holding for ten minutes — the next caller should get another go at it.
  if (result.ok && !result.warning) writeCache(key, result);
  return result;
}

module.exports = {
  fetchSimilarTemplates,
  _internals: { isAnchorId, isImageAnchorId, flattenResult },
};
