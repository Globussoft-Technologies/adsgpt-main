#!/usr/bin/env node
/**
 * The mode switch's safety net.
 *
 * Quick setup and Full control operate on the same underlying work: a brief
 * projects into a Campaign (`briefToCampaignDoc`), and a Campaign with no brief
 * adopts into one (`campaignDocToBrief`). This file pins the two properties
 * that make that switch safe to offer:
 *
 *   1. Nothing a user typed in one mode disappears because they looked at the
 *      other. Silent data loss on toggle is the one bug that would kill trust
 *      in the feature permanently.
 *
 *   2. The set of brief fields with no Campaign home is EXHAUSTIVE and
 *      declared. Those fields are not lost — the brief is the record and keeps
 *      them — but a new brief field must not be able to quietly acquire a lossy
 *      path. Adding one without deciding its projection fails here.
 *
 * Both mappers are pure, so this is fixture in / value out. No DB, no stubs.
 *
 * Run:  node test/adFactory/modeRoundTrip.test.js
 */

const assert = require("node:assert/strict");

const {
  briefToCampaignDoc,
  campaignNameFor,
  BriefProjectionError,
  CAMPAIGN_HAS_NO_HOME_FOR,
  PRESERVED_FROM_EXISTING,
} = require("../../services/adFactory/briefToCampaignDoc");
const { campaignDocToBrief } = require("../../services/adFactory/campaignDocToBrief");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A brief with EVERY field populated and every value distinguishable, so a
// mapper that crosses two wires is caught rather than passing on equal blanks.
const fullBrief = () => ({
  _id: "65b1f2c3d4e5f60718293a4b",
  userId: "user-1",
  source: { type: "url", url: "https://tulsiandco.in/collections/gift-sets" },
  brand: {
    name: "Tulsi & Co",
    description: "Small-batch botanical skincare made in Bengaluru.",
    category: "beauty",
    logoUrls: ["https://cdn.example.com/logo.png"],
    voice: ["warm", "direct", "unfussy"],
    tone: "Confident but never shouty.",
    dos: ["lead with the ritual", "name the ingredients"],
    donts: ["never promise medical results", "no before/after shots"],
    palette: ["#2C4E63", "#E8DCC8", "#1E5148"],
  },
  offer: {
    primaryObjective: "OUTCOME_SALES",
    conversionLocation: "WEBSITE",
    statedGoal: "Sell more gift sets before Diwali",
    coreIdea: "A ritual worth gifting",
    notes: "Mention free shipping over ₹999 where it fits.",
    audience: ["women 25-40", "gift buyers"],
    promotions: ["Free shipping over ₹999", "10% off sets of three"],
    cta: { button: "SHOP_NOW", url: "https://tulsiandco.in/collections/gift-sets" },
  },
  delivery: {
    platforms: ["meta", "google"],
    ratios: ["1:1", "4:5", "9:16"],
    pairsPerCycle: 3,
    budget: { daily: 800, currency: "INR" },
    frequency: { preset: "weekly", hour: 9, timezone: "Asia/Kolkata" },
  },
  generation: {
    imageModel: "google",
    textModel: "auto",
    imageCount: 3,
    textCount: 4,
    seedImages: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
  },
  provenance: {
    "brand.voice": { source: "autofill", confidence: 0.8, evidence: "page copy" },
  },
  status: "draft",
});

