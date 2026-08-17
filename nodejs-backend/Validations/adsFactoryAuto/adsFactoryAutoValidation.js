const Joi = require("joi");

// ─── scheduleSchema ───────────────────────────────────────────────────────────

const customFrequencySchema = Joi.object({
  repeatEvery:  Joi.number().integer().min(1).default(1),
  repeatUnit:   Joi.string().valid("day", "week").default("week"),
  repeatOnDays: Joi.array().items(Joi.string()).default([]),
});

// Timezones are validated by CONSTRUCTION, not against a list.
//
// `Intl.supportedValuesOf("timeZone")` returns whatever names the linked ICU
// build considers canonical, and that set is both incomplete and version-
// dependent. On this runtime it rejects every one of these, all of which are
// valid IANA zones that browsers really do emit from
// `Intl.DateTimeFormat().resolvedOptions().timeZone`:
//
//   Asia/Kolkata       (ICU offers the legacy alias Asia/Calcutta)
//   Asia/Ho_Chi_Minh   (Asia/Saigon)
//   Asia/Yangon        (Asia/Rangoon)
//   Europe/Kyiv        (Europe/Kiev)
//   UTC                (an alias, not a zone, so it is never listed)
//
// `Asia/Kolkata` is the one that matters most here: it is what an Indian
// user's browser sends, this product's primary market, and the enum turned it
// into a 400 with a 417-name message the user could not act on. "UTC" had the
// same problem from the other side — it is this schema's own declared default,
// so a client echoing the default back was rejected by it.
//
// Constructing a DateTimeFormat accepts canonical names and aliases alike and
// cannot drift as ICU updates, so it is both broader and more stable than any
// list we could pin.
const isValidTimezone = (value, helpers) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return helpers.error("any.invalid", { message: `"${value}" is not a known timezone` });
  }
};

const scheduleSchema = Joi.object({
  frequency:       Joi.string().required(),
  startDate:       Joi.date().iso().optional().allow(null),
  endDate:         Joi.date().iso().optional().allow(null),
  timezone:        Joi.string().custom(isValidTimezone).default("UTC"),
  hour:            Joi.number().integer().min(0).max(23).default(0),
  customFrequency: Joi.when("frequency", {
    is:        "custom",
    then:      customFrequencySchema.required(),
    otherwise: customFrequencySchema.optional(),
  }),
}).custom((value, helpers) => {
  if (value.startDate && value.endDate && new Date(value.endDate) <= new Date(value.startDate)) {
    return helpers.error("any.invalid", { message: "endDate must be greater than startDate" });
  }
  return value;
}).messages({ "any.invalid": "{{#message}}" });

// ─── Platform target schemas ──────────────────────────────────────────────────

// A template the user already built and saved in the V2 wizard.
const savedMetaTemplateSchema = Joi.object({
  name: Joi.string().trim().required(),
  objective: Joi.string().allow("", null).optional(),
  conversionLocation: Joi.string().allow("", null).optional(),
  pageId: Joi.string().allow("", null).optional(),
  payload: Joi.object().required(),
});

// A request to BUILD a template instead of picking one.
//
// Scheduling used to dead-end for anyone with no saved template — the picker
// told them to go build one in Meta Ads Manager and come back. This shape lets
// the client say "I don't have one, make me one" with just an objective and a
// budget; the controller runs it through services/adsFactoryAuto/
// templateSynthesizer, which reads every other default from config/
// wizardSchema.js.
//
// Unknown keys are rejected (Joi's default), which is what makes
// `{ synthesize: true, payload: {...} }` fail — you either pick a template or
// have one built, never both.
const synthesizeMetaTemplateSchema = Joi.object({
  synthesize: Joi.valid(true).required(),

  objective: Joi.string().trim().required(),
  conversionLocation: Joi.string().trim().required(),
  adAccountId: Joi.string().trim().required(),
  // Daily budget in MAJOR currency units (₹800 → 800). The orchestrator
  // applies the ×100 minor-unit conversion at launch.
  budget: Joi.number().positive().required(),

  pageId: Joi.string().trim().allow("").optional(),
  linkUrl: Joi.string().trim().allow("").optional(),
  callToAction: Joi.string().trim().optional(),
  campaignName: Joi.string().trim().max(120).optional(),
  instagramUserId: Joi.string().trim().allow("").optional(),
  leadFormId: Joi.string().trim().allow("").optional(),
  applicationId: Joi.string().trim().allow("").optional(),
  objectStoreUrl: Joi.string().trim().allow("").optional(),
  optimizationGoal: Joi.string().trim().optional(),
  billingEvent: Joi.string().trim().optional(),
  targeting: Joi.object().optional(),
});

// Branch on the presence of `synthesize` so each path reports its own field
// errors. A bare `alternatives().try()` would emit both sets on any failure,
// which reads as noise ("payload is required" on a synthesize call).
const metaTemplateSchema = Joi.alternatives().conditional(
  Joi.object({ synthesize: Joi.exist() }).unknown(),
  { then: synthesizeMetaTemplateSchema, otherwise: savedMetaTemplateSchema },
);

