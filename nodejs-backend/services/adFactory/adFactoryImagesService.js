/**
 * adFactoryImagesService — pure assembly of the "AdFactory images" list
 * (manual + automatic) from live Campaign docs and CampaignHistory snapshots.
 *
 * No DB / SDK / HTTP here so it can be unit-tested in isolation. The
 * controller fetches the raw docs and hands them to assembleAdFactoryImages().
 *
 * An image entry (results.image[]) is in one of three states:
 *   success     status === 200, data present
 *   generating  status null/unset (slot pushed but not filled yet) — live only
 *   error       status is some other numeric HTTP code (e.g. 400/500)
 */

// Resolve a results.image[].data value (string URL, or object holding the URL)
// to a plain URL string. Mirrors the extraction used across the AdFactory code.
function resolveImageUrl(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data !== "object") return null;
  const u = data.base_image || data.url || data.data || null;
  return typeof u === "string" ? u : null;
}

function resolveAspectRatio(data) {
  if (!data || typeof data !== "object") return null;
  return data.aspect_ratio || data.aspectRatio || data.aspectRatioString || null;
}

// Pick the image model used by a campaign (per-campaign, best-effort) from its
// services list. Works for both live (campaign.services) and history
// (previousData.services) shapes since callers pass the right services object.
function resolveImageModel(services) {
  const list = services?.servicesSelected || [];
  const imageSvc = list.find((s) => s?.serviceName === "image");
  return imageSvc?.serviceParams?.model || null;
}

// Classify the numeric per-image status into a label.
//   200                              → success
//   any other finite number (≠ 200) → error
//   null / undefined / "" / NaN     → generating (slot not filled yet)
function classifyStatus(status) {
  if (status === 200) return "success";
  if (typeof status === "number" && Number.isFinite(status)) return "error";
  return "generating";
}

const tsMs = (t) => (t ? new Date(t).getTime() : 0);

// Map a single results.image[] entry into the flat response shape.
// `now` is the reference "current time" (ms) used to stamp generating
// placeholders that have no timestamp of their own, so they sort to the top
// and fall inside a date range covering today.
function mapImageEntry(entry, { campaignId, campaignName, model, origin, now }) {
  const status = classifyStatus(entry?.status);
  const timestamp =
    entry?.timestamp || (status === "generating" ? new Date(now) : null);
  return {
    url: resolveImageUrl(entry?.data),
    prompt: entry?.prompt || null,
    model,
    status,
    error: entry?.error || null,
    aspectRatio: resolveAspectRatio(entry?.data),
    campaignId,
    campaignName,
    jobId: entry?.jobId || null,
    origin, // "live" | "history"
    timestamp,
  };
}

// Build a predicate that tests whether a timestamp falls inside the optional
// dd-MM-yyyy date range. No range → always true.
function buildInRange({ startDate, endDate } = {}) {
  let rangeStart = null;
  let rangeEnd = null;
  if (startDate) {
    const [d, m, y] = String(startDate).split("-");
    rangeStart = new Date(y, m - 1, d).getTime();
  }
  if (endDate) {
    const [d, m, y] = String(endDate).split("-");
    rangeEnd = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  }
  return (ts) => {
    if (rangeStart === null && rangeEnd === null) return true;
    if (!ts) return false; // a filter is active but this entry has no timestamp
    const t = tsMs(ts);
    if (rangeStart !== null && t < rangeStart) return false;
    if (rangeEnd !== null && t > rangeEnd) return false;
    return true;
  };
}

// Dedupe key. Successful/errored images dedupe so the same image (which is
// copied across every history snapshot + the live doc) appears once.
//   - has URL              → dedupe on URL
//   - errored, no URL      → dedupe on campaign+timestamp+error (snapshots repeat)
//   - generating, no URL   → never deduped (each pending slot is distinct)
function dedupeKey(img) {
  if (img.url) return `url:${img.url}`;
  if (img.status === "error") {
    return `err:${img.campaignId || ""}:${tsMs(img.timestamp)}:${img.error || ""}`;
  }
  return null; // generating — keep all
}

/**
 * Assemble the paginated AdFactory image list.
 *
 * @param {Object}   p
 * @param {Array}    p.campaigns  live Campaign docs (lean)
 * @param {Array}    p.histories  CampaignHistory docs (lean)
 * @param {string}  [p.startDate] dd-MM-yyyy
 * @param {string}  [p.endDate]   dd-MM-yyyy
 * @param {number}  [p.skip=0]
 * @param {number}  [p.limit=20]
 * @param {number}  [p.now]       reference time (ms) for generating placeholders
 * @returns {{ total:number, skip:number, limit:number, counts:Object, data:Array }}
 */
function assembleAdFactoryImages({
  campaigns = [],
  histories = [],
  startDate,
  endDate,
  skip = 0,
  limit = 20,
  now = Date.now(),
} = {}) {
  const safeSkip = Math.max(0, Number(skip) || 0);
  const safeLimit = Math.max(1, Number(limit) || 20);
  const inRange = buildInRange({ startDate, endDate });

  const all = [];

  // 1. Live campaigns — success + generating + error.
  for (const c of campaigns || []) {
    const model = resolveImageModel(c?.services);
    const campaignId = c?.metadata?.campaignId || c?._id?.toString?.() || null;
    const campaignName = c?.metadata?.campaignName || null;
    for (const entry of c?.results?.image || []) {
      all.push(mapImageEntry(entry, { campaignId, campaignName, model, origin: "live", now }));
    }
  }

  // 2. History snapshots — success + error only (generating is stale here).
  for (const h of histories || []) {
    const prev = h?.previousData || {};
    const model = resolveImageModel(prev?.services);
    const campaignId = h?.campaignId || prev?.metadata?.campaignId || null;
    const campaignName = prev?.metadata?.campaignName || null;
    for (const entry of prev?.results?.image || []) {
      const mapped = mapImageEntry(entry, { campaignId, campaignName, model, origin: "history", now });
      if (mapped.status === "generating") continue;
      all.push(mapped);
    }
  }

  // 3. Date-range filter on the (effective) timestamp.
  const filtered = all.filter((m) => inRange(m.timestamp));

  // 4. Dedupe.
  const seen = new Set();
  const deduped = [];
  for (const img of filtered) {
    const key = dedupeKey(img);
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    deduped.push(img);
  }

  // 5. Sort newest-first.
  deduped.sort((a, b) => tsMs(b.timestamp) - tsMs(a.timestamp));

  // 6. Counts over the full deduped set.
  const counts = { success: 0, generating: 0, error: 0 };
  for (const img of deduped) counts[img.status] = (counts[img.status] || 0) + 1;

  // 7. Paginate.
  const data = deduped.slice(safeSkip, safeSkip + safeLimit);

  return { total: deduped.length, skip: safeSkip, limit: safeLimit, counts, data };
}

module.exports = {
  resolveImageUrl,
  resolveAspectRatio,
  resolveImageModel,
  classifyStatus,
  mapImageEntry,
  buildInRange,
  dedupeKey,
  assembleAdFactoryImages,
};
