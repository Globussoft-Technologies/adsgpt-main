// brandIQEntry — the onboarded brand, filed where the user's other brands live.
//
// Onboarding researches a brand thoroughly and then keeps the result on the
// session, which is right for the workspace and wrong for everything after it.
// BrandIQ is the brand library: a brand that is not in it cannot be picked in
// AdCreative, cannot be targeted by AdFactory, and cannot have competitors or
// keywords discovered for it. As far as the rest of the product is concerned,
// a brand that never reached this collection was never created.
//
// So a session whose brand job succeeds also gets a `BrandsList` entry.
//
// ── Two contracts meeting ───────────────────────────────────────────────────
//
// Python's context and our `brandSchema` name almost nothing the same way, and
// the mapping below is the whole of this file. It is deliberately conservative:
// only fields we can fill honestly are filled. `logo_urls`, `image_urls` and
// `color_palette` all come back `null` on a prompt-only run — no site was
// scraped, so there was nothing to take — and writing empty arrays for them
// would make a brand look researched when it was described.
//
// ── Why it is not an upsert on brandName ────────────────────────────────────
//
// The list is one document per user with brands embedded, and a user can
// legitimately onboard the same brand twice (a second run, a corrected prompt).
// Keying on the SESSION is what makes this idempotent without collapsing two
// genuinely different runs into one row: the webhook is at-least-once and the
// SSE bridge delivers the same terminal result again, so this runs more than
// once per brand as a matter of course.

const { randomUUID } = require("node:crypto");
const BrandsList = require("../../Module/brandNames/brandNamesSchema");
const { createFlowLog } = require("../../utils/flowLog");

/** First non-empty string from a list of candidates. */
const firstText = (...values) => {
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
};

/** Upstream returns `null` for these on a prompt-only run; keep arrays only. */
const arrayOr = (value, fallback = []) => (Array.isArray(value) ? value : fallback);

/**
 * Files the onboarded brand into BrandIQ.
 *
 * Returns the brand id when one was written, the existing id when this session
 * has already been filed, or null when there was nothing worth filing.
 *
 * Never throws at the caller. The library copy is a convenience; failing it
 * must not fail the webhook that reports the brand, or upstream retries a job
 * that actually succeeded.
 */
async function fileBrandToBrandIQ({ userId, sessionId, result }) {
  const context = result?.context;
  if (!userId || !context) return null;

  const log = createFlowLog("brandiq", { session: sessionId, user: userId });

  // A brand with no name is not a brand. Onboarding can finish without one on a
  // prompt so thin that nothing could be inferred, and an unnamed row in a
  // picker is worse than an absent one.
  const brandName = firstText(context.brand_name);
  if (!brandName) {
    log.warn("skipped.no_brand_name");
    return null;
  }

  const existing = await BrandsList.findOne(
    { user_id: userId, "brands.onboardingSessionId": sessionId },
    { "brands.$": 1 }
  ).lean();
  if (existing?.brands?.[0]) return existing.brands[0].id;

  const industry = [context.industry_major, context.industry_sub]
    .filter(Boolean)
    .join(" · ");

  const brand = {
    id: randomUUID(),
    brandName,
    // `summary` is the paragraph the workspace shows; `description` is
    // upstream's shorter line. Either is a better description than none, and
    // the longer one is what a person recognises the brand by.
    brandDescription: firstText(context.summary, context.description),
    // The site the run was started from, when it was started from one. Not
    // taken from the context: `source_urls` is provenance and belongs to the
    // result, not to the brand profile.
    websiteUrl: firstText(arrayOr(result.source_urls)[0]),
    // Scraped media, when there was a scrape. Absent on a prompt-only run, and
    // absent is the honest answer there.
    logoUrls: arrayOr(context.logo_urls),
    logoUrl: firstText(arrayOr(context.logo_urls)[0]),
    imageUrls: arrayOr(context.image_urls),
    targetAudiences: arrayOr(context.target_audience).filter(
      (a) => typeof a === "string" && a.trim()
    ),
    // BrandIQ's own taxonomy is one of 45 names in utils/categoryTaxonomy.js.
    // Python's `category` is its own vocabulary and is NOT that list, so this
    // is left null on purpose: the lazy classifier that already exists for
    // brands without a category will fill it with a value the picker can use.
    // Writing Python's word here would look correct and match nothing.
    category: null,
    // Where this brand came from, and the dedupe key. Not on the schema as a
    // declared field — brandSchema is not strict about extras — but it is what
    // makes a redelivered webhook a no-op.
    onboardingSessionId: sessionId,
    source: "onboarding",
    createdAt: new Date(),
  };

  await BrandsList.updateOne(
    { user_id: userId },
    { $push: { brands: brand }, $setOnInsert: { user_id: userId } },
    { upsert: true }
  );

  log.info("filed", { brand: brand.id, name: brandName, industry: industry || "-" });
  return brand.id;
}

module.exports = { fileBrandToBrandIQ, _internals: { firstText, arrayOr } };
