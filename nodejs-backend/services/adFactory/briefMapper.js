/**
 * briefMapper — turn an autofill response into an Ad Factory brief.
 *
 * PURE. No DB, no SDK, no network, no `process.env`. Fixture in, brief out.
 * That is deliberate: this is where every inference decision lives, so it must
 * be the easiest thing in the codebase to test.
 *
 * Python has already done the expensive work (scrape + LLM), so there is no
 * second LLM call here. Most of this file is a direct field copy; the parts
 * worth reading are:
 *
 *   • `resolveObjective` — text heuristic → Meta objective enum. This is OUR
 *     guess, not Python's, and its provenance confidence says so.
 *   • `resolveCta`       — page CTA text → a CTA the chosen cell actually
 *     allows, via config/wizardSchema. Never emits an enum Meta would reject.
 *   • `provenance`       — per-field source + confidence, which drives the
 *     "we guessed this, check it?" affordance in the UI.
 *
 * Degrade, never throw. A partial response yields a partial brief with the
 * missing fields simply absent; an empty one yields `status: "needs_input"`.
 * The user is never shown a dead end because a scrape came back thin.
 */

const { getCell, isCellImplemented } = require("../../config/wizardSchema");

// Python writes this sentinel when the LLM had nothing. Treat it as absent.
const NA = /^\s*n\s*\/?\s*a\s*$/i;

// ─── Confidence ──────────────────────────────────────────────────────────────
// Deliberately coarse. Python returns no per-field score (§10.4), so these are
// derived from where a value came from, not from any model output. Three tiers
// is enough to drive the UI: settled, fine, check-this.
const CONFIDENCE = Object.freeze({
  SCRAPED: 0.95, // injected by the scraper, not generated — logos, images
  STATED: 0.8, // LLM read it off the page
  INFERRED: 0.5, // our own heuristic over Python's text
  DEFAULTED: 0.3, // nothing to go on; a safe default was applied
});

// ─── Small helpers ───────────────────────────────────────────────────────────

const isBlank = (v) =>
  v == null || (typeof v === "string" && (!v.trim() || NA.test(v)));

const str = (v) => (isBlank(v) ? "" : String(v).trim());