const metaTargetSchema = Joi.object({
  facebookId: Joi.string().trim().required(),
  connectionId: Joi.string().length(24).hex().required(),
  template: metaTemplateSchema.required(),
});

const googleTargetSchema = Joi.object({
  template: Joi.object({
    name: Joi.string().trim().required(),
    objective: Joi.string().allow("", null).optional(),
    conversionLocation: Joi.string().allow("", null).optional(),
    customerId: Joi.string().allow("", null).optional(),
    payload: Joi.object().required(),
  }).required(),
});

const targetsSchema = Joi.object({
  meta:   metaTargetSchema.optional(),
  google: googleTargetSchema.optional(),
}).min(1).required();

// ─── Update-only target schemas ───────────────────────────────────────────────
// Editing a job must NOT be able to rename the campaign or swap the template
// wholesale — the campaign/ad group/ad were already created (or will be) from
// the original template. Only budget, CTA, and destination link are editable
// after the job is created; schedule and pairsPerCycle are handled separately.

// Accepts the full template shape (frontend can send back the whole job
// object it already has) — payload keys are NOT whitelisted here. The
// controller diffs incoming vs. saved values field-by-field: editable fields
// (see EDITABLE_*_PAYLOAD_FIELDS below) may change freely; any other field
// that differs from the saved value is rejected with a named error. Fields
// echoed back unchanged are silently accepted either way.
const EDITABLE_META_PAYLOAD_FIELDS   = ["dailyBudget", "lifetimeBudget", "adSetBudget", "spendCap", "callToAction", "linkUrl"];
const EDITABLE_GOOGLE_PAYLOAD_FIELDS = ["dailyBudget", "dailyBudgetMicros", "lifetimeBudget", "cpcBid", "callToAction", "linkUrl", "finalUrl"];

const updateTargetsSchema = Joi.object({
  meta: Joi.object({
    facebookId: Joi.string().trim().optional(),
    connectionId: Joi.string().length(24).hex().optional(),
    template: Joi.object({
      name:               Joi.string().trim().optional(),
      objective:          Joi.string().allow("", null).optional(),
      conversionLocation: Joi.string().allow("", null).optional(),
      pageId:             Joi.string().allow("", null).optional(),
      payload:            Joi.object().required(),
    }).required(),
  }).optional(),
  google: Joi.object({
    template: Joi.object({
      name:               Joi.string().trim().optional(),
      objective:          Joi.string().allow("", null).optional(),
      conversionLocation: Joi.string().allow("", null).optional(),
      customerId:         Joi.string().allow("", null).optional(),
      payload:            Joi.object().required(),
    }).required(),
  }).optional(),
}).min(1);

// ─── alertsSchema ─────────────────────────────────────────────────────────────
// Per-job cycle-complete email recipients. emailTo is a comma-separated list of
// up to 5 addresses, stored as a single string and split at send-time by
// adsFactoryAlertService.parseEmailRecipients. Same tokenize→trim→cap→validate
// rule as the Meta Autopilot's autopilotSettings validator. Empty = no email.
const alertsSchema = Joi.object({
  emailTo: Joi.string()
    .allow("")
    .custom((value, helpers) => {
      if (!value) return value;
      const parts = String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 5) {
        return helpers.error("emailTo.tooMany", { count: parts.length });
      }
      const emailValidator = Joi.string().email({ tlds: false });
      for (const p of parts) {
        const { error } = emailValidator.validate(p);
        if (error) return helpers.error("emailTo.invalid", { bad: p });
      }
      return value;
    })
    .messages({
      "emailTo.invalid":
        "alerts.emailTo must be a comma-separated list of valid email addresses (invalid: {#bad})",
      "emailTo.tooMany":
        "alerts.emailTo accepts up to 5 addresses (got {#count}). Trim the list or use a distribution group.",
    }),
});

// ─── createJobSchema ──────────────────────────────────────────────────────────

const createJobSchema = Joi.object({
  campaignId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required()
    .messages({ "string.pattern.base": "campaignId must be a valid MongoDB ObjectId" }),

  schedule: scheduleSchema.required(),

  pairsPerCycle: Joi.number().integer().min(1).max(200).default(1),

  model: Joi.string().allow("", null).optional(),

  targets: targetsSchema.required(),

  alerts: alertsSchema.optional(),
});

// ─── updateJobSchema ──────────────────────────────────────────────────────────

const updateJobSchema = Joi.object({
  schedule:       scheduleSchema,
  pairsPerCycle:  Joi.number().integer().min(1).max(200),
  model:          Joi.string().allow("", null),
  // Restricted — cannot rename the campaign or replace the template. Only
  // budget, CTA, and destination link are editable; see updateTargetsSchema.
  targets:        updateTargetsSchema,
  alerts:         alertsSchema,
}).min(1);

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createJobSchema,
  updateJobSchema,
  EDITABLE_META_PAYLOAD_FIELDS,
  EDITABLE_GOOGLE_PAYLOAD_FIELDS,
};
