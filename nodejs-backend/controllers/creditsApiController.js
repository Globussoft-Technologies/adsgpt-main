const UnifiedCreditController = require("./UnifiedCreditController");
const GeneratedMediaController = require("./generatedMedia.controller");
const CreditReservation = require("../Module/credit/creditReservationModel");
const GeneratedCount = require("../Module/generatedCount/generatedCountSchema");
const {
  MODEL_REGISTRY,
  findModel,
  getCreditDeduction,
  getCreditDeductionByQuality,
} = require("../config/modelRegistry");
const { SURFACE_CATALOG } = require("../config/surfaceCatalog");
const {
  freezeSchema,
  finalizeSchema,
} = require("../Validations/creditsApiValidator");

// Map freezeCredits internal `reason` strings → HTTP status codes.
const FREEZE_REASON_TO_STATUS = {
  MISSING_KEY: 400,
  BAD_AMOUNT: 400,
  NO_USER: 404,
  NO_BASE_PLAN: 403,
  INSUFFICIENT: 402,
  CONTENDED: 503,
  RECEIPT_WRITE_FAILED: 500,
};

/**
 * POST /api/v1/credits/freeze
 *
 * Body: { user_id, reservation_key, amount, meta? }
 *
 * Atomically reserves `amount` credits and writes a CreditReservation
 * receipt. Idempotent on `reservation_key` (same key returns the existing
 * reservation, never double-charges).
 */
exports.freeze = async (req, res) => {
  /* #swagger.tags = ['Credits']
     #swagger.summary = 'Reserve (freeze) credits before starting a unit of work'
     #swagger.description = 'Atomically pre-deducts credits and writes a reservation receipt. Idempotent on `reservation_key` — replays with the same key return the existing reservation. Python should call this BEFORE invoking a paid tool / model. Requires the x-secret-key header.'
     #swagger.parameters['x-secret-key'] = {
         in: 'header',
         required: true,
         type: 'string',
         description: 'Shared Python ↔ Node secret. Same value used by /update-result/* callbacks.'
     }
     #swagger.requestBody = {
         required: true,
         content: {
             "application/json": {
                 schema: {
                     type: 'object',
                     required: ['user_id', 'reservation_key', 'amount'],
                     properties: {
                         user_id: { type: 'string', example: 'GPT-435', description: 'Internal user id (incl. created_from prefix).' },
                         reservation_key: { type: 'string', example: 'chat-agent:sess_abc:turn_42:web_search', description: 'Caller-controlled idempotency key. Recommend a namespaced format.' },
                         amount: { type: 'number', example: 7, description: 'Credits to freeze. Must be positive.' },
                         meta: { type: 'object', example: { service_type: 'agent_chat', tool: 'web_search' }, description: 'Free-form context stored on the receipt for debugging / analytics.' }
                     }
                 }
             }
         }
     }
     #swagger.responses[200] = {
         description: 'Reserved. Body indicates idempotency.',
         content: {
             "application/json": {
                 schema: {
                     type: 'object',
                     properties: {
                         ok: { type: 'boolean', example: true },
                         frozen: { type: 'number', example: 7 },
                         split: {
                             type: 'object',
                             properties: {
                                 fromRollover: { type: 'number', example: 0 },
                                 fromSub: { type: 'number', example: 7 },
                                 fromTopup: { type: 'number', example: 0 }
                             }
                         },
                         idempotent: { type: 'boolean', example: false, description: 'true if the same reservation_key existed already — no new charge.' }
                     }
                 }
             }
         }
     }
     #swagger.responses[400] = { description: 'BAD_INPUT / MISSING_KEY — malformed body.' }
     #swagger.responses[402] = { description: 'INSUFFICIENT — `required` and `remaining` returned in body.' }
     #swagger.responses[403] = { description: 'NO_BASE_PLAN — user has no active base subscription.' }
     #swagger.responses[404] = { description: 'NO_USER — unknown user_id.' }
     #swagger.responses[503] = { description: 'CONTENDED — CAS retries exhausted. Retry with backoff.' }
     #swagger.responses[500] = { description: 'RECEIPT_WRITE_FAILED — server-side fault, escalate.' }
  */
  const { error, value } = freezeSchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return res.status(400).json({
      ok: false,
      reason: "BAD_INPUT",
      details: error.details.map((d) => d.message),
    });
  }

  const { user_id, reservation_key, amount, meta = {} } = value;

  console.log(
    `[credits-api] freeze ENTER user=${user_id} key=${reservation_key} amount=${amount}`,
  );

  const result = await UnifiedCreditController.freezeCredits({
    userId: user_id,
    reservationKey: reservation_key,
    amount,
    meta: { ...meta, source: "api:agent_chat" },
  });

  if (result.ok) {
    console.log(
      `[credits-api] freeze OK user=${user_id} key=${reservation_key} ` +
        `frozen=${result.frozen} idempotent=${!!result.idempotent}`,
    );
    return res.status(200).json({
      ok: true,
      frozen: result.frozen,
      split: result.split,
      idempotent: !!result.idempotent,
    });
  }

  const status = FREEZE_REASON_TO_STATUS[result.reason] || 500;
  console.warn(
    `[credits-api] freeze FAIL user=${user_id} key=${reservation_key} ` +
      `reason=${result.reason} status=${status}`,
  );
  return res.status(status).json({
    ok: false,
    reason: result.reason,
    required: result.required,
    remaining: result.remaining,
  });
};