// A campaign authored on the v1 canvas, including the fields Quick setup has
// no control for. These are the ones a careless projection would wipe.
const v1Campaign = () => ({
  _id: "65c0000000000000000000ff",
  userId: "user-9",
  metadata: { campaignId: "65c0000000000000000000ff", campaignName: "Diwali push" },
  brandInfo: {
    brandName: "Hoja Studio",
    brandDescription: "Hand-thrown tableware.",
    category: "home",
    brandLogo: ["https://cdn.example.com/hoja.png"],
    brandVoice: ["quiet", "precise"],
    brandGuidelines: {
      toneOfVoice: "Plain and unhurried.",
      dos: ["show the maker's hands"],
      donts: ["no stock photography"],
      colorPalette: ["#4A3A5E"],
    },
  },
  objectives: {
    primaryObjective: "get more people buying from the shop",
    promotionalInfo: ["Festive bundle"],
    coreIdea: "Everyday objects, made slowly",
    callToAction: ["SHOP_NOW"],
    additionalGuidelines: "Avoid the word artisanal.",
    targetAudience: ["home cooks", "gift buyers"],
  },
  assets: { keyVisuals: { type: "image", urls: ["https://cdn.example.com/bowl.jpg"] } },
  distribution: {
    platforms: [
      { platformName: "meta", creativeRatios: ["1:1", "4:5"] },
      { platformName: "google", creativeRatios: ["1.91:1"] },
    ],
  },
  services: {
    servicesSelected: [
      { serviceName: "text", serviceParams: { quantity: 2, model: "auto" }, generated: 0 },
      { serviceName: "image", serviceParams: { quantity: 5, model: "openai" }, generated: 0 },
    ],
  },
  // Quick setup models none of these.
  creatives: [{ creativeId: "c1", imageUrl: "x", headline: "h", message: "m", linkUrl: "u", callToAction: "SHOP_NOW" }],
  customCreatives: { images: [{ data: "/creatives/hand.png", source: "upload" }], copies: [] },
  results: { text: [{ status: 200, data: "old copy" }], image: [], video: [] },
  fbMetaData: { adAccountId: "act_1", pageId: "page_1" },
  googleMetaData: { adAccountId: "goog_1" },
  history: ["65c0000000000000000000aa"],
});

// ─── brief → campaign ────────────────────────────────────────────────────────

