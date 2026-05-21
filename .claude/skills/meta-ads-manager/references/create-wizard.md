# Create Campaign Wizard

The wizard creates a campaign + ad set + ad on Meta in four sequential API calls. It is **being rebuilt to full Meta parity** per [`docs/CAMPAIGN_CREATION_PARITY_PLAN.md`](../../../docs/CAMPAIGN_CREATION_PARITY_PLAN.md). Read both files before making non-trivial wizard changes.

## V1 — current state (~10–15% parity)

[`react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx`](../../../react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx) — single rigid 4-step modal:

1. **Campaign** — name, objective (one of 6 ODAX values), special ad categories, optional CBO budget.
2. **Ad Set** — name, page, optional Instagram identity, optional saved audience OR (countries / worldwide), age, gender, locales, advantage-audience toggle, billing event, optimization goal, bid strategy, optional bid amount, optional schedule, status.
3. **Ad** — image upload, headline, primary text, description, link URL, optional URL tags, CTA, status.
4. **Review** — summary + Launch button.

### What V1 hardcodes (and parity work fixes)

| Assumption | Why it's wrong |
|---|---|
| Conversion location = Website | Real Ads Manager exposes Website / App / Messenger / Instagram / WhatsApp / Calls / Lead Form / etc. per objective. |
| Creative = single image | Ads Manager supports video, carousel, collection, dynamic creative, asset feed spec. |
| One billing event + one optimization goal | Both are objective-and-location-dependent. Most combinations valid in V1's dropdown are invalid for some objectives. |
| Targeting = country list OR saved audience | Missing detailed targeting (interest/behavior/demo search), custom audiences, lookalikes, exclusions. |
| Placements = automatic | Manual placement selection across FB/IG/Messenger/Audience Network surfaces is missing. |
| No tracking integration | Pixel + conversion event picker missing. Required for SALES + Website. |
| Identity = Page (+ optional IG) | App Promotion needs linked App; Catalog Sales needs Catalog. |

## Idempotent retry — `created` step cache

Already shipped in V1 and will carry forward to V2. The wizard caches step results in component state:

```js
const [created, setCreated] = useState({}); // { campaignId, adSetId, imageHash }
```

Each step in `handleLaunch`:

```js
let campaignId = created.campaignId;
if (!campaignId) {
  // ... create campaign on Meta ...
  setCreated((p) => ({ ...p, campaignId }));
}
// continue to next step using campaignId (whether freshly created or cached)
```

**Cache resets** on:
- Wizard open (`useEffect([open])`).
- Successful completion (right before `onClose()`).
- Explicit "Discard" via the close-confirm modal.

**Cache does NOT reset** when the user goes back to a previous step and edits a field — the cached IDs still point at the entities created with old form values. Documented limitation; user must close + reopen + delete the orphan to truly start fresh.

**When you add a new step** (e.g. lead form creation, catalog binding, pixel setup), extend `created` with the new ID and gate the new step on it.

## V2 — config-driven rebuild

Per the parity plan, V2 will:

1. **Render from `wizardSchema`** ([`config/wizardSchema.js`](../../../nodejs-backend/config/wizardSchema.js), authored in Phase 0). Schema enumerates every (objective × location × goal) combination and the fields each requires.
2. **Insert a Conversion Location step** between Campaign and Ad Set — the missing branch point that drives most form variance.
3. **Use a discriminated-union Joi validator** (or a `buildAdSetSchema(objective, location)` factory) — see [`validators.md`](validators.md).
4. **Live behind `FEATURE_WIZARD_V2`** feature flag, side-by-side with V1 until end of Phase 6.

### Migration order

Phase 2 ships objectives sequentially. When an objective ships in V2, V1 stops offering it (the V1 dropdown filters out the migrated objective). V1 is deleted at end of Phase 6.

### Field component library (Phase 1)

V2 fields are reusable components in `react-frontend/src/components/MetaAds/wizardFields/` (created in Phase 1):

- `<TextField />`, `<NumberField />`, `<SelectField />`, `<MultiSelectField />`, `<CurrencyField />`, `<DateField />`, `<ImageField />`, `<LookupAsyncField />` (for autocomplete against Meta's targeting search), `<ToggleField />`, `<RangeField />` (age min-max).

Each component reads its config from a wizardSchema entry and emits canonical state. The wizard step renders these in the order the schema specifies for the current (objective × location).

## Backend — wizard endpoints

| Endpoint | What it does | Idempotency |
|---|---|---|
| `POST /meta-ads/create-campaign` | Creates Campaign on Meta. Validates with `createCampaignSchema`. Defaults `is_adset_budget_sharing_enabled: false` for non-CBO. | None server-side — frontend caches the returned `campaign.id`. |
| `POST /meta-ads/create-adset` | Creates AdSet under campaign. Validates with `createAdSetSchema`. Resolves saved audience → targeting JSON via `SavedAudience.get(["targeting"])` if `savedAudienceId` provided. | Same. |
| `POST /meta-ads/upload-image` | Multipart upload. 10MB cap (multer). Uploads bytes straight to Meta and returns `imageHash`. | Same — frontend caches the hash. |
| `POST /meta-ads/create-ad` | Creates Creative (`object_story_spec`) + Ad in one call. Validates with `createAdSchema`. | Same. |

After each successful create, the controller calls `invalidateAfterCreate(userId, { adAccountId, campaignId, adSetId })` to bust the relevant list caches.

## V1 known issues (kept for reference; resolved or scheduled)

- ✅ `is_adset_budget_sharing_enabled` defaulting (resolved server-side).
- ✅ Step retry duplication (resolved via `created` cache).
- ⏳ Form state lost when user goes back to edit between failed attempts (documented limitation; will be addressed in V2 with a "Discard previous attempt" affordance on the error banner).
- ⏳ Image-only creative (Phase 3).
- ⏳ Single CTA list shown for all objectives (CTA filtering by objective in Phase 3).
- ⏳ No pixel / conversion event integration (Phase 2c — Sales).
- ⏳ No lead form builder (Phase 2b — Leads + Instant Form).