/**
 * POST /api/v1/credits/finalize
 *
 * Body: { reservation_key, actual_used? }
 *
 * Settles the reservation:
 *   actual_used == 0       → full refund of the freeze
 *   actual_used >= amount  → full charge (clipped to amount)
 *   else                   → partial: keep actual_used charged, refund rest
 *
 * Idempotent on missing receipt — a retry after a successful first call
 * returns 200 { idempotent: true, alreadySettled: true } rather than 404,
 * so Python's retry path is forgiving.
 */
exports.finalize = async (req, res) => {
  /* #swagger.tags = ['Credits']
     #swagger.summary = 'Settle (charge actual + refund rest) OR release (full refund) a frozen reservation'
     #swagger.description = 'One endpoint for both finalize cases, parameterised by `actual_used`. `actual_used = 0` → full refund. `actual_used == amount` → full charge. In-between → partial charge + partial refund. Optionally accepts a `media[]` array to write GeneratedMedia rows for admin dashboard visibility (mirrors imageController / videoController). Idempotent on missing receipt: a retry after a successful first call returns 200 with `idempotent: true` rather than 404. Requires the x-secret-key header.'
     #swagger.parameters['x-secret-key'] = {
         in: 'header',
         required: true,
         type: 'string',
         description: 'Shared Python ↔ Node secret.'
     }
     #swagger.requestBody = {
         required: true,
         content: {
             "application/json": {
                 schema: {
                     type: 'object',
                     required: ['reservation_key'],
                     properties: {
                         reservation_key: { type: 'string', example: 'chat-agent:sess_abc:turn_42:web_search' },
                         actual_used: { type: 'number', example: 5, description: 'Credits actually consumed. Default 0 = full refund. Server-side clipped to reservation amount.' },
                         media: {
                             type: 'array',
                             description: 'Optional. Items here are persisted to GeneratedMedia keyed to the receipt owner.',
                             items: {
                                 type: 'object',
                                 required: ['type', 'url', 'model'],
                                 properties: {
                                     type: { type: 'string', enum: ['image', 'video'], example: 'image' },
                                     url: { type: 'string', example: '/creatives/GPT-435/abc123.webp' },
                                     model: { type: 'string', example: 'google' },
                                     credit_deduction: { type: 'number', example: 7 },
                                     cost: { type: 'number', example: 0.27, description: 'USD cost. Default 0.' },
                                     duration: { type: 'number', example: 0, description: 'Seconds — videos only. Default 0.' }
                                 }
                             }
                         }
                     }
                 },
                 examples: {
                     "Settle with media": {
                         value: {
                             reservation_key: 'chat-agent:sess_abc:turn_42:image_gen',
                             actual_used: 7,
                             media: [
                                 {
                                     type: 'image',
                                     url: '/creatives/GPT-435/abc123.webp',
                                     model: 'google',
                                     credit_deduction: 7,
                                     cost: 0.27
                                 }
                             ]
                         }
                     },
                     "Pure refund (no media)": {
                         value: {
                             reservation_key: 'chat-agent:sess_abc:turn_42:web_search',
                             actual_used: 0
                         }
                     },
                     "Partial settle (3 of 5 succeeded)": {
                         value: {
                             reservation_key: 'chat-agent:sess_abc:turn_42:image_gen',
                             actual_used: 21,
                             media: [
                                 { type: 'image', url: '/creatives/.../1.webp', model: 'google', credit_deduction: 7, cost: 0.27 },
                                 { type: 'image', url: '/creatives/.../2.webp', model: 'google', credit_deduction: 7, cost: 0.27 },
                                 { type: 'image', url: '/creatives/.../3.webp', model: 'google', credit_deduction: 7, cost: 0.27 }
                             ]
                         }
                     }
                 }
             }
         }
     }
     #swagger.responses[200] = {
         description: 'Settled. Body shows what was charged and refunded. On idempotent retry: `{ ok: true, idempotent: true, alreadySettled: true }`.',
         content: {
             "application/json": {
                 schema: {
                     type: 'object',
                     properties: {
                         ok: { type: 'boolean', example: true },
                         charged: { type: 'number', example: 5 },
                         refunded: { type: 'number', example: 2 },
                         refundSplit: {
                             type: 'object',
                             properties: {
                                 fromTopup: { type: 'number', example: 0 },
                                 fromSub: { type: 'number', example: 2 },
                                 fromRollover: { type: 'number', example: 0 }
                             }
                         },
                         mediaWritten: { type: 'number', example: 1 },
                         idempotent: { type: 'boolean', description: 'Only present on retries.' },
                         alreadySettled: { type: 'boolean', description: 'Only present on retries.' }
                     }
                 }
             }
         }
     }
     #swagger.responses[400] = { description: 'BAD_INPUT / MISSING_KEY — malformed body.' }
  */
  const { error, value } = finalizeSchema.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    return res.status(400).json({
      ok: false,
      reason: "BAD_INPUT",
      details: error.details.map((d) => d.message),
    });
  }

  const { reservation_key, actual_used, media, source } = value;

  console.log(
    `[credits-api] finalize ENTER key=${reservation_key} actual_used=${actual_used} media=${media.length}`,
  );

  // Look up the user_id BEFORE releasing — releasePartial deletes the receipt,
  // so we'd lose the link to the user otherwise. Used for GeneratedMedia rows.
  const receipt = await CreditReservation.findOne(
    { reservation_key },
    { user_id: 1 },
  ).lean();
  const userId = receipt?.user_id || null;

  const result = await UnifiedCreditController.releasePartial(
    reservation_key,
    actual_used,
  );

  if (!result.ok && result.reason === "NO_RECEIPT") {
    console.warn(
      `[credits-api] finalize NO_RECEIPT key=${reservation_key} — treating as idempotent`,
    );
    return res.status(200).json({
      ok: true,
      idempotent: true,
      alreadySettled: true,
    });
  }

  if (!result.ok) {
    console.warn(
      `[credits-api] finalize FAIL key=${reservation_key} reason=${result.reason}`,
    );
    return res.status(400).json({ ok: false, reason: result.reason });
  }

  // Write GeneratedMedia rows for the items Python delivered. Mirrors the
  // pattern in imageController / videoController so the admin dashboard
  // sums agent-chatbot usage the same way it sums Ad Studio.
  let mediaWritten = 0;
  if (userId && Array.isArray(media) && media.length > 0) {
    for (const m of media) {
      try {
        const saved = await GeneratedMediaController.saveGeneratedMedia({
          userId,
          model: m.model,
          type: m.type,
          // Provenance tag for My Space's source filter, isolating these from
          // Ad Studio / AdFactory media (which live untagged in the same
          // collection). Defaults to "aiAssistant" (the legacy agent-chat path)
          // when the caller omits `source`; the MCP connector path sends
          // "claudeAI" so claude.ai generations get their own filter.
          source,
          image: m.type === "image" ? m.url : "",
          video: m.type === "video" ? m.url : "",
          credit_deduction: m.credit_deduction || 0,
          cost: m.cost || 0,
          duration: m.duration || 0,
          aspect_ratio: m.aspect_ratio || "",
          quality: m.quality || "",
        });
        if (!saved?.success) {
          throw new Error(saved?.error || saved?.message || "GeneratedMedia write failed");
        }
        // Profile's generation graph counts successful images from
        // GeneratedCount. Agent generations used to write only GeneratedMedia,
        // so they appeared in My Space but never in that graph.
        if (m.type === "image" && m.url) {
          await GeneratedCount.updateOne(
            { userId, type: "image", url: m.url, model: m.model },
            { $setOnInsert: { userId, type: "image", url: m.url, model: m.model } },
            { upsert: true },
          );
        }
        mediaWritten += 1;
      } catch (e) {
        console.error(
          `[credits-api] finalize media write failed key=${reservation_key} url=${m.url}:`,
          e.message,
        );
      }
    }
  }

  console.log(
    `[credits-api] finalize OK key=${reservation_key} user=${userId} ` +
      `charged=${result.charged} refunded=${result.refunded} mediaWritten=${mediaWritten}`,
  );
  return res.status(200).json({
    ok: true,
    charged: result.charged,
    refunded: result.refunded,
    refundSplit: result.refundSplit,
    mediaWritten,
  });
};