group("brief → campaign: every field lands where the engine reads it", () => {
  const c = briefToCampaignDoc(fullBrief());

  test("brand maps onto brandInfo", () => {
    assert.equal(c.brandInfo.brandName, "Tulsi & Co");
    assert.equal(c.brandInfo.brandDescription, "Small-batch botanical skincare made in Bengaluru.");
    assert.equal(c.brandInfo.category, "beauty");
    assert.deepEqual(c.brandInfo.brandLogo, ["https://cdn.example.com/logo.png"]);
    assert.deepEqual(c.brandInfo.brandVoice, ["warm", "direct", "unfussy"]);
  });

  test("brand guidelines map into the nested guidelines object", () => {
    assert.equal(c.brandInfo.brandGuidelines.toneOfVoice, "Confident but never shouty.");
    assert.deepEqual(c.brandInfo.brandGuidelines.dos, ["lead with the ritual", "name the ingredients"]);
    assert.deepEqual(c.brandInfo.brandGuidelines.donts, [
      "never promise medical results",
      "no before/after shots",
    ]);
    assert.deepEqual(c.brandInfo.brandGuidelines.colorPalette, ["#2C4E63", "#E8DCC8", "#1E5148"]);
  });

  test("THE TRAP: objectives.primaryObjective is the stated goal, never the Meta enum", () => {
    assert.equal(c.objectives.primaryObjective, "Sell more gift sets before Diwali");
    assert.notEqual(c.objectives.primaryObjective, "OUTCOME_SALES");
    // And the enum must not have leaked in anywhere else on the campaign.
    assert.ok(!JSON.stringify(c).includes("OUTCOME_SALES"));
  });

  test("offer maps onto objectives", () => {
    assert.equal(c.objectives.coreIdea, "A ritual worth gifting");
    assert.equal(c.objectives.additionalGuidelines, "Mention free shipping over ₹999 where it fits.");
    assert.deepEqual(c.objectives.targetAudience, ["women 25-40", "gift buyers"]);
    assert.deepEqual(c.objectives.promotionalInfo, ["Free shipping over ₹999", "10% off sets of three"]);
  });

  test("the single CTA button becomes the campaign's CTA list", () => {
    assert.deepEqual(c.objectives.callToAction, ["SHOP_NOW"]);
  });

  test("seed images become keyVisuals — this is what removes v1's mandatory upload", () => {
    assert.equal(c.assets.keyVisuals.type, "image");
    assert.deepEqual(c.assets.keyVisuals.urls, [
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
  });

  test("each platform carries the brief's ratios", () => {
    assert.deepEqual(c.distribution.platforms, [
      { platformName: "meta", creativeRatios: ["1:1", "4:5", "9:16"] },
      { platformName: "google", creativeRatios: ["1:1", "4:5", "9:16"] },
    ]);
  });

  test("counts and models become servicesSelected", () => {
    const text = c.services.servicesSelected.find((s) => s.serviceName === "text");
    const image = c.services.servicesSelected.find((s) => s.serviceName === "image");
    assert.equal(text.serviceParams.quantity, 4);
    assert.equal(image.serviceParams.quantity, 3);
    assert.equal(image.serviceParams.model, "google");
  });

  test("all five nodes are success — sendAdFactoryRequest's requiredNodes gate", () => {
    for (const node of ["brandInfo", "objectives", "assets", "distribution", "services"]) {
      assert.equal(c[node].status, "success", `${node}.status`);
    }
  });

  test("the campaign name is derived, stable, and unique per brief", () => {
    const a = campaignNameFor(fullBrief());
    assert.equal(a, campaignNameFor(fullBrief()), "must be stable");
    assert.ok(a.includes("Tulsi & Co"));
    const other = campaignNameFor({ ...fullBrief(), _id: "65b1f2c3d4e5f60718290000" });
    assert.notEqual(a, other, "two briefs must not collide on campaignName");
  });

  test("a brief with no brand name falls back to the host, then a label", () => {
    const noBrand = { ...fullBrief(), brand: {} };
    assert.ok(campaignNameFor(noBrand).includes("tulsiandco.in"));
    assert.ok(campaignNameFor({ userId: "u" }).includes("Quick setup"));
  });
});

group("brief → campaign: refusals are loud, never half a document", () => {
  test("no userId throws rather than writing an unowned campaign", () => {
    assert.throws(
      () => briefToCampaignDoc({ ...fullBrief(), userId: "" }),
      (e) => e instanceof BriefProjectionError && e.field === "userId",
    );
  });

  test("asking for neither images nor copy throws instead of an empty run", () => {
    const brief = fullBrief();
    brief.generation.imageCount = 0;
    brief.generation.textCount = 0;
    assert.throws(
      () => briefToCampaignDoc(brief),
      (e) => e instanceof BriefProjectionError && e.field === "generation",
    );
  });

  test("an unknown platform is dropped, not written into an enum that rejects it", () => {
    const brief = fullBrief();
    brief.delivery.platforms = ["meta", "myspace"];
    const c = briefToCampaignDoc(brief);
    assert.deepEqual(c.distribution.platforms.map((p) => p.platformName), ["meta"]);
  });

  test("an empty platform list falls back to meta rather than generating nowhere", () => {
    const brief = fullBrief();
    brief.delivery.platforms = [];
    const c = briefToCampaignDoc(brief);
    assert.deepEqual(c.distribution.platforms.map((p) => p.platformName), ["meta"]);
  });

  test("purity: the brief is not mutated", () => {
    const brief = fullBrief();
    const before = JSON.stringify(brief);
    briefToCampaignDoc(brief);
    assert.equal(JSON.stringify(brief), before);
  });

  test("handles Mongoose-style documents", () => {
    const brief = fullBrief();
    const doc = { toObject: () => brief, ...brief };
    assert.equal(briefToCampaignDoc(doc).brandInfo.brandName, "Tulsi & Co");
  });
});

// ─── The declared-exemption rule ─────────────────────────────────────────────

group("no brief field may quietly acquire a lossy path", () => {
  // Every leaf path in the brief that briefToCampaignDoc is responsible for.
  // Compared against the mapper's own declared exemption list, so the two
  // cannot drift: add a brief field, and you must either project it or declare
  // that you deliberately did not.
  const PROJECTED = [
    "brand.name",
    "brand.description",
    "brand.category",
    "brand.logoUrls",
    "brand.voice",
    "brand.tone",
    "brand.dos",
    "brand.donts",
    "brand.palette",
    "offer.statedGoal",
    "offer.coreIdea",
    "offer.notes",
    "offer.audience",
    "offer.promotions",
    "offer.cta.button",
    "delivery.platforms",
    "delivery.ratios",
    "generation.seedImages",
    "generation.imageCount",
    "generation.textCount",
    "generation.imageModel",
    "generation.textModel",
  ];

  // Leaf paths of the fixture, which is populated everywhere on purpose.
  const leaves = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) => {
      const path = prefix ? `${prefix}.${k}` : k;
      const isPlainObject = v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
      return isPlainObject ? leaves(v, path) : [path];
    });

  test("every brief field is either projected or declared exempt", () => {
    const { _id, userId, status, provenance, source, delivery, ...rest } = fullBrief();
    // provenance/source/delivery are handled by the declared list; walk the
    // rest plus the delivery subtree so budget and frequency are covered.
    const all = [...leaves(rest), ...leaves({ delivery }), "provenance", "source"];

    const accountedFor = new Set([
      ...PROJECTED,
      ...CAMPAIGN_HAS_NO_HOME_FOR,
      // Declared-exempt subtrees cover their own leaves.
      ...CAMPAIGN_HAS_NO_HOME_FOR.flatMap((p) => all.filter((f) => f.startsWith(`${p}.`))),
    ]);

    const orphans = all.filter((f) => !accountedFor.has(f));
    assert.deepEqual(
      orphans,
      [],
      `brief fields with no declared projection: ${orphans.join(", ")}. ` +
        "Either map them in briefToCampaignDoc or add them to CAMPAIGN_HAS_NO_HOME_FOR.",
    );
  });

  test("the exemption list is honest — none of it reaches the campaign", () => {
    const c = briefToCampaignDoc(fullBrief());
    const serialized = JSON.stringify(c);
    // Values that exist ONLY on exempt fields must be absent from the projection.
    assert.ok(!serialized.includes("OUTCOME_SALES"), "Meta enum leaked");
    assert.ok(!serialized.includes("WEBSITE"), "conversion location leaked");
    assert.ok(!serialized.includes("Asia/Kolkata"), "timezone leaked");
    assert.ok(!serialized.includes("800"), "budget leaked");
  });
});

