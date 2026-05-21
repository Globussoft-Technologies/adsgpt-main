# Validators (Joi)

The Meta Ads Manager API surface is validated **server-side** with Joi. The schemas live in [`nodejs-backend/Validations/meta.validator.js`](../../../nodejs-backend/Validations/meta.validator.js) and are the **source of truth** — frontend validation is a UX layer only.

## Current schemas

| Schema | Used by | Notes |
|---|---|---|
| `updateAdStatusSchema` | `PATCH /update-status` | `level` ∈ {campaign, adset, ad}, `id`, `status` ∈ {ACTIVE, PAUSED}. |
| `applyFixSchema` | LLM audit `apply-fix/:findingId` | `confirmed: true` required; `acknowledgeRisk` boolean; `paramOverrides` object. |
| `createCampaignSchema` | `POST /create-campaign` | Hard-codes the modern ODAX objective set. CBO budget is mutually exclusive with adset budget — validator enforces "daily OR lifetime, not both". |
| `createAdSetSchema` | `POST /create-adset` | Big one. Targeting block, budget, billing event, optimization goal, bid strategy, optional saved audience, schedule. Custom validators reject "neither saved audience nor country list nor worldwide". |
| `createAdSchema` | `POST /create-ad` | Creative + identity + CTA. Image-only today. |
| `deleteCampaignSchema` | `DELETE /delete-campaign` | `adAccountId` + `campaignId` only. |

## Patterns

### 1. Allowed-values lists are exported

```js
const META_OBJECTIVES = [...];
const SPECIAL_AD_CATEGORIES = [...];
const BID_STRATEGIES = [...];

module.exports = {
  ...,
  META_OBJECTIVES,
  SPECIAL_AD_CATEGORIES,
};
```

The frontend imports these arrays to drive dropdowns, so the dropdown options can never drift from what the validator accepts.

**When you add a new allowed value** (e.g. a new objective, a new CTA), add it here and import on the frontend.

### 2. Cross-field constraints use `.custom()`

For rules that span multiple fields, use Joi's `.custom()` rather than separate per-field validation:

```js
}).custom((value, helpers) => {
  if (value.dailyBudget && value.lifetimeBudget) {
    return helpers.error("any.invalid", {
      message: "Provide dailyBudget OR lifetimeBudget, not both",
    });
  }
  return value;
});
```

The error message is surfaced to the user via the controller's `error.details[0].context?.message || error.details[0].message` extraction. Always provide a `message` so users see the cross-field rule, not Joi's default.

### 3. Optional fields use `.optional()` with defaults where Meta requires them

`status` defaults to `"PAUSED"` — safer than `"ACTIVE"` if a downstream step fails. `specialAdCategories` defaults to `[]`. `targeting.advantageAudience` defaults to `true` (Meta's recommendation).

### 4. Backwards-compat through `.allow("")`

`instagramActorId: Joi.string().optional().allow("")` — accepts empty strings from older clients without forcing them to omit the field. Mirror this when adding a field that older wizard versions might still send.

## Adding a new field — checklist

1. **Update the schema** in `meta.validator.js`. Decide required vs optional, default value, and any cross-field constraints.
2. **Update the controller** in `metaAdLauncher.js` to read the new field from `value` and pass it in the params object to the SDK call.
3. **Update the SDK field list** in `utils/metaHelpers.js` (`getCampaignFields`, `getAdSetFields`, `getAdFields`) **only if** you also want to read this field back on list endpoints. Adding a write-only field doesn't require this.
4. **Update the frontend wizard** to expose the field in the relevant step. Plumb through `form` state.
5. **Update the API client** (`metaAdsApi.js`) — usually no change needed since payloads are passed through, but verify if you renamed anything.
6. **Cache invalidation** — if the new field affects what's shown in list views, the create/update mutation already busts the right cache. Verify.
7. **Label maps** — if the field is a SCREAMING_SNAKE enum displayed in tables, add a label entry in `metaAdsUtils.js`.

## Wizard rebuild — discriminated unions (Phase 1+)

Per [`docs/CAMPAIGN_CREATION_PARITY_PLAN.md`](../../../docs/CAMPAIGN_CREATION_PARITY_PLAN.md), `createAdSetSchema` becomes a **discriminated union by `(objective, conversion_location)`** in Phase 1. Each branch has its own required-field set. Rough shape:

```js
const createAdSetSchemaV2 = Joi.object({
  objective: Joi.string().valid(...META_OBJECTIVES).required(),
  conversion_location: Joi.string().required(),
  // ... shared required fields ...
  // ... branch-specific block selected via Joi.alternatives().conditional() ...
});
```

Or — more maintainable — a `buildAdSetSchema(objective, location)` factory that consumes [`config/wizardSchema.js`](../../../nodejs-backend/config/wizardSchema.js) (created in Phase 0). The factory approach keeps schema authoring out of code: change the matrix, validation follows.

**Do not** carry forward the V1 single-flat schema for V2 work. The whole point of the rebuild is to model branches faithfully.

## Error envelope

Controllers return validation errors in this shape:

```js
return res.status(400).json({
  status: false,
  error: error.details[0].context?.message || error.details[0].message,
});
```

The frontend reads `err?.response?.data?.error` for the headline and `details` for the long-form text. When a validation rule fires, write a message that **describes the rule**, not just the field name (good: "Provide dailyBudget OR lifetimeBudget, not both"; bad: "Invalid input for `dailyBudget`").
