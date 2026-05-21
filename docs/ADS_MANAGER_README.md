# AdsGPT Ads Manager — Developer README

> Meta Ads Manager surface inside AdsGPT — ad-account discovery, dashboard analytics, three-level entity drilldown (Campaign → Ad Set → Ad), audit findings, a Create Campaign Wizard that launches end-to-end on Meta, and an Autopilot subroute that automates ad ops.
>
> **Tagline:** *Everything Meta's Ads Manager does, in AdsGPT — plus an audit lane and an automation lane on the same shell.*

This README is a developer-oriented overview of the `/meta-ads/*` surface as it stands today. For the automation layer that lives under `/meta-ads/autopilot/*` see [AUTOPILOT_README.md](AUTOPILOT_README.md). For the in-flight Wizard rebuild see [CAMPAIGN_CREATION_PARITY_PLAN.md](CAMPAIGN_CREATION_PARITY_PLAN.md).

---

## 1. What the Ads Manager surface is

A self-contained section of AdsGPT that lets a logged-in user:

1. Connect their Facebook account (OAuth, encrypted token store).
2. Pick from the ad accounts they own / have access to.
3. See dashboard analytics (spend, CTR, CPA, ROAS, frequency) over a date preset.
4. Drill from Campaigns → Ad Sets → Ads, with status toggles and a delete-campaign action.
5. Run a 37-rule audit and see findings grouped by severity.
6. Launch a new campaign end-to-end via a 4-step wizard (V1) — campaign + ad set + creative + ad on Meta.
7. Hand off to **Autopilot** (subroute) for continuous rule-based automation + on-demand LLM audit.

The surface is split across **three HTTP namespaces**:

```
/ad-posting/*           ← legacy: OAuth, FB pages, older posted-ads CRUD
/meta-ads/*             ← current: Ads Manager dashboard + Wizard endpoints
/meta-ads/autopilot/*   ← subroute of meta-ads: continuous automation + LLM audit
```

