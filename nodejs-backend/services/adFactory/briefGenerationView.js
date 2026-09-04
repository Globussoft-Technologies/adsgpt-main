/**
 * briefGenerationView — the campaign's generation state, as the preview screen
 * needs it.
 *
 * PURE. No DB, no SDK, no network.
 *
 * Quick setup keeps no results of its own: generation rides the v1 campaign
 * pipeline, so Python writes to `campaign.results` exactly as it always has and
 * there is one webhook, one credit meter and one place results live. This is
 * the read side of that decision.
 *
 * Three properties of `campaign.results` make a naive read wrong, and all three
 * are learned from how the orchestrator handles the same arrays:
 *
 *   1. The arrays are APPEND-ONLY ACROSS RUNS. The orchestrator pushes one
 *      empty slot per requested item before every run, so after three cycles
 *      the array holds three runs' worth. Reading all of it shows the user ads
 *      from last week alongside the ones they just made.
 *
 *   2. Empty placeholder slots are normal. A slot is pushed as `{}` and filled
 *      by the webhook, so `status`/`data` are absent until Python answers. They
 *      are pending, not failures, and must not render as broken cards.
 *
 *   3. Python does not guarantee the last N entries are this run's successful
 *      ones — a stale placeholder can sit at the tail. So filter to real
 *      results FIRST, then take the last N. Slicing before filtering is the
 *      bug that previously made successful runs report as failures in run
 *      history.
 *
 * Image and copy are paired by INDEX, which is the same pairing
 * `buildCreativesFromResults` uses when it posts them, so the preview shows the
 * user the pairs that would actually go live rather than an arbitrary mix.
 */

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});
const arr = (v) => (Array.isArray(v) ? v : []);

const DEFAULT_LIMIT = 3;

// A slot Python has actually answered with something usable.
const isDelivered = (entry) => {
  const e = plain(entry);
  return e.status === 200 && e.data != null && e.data !== "";
};

// A slot Python answered with a failure — worth showing, unlike a pending one.
const isFailed = (entry) => {
  const e = plain(entry);
  return Boolean(e.error) || (typeof e.status === "number" && e.status !== 200);
};

/**
 * Copy comes back as either a string or an object; the schema types it Mixed.
 * Normalise so the card never has to branch, and never renders "[object
 * Object]" because a shape changed upstream.
 */
function normalizeCopy(data) {
  if (data == null) return null;
  if (typeof data === "string") return { primaryText: data, headline: "", description: "" };
  const d = plain(data);

  // Python generates DISTINCT copy per platform, nested under the platform key
  // and snake_cased: { meta: { headline, primary_text, description },
  //                    google: { headline, description } }
  //
  // This is what the orchestrator's buildCreativesFromResults reads
  // (textData.meta.primary_text / textData.google.description), so the preview
  // must read the same place or it shows blank cards for copy that exists and
  // is about to be posted. Meta first because Quick setup is Meta-first; the
  // flat shapes after it are older/simpler responses, kept so a change upstream
  // degrades instead of blanking.
  const meta = plain(d.meta);
  const google = plain(d.google);

  const headline = meta.headline || google.headline || d.headline || d.title || "";
  const primaryText =
    meta.primary_text ||
    google.description ||
    d.primaryText ||
    d.primary_text ||
    d.message ||
    d.body ||
    d.text ||
    "";
  const description = meta.description || google.description || d.description || "";

  return { primaryText, headline, description, meta, google };
}

/**
 * @param {object} campaign  A Campaign document or plain object.
 * @param {object} [opts]
 * @param {number} [opts.since]  Index the CURRENT run starts at, from
 *                               runSlices.sliceRuns. Preferred over `limit`:
 *                               it is the real boundary between this run and
 *                               the last, whereas the quantity setting is only
 *                               a proxy and goes wrong the moment the user
 *                               changes "ads per run" between runs.
 * @param {number} [opts.limit]  Fallback when there is no history to bound
 *                               against — the campaign's own image quantity.
 * @returns {{ status, images, texts, pairs, pending, failed, requested }}
 */
