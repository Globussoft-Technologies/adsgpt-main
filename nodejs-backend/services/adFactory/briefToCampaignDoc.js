/**
 * briefToCampaignDoc — brief → the Campaign document the engine runs on.
 *
 * PURE. No DB, no SDK, no network. Returns a plain object; the caller writes it.
 *
 * Why this exists
 * ---------------
 * Everything downstream of the brief is already built, and all of it is
 * Campaign-shaped:
 *
 *   • `AdsFactoryJob.campaignId` is `required, ref: "Campaign"`
 *   • the orchestrator loads its generation input with
 *     `Campaign.findById(job.campaignId)` and then polls the Campaign
 *     collection for results
 *   • `controllers/adFactory.js` → `sendAdFactoryRequest` reads a Campaign and
 *     is the only thing that talks to Python
 *   • credits freeze and settle against `campaign:<metadata.campaignId>`
 *
 * So the cheapest correct way to give Quick setup an automation is to hand that
 * machinery the document it already expects. This mapper is that hand-off. No
 * orchestrator change, no new Python contract, no second credit meter.
 *
 * Direction is one-way. The brief is the record and this output is a
 * projection: it is rewritten from the brief, never merged back. The `existing`
 * argument exists only to preserve fields Quick setup does not model (see
 * PRESERVED_FROM_EXISTING), so adopting a Full control campaign and then
 * editing it in Quick setup cannot silently drop that campaign's own data.
 *
 * Two traps, both load-bearing
 * ----------------------------
 *  1. `objectives.primaryObjective` on a Campaign is FREE TEXT that feeds copy
 *     generation — it is the user's stated goal, not a Meta enum. Writing
 *     `OUTCOME_SALES` there hands the generator a token instead of a sentence
 *     and measurably degrades the copy. The enum lives on the brief for the
 *     Meta boundary (templateSynthesizer reads it) and is never sent here.
 *
 *  2. `sendAdFactoryRequest` gates on all five nodes having
 *     `status === "success"` (its `requiredNodes` check). A projection is
 *     complete by construction — there are no half-filled modals in Quick setup
 *     — so the statuses are set here rather than patched in later by whoever
 *     happens to call it.
 */

// ─── Field policy ────────────────────────────────────────────────────────────

/**
 * Brief fields with no Campaign home, listed so the omission is a decision
 * rather than an oversight. None of these are lost: the brief is the record and
 * keeps them. They are simply not part of the projection.
 *
 * `test/adFactory/modeRoundTrip.test.js` asserts this list is exhaustive, so
 * adding a brief field without deciding its projection breaks the build.
 */
const CAMPAIGN_HAS_NO_HOME_FOR = Object.freeze([
  "offer.primaryObjective", // Meta enum — trap 1 above; goes to the template
  "offer.conversionLocation", // Meta wizard cell — goes to the template
  "offer.cta.url", // becomes the template's linkUrl at job creation
  "delivery.budget", // becomes the template's dailyBudget
  "delivery.frequency", // becomes AdsFactoryJob.schedule
  "delivery.pairsPerCycle", // becomes AdsFactoryJob.pairsPerCycle
  "provenance", // brief-only: the trust layer
  "source", // brief-only: where the inference came from
]);

/**
 * Campaign fields Quick setup does not model and must therefore never clear.
 * These only ever hold data when the campaign was authored in Full control, and
 * dropping them on a Quick setup save is the silent data loss that would kill
 * trust in the mode switch.
 */
const PRESERVED_FROM_EXISTING = Object.freeze([
  "creatives",
  "customCreatives",
  "results",
  "fbMetaData",
  "googleMetaData",
  "history",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});
const text = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) =>
  Array.isArray(v) ? v.filter((x) => x != null && x !== "").map((x) => (typeof x === "string" ? x.trim() : x)) : [];

const count = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const DEFAULT_PLATFORMS = ["meta"];
const DEFAULT_RATIOS = ["1:1", "4:5"];
const DEFAULT_COUNT = 3;

// Platforms the Campaign's `distribution` enum accepts. A brief carrying
// something else (a future platform, a typo from a hand-edited document) is
// dropped rather than written, because an unknown value fails Mongoose
// validation on save and would take the whole projection down with it.
const KNOWN_PLATFORMS = new Set([
  "meta",
  "google",
  "tiktok",
  "snapchat",
  "linkedin",
  "twitter",
  "pinterest",
  "reddit",
  "whatsapp",
  "youtube",
]);

class BriefProjectionError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "BriefProjectionError";
    this.code = "BRIEF_PROJECTION_INVALID";
    this.field = field;
  }
}

/**
 * A campaign name that is stable for a brief and unique per user.
 *
 * `createCampaign` rejects a duplicate `metadata.campaignName` for the same
 * user, and Quick setup never asks for a name — so one is derived. The brief id
 * suffix is what keeps two briefs for the same site from colliding; without it
 * a user reading the same page twice would hit a 409 they cannot act on.
 */