// Minimal shape for Python: billing fields plus the shared AdStudio surface
// capabilities needed to render the same model/ratio choices in AI Assistant.
//   model:  canonical key (the string to pass to the model/router)
//   type:   "image" | "video"
//   credit: default per-unit credit (image defaults to the high-quality tier)
//   quality_tiers: effective per-quality image credits (env overrides applied)
//   price:  per-unit USD (per_image for image, per_second for video)
//   surface_capabilities: model availability and caps from surfaceCatalog.js
//                         (the same source used by Profile / Ad Creative)
const _publicModel = (entry) => {
  const isImage = entry.type === "image";
  const qualityTiers =
    isImage && Array.isArray(entry.qualityTiers)
      ? entry.qualityTiers.map((tier) => ({
          quality: tier.quality,
          credit: getCreditDeductionByQuality(
            entry.canonicalKey,
            tier.quality,
          ),
          price: tier.pricing?.per_image ?? entry.pricing?.per_image ?? 0,
        }))
      : [];
  const surfaceCapabilities = Object.fromEntries(
    Object.entries(SURFACE_CATALOG)
      .filter(([, catalog]) => catalog[entry.canonicalKey])
      .map(([surface, catalog]) => {
        const caps = catalog[entry.canonicalKey];
        return [
          surface,
          {
            durations: [...(caps.durations || [])],
            aspect_ratios: [...(caps.aspectRatios || [])],
          },
        ];
      }),
  );

  return {
    model: entry.canonicalKey,
    label: entry.label,
    type: entry.type,
    // Profile and Ad Creative both default an omitted quality to "high".
    // Matching that here removes the stale flat image value from Agent billing.
    credit: isImage
      ? getCreditDeductionByQuality(entry.canonicalKey, "high")
      : getCreditDeduction(entry.canonicalKey),
    quality_tiers: qualityTiers,
    price:
      entry.type === "video"
        ? entry.pricing?.per_second ?? 0
        : entry.pricing?.per_image ?? 0,
    surface_capabilities: surfaceCapabilities,
  };
};