function briefGenerationView(campaign, opts = {}) {
  const c = plain(campaign);
  const results = plain(c.results);

  const rawImages = arr(results.image).map(plain);
  const rawTexts = arr(results.text).map(plain);

  const requestedFromServices = () => {
    const selected = arr(plain(c.services).servicesSelected).map(plain);
    const image = selected.find((s) => s.serviceName === "image");
    const n = Number(plain(image?.serviceParams).quantity);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
  };

  const limit = Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0
    ? Math.floor(Number(opts.limit))
    : requestedFromServices();

  // Filter FIRST, then take this run's slice — see property 3 above.
  //
  // `since` is the exact boundary the previous run ended at, so it is used
  // whenever the caller knows it. The quantity-based tail is only a guess: with
  // "ads per run" changed from 3 to 1 between runs it shows one ad for a run
  // that made three, which is precisely what was on screen before this.
  const deliveredImages = rawImages.filter(isDelivered);
  const deliveredTexts = rawTexts.filter(isDelivered);
  const from = Number.isFinite(Number(opts.since)) && Number(opts.since) >= 0
    ? Math.min(Number(opts.since), deliveredImages.length)
    : Math.max(0, deliveredImages.length - limit);

  const images = deliveredImages.slice(from);
  const texts = deliveredTexts.slice(from);

  // ── This run's own slots ───────────────────────────────────────────────────
  //
  // `limit` is the campaign's CURRENT image quantity, and pending used to be
  // derived from it: `limit - delivered - failed`. That reads the setting, not
  // the run. Raising "ads per generate" from 3 to 14 rewrites
  // `services.servicesSelected` — `updateBrief` re-materialises the campaign on
  // every edit — so a finished run that produced one ad immediately reported
  // thirteen pending, and drew thirteen skeletons that could never fill.
  //
  // The authoritative count is the SLOTS. `resultSlots` pre-allocates one empty
  // entry per requested item before the request goes out, so the entries from
  // this run's boundary onward are exactly what this run asked for — fixed at
  // the moment it started and immune to later edits.
  //
  // `from` indexes the DELIVERED-filtered array, so it has to be walked back to
  // a raw index before the raw entries can be sliced. Mixing the two is what
  // makes counts like this drift in the first place.
  let rawFrom = rawImages.length;
  let seenDelivered = 0;
  for (let i = 0; i < rawImages.length; i += 1) {
    if (seenDelivered >= from) {
      rawFrom = i;
      break;
    }
    if (isDelivered(rawImages[i])) seenDelivered += 1;
    rawFrom = i + 1;
  }

  const runSlots = rawImages.slice(rawFrom);
  const failed = runSlots.filter(isFailed).length;
  // Neither answered nor refused: an empty slot Python has yet to write to.
  const awaiting = runSlots.length - runSlots.filter(isDelivered).length - failed;

  // A campaign with no pre-allocated slots predates resultSlots; fall back to
  // the quantity so those briefs still render something sane.
  const requested = runSlots.length > 0 ? runSlots.length : limit;

  // Index pairing, matching how these are posted.
  const pairs = images.map((image, i) => ({
    imageUrl: image.data,
    prompt: image.prompt || "",
    copy: normalizeCopy(texts[i]?.data),
  }));

  // The campaign owns generation state; the brief deliberately does not
  // duplicate it. `results.status` is what the orchestrator and the webhook
  // both write, so it is the one to read.
  const isStale =
    c.updatedAt &&
    Date.now() - new Date(c.updatedAt).getTime() > 4 * 60 * 1000;

  const running =
    (results.status === "in-progress" || c.status === "in-progress") && !isStale;

  // Skeletons are a promise that something is still coming. A run that has
  // stopped has nothing coming, whatever its slots look like — an empty slot
  // left behind by a crashed cycle must not spin forever.
  const pending = running
    ? Math.max(0, runSlots.length > 0 ? awaiting : limit - images.length - failed)
    : 0;

  const status =
    running
      ? "running"
      : failed > 0 && images.length > 0
        ? "partial"
        : failed > 0
          ? "failed"
          : images.length > 0
            ? "success"
            : "idle";

  return { status, images, texts, pairs, pending, failed, requested };
}

module.exports = { briefGenerationView, _internals: { isDelivered, isFailed, normalizeCopy } };
