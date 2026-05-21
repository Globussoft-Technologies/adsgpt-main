const Joi = require("joi");
const { buildAllowedOverrides } = require("../config/auditRuleMetadata");

/**
 * PATCH /meta-ads/autopilot/settings body validator.
 *
 * Every field is optional — the PATCH semantics are merge-not-replace, so
 * the client can send just the field(s) they want to change. An empty object
 * is rejected so we don't silently no-op a broken UI submission.
 */
// v4: action-log rows now carry user-defined severity (low/medium/high)
// instead of the legacy critical/warning/opportunity buckets. The
// budget_anomaly / scale_action / flap chips were tied to v3-only audit
// rule ids and behaviors that no longer fire — dropped.
const alertOnValues = ["low", "medium", "high"];

// Built once at module load. If a new rule lands in auditRulesConfig.js,
// restart the server — the validator will pick it up via this map.
const ALLOWED_OVERRIDES = buildAllowedOverrides();

// chat_id is either a signed int as string (user `12345`, group/channel
// `-1001234567890`) or a public channel username `@channelname`. The bot
// token is no longer user-supplied — AdsGPT owns one shared bot whose
// token lives in process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN, so users only
// configure WHERE to send (chat id), not WHICH bot to send from.
const TELEGRAM_CHAT_ID_RE = /^(-?\d+|@[A-Za-z][A-Za-z0-9_]{4,})$/;

const alertsSchema = Joi.object({
  slackWebhookUrl: Joi.string().allow("").uri().messages({
    "string.uri": "slackWebhookUrl must be a valid URL",
  }),
  // Comma-separated list of up to 5 recipient emails. Stored as a single
  // string (no schema migration needed) and split at send-time by
  // alertService.parseEmailRecipients. The validator tokenizes on comma,
  // trims, drops empties, enforces the 5-address cap, and runs each
  // remaining token through Joi's email rule. Empty input is allowed
  // (means "skip email"); the cron no-ops on no recipients.
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
      const emailSchema = Joi.string().email();
      for (const p of parts) {
        const { error } = emailSchema.validate(p);
        if (error) return helpers.error("emailTo.invalid", { bad: p });
      }
      return value;
    })
    .messages({
      "emailTo.invalid":
        "emailTo must be a comma-separated list of valid email addresses (invalid: {#bad})",
      "emailTo.tooMany":
        "emailTo accepts up to 5 addresses (got {#count}). Trim the list or use a distribution group.",
    }),
  telegramChatId: Joi.string()
    .allow("")
    .pattern(TELEGRAM_CHAT_ID_RE)
    .messages({
      "string.pattern.base":
        "telegramChatId must be a numeric chat id (e.g. 123456789 or -1001234567890) or a public @channelname.",
    }),
  alertOn: Joi.array().items(Joi.string().valid(...alertOnValues)),
}).min(1);

const updateSettingsSchema = Joi.object({
  enabled: Joi.boolean(),
  dryRunGlobal: Joi.boolean(),
  severityFloor: Joi.string().valid("critical", "warning", "opportunity"),
  autoResumeEnabled: Joi.boolean(),
  scaleWinnersEnabled: Joi.boolean(),
  creativeRotationEnabled: Joi.boolean(),
  creativeAutoGenerateEnabled: Joi.boolean(),
  creativeAutoApproveGenerated: Joi.boolean(),
  alerts: alertsSchema,
  // Per-account opt-in. Bare numeric ids only (no `act_` prefix). Duplicates
  // are deduped before save — clients shouldn't depend on send-order being
  // preserved. Empty array is the safe default and means "audit nothing".
  selectedAdAccountIds: Joi.array()
    .items(
      Joi.string()
        .pattern(/^\d+$/)
        .messages({
          "string.pattern.base":
            "selectedAdAccountIds entries must be bare numeric Meta ad-account ids (no `act_` prefix)",
        }),
    )
    .unique(),
  // Strict three-level validation:
  //   { 'act_xxx': { 'AUD-01': { min_spend: 10000 } } }
  //
  //   - top-level keys must be act_-prefixed,
  //   - second-level keys must be a known rule id from auditRulesConfig.js,
  //   - third-level keys must be a threshold name declared in that rule's
  //     `defaults` (rejects typos & unknown keys),
  //   - third-level values must be finite, non-negative numbers.
  //
  // An empty `perAccountOverrides: {}` is allowed (means "wipe my customs").
  perAccountOverrides: Joi.object()
    .custom((value, helpers) => {
      for (const [acctKey, ruleMap] of Object.entries(value || {})) {
        if (!acctKey.startsWith("act_")) {
          return helpers.error("any.custom", {
            message: `perAccountOverrides keys must start with 'act_' (got '${acctKey}')`,
          });
        }
        if (!ruleMap || typeof ruleMap !== "object") {
          return helpers.error("any.custom", {
            message: `perAccountOverrides[${acctKey}] must be an object`,
          });
        }
        for (const [ruleId, overrides] of Object.entries(ruleMap)) {
          const allowed = ALLOWED_OVERRIDES.get(ruleId);
          if (!allowed) {
            return helpers.error("any.custom", {
              message: `Unknown rule '${ruleId}' in perAccountOverrides[${acctKey}]`,
            });
          }
          if (!overrides || typeof overrides !== "object") {
            return helpers.error("any.custom", {
              message: `perAccountOverrides[${acctKey}][${ruleId}] must be an object of threshold overrides`,
            });
          }
          for (const [thresholdKey, thresholdVal] of Object.entries(overrides)) {
            if (!allowed.has(thresholdKey)) {
              return helpers.error("any.custom", {
                message: `Rule '${ruleId}' has no threshold called '${thresholdKey}' (allowed: ${Array.from(allowed).join(", ") || "(none)"})`,
              });
            }
            if (
              typeof thresholdVal !== "number" ||
              !Number.isFinite(thresholdVal) ||
              thresholdVal < 0
            ) {
              return helpers.error("any.custom", {
                message: `perAccountOverrides[${acctKey}][${ruleId}][${thresholdKey}] must be a finite non-negative number (got ${thresholdVal === null ? "null" : typeof thresholdVal})`,
              });
            }
          }
        }
      }
      return value;
    })
    .messages({
      "any.custom": "{#message}",
    }),
})
  .min(1)
  .messages({
    "object.min":
      "PATCH body must contain at least one field to update",
  });

module.exports = {
  updateSettingsSchema,
  alertOnValues,
};
