/**
 * briefService — orchestrates URL → brief.
 *
 * Sequence: create (or reuse) the document → call autofill → map the response
 * → persist. The document is created BEFORE the slow call so the client has an
 * id to poll or subscribe with immediately, and so a crash mid-inference leaves
 * a visible `inferring` record rather than nothing at all.
 *
 * Everything interesting is delegated:
 *   • URL safety   → utils/safeUrl        (called inside autofillClient)
 *   • transport    → autofillClient
 *   • all mapping  → briefMapper          (pure)
 *
 * What lives here is the part that touches the database and decides what the
 * user sees when something goes wrong.
 */

const AdFactoryBrief = require("../../Module/adFactory/adFactoryBrief");
const Campaign = require("../../Module/adFactory/adFactory");
const { fetchAutofill, AutofillError, AUTOFILL_ERROR_CODES } = require("./autofillClient");
const { mapAutofillToBrief } = require("./briefMapper");
const { briefToCampaignDoc } = require("./briefToCampaignDoc");
const { campaignDocToBrief } = require("./campaignDocToBrief");
const { UnsafeUrlError } = require("../../utils/safeUrl");
const { canonicalUrlKey } = require("../../utils/urlKey");
const logger = require("../../utils/logger");

// Socket event fired when a brief leaves `inferring`. The client opens Quick
// setup, waits ~35s while Python reads the page, and needs to know the moment
// it's done.
//
// Autofill itself emits nothing and won't for now, but it doesn't need to:
// `runInference` below is OUR code and it is what flips the status, so the
// completion signal is ours to send. Every socket joins a room named after its
// userId on connect (`middlewares/authMiddleware.js`:
// `socket.join(socket.user.user_id)`), unconditionally and for every open tab —
// so this reaches all of the user's live clients.
//
// Without it the client would have to poll `GET /briefs/:id` for half a minute.
// Polling stays as a fallback for a client that missed the event (a reconnect
// mid-inference), but it is the safety net, not the mechanism.
const BRIEF_READY_EVENT = "adFactoryBriefReady";

function emitBriefReady(brief) {
  try {
    if (!global.io || !brief?.userId) return;
    global.io.to(brief.userId).emit(BRIEF_READY_EVENT, {
      briefId: brief._id?.toString?.() || String(brief._id),
      status: brief.status,
      failureReason: brief.failureReason || "",
    });
  } catch (err) {
    // A missing socket server must never fail the inference that just
    // succeeded — the brief is saved either way and polling will find it.
    logger.warn(`[adFactory:brief] socket emit failed: ${err.message}`);
  }
}

// Free briefs per account before metering kicks in (docs/AD_FACTORY_2.md, D2).
// Inference is cheap relative to generation, and the entire thesis of 2.0 is
// value-before-commitment — charging for the first taste contradicts it. The
// cap exists to bound abuse, not to monetise.
const FREE_BRIEF_QUOTA = 5;

/**
 * How many briefs has this user created from a URL?
 * Brand-path briefs are excluded — they cost us nothing (no scrape, no LLM).
 */
async function countInferredBriefs(userId) {
  return AdFactoryBrief.countDocuments({ userId, "source.type": "url" });
}

async function isWithinFreeQuota(userId) {
  return (await countInferredBriefs(userId)) < FREE_BRIEF_QUOTA;
}

/**
 * Create a brief from a URL, or reuse the existing one for this (user, URL).
 *
 * Returns immediately with the document in `inferring`; inference itself is
 * kicked off by the caller via `runInference` so the HTTP layer can respond
 * 202 without waiting the full autofill round trip.
 *
 * @returns {{ brief: object, isNew: boolean, reused: boolean }}
 */
/**
 * The client's IANA zone, applied only when we have one.
 *
 * `delivery.frequency.timezone` defaults to "UTC" in the schema and nothing ever
 * set it, so every Quick setup schedule ran on UTC — a user in India choosing
 * 9:00 AM got their ads at 2:30 PM. The server cannot infer this; the browser
 * reports it. Returned as a spreadable fragment so a request without one leaves
 * the schema default exactly as it was.
 */
const deliveryFor = (timezone) =>
  timezone ? { delivery: { frequency: { timezone } } } : {};

