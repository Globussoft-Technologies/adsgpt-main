/**
 * AdFactoryBrief — the single input document behind Ad Factory Quick setup.
 *
 * Replaces v1's six-modal form state (and the three Redux slices that mirrored
 * it) with one document, most of which is INFERRED rather than typed. A user
 * supplies a URL and a budget; everything else arrives from
 * `services/adFactory/briefMapper` and is presented as an editable default.
 *
 * The brief is the record; the Campaign is its projection
 * -------------------------------------------------------
 * A brief OWNS a `Campaign` document (`campaignId` below) which it materialises
 * through `services/adFactory/briefToCampaignDoc`. That campaign is not a
 * second source of truth and is never edited directly by Quick setup — it is a
 * projection, rewritten from the brief on every save that matters.
 *
 * The direction matters, so state it plainly: **brief → campaign, always.** The
 * reverse mapper (`campaignDocToBrief`) exists for exactly one job — adopting a
 * campaign that was authored in Full control and has no brief yet. It is not a
 * sync, and nothing reads brief state back out of a campaign.
 *
 * Why a projection at all, when the previous attempt deliberately removed one
 * -----------------------------------------------------------------------------
 * PR #1266 made briefs and campaigns independent collections and argued three
 * reasons for it. Each is real, and each is answered by the direction above:
 *
 *   1. "A campaign deleted in Full control orphans its brief."
 *      Ownership runs one way, so deletion does too — the brief owns the
 *      projection and tears it down with itself. A campaign carrying a brief is
 *      not the user's to delete out from under it.
 *
 *   2. "Credit settlement has two owners for one spend."
 *      It had two owners *because* generation bypassed the campaign pipeline
 *      and needed its own meter (`brief.creditHoldKey`) and its own results
 *      webhook. Riding the campaign path removes the second meter rather than
 *      adding one: the existing `campaign:<id>` freeze/settle in
 *      `controllers/adFactory.js` stays the only owner, and Python keeps
 *      posting to the one result endpoint it already knows.
 *
 *   3. "Provenance, the Meta enum and the budget have no Campaign home, so a
 *      mode switch round-trips them lossily."
 *      They are never round-tripped. They live here, on the record, and are
 *      simply not part of the projection. `test/adFactory/modeRoundTrip.test.js`
 *      pins that list so a new brief field cannot quietly acquire a lossy path.
 *
 * What the separation cost was activation. `AdsFactoryJob.campaignId` is
 * `required, ref: "Campaign"` and the orchestrator loads generation input with
 * `Campaign.findById(job.campaignId)`, so with no campaign there is no job —
 * which is why v2 could generate ads and never schedule them.
 */

const mongoose = require("mongoose");

// ─── Provenance ──────────────────────────────────────────────────────────────

// Written per inferred field by briefMapper: which field, where it came from,
// how much we trust it, and the human-readable reason. This is what powers the
// "we guessed this — check it?" affordance, and what keeps us from presenting
// our own heuristics as though the page said them.
//
// Stored as Mixed keyed by field path ("brand.voice" → { source, confidence,
// evidence }) rather than an array of rows: reads are always "what do we know
// about THIS field", and a map makes that a lookup instead of a scan.
const ProvenanceSchema = mongoose.Schema.Types.Mixed;

// ─── Sub-documents ───────────────────────────────────────────────────────────

const SourceSchema = new mongoose.Schema(
  {
    // 'url'      — inferred from a page the user pasted
    // 'brand'    — copied from a saved BrandIQ brand (zero typing)
    // 'campaign' — adopted from a Full control campaign (campaignDocToBrief)
    // 'manual'   — the fallback form, used when the others fail
    type: {
      type: String,
      enum: ["url", "brand", "campaign", "manual"],
      default: "url",
    },
    // Exactly what the user typed. This is what gets scraped, what the CTA
    // links to, and what is shown back to them.
    url: { type: String, default: "", trim: true },
    // The same page in canonical form (utils/urlKey), used ONLY to match a
    // repeat submit against an existing brief. `url` alone can't do that job:
    // `dell.com`, `https://www.dell.com/` and a UTM-tagged link are three
    // strings for one page, and each miss costs another ~35s LLM read.
    urlKey: { type: String, default: "", trim: true },
    brandId: { type: String, default: "" },
  },
  { _id: false },
);

const BrandSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true },
    logoUrls: { type: [String], default: [] },
    voice: { type: [String], default: [] },
    tone: { type: String, default: "", trim: true },
    dos: { type: [String], default: [] },
    donts: { type: [String], default: [] },
    // Hex strings, validated by briefMapper before they land here.
    palette: { type: [String], default: [] },
  },
  { _id: false },
);

const OfferSchema = new mongoose.Schema(
  {
    // A Meta objective enum, not free text — briefMapper maps the page's
    // stated goal onto a real wizardSchema cell so the template synthesizer
    // can always build from it. PROJECTION-EXEMPT: the Campaign's
    // `objectives.primaryObjective` is free text that feeds copy generation,
    // and writing an enum there degrades the copy. See briefToCampaignDoc.
    primaryObjective: { type: String, default: "" },
    conversionLocation: { type: String, default: "" },
    // The page's own words. THIS is what the projection sends as the
    // Campaign's `objectives.primaryObjective`.
    statedGoal: { type: String, default: "", trim: true },
    coreIdea: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    audience: { type: [String], default: [] },
    promotions: { type: [String], default: [] },
    cta: {
      button: { type: String, default: "" },
      url: { type: String, default: "", trim: true },
    },
  },
  { _id: false },
);

