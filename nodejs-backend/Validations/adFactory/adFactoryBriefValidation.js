/**
 * Validation for the Ad Factory 2.0 brief endpoints.
 *
 * Two rules shape this file:
 *
 *   1. CREATE takes almost nothing. The whole premise of 2.0 is that a user
 *      supplies a URL (or picks a brand) and everything else is inferred, so
 *      demanding fields here would re-import the problem we are removing.
 *
 *   2. PATCH cannot rewrite history. `provenance` records where each value came
 *      from and how much we trust it; letting a client PATCH it would let the
 *      UI launder our own guesses into "the page said so". Same for `userId`
 *      and `status` — ownership and lifecycle are the server's to decide.
 *
 * URL *safety* is deliberately NOT handled here. Joi can confirm a string looks
 * like a URL; it cannot tell you that `internal.corp` resolves to 10.0.0.5.
 * That check lives in `utils/safeUrl` and runs in the controller, because it
 * needs DNS. See docs/AD_FACTORY_2.md §8.1.
 */

const Joi = require("joi");

// Same by-construction check the autopilot schedule uses, so a zone accepted
// when the brief is created cannot be rejected when it is activated.
const { joiTimezone } = require("../../utils/timezone");

// Length ceiling on the pasted URL. Long enough for real campaign URLs with
// tracking parameters, short enough that nobody posts a novel.
const MAX_URL_LENGTH = 2048;

// ─── Create ──────────────────────────────────────────────────────────────────

// The one thing the CLIENT knows and the server cannot infer.
//
// `delivery.frequency.timezone` defaults to "UTC" in the schema and nothing was
// ever setting it, so every schedule ran on UTC: a user in India picking 9:00 AM
// got ads at 2:30 PM. The server has no way to guess — the browser does, from
// `Intl.DateTimeFormat().resolvedOptions().timeZone` — so it is taken at
// creation. Optional, because a client that doesn't send one is no worse off
// than before.
const TIMEZONE = Joi.string().trim().max(64).custom(joiTimezone);

// The URL path. `url` is the only required field in the entire flow.
const createFromUrlSchema = Joi.object({
  url: Joi.string().trim().max(MAX_URL_LENGTH).required().messages({
    "string.empty": "Paste a product or landing page URL to get started",
    "any.required": "Paste a product or landing page URL to get started",
    "string.max": `That URL is too long (max ${MAX_URL_LENGTH} characters)`,
  }),
  // Re-run inference for a URL we already have a brief for, bypassing both our
  // dedupe and (eventually) Python's 7-day cache.
  forceRefresh: Joi.boolean().default(false),
  timezone: TIMEZONE,
});

// The brand path — zero typed fields; everything comes from the saved brand.
const createFromBrandSchema = Joi.object({
  brandId: Joi.string().trim().required().messages({
    "any.required": "Pick one of your saved brands",
  }),
  timezone: TIMEZONE,
});

// ─── Update ──────────────────────────────────────────────────────────────────

// Every field the user is allowed to correct after inference. Mirrors what the
// UI actually renders as editable; anything absent here is either server-owned
// or not yet exposed.
const updateBriefSchema = Joi.object({
  brand: Joi.object({
    name: Joi.string().trim().allow("").max(200),
    description: Joi.string().trim().allow("").max(5000),
    category: Joi.string().trim().allow("").max(100),
    logoUrls: Joi.array().items(Joi.string().trim()).max(10),
    voice: Joi.array().items(Joi.string().trim().max(60)).max(10),
    tone: Joi.string().trim().allow("").max(300),
    dos: Joi.array().items(Joi.string().trim().max(200)).max(10),
    donts: Joi.array().items(Joi.string().trim().max(200)).max(10),
    palette: Joi.array()
      .items(
        Joi.string()
          .trim()
          .pattern(/^#[0-9a-fA-F]{6}$/)
          .messages({ "string.pattern.base": "Colours must be 6-digit hex, e.g. #2F4F3A" }),
      )
      .max(12),
  }),

  offer: Joi.object({
    primaryObjective: Joi.string().trim().max(60),
    conversionLocation: Joi.string().trim().max(60),
    statedGoal: Joi.string().trim().allow("").max(500),
    coreIdea: Joi.string().trim().allow("").max(1000),
    notes: Joi.string().trim().allow("").max(2000),
    audience: Joi.array().items(Joi.string().trim().max(200)).max(10),
    promotions: Joi.array().items(Joi.string().trim().max(300)).max(10),
    cta: Joi.object({
      button: Joi.string().trim().allow("").max(60),
      url: Joi.string().trim().allow("").max(MAX_URL_LENGTH),
    }),
  }),

  delivery: Joi.object({
    platforms: Joi.array().items(Joi.string().valid("meta", "google")).min(1).max(2),
    ratios: Joi.array().items(Joi.string().trim().max(10)).max(5),
    pairsPerCycle: Joi.number().integer().min(1).max(200),
    budget: Joi.object({
      // Major currency units. Positive-only: a zero budget produces a campaign
      // that silently never delivers, which is worse than an error.
      daily: Joi.number().positive().allow(null),
      currency: Joi.string().trim().uppercase().length(3),
    }),
    frequency: Joi.object({
      preset: Joi.string().trim().allow(null).max(40),
      startDate: Joi.date().iso().allow(null),
      endDate: Joi.date().iso().allow(null),
      hour: Joi.number().integer().min(0).max(23),
      timezone: TIMEZONE,
      // Read only when preset is "custom". The job's own scheduleSchema
      // REQUIRES this block in that case, so a brief that could name `custom`
      // without carrying it would 400 at activation.
      custom: Joi.object({
        repeatEvery: Joi.number().integer().min(1).max(52),
        repeatUnit: Joi.string().valid("day", "week"),
        repeatOnDays: Joi.array()
          .items(
            Joi.string()
              .lowercase()
              .valid(
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
              ),
          )
          .max(7),
      }),
    }),
  }),

  generation: Joi.object({
    imageModel: Joi.string().trim().max(40),
    textModel: Joi.string().trim().allow(null).max(40),
    imageCount: Joi.number().integer().min(0).max(50),
    textCount: Joi.number().integer().min(0).max(50),
    seedImages: Joi.array().items(Joi.string().trim()).max(50),
  }),

  // Cycle-summary recipients. Capped at 5 to match adsFactoryAlertService,
  // which only sends to the first five.
  alertEmails: Joi.array().items(Joi.string().trim().email().max(254)).max(5),
})
  .min(1)
  .messages({ "object.min": "Nothing to update" });

// Server-owned keys. Rejected by name so a client gets a clear reason rather
// than a generic "not allowed" — the difference between a developer finding
// the bug in ten seconds and in an hour.
const FORBIDDEN_UPDATE_KEYS = Object.freeze([
  "provenance",
  "userId",
  "_id",
  "status",
  "failureReason",
  "source",
  "campaignId",
  "createdAt",
  "updatedAt",
]);

/**
 * Reject attempts to write server-owned fields.
 * Returns an error message, or null when the body is clean.
 */
function rejectForbiddenKeys(body) {
  if (!body || typeof body !== "object") return null;
  const offenders = FORBIDDEN_UPDATE_KEYS.filter((k) =>
    Object.prototype.hasOwnProperty.call(body, k),
  );
  if (offenders.length === 0) return null;
  return `These fields are set by the server and cannot be edited: ${offenders.join(", ")}`;
}

module.exports = {
  createFromUrlSchema,
  createFromBrandSchema,
  updateBriefSchema,
  rejectForbiddenKeys,
  FORBIDDEN_UPDATE_KEYS,
  MAX_URL_LENGTH,
};