async function createOrReuseUrlBrief({ userId, url, forceRefresh = false, timezone = "" }) {
  // Match on the canonical key, not the raw string. `dell.com`,
  // `https://www.dell.com/` and the same link with a utm tag are one page, and
  // matching on `source.url` treated them as three — which is how one account
  // accumulated six briefs for one site, each having paid for its own scrape.
  const urlKey = canonicalUrlKey(url);
  const existing = urlKey
    ? await AdFactoryBrief.findOne({ userId, "source.urlKey": urlKey })
    : null;

  if (existing && !forceRefresh) {
    // Inference already running for this URL — hand back the same document
    // rather than starting a second scrape of the same page.
    if (existing.status === "inferring") {
      return { brief: existing, isNew: false, reused: true };
    }
    // A finished brief the user can already work with.
    if (["draft", "previewing", "live", "paused"].includes(existing.status)) {
      return { brief: existing, isNew: false, reused: true };
    }
    // needs_input / failed / ended fall through and are re-run below — a
    // retry of something that didn't work should actually retry.
  }

  if (existing) {
    existing.status = "inferring";
    existing.failureReason = "";
    // Backfill for briefs created before urlKey existed, so the NEXT submit of
    // this page matches instead of forking again.
    if (!existing.source?.urlKey && urlKey) existing.source.urlKey = urlKey;
    await existing.save();
    return { brief: existing, isNew: false, reused: false };
  }

  const brief = await AdFactoryBrief.create({
    userId,
    source: { type: "url", url, urlKey },
    ...deliveryFor(timezone),
    status: "inferring",
  });
  return { brief, isNew: true, reused: false };
}

/**
 * Run inference for a brief and persist the result.
 *
 * Never throws for an expected failure — the brief is moved to `failed` or
 * `needs_input` with a user-safe reason, because a dead end is the exact
 * problem 2.0 exists to remove. The caller can always offer the brand path.
 *
 * @param {object} brief   an AdFactoryBrief document
 * @param {object} [deps]  injection points for tests
 * @returns {Promise<object>} the updated document
 */
async function runInference(brief, deps = {}) {
  const { fetch = fetchAutofill, map = mapAutofillToBrief } = deps;
  const url = brief?.source?.url;

  if (!url) {
    brief.status = "failed";
    brief.failureReason = "This brief has no URL to read.";
    await brief.save();
    emitBriefReady(brief);
    return brief;
  }

  let autofill;
  try {
    autofill = await fetch(url, deps.fetchOptions || {});
  } catch (err) {
    const { status, reason } = describeInferenceFailure(err);

    // A brand-seeded brief already carries a curated name, description, logo
    // and audience — the website read was only ever going to ADD voice and
    // guidelines. Marking it `failed` throws away data we already have and
    // dead-ends a user who has everything they need to continue. Degrade to a
    // usable draft and say what's missing instead.
    const fromBrandRecord = brief.source?.type === "brand";
    const hasUsableBrand = Boolean(brief.brand?.name || brief.brand?.description);

    if (fromBrandRecord && hasUsableBrand) {
      brief.status = "draft";
      brief.failureReason =
        "We couldn't read your brand's website, so tone and guidelines are blank — fill in anything you want the ads to follow.";
    } else {
      brief.status = status;
      brief.failureReason = reason;
    }
    await brief.save();
    // Failures notify too — a client sitting on the wait screen must learn it
    // failed, not sit there until a poll eventually notices.
    emitBriefReady(brief);
    logger.warn(
      `[adFactory:brief] inference failed brief=${brief._id} code=${err?.code || err?.name} — ${reason}`,
    );
    return brief;
  }

  const mapped = map(autofill, { url });

  // On the brand path the saved record wins wherever it has a value — a user
  // curated it, and a scrape must not overwrite curation with a guess.
  const fromBrand = brief.source?.type === "brand";
  const currentBrand = brief.brand?.toObject?.() || brief.brand || {};
  const currentOffer = brief.offer?.toObject?.() || brief.offer || {};

  brief.brand = fromBrand
    ? mergeInferredOverBrand(currentBrand, mapped.brand)
    : mapped.brand;
  brief.offer = fromBrand
    ? mergeInferredOverBrand(currentOffer, mapped.offer)
    : mapped.offer;
  // Merge rather than replace: `generation` carries user-editable defaults
  // (model, counts) that inference has no opinion about.
  brief.generation = { ...(brief.generation?.toObject?.() || brief.generation || {}), ...mapped.generation };
  // Brand-sourced provenance outranks inferred provenance for the same field,
  // for the same reason the values do.
  brief.provenance = fromBrand
    ? { ...mapped.provenance, ...(brief.provenance || {}) }
    : mapped.provenance;
  // A brand-seeded brief is usable even if the scrape came back thin — it
  // already has a curated name and description.
  brief.status = fromBrand && mapped.status === "needs_input" ? "draft" : mapped.status;
  brief.failureReason = "";

  // Seed the CTA destination from the URL the user actually pasted.
  if (!brief.offer?.cta?.url) {
    brief.offer.cta = { ...(brief.offer.cta || {}), url };
  }

  await brief.save();

  // Project into the campaign the engine runs on. Deliberately non-fatal: the
  // inference the user waited ~35s for has already succeeded and is saved, so a
  // projection problem must not present as "reading your page failed". Generate
  // and activate both materialise before they act, so this is an optimisation —
  // it means the campaign already exists by the time the user presses a button.
  try {
    await materializeCampaign(brief);
  } catch (err) {
    logger.warn(
      `[adFactory:brief] projection deferred brief=${brief._id}: ${err.message}`,
    );
  }

  emitBriefReady(brief);
  return brief;
}