/**
 * GET /api/v1/credits/models
 *
 * Query params:
 *   type=image|video    optional — filter by media type
 *   model=<key|alias>   optional — return single entry (canonical key OR alias)
 *   includeDisabled=1   optional — include `enabled: false` entries
 *
 * Returns the full registry (filtered as requested) so Python knows the
 * credit cost and AdStudio surface capabilities per model without hardcoding
 * either contract on its side.
 */
exports.getModels = async (req, res) => {
  /* #swagger.tags = ['Credits']
     #swagger.summary = 'List model registry — credit costs, pricing, capabilities'
     #swagger.description = 'Read-only view of the model registry. Python uses this to compute how much to freeze BEFORE invoking a model and to reuse the same surface model/aspect-ratio contract as AdStudio. Returns the effective per-unit credit (env override applied), per-quality tiers, and surface capabilities. Requires the x-secret-key header.'
     #swagger.parameters['x-secret-key'] = {
         in: 'header',
         required: true,
         type: 'string',
         description: 'Shared Python ↔ Node secret.'
     }
     #swagger.parameters['type'] = {
         in: 'query',
         required: false,
         type: 'string',
         enum: ['image', 'video'],
         description: 'Filter to only image or only video models.'
     }
     #swagger.parameters['model'] = {
         in: 'query',
         required: false,
         type: 'string',
         description: 'Look up a single model by canonical key OR alias. Returns 404 if unknown.'
     }
     #swagger.parameters['includeDisabled'] = {
         in: 'query',
         required: false,
         type: 'string',
         description: 'Pass 1 to include entries with enabled=false. Default omits them.'
     }
     #swagger.responses[200] = {
         description: 'Returns either an array of models or a single model object when ?model= is used.',
         content: {
             "application/json": {
                 schema: {
                     type: 'object',
                     properties: {
                         ok: { type: 'boolean', example: true },
                         count: { type: 'number', example: 10 },
                         models: {
                             type: 'array',
                             items: {
                                 type: 'object',
                                 properties: {
                                     model: { type: 'string', example: 'veo-3.1-fast', description: 'Canonical model key. Pass this exact string when invoking the model.' },
                                     label: { type: 'string', example: 'Veo 3.1 fast' },
                                     type: { type: 'string', example: 'video', enum: ['image', 'video'] },
                                     credit: { type: 'number', example: 13, description: 'Per-unit credit cost (per image OR per second of video).' },
                                     quality_tiers: { type: 'array', description: 'Image-only per-quality credit and price rows.', items: { type: 'object', properties: { quality: { type: 'string' }, credit: { type: 'number' }, price: { type: 'number' } } } },
                                     price: { type: 'number', example: 0.15, description: 'Per-unit USD cost (per image OR per second of video).' },
                                     surface_capabilities: { type: 'object', description: 'Per-surface durations and aspect ratios from the shared AdStudio surface catalog.' }
                                 }
                             }
                         }
                     }
                 }
             }
         }
     }
     #swagger.responses[404] = { description: 'NOT_FOUND — ?model= passed but no registry entry matched.' }
  */
  const { type, model, includeDisabled } = req.query;

  // Single-model lookup short-circuits everything else.
  if (model) {
    const entry = findModel(String(model));
    if (!entry) {
      return res.status(404).json({ ok: false, reason: "NOT_FOUND", model });
    }
    return res.status(200).json({ ok: true, model: _publicModel(entry) });
  }

  let entries = MODEL_REGISTRY;
  if (type) {
    entries = entries.filter((e) => e.type === String(type));
  }
  if (includeDisabled !== "1" && includeDisabled !== "true") {
    entries = entries.filter((e) => e.enabled !== false);
  }

  const models = entries.map(_publicModel);
  return res.status(200).json({ ok: true, count: models.length, models });
};