function campaignNameFor(brief) {
  const label =
    text(brief?.brand?.name) ||
    hostOf(text(brief?.source?.url)) ||
    "Quick setup";
  const suffix = String(brief?._id || brief?.id || "").slice(-6);
  const name = suffix ? `${label} (${suffix})` : label;
  // metadata.campaignName has no explicit maxlength, but Meta's own campaign
  // name limit is what this eventually feeds, so keep it sane.
  return name.slice(0, 120);
}

function hostOf(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * @param {object} brief      An AdFactoryBrief document or plain object.
 * @param {object} [opts]
 * @param {object} [opts.existing]  The campaign being rewritten, when there is
 *                                  one. Only PRESERVED_FROM_EXISTING is read
 *                                  from it.
 * @returns {object} Campaign document fields, ready for create or $set.
 * @throws {BriefProjectionError} when the brief cannot produce a runnable
 *         campaign. Thrown rather than defaulted: a campaign with no user or no
 *         services generates nothing, and failing here is far cheaper to
 *         diagnose than an empty run three steps later.
 */
function briefToCampaignDoc(brief, opts = {}) {
  const b = plain(brief);
  const userId = text(b.userId);
  if (!userId) {
    throw new BriefProjectionError("brief has no userId", "userId");
  }

  const brand = plain(b.brand);
  const offer = plain(b.offer);
  const delivery = plain(b.delivery);
  const generation = plain(b.generation);
  const existing = plain(opts.existing);

  // ── brandInfo ──────────────────────────────────────────────────────────────
  const brandInfo = {
    brandName: text(brand.name),
    brandDescription: text(brand.description),
    brandLogo: list(brand.logoUrls),
    brandVoice: list(brand.voice),
    category: text(brand.category),
    brandGuidelines: {
      toneOfVoice: text(brand.tone),
      dos: list(brand.dos),
      donts: list(brand.donts),
      colorPalette: list(brand.palette),
    },
    type: "brandInfo",
    status: "success",
  };

  // ── objectives ─────────────────────────────────────────────────────────────
  // `primaryObjective` is the user's own words (trap 1). The Meta enum stays on
  // the brief.
  const cta = plain(offer.cta);
  const objectives = {
    primaryObjective: text(offer.statedGoal),
    promotionalInfo: list(offer.promotions),
    coreIdea: text(offer.coreIdea),
    // The Campaign models CTA as a list; the brief resolves exactly one button.
    callToAction: text(cta.button) ? [text(cta.button)] : [],
    additionalGuidelines: text(offer.notes),
    targetAudience: list(offer.audience),
    type: "objectives",
    status: "success",
  };

  // ── assets ─────────────────────────────────────────────────────────────────
  // The page's own imagery seeds the creatives. v1 required an upload here;
  // this is the field that removes it.
  const assets = {
    keyVisuals: { type: "image", urls: list(generation.seedImages) },
    type: "assets",
    status: "success",
  };

  // ── distribution ───────────────────────────────────────────────────────────
  const ratios = list(delivery.ratios).length ? list(delivery.ratios) : [...DEFAULT_RATIOS];
  const platforms = list(delivery.platforms).filter((p) => KNOWN_PLATFORMS.has(p));
  const distribution = {
    platforms: (platforms.length ? platforms : DEFAULT_PLATFORMS).map((platformName) => ({
      platformName,
      creativeRatios: ratios,
    })),
    type: "distribution",
    status: "success",
  };

  // ── services ───────────────────────────────────────────────────────────────
  // Only non-zero services are listed. The orchestrator warns loudly on an
  // empty servicesSelected and then generates nothing, so a brief that asks for
  // no images and no copy is refused here instead.
  const imageCount = count(generation.imageCount, DEFAULT_COUNT);
  const textCount = count(generation.textCount, DEFAULT_COUNT);
  const servicesSelected = [];
  if (textCount > 0) {
    servicesSelected.push({
      serviceName: "text",
      serviceParams: { quantity: textCount, model: text(generation.textModel) || "auto" },
      generated: 0,
    });
  }
  if (imageCount > 0) {
    servicesSelected.push({
      serviceName: "image",
      serviceParams: { quantity: imageCount, model: text(generation.imageModel) || "auto" },
      generated: 0,
    });
  }
  if (servicesSelected.length === 0) {
    throw new BriefProjectionError(
      "brief requests neither images nor copy, so a run would produce nothing",
      "generation",
    );
  }

  const doc = {
    userId,
    metadata: {
      campaignName: campaignNameFor(b),
      type: "metadata",
    },
    brandInfo,
    objectives,
    assets,
    distribution,
    services: { servicesSelected, type: "services", status: "success" },
    status: "draft",
  };

  // Carry across anything Quick setup does not model. Only keys actually
  // present are copied, so a fresh projection stays clean rather than gaining a
  // row of empty defaults.
  for (const key of PRESERVED_FROM_EXISTING) {
    if (existing[key] !== undefined) doc[key] = existing[key];
  }

  return doc;
}

module.exports = {
  briefToCampaignDoc,
  campaignNameFor,
  BriefProjectionError,
  CAMPAIGN_HAS_NO_HOME_FOR,
  PRESERVED_FROM_EXISTING,
  _internals: { hostOf, KNOWN_PLATFORMS, DEFAULT_RATIOS, DEFAULT_COUNT },
};
