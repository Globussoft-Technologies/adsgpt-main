/**
 * campaignDocToBrief — a Full control campaign → an editable brief.
 *
 * PURE. No DB, no SDK, no network.
 *
 * Scope: adoption, not sync
 * -------------------------
 * This runs in exactly one situation — a user opens Quick setup on a campaign
 * that was authored on the canvas and has no brief yet. It builds the brief
 * that campaign would have produced, so the switch is a render change rather
 * than "start again".
 *
 * It is NOT the reverse leg of a two-way sync. Once a brief exists it is the
 * record, and `briefToCampaignDoc` projects forward from it; nothing reads
 * brief state back out of a campaign. A two-way sync would need a conflict
 * policy for every field, and the previous attempt at this feature is a good
 * demonstration of what that costs.
 *
 * Everything here is user-authored
 * --------------------------------
 * A v1 campaign's fields were typed by a person, so provenance is recorded as
 * `source: "user", confidence: 1` throughout. That is not a formality: the UI
 * flags low-confidence fields as "worth a look", and flagging a value the user
 * typed themselves would be nonsense.
 *
 * The one genuine inference is the Meta objective. A Campaign stores
 * `objectives.primaryObjective` as free text ("get more online sales"), while
 * the template synthesizer needs a wizardSchema cell. `briefMapper`'s
 * `resolveObjective` already does exactly that mapping and takes exactly this
 * shape, so it is reused rather than reimplemented — one heuristic, one place
 * to correct it.
 */

const { _internals: mapperInternals, CONFIDENCE } = require("./briefMapper");

const { resolveObjective } = mapperInternals;

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});
const text = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) =>
  Array.isArray(v) ? v.filter((x) => x != null && x !== "").map((x) => (typeof x === "string" ? x.trim() : x)) : [];

const DEFAULT_COUNT = 3;

/**
 * @param {object} campaign  A Campaign document or plain object.
 * @param {object} [opts]
 * @param {string} [opts.url]  Destination URL, when the caller knows one. A
 *                             Campaign has no link field of its own — the URL
 *                             lives in the automation's template payload — so
 *                             it is passed in rather than guessed.
 * @returns {object} Brief fields: source, brand, offer, delivery, generation,
 *                   provenance, status. Never a saved document.
 */
function campaignDocToBrief(campaign, opts = {}) {
  const c = plain(campaign);
  const brandInfo = plain(c.brandInfo);
  const guidelines = plain(brandInfo.brandGuidelines);
  const objectives = plain(c.objectives);
  const assets = plain(c.assets);
  const distribution = plain(c.distribution);
  const services = plain(c.services);

  const provenance = {};
  const note = (path, confidence = 1, evidence = "you entered this", source = "user") => {
    provenance[path] = { source, confidence, evidence };
  };

  // ── Brand ────────────────────────────────────────────────────────────────
  const brand = {
    name: text(brandInfo.brandName),
    description: text(brandInfo.brandDescription),
    category: text(brandInfo.category),
    logoUrls: list(brandInfo.brandLogo),
    voice: list(brandInfo.brandVoice),
    tone: text(guidelines.toneOfVoice),
    dos: list(guidelines.dos),
    donts: list(guidelines.donts),
    palette: list(guidelines.colorPalette),
  };
  for (const [key, value] of Object.entries(brand)) {
    if (Array.isArray(value) ? value.length : value) note(`brand.${key}`);
  }

  // ── Offer ────────────────────────────────────────────────────────────────
  // The free-text goal is preserved verbatim as `statedGoal`; the Meta enum is
  // derived from it. Both are kept — the first feeds copy generation, the
  // second feeds the template.
  const statedGoal = text(objectives.primaryObjective);
  const resolved = resolveObjective(objectives, brandInfo);

  const offer = {
    primaryObjective: resolved.objective,
    conversionLocation: resolved.conversionLocation,
    statedGoal,
    coreIdea: text(objectives.coreIdea),
    notes: text(objectives.additionalGuidelines),
    audience: list(objectives.targetAudience),
    promotions: list(objectives.promotionalInfo),
    cta: {
      // The Campaign models CTA as a list; the brief resolves exactly one.
      button: text(list(objectives.callToAction)[0]),
      url: text(opts.url),
    },
  };

  if (statedGoal) note("offer.statedGoal");
  if (offer.coreIdea) note("offer.coreIdea");
  if (offer.notes) note("offer.notes");
  if (offer.audience.length) note("offer.audience");
  if (offer.promotions.length) note("offer.promotions");
  if (offer.cta.button) note("offer.cta.button");
  if (offer.cta.url) note("offer.cta.url");

  // The objective is ours, not the user's — record it honestly so the UI can
  // flag it for a look rather than presenting a guess as a settled value.
  note("offer.primaryObjective", resolved.confidence, resolved.evidence, "inferred");

  // ── Delivery ─────────────────────────────────────────────────────────────
  // Budget and schedule are absent by construction: they live on the
  // AdsFactoryJob, not the Campaign. A campaign with an automation already has
  // them there, and one without has never had them. Either way the Quick setup
  // budget field is the right place to ask.
  const platformRows = list(distribution.platforms).map(plain);
  const delivery = {
    platforms: platformRows.map((p) => text(p.platformName)).filter(Boolean),
    // Ratios are per-platform on a Campaign and flat on a brief. Union them so
    // a multi-platform campaign doesn't silently lose the ratios that only one
    // platform asked for.
    ratios: [...new Set(platformRows.flatMap((p) => list(p.creativeRatios)))],
  };
  if (delivery.platforms.length) note("delivery.platforms");
  if (delivery.ratios.length) note("delivery.ratios");

  // ── Generation ───────────────────────────────────────────────────────────
  const selected = list(services.servicesSelected).map(plain);
  const byName = (name) => selected.find((s) => text(s.serviceName) === name);
  const quantityOf = (name) => {
    const n = Number(plain(byName(name)?.serviceParams).quantity);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_COUNT;
  };

  const generation = {
    seedImages: list(plain(assets.keyVisuals).urls),
    imageCount: quantityOf("image"),
    textCount: quantityOf("text"),
    imageModel: text(plain(byName("image")?.serviceParams).model) || "auto",
    textModel: text(plain(byName("text")?.serviceParams).model) || null,
  };
  if (generation.seedImages.length) note("generation.seedImages");

  // ── Status ───────────────────────────────────────────────────────────────
  // Same rule briefMapper uses: a brief is usable once it has a name or a
  // description. An empty draft campaign adopts as `needs_input` rather than
  // presenting a blank brief as though inference had succeeded.
  const status = brand.name || brand.description ? "draft" : "needs_input";

  return {
    source: { type: "campaign", url: text(opts.url) },
    brand,
    offer,
    delivery,
    generation,
    provenance,
    status,
  };
}

module.exports = { campaignDocToBrief, CONFIDENCE };