// ─── campaign → brief → campaign ─────────────────────────────────────────────

group("a v1 campaign survives adoption into Quick setup", () => {
  const original = v1Campaign();
  const brief = campaignDocToBrief(original, { url: "https://hoja.studio/shop" });

  test("brandInfo round-trips into brand", () => {
    assert.equal(brief.brand.name, "Hoja Studio");
    assert.equal(brief.brand.tone, "Plain and unhurried.");
    assert.deepEqual(brief.brand.donts, ["no stock photography"]);
    assert.deepEqual(brief.brand.palette, ["#4A3A5E"]);
  });

  test("the free-text goal is preserved verbatim, not overwritten by the enum", () => {
    assert.equal(brief.offer.statedGoal, "get more people buying from the shop");
  });

  test("a Meta enum is derived alongside it, flagged as inferred not user-typed", () => {
    assert.ok(brief.offer.primaryObjective.startsWith("OUTCOME_"));
    assert.equal(brief.provenance["offer.primaryObjective"].source, "inferred");
    assert.ok(brief.provenance["offer.primaryObjective"].confidence < 1);
  });

  test("everything the user actually typed is provenance user/1.0 — never flagged", () => {
    for (const path of ["brand.name", "offer.coreIdea", "offer.audience"]) {
      assert.equal(brief.provenance[path].source, "user", path);
      assert.equal(brief.provenance[path].confidence, 1, path);
    }
  });

  test("per-platform ratios are unioned, so no platform's ratios are dropped", () => {
    assert.deepEqual(brief.delivery.platforms, ["meta", "google"]);
    assert.deepEqual(brief.delivery.ratios, ["1:1", "4:5", "1.91:1"]);
  });

  test("service quantities and models survive", () => {
    assert.equal(brief.generation.textCount, 2);
    assert.equal(brief.generation.imageCount, 5);
    assert.equal(brief.generation.imageModel, "openai");
  });

  test("an empty campaign adopts as needs_input, not a blank draft", () => {
    assert.equal(campaignDocToBrief({ userId: "u" }).status, "needs_input");
  });

  test("purity: the campaign is not mutated", () => {
    const c = v1Campaign();
    const before = JSON.stringify(c);
    campaignDocToBrief(c);
    assert.equal(JSON.stringify(c), before);
  });
});