const DeliverySchema = new mongoose.Schema(
  {
    platforms: { type: [String], default: ["meta"] },
    ratios: { type: [String], default: [] },
    pairsPerCycle: { type: Number, default: 3, min: 1, max: 200 },
    budget: {
      // MAJOR currency units (₹800 → 800). Minor-unit conversion happens at
      // the Meta boundary, in the orchestrator. Never pre-multiply here.
      daily: { type: Number, default: null },
      currency: { type: String, default: "INR" },
    },
    // Mirrors AdsFactoryJob.schedule. Only populated once the user flips
    // "keep these coming"; a brief that only ever previewed leaves it null.
    frequency: {
      preset: { type: String, default: null },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
      hour: { type: Number, default: 9, min: 0, max: 23 },
      timezone: { type: String, default: "UTC" },
      // Only read when `preset === "custom"`, and REQUIRED by the job's
      // scheduleSchema in that case. Without somewhere to hold these, custom
      // cadences could not be expressed at all — the brief could name `custom`
      // but not say what it repeated on, which is a 400 at activation. That is
      // why briefToJobPayload used to refuse the word outright.
      custom: {
        repeatEvery: { type: Number, default: 1, min: 1, max: 52 },
        repeatUnit: { type: String, enum: ["day", "week"], default: "week" },
        // Lowercase day names — the queue's DOW_MAP keys.
        repeatOnDays: { type: [String], default: [] },
      },
    },
  },
  { _id: false },
);

const GenerationSchema = new mongoose.Schema(
  {
    imageModel: { type: String, default: "google" },
    textModel: { type: String, default: null },
    imageCount: { type: Number, default: 3, min: 0, max: 50 },
    textCount: { type: Number, default: 3, min: 0, max: 50 },
    // Every image the scraper found on the page. This is what removes v1's
    // mandatory asset upload — the page's own imagery seeds the creatives.
    seedImages: { type: [String], default: [] },
  },
  { _id: false },
);

// ─── Root ────────────────────────────────────────────────────────────────────

const AdFactoryBriefSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },

    // The projection this brief owns. Null only between creation and the first
    // materialisation; everything downstream (generation, activation, results,
    // credits) goes through it.
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
      index: true,
    },

    // The automation created from this brief, when there is one. Denormalised
    // from `campaign.metadata.jobId` so the deliveries screen is one read.
    jobId: { type: String, default: null },

    source: { type: SourceSchema, default: () => ({}) },
    brand: { type: BrandSchema, default: () => ({}) },
    offer: { type: OfferSchema, default: () => ({}) },
    delivery: { type: DeliverySchema, default: () => ({}) },
    generation: { type: GenerationSchema, default: () => ({}) },

    // Who gets the cycle-summary email after every run.
    //
    // `briefToJobPayload` has read `brief.alertEmails` since it was written and
    // this field did not exist, so the read always returned undefined and no
    // Quick setup job ever had alerts configured — a dead branch that looked
    // wired. Stored as an array because that is what a list control edits; the
    // job flattens it to one comma-separated string at the boundary, matching
    // the Meta Autopilot's own `alerts.emailTo` convention.
    //
    // Capped at 5, which is what adsFactoryAlertService actually sends to.
    alertEmails: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => !Array.isArray(v) || v.length <= 5,
        message: "At most 5 alert recipients",
      },
    },

    provenance: { type: ProvenanceSchema, default: () => ({}) },

    // Lifecycle:
    //   inferring   — autofill is in flight
    //   needs_input — it came back too thin to use as-is
    //   failed      — autofill errored; the user is offered the brand path
    //   draft       — usable, user is editing
    //   previewing  — creatives generated, not yet launched
    //   live        — an automation is running off this brief
    //   paused / ended — mirrors the job's own lifecycle
    //
    // Deliberately NOT a generation status. One generation run's state lives on
    // the campaign (`status` + `results.status`), which is the document Python
    // writes to and the orchestrator polls. Duplicating it here would create a
    // second thing to keep in step, and the two would drift the first time a
    // run failed between the two writes.
    status: {
      type: String,
      enum: [
        "inferring",
        "needs_input",
        "failed",
        "draft",
        "previewing",
        "live",
        "paused",
        "ended",
      ],
      default: "inferring",
      index: true,
    },

    // Why inference failed, when it did. User-safe text — this is shown, not
    // just logged, so the user knows whether to retry or switch paths.
    failureReason: { type: String, default: "" },
  },
  { timestamps: true },
);

// Lookup index for the dedupe in briefService.createOrReuseUrlBrief: one brief
// per (user, canonical page).
//
// Deliberately NOT unique, and that is a decision rather than an oversight.
// Enforcement lives in the service, which is where the "reuse vs re-run"
// judgement already sits — a `failed` brief for the same page SHOULD be re-run
// rather than rejected, and a unique index cannot express that. A unique index
// would also fail to build on any account that already carries duplicates from
// before `urlKey` existed, which would take writes down rather than clean data
// up. Add one later behind a cleanup migration if the service guard ever
// proves insufficient.
//
// Partial so the brand / manual / campaign paths, which have no page, are
// exempt rather than all colliding on "".
AdFactoryBriefSchema.index(
  { userId: 1, "source.urlKey": 1 },
  {
    partialFilterExpression: {
      "source.urlKey": { $type: "string", $gt: "" },
    },
  },
);

// Newest-first listing.
AdFactoryBriefSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("AdFactoryBrief", AdFactoryBriefSchema);
