// Pure helpers for merging live `adFactoryResponse` socket results into the
// AdFactory gallery's local item list. No React / no socket here so it can be
// unit-tested in isolation.
//
// A socket result entry mirrors results.image[]:
//   { status, data, error, prompt, jobId, timestamp }
// status: 200 → success, null/""/NaN → still generating, other number → error.

export function extractUrl(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return null;
  const u = data.base_image || data.url || data.data || null;
  return typeof u === 'string' ? u : null;
}

export function extractAspect(data) {
  if (!data || typeof data !== 'object') return null;
  return data.aspect_ratio || data.aspectRatio || data.aspectRatioString || null;
}

export function classifyStatus(status) {
  if (status === 200) return 'success';
  if (typeof status === 'number' && Number.isFinite(status)) return 'error';
  return 'generating';
}

const tsMs = (t) => (t ? new Date(t).getTime() : 0);

/**
 * Merge socket image results for ONE campaign into the gallery items.
 *
 * Behaviour:
 *  - Only merges when the campaign is already represented in `items` (the
 *    gallery joined that room because it was showing the campaign). Unrelated
 *    campaigns are ignored so the active date/source filter isn't violated.
 *  - Builds gallery items from success/error entries (generating entries are
 *    not resolutions and are skipped).
 *  - Dedupes new URLs against existing items.
 *  - Replaces this campaign's `generating` placeholders in order; any extra
 *    new items are prepended. Result is re-sorted newest-first.
 *
 * @returns a NEW array (or the same reference if nothing changed).
 */
export function mergeCampaignImageResults(items, campaignId, entries, now = Date.now()) {
  if (!Array.isArray(items)) return items;
  if (!campaignId || !Array.isArray(entries) || entries.length === 0) return items;

  const template = items.find((i) => i.campaignId === campaignId);
  if (!template) return items; // campaign not on screen — ignore

  const existingUrls = new Set(items.map((i) => i.url).filter(Boolean));

  const built = [];
  for (const e of entries) {
    const status = classifyStatus(e?.status);
    if (status === 'generating') continue;
    const url = extractUrl(e?.data);
    if (url && existingUrls.has(url)) continue; // already shown — skip
    if (url) existingUrls.add(url);
    built.push({
      url,
      prompt: e?.prompt || null,
      model: template.model || null,
      modelLabel: template.modelLabel || template.model || null,
      status,
      error: e?.error || null,
      aspectRatio: extractAspect(e?.data),
      campaignId,
      campaignName: template.campaignName || null,
      jobId: e?.jobId || null,
      origin: 'live',
      timestamp: e?.timestamp || new Date(now).toISOString(),
    });
  }
  if (built.length === 0) return items;

  // Replace generating placeholders for this campaign, in order.
  const next = [...items];
  let bi = 0;
  for (let i = 0; i < next.length && bi < built.length; i += 1) {
    if (next[i].campaignId === campaignId && next[i].status === 'generating') {
      next[i] = built[bi];
      bi += 1;
    }
  }
  // Extra results beyond available placeholders → prepend as fresh items.
  const merged = bi < built.length ? [...built.slice(bi), ...next] : next;

  // Keep newest-first (placeholders carried a `now` timestamp, so they stay on top).
  merged.sort((a, b) => tsMs(b.timestamp) - tsMs(a.timestamp));
  return merged;
}