group("RULE 1: a Quick setup save never drops Full control's own data", () => {
  const original = v1Campaign();
  const adopted = campaignDocToBrief(original, { url: "https://hoja.studio/shop" });
  const reprojected = briefToCampaignDoc(
    { ...adopted, _id: "65b1f2c3d4e5f60718293a4b", userId: original.userId },
    { existing: original },
  );

  test("fields Quick setup does not model are carried across untouched", () => {
    for (const key of PRESERVED_FROM_EXISTING) {
      assert.deepEqual(reprojected[key], original[key], key);
    }
  });

  test("hand-added creatives and copies survive the round trip", () => {
    assert.deepEqual(reprojected.customCreatives, original.customCreatives);
    assert.equal(reprojected.creatives.length, 1);
  });

  test("prior generation results are not wiped", () => {
    assert.deepEqual(reprojected.results, original.results);
  });

  test("the live ad-account linkage survives", () => {
    assert.equal(reprojected.fbMetaData.adAccountId, "act_1");
    assert.equal(reprojected.googleMetaData.adAccountId, "goog_1");
  });

  test("editable content still round-trips correctly alongside it", () => {
    assert.equal(reprojected.objectives.primaryObjective, original.objectives.primaryObjective);
    assert.equal(reprojected.objectives.additionalGuidelines, "Avoid the word artisanal.");
    assert.deepEqual(reprojected.objectives.promotionalInfo, ["Festive bundle"]);
    assert.deepEqual(reprojected.brandInfo.brandVoice, ["quiet", "precise"]);
    assert.deepEqual(reprojected.assets.keyVisuals.urls, ["https://cdn.example.com/bowl.jpg"]);
  });

  test("a fresh projection does NOT invent those keys", () => {
    const fresh = briefToCampaignDoc(fullBrief());
    for (const key of PRESERVED_FROM_EXISTING) {
      assert.equal(fresh[key], undefined, `${key} should be absent on a new campaign`);
    }
  });
});

group("brief → campaign → brief is stable for everything the campaign holds", () => {
  const brief = fullBrief();
  const campaign = briefToCampaignDoc(brief);
  const back = campaignDocToBrief(campaign, { url: brief.offer.cta.url });

  test("brand is identical", () => {
    assert.deepEqual(back.brand, brief.brand);
  });

  test("the campaign-representable half of offer is identical", () => {
    assert.equal(back.offer.statedGoal, brief.offer.statedGoal);
    assert.equal(back.offer.coreIdea, brief.offer.coreIdea);
    assert.equal(back.offer.notes, brief.offer.notes);
    assert.deepEqual(back.offer.audience, brief.offer.audience);
    assert.deepEqual(back.offer.promotions, brief.offer.promotions);
    assert.equal(back.offer.cta.button, brief.offer.cta.button);
  });

  test("platforms, ratios and generation settings are identical", () => {
    assert.deepEqual(back.delivery.platforms, brief.delivery.platforms);
    assert.deepEqual(back.delivery.ratios, brief.delivery.ratios);
    assert.equal(back.generation.imageCount, brief.generation.imageCount);
    assert.equal(back.generation.textCount, brief.generation.textCount);
    assert.equal(back.generation.imageModel, brief.generation.imageModel);
    assert.deepEqual(back.generation.seedImages, brief.generation.seedImages);
  });

  test("a second pass changes nothing — the projection is idempotent", () => {
    const twice = briefToCampaignDoc({ ...back, _id: brief._id, userId: brief.userId });
    assert.deepEqual(twice.brandInfo, campaign.brandInfo);
    assert.deepEqual(twice.objectives, campaign.objectives);
    assert.deepEqual(twice.distribution, campaign.distribution);
    assert.deepEqual(twice.assets, campaign.assets);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