/**
 * Map a thrown error onto the brief's lifecycle plus a message worth showing.
 *
 * The distinction that matters to the user is "is this URL the problem, or is
 * it us?" — because it decides whether retrying is worth their time.
 */
function describeInferenceFailure(err) {
  if (err instanceof UnsafeUrlError) {
    return { status: "failed", reason: err.message };
  }
  if (err instanceof AutofillError) {
    switch (err.code) {
      case AUTOFILL_ERROR_CODES.UNUSABLE_URL:
        return {
          status: "needs_input",
          reason:
            "We couldn't read enough from that page. Try a different URL, or start from one of your saved brands.",
        };
      case AUTOFILL_ERROR_CODES.TIMEOUT:
        return {
          status: "failed",
          reason: "Reading that page took too long. Try again in a moment.",
        };
      case AUTOFILL_ERROR_CODES.NOT_CONFIGURED:
        return {
          status: "failed",
          reason: "Page reading isn't available right now. Start from a saved brand instead.",
        };
      default:
        return {
          status: "failed",
          reason: "Our page reader is unavailable right now. Try again shortly.",
        };
    }
  }
  return {
    status: "failed",
    reason: "Something went wrong reading that page. Try again, or start from a saved brand.",
  };
}

/**
 * Build a brief from a saved BrandIQ brand — the zero-typing path, and the
 * fallback whenever URL inference can't deliver.
 *
 * IMPORTANT — what a BrandIQ brand actually contains
 * --------------------------------------------------
 * A brand (`Module/brandNames/brandNamesSchema.js`, the `brands[]` subdocument)
 * stores name, description, logos, images, websiteUrl, targetAudiences, region
 * and category. It stores NO brand voice, tone, do's, don'ts or colour palette
 * — those live only on the v1 Campaign's `brandInfo`. This is precisely why
 * `BrandSelect.jsx` could only ever pipe back a name and a logo: the rest was
 * never there to pipe.
 *
 * So the brand path seeds what the record genuinely holds, then — when the
 * brand has a `websiteUrl` — runs the SAME inference as the URL path to fill in
 * the voice and guidelines. That yields a complete brief with zero typing,
 * rather than a half-empty one the user has to finish by hand.
 *
 * `brand` is the caller's already-located subdocument; this service does not
 * own brand lookup.
 *
 * @returns {Promise<{ brief: object, shouldInfer: boolean }>}
 */