// Drop blanks and N/A sentinels, de-duplicate, preserve order.
const list = (v) => {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const item of v) {
    const s = str(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

// ─── Objective heuristic ─────────────────────────────────────────────────────
// Ordered most-specific first: a page that says "buy now" AND "sign up" is a
// storefront with a newsletter, not a lead-gen page.
const OBJECTIVE_RULES = [
  {
    objective: "OUTCOME_SALES",
    conversionLocation: "WEBSITE",
    re: /\b(sell|sale|shop|buy|purchase|order|checkout|cart|storefront|e-?commerce|pricing|product)\b/i,
  },
  {
    objective: "OUTCOME_LEADS",
    conversionLocation: "WEBSITE",
    re: /\b(lead|sign[\s-]?up|signup|register|enquir|inquir|contact|demo|quote|consultation|appointment|book|subscribe|trial|waitlist)\b/i,
  },
];

// Traffic → Website is the fallback: the safest cell, the widest CTA list, and
// the one every advertiser understands.
const DEFAULT_OBJECTIVE = "OUTCOME_TRAFFIC";
const DEFAULT_CONVERSION_LOCATION = "WEBSITE";

function resolveObjective(objectives = {}, brandInfo = {}) {
  const haystack = [
    str(objectives.primaryObjective),
    str(objectives.coreIdea),
    str(brandInfo.category),
  ]
    .filter(Boolean)
    .join(" ");

  if (haystack) {
    for (const rule of OBJECTIVE_RULES) {
      if (rule.re.test(haystack)) {
        return {
          objective: rule.objective,
          conversionLocation: rule.conversionLocation,
          confidence: CONFIDENCE.INFERRED,
          evidence: `matched "${rule.objective}" cues in the page's stated goal`,
        };
      }
    }
  }

  return {
    objective: DEFAULT_OBJECTIVE,
    conversionLocation: DEFAULT_CONVERSION_LOCATION,
    confidence: CONFIDENCE.DEFAULTED,
    evidence: haystack
      ? "no clear sales or lead signal — defaulted to traffic"
      : "nothing to infer from — defaulted to traffic",
  };
}

// ─── CTA ─────────────────────────────────────────────────────────────────────
// Page button text → candidate Meta enum. The candidate is then filtered
// against the resolved cell's allowed list, so we can never emit a CTA Meta
// rejects for that objective.
const CTA_PATTERNS = [
  [/\b(shop|buy|purchase|order|add to (cart|bag))\b/i, "SHOP_NOW"],
  [/\b(sign[\s-]?up|register|join|create (an )?account)\b/i, "SIGN_UP"],
  [/\b(subscribe|newsletter)\b/i, "SUBSCRIBE"],
  [/\b(download|get the app|install)\b/i, "DOWNLOAD"],
  [/\b(contact|talk to|get in touch|message us)\b/i, "CONTACT_US"],
  [/\b(quote|estimate)\b/i, "GET_QUOTE"],
  [/\b(apply)\b/i, "APPLY_NOW"],
  [/\b(book|schedule|reserve|appointment)\b/i, "BOOK_TRAVEL"],
  [/\b(offer|deal|discount|coupon)\b/i, "GET_OFFER"],
  [/\b(learn|read|discover|explore|find out|more)\b/i, "LEARN_MORE"],
];

/**
 * @param {string[]} ctaTexts  page CTA strings, if Python supplied any
 * @param {string} objective
 * @param {string} conversionLocation
 */
function resolveCta(ctaTexts, objective, conversionLocation) {
  let cell = null;
  try {
    if (isCellImplemented(objective, conversionLocation)) {
      cell = getCell(objective, conversionLocation);
    }
  } catch {
    cell = null;
  }
  const allowed = cell?.ctas?.allowed || [];
  const fallback = cell?.ctas?.default || null;

  for (const text of list(ctaTexts)) {
    for (const [re, enumValue] of CTA_PATTERNS) {
      if (re.test(text) && allowed.includes(enumValue)) {
        return {
          button: enumValue,
          confidence: CONFIDENCE.INFERRED,
          evidence: `page call-to-action "${text}"`,
        };
      }
    }
  }

  // Python currently comments `callToAction` out of its autofill response
  // (§10.2), so this default is the live path today, not a rare edge. It is
  // still correct: the cell's own default is what the wizard would pick.
  return {
    button: fallback,
    confidence: CONFIDENCE.DEFAULTED,
    evidence: fallback
      ? "no page call-to-action available — used the objective's default"
      : "no call-to-action could be resolved",
  };
}

// ─── Mapper ──────────────────────────────────────────────────────────────────

/**
 * @param {object} autofill  `{ brandInfo, objectives, sourceUrl }` from autofillClient
 * @param {object} [opts]
 * @param {string} [opts.url]  the URL the user pasted; used for the CTA destination
 * @returns {{ brand, offer, generation, provenance, status }}
 */
function mapAutofillToBrief(autofill = {}, opts = {}) {
  const brandInfo = autofill.brandInfo || {};
  const objectives = autofill.objectives || {};
  const guidelines = brandInfo.brandGuidelines || {};
  const sourceUrl = str(opts.url) || str(autofill.sourceUrl);

  const provenance = {};
  const note = (path, confidence, evidence, source = "autofill") => {
    provenance[path] = { source, confidence, evidence };
  };

  // ── Brand ────────────────────────────────────────────────────────────────
  const brand = {};

  const name = str(brandInfo.brandName);
  if (name) {
    brand.name = name;
    note("brand.name", CONFIDENCE.STATED, "brand name read from the page");
  }

  const description = str(brandInfo.brandDescription);
  if (description) {
    brand.description = description;
    note("brand.description", CONFIDENCE.STATED, "description read from the page");
  }

  const category = str(brandInfo.category);
  if (category) {
    brand.category = category;
    note("brand.category", CONFIDENCE.STATED, "industry inferred from the page");
  }

  const voice = list(brandInfo.brandVoice);
  if (voice.length) {
    brand.voice = voice;
    note("brand.voice", CONFIDENCE.STATED, "tone adjectives from the page's copy");
  }

  const tone = str(guidelines.toneOfVoice);
  if (tone) {
    brand.tone = tone;
    note("brand.tone", CONFIDENCE.STATED, "overall tone from the page's copy");
  }

  const dos = list(guidelines.dos);
  if (dos.length) {
    brand.dos = dos;
    note("brand.dos", CONFIDENCE.STATED, "derived from the page's messaging");
  }

  const donts = list(guidelines.donts);
  if (donts.length) {
    brand.donts = donts;
    note("brand.donts", CONFIDENCE.STATED, "derived from the page's messaging");
  }

  // Palette and logos come from the scraper, not the LLM — higher confidence.
  const palette = list(guidelines.colorPalette).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  if (palette.length) {
    brand.palette = palette;
    note("brand.palette", CONFIDENCE.SCRAPED, "colours sampled from the page");
  }

  const logoUrls = list(brandInfo.brandLogo);
  if (logoUrls.length) {
    brand.logoUrls = logoUrls;
    note("brand.logoUrls", CONFIDENCE.SCRAPED, "logo detected on the page");
  }

  // ── Offer ────────────────────────────────────────────────────────────────
  const offer = {};

  const resolved = resolveObjective(objectives, brandInfo);
  offer.primaryObjective = resolved.objective;
  offer.conversionLocation = resolved.conversionLocation;
  note("offer.primaryObjective", resolved.confidence, resolved.evidence);

  const statedObjective = str(objectives.primaryObjective);
  if (statedObjective) {
    offer.statedGoal = statedObjective;
    note("offer.statedGoal", CONFIDENCE.STATED, "the page's own stated goal");
  }

  const coreIdea = str(objectives.coreIdea);
  if (coreIdea) {
    offer.coreIdea = coreIdea;
    note("offer.coreIdea", CONFIDENCE.STATED, "central message from the page");
  }

  const notes = str(objectives.additionalGuidelines);
  if (notes) offer.notes = notes;

  const audience = list(objectives.targetAudience);
  if (audience.length) {
    offer.audience = audience;
    note("offer.audience", CONFIDENCE.STATED, "audience signals from the page");
  }

  // `promotionalInfo` is commented out in Python's schema today (§10.2). Read
  // it anyway so re-enabling it needs no change here.
  const promotions = list(objectives.promotionalInfo);
  if (promotions.length) {
    offer.promotions = promotions;
    note("offer.promotions", CONFIDENCE.STATED, "offers visible on the page");
  }

  const cta = resolveCta(
    objectives.callToAction,
    resolved.objective,
    resolved.conversionLocation,
  );
  offer.cta = { button: cta.button, url: sourceUrl };
  note("offer.cta.button", cta.confidence, cta.evidence);
  if (sourceUrl) {
    note("offer.cta.url", 1, "the URL you entered", "user");
  }

  // ── Generation seeds ─────────────────────────────────────────────────────
  // Every image the scraper found. This is what removes v1's mandatory asset
  // upload — the page's own imagery seeds the creatives.
  const generation = {};
  const images = list(brandInfo.brandImages);
  if (images.length) {
    generation.seedImages = images;
    note("generation.seedImages", CONFIDENCE.SCRAPED, `${images.length} images found on the page`);
  }

  // ── Status ───────────────────────────────────────────────────────────────
  // Name and description are what make a brief usable. Without both, the user
  // has to fill in the gaps — say so rather than pretending we succeeded.
  const status = brand.name || brand.description ? "draft" : "needs_input";

  return {
    brand,
    offer,
    generation,
    provenance,
    status,
    source: { type: "url", url: sourceUrl },
  };
}

/**
 * Fields whose confidence is low enough that the UI should flag them for a
 * look. Keeps the "check this?" threshold in one place instead of scattering
 * a magic number through the frontend.
 */
function lowConfidenceFields(brief, threshold = CONFIDENCE.INFERRED) {
  const out = [];
  for (const [path, meta] of Object.entries(brief?.provenance || {})) {
    if (meta && typeof meta.confidence === "number" && meta.confidence <= threshold) {
      out.push(path);
    }
  }
  return out;
}

module.exports = {
  mapAutofillToBrief,
  lowConfidenceFields,
  CONFIDENCE,
  _internals: {
    resolveObjective,
    resolveCta,
    list,
    str,
    isBlank,
    OBJECTIVE_RULES,
    CTA_PATTERNS,
    DEFAULT_OBJECTIVE,
    DEFAULT_CONVERSION_LOCATION,
  },
};