`authenticateJWT` is applied **once at the parent mount** in [Router/MainRouter.js](../nodejs-backend/Router/MainRouter.js). Subroute files do not re-apply it.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AdsGPT Ads Manager surface                         │
│                                                                             │
│  React frontend                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  MetaAdsDashboard.jsx  (account picker + 3 tabs)                      │  │
│  │   ├── AnalyticsPanel  ─────── /meta-ads/get-analytics-data            │  │
│  │   ├── AuditTab        ─────── /meta-ads/audit  (rule-based)           │  │
│  │   └── MetaAdsTableView ───── /meta-ads/get-campaigns / get-ad-sets /  │  │
│  │       (3-level drilldown)     get-campaign-ads / get-ad-set-ads       │  │
│  │                                                                       │  │
│  │  CreateCampaignWizard.jsx   ── POST /meta-ads/create-{campaign,       │  │
│  │   (4-step modal, V1)               adset,ad} + /upload-image          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                            axios │ /meta-ads/*  (JWT)                       │
│                                  ▼                                          │
│  Node backend                                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  metaAdLauncher.js  (~1800 lines, owns nearly every /meta-ads/* path) │  │
│  │   ├── initApiForUser(userId) ── load + decrypt FB token               │  │
│  │   ├── reads & writes  via facebook-nodejs-business-sdk                │  │
│  │   ├── 2-tier Redis cache (REDIS_TTL 2h / VOLATILE_TTL 5m / audit 30m) │  │
│  │   └── invalidate* helpers run on every mutation                       │  │
│  │                                                                       │  │
│  │  metaAuditService.js  ─── 37 rules from auditRulesConfig.js           │  │
│  │  meta.validator.js    ─── Joi schemas (source of truth)               │  │
│  │  metaHelpers.js       ─── canonical SDK field lists                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                  │                                          │
│                                  ▼                                          │
│                    Meta Marketing API (SDK v22 calls)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

Key design choices:

- **Per-user OAuth tokens only.** No system token. Encrypted at rest in `facebookUsers`, decrypted at use via `utils/crypto`. The retired `META_SYSTEM_USER_TOKEN` must not be reintroduced.
- **One controller class for the whole surface.** [metaAdLauncher.js](../nodejs-backend/controllers/adPosting/metaAdLauncher.js) is a singleton with named exports for the few helpers other modules need (`invalidateAllUserMetaCache` for the disconnect handler).
- **Validators are the contract.** Joi schemas in [meta.validator.js](../nodejs-backend/Validations/meta.validator.js) define what the API accepts. The frontend imports the allowed-values arrays (`META_OBJECTIVES`, `BID_STRATEGIES`, ...) so dropdowns can't drift from validation.
- **Two-tier Redis cache + an inline audit TTL.** See [§5 Caching](#5-caching).
- **Errors come back as a structured envelope.** `{ error, details, meta: { code, subcode, fbtraceId, data } }`. The frontend reads `err?.response?.data?.error` for the headline.

---

## 3. Backend layout

All paths relative to [nodejs-backend/](../nodejs-backend/).

### Routes & controllers

| File | Purpose |
|---|---|
| [Router/MainRouter.js](../nodejs-backend/Router/MainRouter.js) | Mounts the three namespaces under `authenticateJWT`. |
| [Router/adPostingRoutes.js](../nodejs-backend/Router/adPostingRoutes.js) | Legacy `/ad-posting/*` split: users / pages / ads. |
| [Router/adPosting/userRoutes.js](../nodejs-backend/Router/adPosting/userRoutes.js) | FB OAuth lifecycle. **Disconnect lives here**: `DELETE /ad-posting/users/:userId`. |
| [Router/adPosting/metaAdRoutes.js](../nodejs-backend/Router/adPosting/metaAdRoutes.js) | All `/meta-ads/*` routes (table below). |
| [Router/autopilot/autopilotRoutes.js](../nodejs-backend/Router/autopilot/autopilotRoutes.js) | Mounts `/meta-ads/autopilot/*` — see [AUTOPILOT_README.md](AUTOPILOT_README.md). |
| [controllers/adPosting/metaAdLauncher.js](../nodejs-backend/controllers/adPosting/metaAdLauncher.js) | Owns nearly every `/meta-ads/*` endpoint. ~1800 lines. |
| [controllers/adPosting/userController.js](../nodejs-backend/controllers/adPosting/userController.js) | OAuth callback + disconnect; calls `invalidateAllUserMetaCache(userId)` on disconnect. |

### `/meta-ads/*` endpoint table

| Method | Path | Controller method | What it does |
|---|---|---|---|
| GET | `/get-ad-accounts` | `getAdAccountsList` | Lists ad accounts visible to the user's token. Accepts `?refresh=true` to skip + invalidate cache. |
| GET | `/get-dashboard-data` | `getDashboardData` | Account-level rollup for the dashboard cards. |
| GET | `/get-analytics-data` | `getAnalyticsData` | Time-series insights for the Analytics tab. |
| GET | `/get-campaigns` | `getCapaignsByAdAccount` | Campaigns under an ad account. |
| GET | `/get-ad-sets` | `getAdSetsByCampaignId` | Ad sets under a campaign (or all ad sets when no campaignId). |
| GET | `/get-campaign-ads` | `getAdsByCampaignId` | Ads under a campaign. |
| GET | `/get-ad-set-ads` | `getAdsByAdSetId` | Ads under an ad set. |
| GET | `/get-insights` | `getInsights` | Per-entity insights with level / breakdown params. |
| GET | `/audit` | `runAudit` | Rule-based audit (37 rules over the last 14 days). |
| GET | `/get-pages` | `getPages` | FB Pages connected to the user — feeds the Wizard. |
| GET | `/get-saved-audiences` | `getSavedAudiences` | Saved audiences on the ad account — feeds the Wizard. |
| PATCH | `/update-status` | `updateStatus` | Pause / resume a campaign / adset / ad. |
| POST | `/create-campaign` | `createCampaign` | Wizard Step 1. Validates with `createCampaignSchema`. |
| POST | `/create-adset` | `createAdSet` | Wizard Step 2. Validates with `createAdSetSchema`. |
| POST | `/upload-image` | `uploadAdImage` | Wizard Step 3 (multer, 10 MB cap). Returns `imageHash`. |
| POST | `/create-ad` | `createAd` | Wizard Step 4. Validates with `createAdSchema`. |
| DELETE | `/delete-campaign` | `deleteCampaign` | Deletes a campaign + cascades cache invalidation. |

### Support modules

| File | Role |
|---|---|
| [services/metaAuditService.js](../nodejs-backend/services/metaAuditService.js) | Rule-based audit engine. `runAuditForAccount({userId, adAccountId, accessToken})` → findings. |
| [config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js) | 37 rule definitions across campaign / adset / ad. Each has `id`, `severity`, `entity`, `defaults`, `check(d, t)`, `message(d)`. |
| [Validations/meta.validator.js](../nodejs-backend/Validations/meta.validator.js) | Joi schemas. Exports the allowed-values arrays the frontend dropdowns import. |
| [utils/metaHelpers.js](../nodejs-backend/utils/metaHelpers.js) | `getCampaignFields`, `getAdSetFields`, `getAdFields`, `getInsightsFields` — canonical SDK field lists. Re-exports `formatBudget`. |
| [utils/formatBudget.js](../nodejs-backend/utils/formatBudget.js) | `Intl.NumberFormat` currency formatter — returns strings like `"₹100.00"`. |
| [Module/adPosting/facebookUsers.js](../nodejs-backend/Module/adPosting/facebookUsers.js) | Mongo model for per-user FB OAuth token (encrypted). |
| [Module/adPosting/metaAuditFinding.js](../nodejs-backend/Module/adPosting/metaAuditFinding.js) | Persistence for LLM-audit findings (Autopilot lane). |
| [Module/adPosting/metaFixLog.js](../nodejs-backend/Module/adPosting/metaFixLog.js) | Apply / undo log for LLM-audit fixes (Autopilot lane). |

### Token resolution

Inside any `/meta-ads/*` controller, get the SDK handle via `await initApiForUser(userId)` (defined in `metaAdLauncher.js`). It throws an `Error` tagged with `.statusCode` so handlers map cleanly to HTTP. Autopilot uses `getAccessTokenForAccount({adAccountId, callerUserId})` from [config/autopilotConfig.js](../nodejs-backend/config/autopilotConfig.js) — see the Autopilot README.

---

## 4. Frontend layout

All paths relative to [react-frontend/](../react-frontend/).

### Component map

```
src/
├── components/MetaAds/
│   ├── MetaAdsDashboard.jsx       ← root; account picker + tab shell
│   ├── MetaAdsPanels.jsx          ← AnalyticsPanel + AuditTab
│   ├── MetaAdsTableView.jsx       ← three-level drilldown (Campaigns → AdSets → Ads)
│   ├── MetaAdsAtoms.jsx           ← StatusBadge, Spinner, EmptyState, Dropdown, ChartTooltip
│   ├── CreateCampaignWizard.jsx   ← 4-step modal (V1 — being rebuilt to V2)
│   ├── LibraryPicker.jsx          ← image picker for the wizard's Ad step
│   └── metaAdsUtils.js            ← DATE_PRESETS, STATUS_MAP, fmt/fmtINR, enum label maps
└── apis/
    ├── metaAds/metaAdsApi.js      ← axios clients for /meta-ads/*
    └── autopilot/                 ← see AUTOPILOT_README.md
```

### Dashboard tabs

| Tab | Component | Data source |
|---|---|---|
| **Analytics** | `AnalyticsPanel` (in `MetaAdsPanels.jsx`) | `/meta-ads/get-analytics-data`, `/meta-ads/get-dashboard-data` |
| **Audit** | `AuditTab` (in `MetaAdsPanels.jsx`) | `/meta-ads/audit` |
| **Campaigns** | `MetaAdsTableView.jsx` | `/meta-ads/get-campaigns` → `/get-ad-sets` → `/get-campaign-ads` |

The account picker (top of [MetaAdsDashboard.jsx](../react-frontend/src/components/MetaAds/MetaAdsDashboard.jsx)) hydrates from `/meta-ads/get-ad-accounts`. There is no hardcoded account list anywhere in the frontend.

### Shared utilities

[metaAdsUtils.js](../react-frontend/src/components/MetaAds/metaAdsUtils.js) exports:

- `DATE_PRESETS` — the canonical preset keys (`today`, `last_7d`, `last_30d`, ...).
- `STATUS_MAP` — handles both numeric (`1` = ACTIVE on ad accounts) and string (`"ACTIVE"` on campaigns/adsets/ads) status shapes.
- `fmt` / `fmtINR` — number / currency formatters.
- Enum label maps for SCREAMING_SNAKE values (objectives, optimization goals, bid strategies, billing events, CTAs).

When you add a new SCREAMING_SNAKE enum field to a list view, add its label entry here.

---

## 5. Caching

Redis-backed, two TTL tiers plus an inline audit TTL. Get this wrong and users see ghost data for hours.

### TTL tiers

Defined at the top of [metaAdLauncher.js](../nodejs-backend/controllers/adPosting/metaAdLauncher.js):

```js
const REDIS_TTL    = 7200; // 2 hr — stable lists
const VOLATILE_TTL = 300;  // 5 min — period metrics that drift in real time
```

Plus the audit endpoint uses an inline `1800` (30 min).

| Tier | Used for | Why |
|---|---|---|
| `REDIS_TTL` (2 h) | Ad accounts, campaigns, adsets, ads | Change only on user mutation; we bust on writes. |
| `VOLATILE_TTL` (5 min) | `metaAnalytics`, `metaDashboard`, `metaInsights` | Spend / impressions drift in real time. Long TTL produces "today > last_7d" cross-preset inconsistencies. |
| Inline `1800` (30 min) | `metaAudit` | Audit loops 37 rules over every entity — expensive. 5 min would make refreshes painful; 2 h would leave stale findings. |

**Decision rule:** if the cached value contains a metric that changes minute-to-minute, use `VOLATILE_TTL`. Otherwise `REDIS_TTL`.

### Key conventions

All keys are namespaced per user:

```
metaAdAccounts:<userId>
metaCampaigns:<userId>:<adAccountId>
metaAdsets:<userId>:<adAccountId>:<campaignId | "all">
metaCampaignAds:<userId>:<campaignId>
metaAdSetAds:<userId>:<adSetId>
metaAnalytics:<userId>:<adAccountId>:<datePreset>
metaDashboard:<userId>:<adAccountId | "all">:<datePreset>
metaInsights:<userId>:<adAccountId>:<datePreset>:<level>:<campaignId | "none">:<adsetId | "none">:<adId | "none">
metaAudit:<userId>:<adAccountId>
```

When you add a new endpoint, **always** prefix the key with `meta<Entity>:<userId>:` so the bulk-invalidation helpers can find it by prefix.

### Invalidation tiers

```js
const STATUS_CACHE_PREFIXES = [
  "metaCampaigns", "metaAdsets", "metaCampaignAds", "metaAdSetAds", "metaDashboard",
];
const ALL_CACHE_PREFIXES = [
  ...STATUS_CACHE_PREFIXES,
  "metaAnalytics", "metaInsights", "metaAudit", "metaAdAccounts",
];
```

| Mutation | Invalidate via |
|---|---|
| Status update (pause/resume) | `invalidateUserMetaCache(userId)` → `STATUS_CACHE_PREFIXES` |
| Create campaign / adset / ad | `invalidateAfterCreate(userId, { adAccountId, campaignId, adSetId })` — surgical |
| Delete campaign | `invalidateUserMetaCache(userId)` + `invalidateMetaCacheByPrefixes(userId, ["metaAnalytics","metaAudit"])` |
| FB disconnect | `invalidateAllUserMetaCache(userId)` → `ALL_CACHE_PREFIXES` (exported as a named export for the disconnect handler) |

### Force-refresh from the frontend

`getAdAccounts({ refresh: true })` adds `?refresh=true` which makes the backend skip the cache read AND invalidate the existing key. Used after the FB OAuth callback so newly-granted accounts appear immediately. Mirror this when you add a "force refresh" affordance to a new tab.

---

## 6. Validators (Joi)

[meta.validator.js](../nodejs-backend/Validations/meta.validator.js) is the source of truth for what the API accepts. Frontend validation is a UX layer only.

| Schema | Used by | Notes |
|---|---|---|
| `updateAdStatusSchema` | `PATCH /update-status` | `level` ∈ {campaign, adset, ad}, `id`, `status` ∈ {ACTIVE, PAUSED}. |
| `createCampaignSchema` | `POST /create-campaign` | Hard-codes the 6 modern ODAX objectives. CBO budget is mutually exclusive with adset budget (custom validator). |
| `createAdSetSchema` | `POST /create-adset` | Big one. Targeting, budget, billing event, optimization goal, bid strategy, optional saved audience, schedule. Rejects "neither saved audience nor country list nor worldwide". |
| `createAdSchema` | `POST /create-ad` | Creative + identity + CTA. Image-only today. |
| `deleteCampaignSchema` | `DELETE /delete-campaign` | `adAccountId` + `campaignId` only. |
| `applyFixSchema` | LLM audit `apply-fix/:findingId` (Autopilot lane) | `confirmed: true`, `acknowledgeRisk`, `paramOverrides`. |

### Patterns

- **Allowed-values arrays are exported** (`META_OBJECTIVES`, `SPECIAL_AD_CATEGORIES`, `BID_STRATEGIES`, ...) so frontend dropdowns can't drift from validation.
- **Cross-field constraints use `.custom()`** with a `message` so users see the rule, not Joi's default.
- **Optional fields default to safe values.** `status` defaults to `"PAUSED"`; `targeting.advantageAudience` defaults to `true` (Meta's recommendation); `specialAdCategories` defaults to `[]`.
- **`.allow("")` for backwards-compat** with older wizard payloads that still send empty strings.

### Adding a new field — checklist

1. Update the schema in `meta.validator.js` (required vs optional, default, cross-field rules).
2. Update the controller in `metaAdLauncher.js` to read it from `value` and pass it to the SDK.
3. Update the SDK field list in `utils/metaHelpers.js` **only if** you want to read it back on list endpoints.
4. Update the wizard / dashboard frontend to expose the field.
5. Add a label entry in `metaAdsUtils.js` if it's a SCREAMING_SNAKE enum shown in tables.
6. Verify the existing `invalidateAfterCreate` / `invalidateUserMetaCache` paths cover the new field's display surface.

---

## 7. Create Campaign Wizard

[CreateCampaignWizard.jsx](../react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx) — single 4-step modal that creates a Campaign + AdSet + Ad on Meta in four sequential API calls.

> ⚠️ **The Wizard is being rebuilt to full Meta parity.** Read [CAMPAIGN_CREATION_PARITY_PLAN.md](CAMPAIGN_CREATION_PARITY_PLAN.md) before any non-trivial wizard change. New wizard work goes into V2 (config-driven from `wizardSchema`). V1 is feature-frozen and gets deleted at end of Phase 6.

### V1 steps

1. **Campaign** — name, objective (one of 6 ODAX values), special ad categories, optional CBO budget.
2. **Ad Set** — name, page, optional IG identity, optional saved audience OR (countries / worldwide), age, gender, locales, advantage-audience toggle, billing event, optimization goal, bid strategy, optional bid amount, optional schedule, status.
3. **Ad** — image upload, headline, primary text, description, link URL, optional URL tags, CTA, status.
4. **Review** — summary + Launch button.

### Idempotent retry — `created` step cache

The wizard caches step results in component state so a failed step can be retried without recreating the parent entities:

```js
const [created, setCreated] = useState({}); // { campaignId, adSetId, imageHash }
```

Each step's launch logic:

```js
let campaignId = created.campaignId;
if (!campaignId) {
  // ... create campaign on Meta ...
  setCreated((p) => ({ ...p, campaignId }));
}
// continue using campaignId (whether freshly created or cached)
```

Cache resets on: wizard open (`useEffect([open])`), successful completion (right before `onClose()`), explicit "Discard" via the close-confirm modal.

Cache does **not** reset when the user clicks Back and edits an earlier step — the cached IDs still point at entities created with the old form values. Documented limitation; user must close + reopen + delete the orphan to truly start fresh.

**When you add a new wizard step** (e.g. lead form, catalog binding, pixel selection), extend `created` with the new ID so retries skip it too.

### V2 — config-driven rebuild (planned)

Per the parity plan, V2 will:

1. **Render from `wizardSchema`** ([config/wizardSchema.js](../nodejs-backend/config/wizardSchema.js), authored in Phase 0). Schema enumerates every (objective × conversion location × goal) combination and the fields each requires.
2. **Insert a Conversion Location step** between Campaign and Ad Set — the missing branch point that drives most form variance.
3. **Use a discriminated-union Joi validator** (or a `buildAdSetSchema(objective, location)` factory).
4. **Live behind `FEATURE_WIZARD_V2`** feature flag, side-by-side with V1 until end of Phase 6.

---

## 8. Audit

A 37-rule deterministic audit, separate from the LLM audit that lives under Autopilot.

| Engine | Trigger | Where | UI |
|---|---|---|---|
| **Rule-based** (this surface) | On-demand `GET /meta-ads/audit` + hourly Autopilot cron | [services/metaAuditService.js](../nodejs-backend/services/metaAuditService.js) + [config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js) | Audit tab on dashboard |
| **LLM audit** (Autopilot lane) | On-demand `POST /meta-ads/autopilot/llm-audit` | [controllers/autopilot/llmAuditController.js](../nodejs-backend/controllers/autopilot/llmAuditController.js) | Autopilot's AI Audit tab — see [AUTOPILOT_README.md](AUTOPILOT_README.md) |

### Rule shape

```js
{
  id: "AUD-25",                   // monotonic id
  severity: "opportunity",        // "critical" | "warning" | "opportunity"
  entity: "ad",                   // "campaign" | "adset" | "ad"
  defaults: { min_spend: 10000, min_ctr: 3 },
  check: (d, t) => d.spend > t.min_spend && d.ctr >= t.min_ctr,
  message: (d) => `${d.ad_name} has excellent CTR at ${d.ctr.toFixed(2)}%`,
}
```

`d` is the per-entity metrics object the engine builds (spend, ctr, cpa, roas, frequency, prev_*, status, ...). `t` is the resolved thresholds (defaults overridden by per-account config when present).

### Fixed window

The audit always runs over the **last 14 days**, regardless of the dashboard's global date filter. The rule thresholds are calibrated to that window. The Audit tab shows a fixed note saying so. If a tester reports "Audit ignores the date filter" — that's intentional.

### Adding a rule

1. Pick a free `id` (`AUD-XX`). Keep increment monotonic.
2. Add to `auditRulesConfig.js`. Pick `entity`, `severity`, define `defaults`, `check`, `message`.
3. **Always `.toFixed(2)` percentages / floats in the message.** Naked `${d.ctr}` produces `4.848967%` and we keep getting bugs about it.
4. If the rule introduces a new metric, extend the metric flattening in `metaAuditService.js`.
5. Optional: add an Autopilot action handler if the rule should auto-fix.

### Frontend

`AuditTab` in [MetaAdsPanels.jsx](../react-frontend/src/components/MetaAds/MetaAdsPanels.jsx). Filter pills: `all` | `critical` | `warning` | `opportunity`. **Default is `all`** — defaulting to a severity bucket that's empty makes the tab look broken (was a bug; fixed). Findings are grouped by entity, one card per finding. Rule audit is intentionally informational — apply-fix lives only in the LLM audit lane.

---

## 9. Disconnect flow

`DELETE /ad-posting/users/:userId` (note: legacy mount, not `/meta-ads/*`):

1. Removes the FB OAuth token from `FacebookUsers`.
2. Calls `invalidateAllUserMetaCache(userId)` — the named export from [metaAdLauncher.js](../nodejs-backend/controllers/adPosting/metaAdLauncher.js).
3. Wipes every cache prefix in `ALL_CACHE_PREFIXES` for that user.

The frontend disconnect button lives on `MetaAdsDashboard.jsx` and routes the user back to `/ads-manager`.

---

## 10. Error handling

The SDK throws `FacebookRequestError` where the response body is **flattened directly onto `error.response`**, NOT under `.response.error`. Most error formatters from older Meta docs are wrong.

```js
error.response.message          // generic — usually "Invalid parameter"
error.response.code             // numeric Meta error code
error.response.error_subcode
error.response.error_user_title // ← human-readable, surface this
error.response.error_user_msg   // ← human-readable, surface this
error.response.error_data       // sometimes a JSON-string of blame_field_specs
error.response.fbtrace_id
```

Use `formatMetaError(error)` and `logMetaError(prefix, error)` from `metaAdLauncher.js`. When debugging an unexplained "Invalid parameter", `error.response.error_user_msg` almost always has the real reason.

**Diagnostic shortcut:** `JSON.stringify(error, Object.getOwnPropertyNames(error))` grabs non-enumerable props (response, status, headers) that a plain stringify drops.

### Controller error envelope

```js
return res.status(400).json({
  status: false,
  error: error.details[0].context?.message || error.details[0].message,
  details: ...,
  meta: { code, subcode, fbtraceId, data },
});
```

Frontend reads `err?.response?.data?.error` for the headline and `details` for long-form text.

---

## 11. Gotchas — bugs we keep hitting

These have produced bug tickets multiple times. Read before any non-trivial change.

### Currency strings, not numbers

`formatBudget()` returns currency-formatted strings (`"₹100.00"`, `"$5.00"`). Backend list endpoints pass budget fields through this formatter. `parseFloat("₹100.00")` returns `NaN` — naive numeric checks silently fail.

**Fix pattern:** strip non-numeric chars before parsing. The `hasBudget()` helper in [MetaAdsTableView.jsx](../react-frontend/src/components/MetaAds/MetaAdsTableView.jsx) does this — reuse it. Note `parseBudget()` in the same file ALSO uses naked `parseFloat` and has been silently rendering `BudgetBar` as empty since launch.

### Lifetime vs daily budget

CBO campaigns can use **either** `daily_budget` OR `lifetime_budget`. Adsets under a CBO parent return `daily_budget = 0` regardless. Use:

```js
const isCBO = hasBudget(c.daily_budget) || hasBudget(c.lifetime_budget);
```

For display: fall through `daily → lifetime → "Set on ad set"`.

### `bid_type` is legacy; use `bid_strategy`

`bid_type` on Ad nearly always returns `ABSOLUTE_OCPM` regardless of campaign config. The user-meaningful bidding choice is `bid_strategy` on the **AdSet** (`LOWEST_COST_WITHOUT_CAP`, `COST_CAP`, ...). Prefer `bid_strategy` in list views.

### `is_adset_budget_sharing_enabled` is required for non-CBO

Meta enforces this flag on campaigns without a campaign-level budget. Omitting it returns:
> "Must specify True or False in is_adset_budget_sharing_enabled field"

`createCampaign` defaults it to `false` when `dailyBudget` and `lifetimeBudget` are both absent. **Don't strip this default.**

### Meta Marketing API v22 deprecations (hard-cut 2025-09-09)

| Legacy | Current |
|---|---|
| `instagram_actor_id` | `instagram_user_id` |
| `instagram_story_id` | `source_instagram_media_id` |
| `effective_instagram_story_id` | `effective_instagram_media_id` |

The `facebook-nodejs-business-sdk` ships `Fields.instagram_actor_id` constants from older codegen — they fail at request time. **Pass the new names as literal strings**; don't trust `Fields.*` for IG-related fields.

Also: `promoted_object.instagram_user_id` is **only** valid for ads that promote an IG account directly. For Traffic/Engagement/Sales, IG identity goes on the creative's `object_story_spec.instagram_user_id`.

### Audit messages need `.toFixed(2)`

`${d.ctr}` produces `4.848967%`. Always `.toFixed(2)` on percentages and floats in `auditRulesConfig.js` messages.

### `createAd` must stay `Ad.Status.active`

The batch launch flow in `AdController.createAd` requires `Ad.Status.active`. Don't "fix" Meta validation errors by flipping it to PAUSED — fix the creative shape instead.

### Tailwind text tokens

The project's Tailwind v4 config defines `text-10`, `text-13`, `text-15`, `text-18` only — **not** `text-11`, `text-12`, `text-14`, etc. Those classes land in the DOM but match no CSS rule and fall through to the inherited size. Use `text-10` / `text-xs` / `text-13` / `text-sm` / `text-15` / `text-base` / `text-18` / `text-lg`, or arbitrary values like `text-[11px]`.

### `STATUS_MAP` handles both shapes

Meta returns numeric `account_status: 1` for ad accounts and string `"ACTIVE"` for campaigns / adsets / ads. `STATUS_MAP` in `metaAdsUtils.js` maps both to the same badge — don't normalize at fetch time.

### AnimatePresence + table refresh flicker

`MetaAdsTableView.jsx` campaign table renders rows even during a refresh-loading state if you don't gate the row map with `!loading`. Pattern:

```jsx
{loading && <SpinnerRow />}
{!loading && sorted.length === 0 && <EmptyRow />}
{!loading && sorted.map(...)}  // ← !loading guard required
```

### Disconnect lives at `/ad-posting`

`DELETE /ad-posting/users/:userId`, **not** `/meta-ads/disconnect`. Legacy mount because that's where FB OAuth was originally built. The disconnect handler imports `invalidateAllUserMetaCache` as a named export from `metaAdLauncher.js`.

---

## 12. How to test

### Unit tests

The Ads Manager surface itself has no dedicated test suite yet — coverage is currently concentrated on the Autopilot lane:

```bash
cd nodejs-backend
npm run test:autopilot
```

When adding tests for the Ads Manager surface, put them under `nodejs-backend/test/metaAds/` and follow the Autopilot test layout for fixtures.

### Local manual test

1. Start backend + frontend locally (or point at the dev environment).
2. Mint or paste a JWT via the dev-auth landing page (see [AUTOPILOT_README.md §10.3](AUTOPILOT_README.md) for the minting snippet).
3. Connect Facebook from the dashboard's account picker — populates `facebookUsers` for your user.
4. Pick an ad account from the dropdown; verify the three tabs render data.
5. Open the Wizard and create a paused campaign end-to-end. Check `/meta-ads/get-campaigns` returns it.
6. Run the Audit tab; verify findings group by severity and `.toFixed(2)`'d percentages render correctly.
7. Pause / resume a campaign; verify the table refreshes with fresh data (no stale cache).
8. Disconnect FB; verify the user is routed back to `/ads-manager` and every `meta*:<userId>:*` key in Redis is gone.

### Manual API tests via curl

Replace `<JWT>` with your token, `<ACT>` with an ad account id you own.

```bash
# List ad accounts (force refresh)
curl "https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/get-ad-accounts?refresh=true" \
  -H "Authorization: Bearer <JWT>"

# Dashboard rollup
curl "https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/get-dashboard-data?adAccountId=<ACT>&datePreset=last_7d" \
  -H "Authorization: Bearer <JWT>"

# Run audit
curl "https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/audit?adAccountId=<ACT>" \
  -H "Authorization: Bearer <JWT>"

# Pause a campaign
curl -X PATCH https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/update-status \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"level":"campaign","id":"<CAMPAIGN_ID>","status":"PAUSED"}'

# Delete a campaign
curl -X DELETE https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/delete-campaign \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"adAccountId":"<ACT>","campaignId":"<CAMPAIGN_ID>"}'
```

---

## 13. Coordination with Autopilot & the Wizard rebuild

This surface sits between two larger in-flight workstreams:

- **Autopilot** ([AUTOPILOT_README.md](AUTOPILOT_README.md)) consumes the same audit engine and shares the same cache + invalidation conventions. Read it before adding new mutation endpoints — Autopilot's action log may need to know about them.
- **Wizard V2 rebuild** ([CAMPAIGN_CREATION_PARITY_PLAN.md](CAMPAIGN_CREATION_PARITY_PLAN.md)) will replace `CreateCampaignWizard.jsx` and convert `createAdSetSchema` to a discriminated union (or a factory consuming `wizardSchema.js`). Don't extend V1 with new objectives or fields — open the parity plan and add to the V2 milestone instead.

When in doubt, prefer **breaking the change into smaller pieces** that each phase of the rebuild can adopt independently, over a single big change that V1 and V2 both have to track.

---

## 14. Glossary

- **Ad account** — Meta entity (`act_XXXXXXXXXX`) that owns campaigns. A user can have access to many.
- **ODAX** — Outcome-Driven Ad Experiences; the 6 modern objectives (`OUTCOME_AWARENESS`, `OUTCOME_TRAFFIC`, `OUTCOME_ENGAGEMENT`, `OUTCOME_LEADS`, `OUTCOME_APP_PROMOTION`, `OUTCOME_SALES`).
- **CBO** — Campaign Budget Optimization; budget set at campaign level, distributed across adsets by Meta.
- **Conversion location** — Where the conversion happens (Website / App / Messenger / etc.). Drives the form variance the parity rebuild is modelling.
- **Saved audience** — A pre-built targeting block on the ad account; the wizard can use one in lieu of building targeting inline.
- **Advantage audience** — Meta's recommendation that detailed-targeting is a suggestion, not a hard filter. Default `true`.
- **`bid_strategy` vs `bid_type`** — `bid_strategy` (AdSet) is the user-facing choice; `bid_type` (Ad) is legacy.
- **Audit window** — Fixed 14-day window the rule audit runs over.
- **Severity** — `critical` | `warning` | `opportunity` (plus `scaling` rules `AUD-32`–`AUD-37` used by Autopilot's scale-winners path).
- **STATUS_MAP** — Frontend label map that handles both numeric (ad accounts) and string (campaigns/adsets/ads) status shapes from Meta.
- **`created` cache** — Wizard component-state cache of `{ campaignId, adSetId, imageHash }` that makes step retries idempotent.