async function createBrandBrief({ userId, brandId, brand, timezone = "" }) {
  const provenance = {};

  // Brand images are stored as bare S3 KEYS, not URLs — `getBrandsList` is what
  // prefixes them for the UI, so the raw subdocument this service receives has
  // e.g. "brand/logos/abc.png". Copied straight onto the brief they'd render as
  // broken <img>s and be handed to the generator as unfetchable seeds.
  const absolutise = (key) => {
    const k = String(key || "").trim();
    if (!k) return "";
    if (/^https?:\/\//i.test(k)) return k;
    return `${process.env.AWS_IMAGE_VIEW_URL || ""}${k}`;
  };
  const note = (path) => {
    provenance[path] = {
      source: "brand",
      confidence: 1,
      evidence: "from your saved brand",
    };
  };

  const websiteUrl = String(brand?.websiteUrl || "").trim();

  const brandFields = {
    name: brand?.brandName || "",
    description: brand?.brandDescription || "",
    category: brand?.category || "",
    logoUrls: (Array.isArray(brand?.logoUrls)
      ? brand.logoUrls
      : [brand?.logoUrl]
    )
      .filter(Boolean)
      .map(absolutise)
      .filter(Boolean),
    // Deliberately absent from the record — left empty here and filled by
    // inference below when a website is available.
    voice: [],
    tone: "",
    dos: [],
    donts: [],
    palette: [],
  };

  for (const [key, value] of Object.entries(brandFields)) {
    const populated = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (populated) note(`brand.${key}`);
  }

  const audience = Array.isArray(brand?.targetAudiences)
    ? brand.targetAudiences.filter(Boolean)
    : [];
  if (audience.length) note("offer.audience");

  const seedImages = Array.isArray(brand?.imageUrls)
    ? brand.imageUrls.filter(Boolean).map(absolutise).filter(Boolean)
    : [];
  if (seedImages.length) note("generation.seedImages");

  const brief = await AdFactoryBrief.create({
    userId,
    // The URL is recorded so inference can run and so the dedupe index still
    // sees this brief, but `type` stays 'brand' — that's how it was started,
    // and the free-quota count only meters the URL path.
    source: { type: "brand", brandId, url: websiteUrl },
    brand: brandFields,
    offer: { audience, cta: { url: websiteUrl } },
    generation: { seedImages },
    ...deliveryFor(timezone),
    provenance,
    // A brand with a website still owes us the voice/guidelines pass; one
    // without is immediately usable, if thinner.
    status: websiteUrl ? "inferring" : "draft",
  });

  return { brief, shouldInfer: Boolean(websiteUrl) };
}

/**
 * Merge inference over a brand-seeded brief.
 *
 * The brand record is the authority for anything it actually holds — a user
 * curated it, and a scrape must not overwrite that with a guess. Inference only
 * fills the gaps (voice, tone, do's, don'ts, palette, objective).
 */
function mergeInferredOverBrand(existing = {}, inferred = {}) {
  const out = { ...inferred };
  for (const [key, value] of Object.entries(existing)) {
    const populated = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (populated) out[key] = value;
  }
  return out;
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * Materialise the brief into the Campaign document the engine runs on.
 *
 * Everything downstream of the brief — generation, activation, results,
 * credits — is Campaign-shaped and already built. Rather than teach any of it a
 * second source, the brief hands it the document it already expects. See
 * services/adFactory/briefToCampaignDoc for the field-by-field reasoning.
 *
 * Idempotent: called on every save that matters, and safe to call twice.
 *
 * @returns {Promise<object>} the Campaign document
 */
async function materializeCampaign(brief) {
  const existing = brief.campaignId
    ? await Campaign.findOne({ _id: brief.campaignId, userId: brief.userId }).lean()
    : null;

  const doc = briefToCampaignDoc(brief, { existing });

  // ── Create ────────────────────────────────────────────────────────────────
  // Through the model, not updateOne: the `pre("save")` hook is what populates
  // `metadata.campaignId` from `_id`, and everything downstream looks the
  // campaign up by that field rather than by `_id`.
  if (!existing) {
    const campaign = await Campaign.create(doc);
    brief.campaignId = campaign._id;
    await brief.save();
    logger.info(
      `[adFactory:brief] materialised campaign=${campaign.metadata.campaignId} brief=${brief._id}`,
    );
    return campaign;
  }

  // ── Update ────────────────────────────────────────────────────────────────
  // Two things must NOT be written on an update, and both would be if the doc
  // were $set wholesale:
  //
  //   metadata — $set of a subdocument REPLACES it, which would drop
  //              `metadata.campaignId` (every downstream lookup) and
  //              `metadata.jobId` (the automation link). Only the name is
  //              rewritten, by path.
  //   status   — the orchestrator drives this through a run
  //              (in-progress → success/error) and skips a tick when it reads
  //              "in-progress". Resetting it to "draft" mid-run would let a
  //              second generation overlap the first.
  const { metadata, status, ...rest } = doc;
  await Campaign.updateOne(
    { _id: existing._id, userId: brief.userId },
    { $set: { ...rest, "metadata.campaignName": metadata.campaignName } },
  );

  return Campaign.findById(existing._id);
}

/**
 * Adopt a Full control campaign into Quick setup.
 *
 * The one place `campaignDocToBrief` is used. Creates the brief that campaign
 * would have produced and points it back at the same document, so the two modes
 * are then working on one piece of work rather than two.
 *
 * Returns the existing brief if this campaign already has one — adopting twice
 * must not fork the user's work into two records.
 */
async function adoptCampaign({ userId, campaign, url = "" }) {
  const already = await AdFactoryBrief.findOne({ userId, campaignId: campaign._id });
  if (already) return already;

  const fields = campaignDocToBrief(campaign, { url });
  return AdFactoryBrief.create({
    ...fields,
    userId,
    campaignId: campaign._id,
    jobId: campaign.metadata?.jobId || null,
  });
}

module.exports = {
  createOrReuseUrlBrief,
  runInference,
  createBrandBrief,
  mergeInferredOverBrand,
  materializeCampaign,
  adoptCampaign,
  emitBriefReady,
  BRIEF_READY_EVENT,
  countInferredBriefs,
  isWithinFreeQuota,
  describeInferenceFailure,
  FREE_BRIEF_QUOTA,
};
