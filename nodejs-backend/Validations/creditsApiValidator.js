const Joi = require("joi");

// POST /api/v1/credits/freeze — reserve credits before starting a unit of work
const freezeSchema = Joi.object({
  user_id: Joi.string().required(),
  // Caller-controlled idempotency key — same key replays return the existing
  // reservation, never double-charge. Recommend a namespaced format like
  // "chat-agent:<sessionId>:<turnId>:<toolCallId>".
  reservation_key: Joi.string().min(1).max(256).required(),
  amount: Joi.number().positive().required(),
  meta: Joi.object().optional(),
});

// One media item Python wants persisted alongside the settle.
// Mirrors what imageController / videoController write to GeneratedMedia.
const mediaItemSchema = Joi.object({
  type: Joi.string().valid("image", "video").required(),
  url: Joi.string().allow("").required(),
  model: Joi.string().required(),
  credit_deduction: Joi.number().min(0).default(0),
  cost: Joi.number().min(0).default(0),
  // Seconds — only meaningful for video; ignored for image.
  duration: Joi.number().min(0).default(0),
});

// POST /api/v1/credits/finalize — settle (charge actual + refund rest) OR
// release (full refund). One endpoint, parameterised by `actual_used`.
//   actual_used == 0       → full refund (release)
//   actual_used == amount  → full charge (settle)
//   else                   → partial: keep actual_used, refund rest
//
// Optionally takes `media[]` so Python's agent can record GeneratedMedia
// rows for admin/cost reporting in the same call — keeps credit settlement
// and media bookkeeping atomic. `media` is intentionally permissive: any
// items present are written, none required.
const finalizeSchema = Joi.object({
  reservation_key: Joi.string().min(1).max(256).required(),
  // `actual_used` is clipped to the reservation amount server-side — Python
  // can't over-charge a freeze. Default of 0 means "refund the whole hold".
  actual_used: Joi.number().min(0).default(0),
  media: Joi.array().items(mediaItemSchema).default([]),
  // My Space provenance tag written on each GeneratedMedia row. Optional so the
  // legacy Agent-chat caller (which omits it) keeps its "aiAssistant" tag; the
  // MCP connector path sends "claudeAI" so those generations get their own
  // My Space filter. Free-form string (the schema mirrors GeneratedMedia.source).
  source: Joi.string().max(64).default("aiAssistant"),
});

module.exports = { freezeSchema, finalizeSchema };
