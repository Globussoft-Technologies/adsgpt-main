# Architecture — file-by-file map

The Meta Ads Manager surface is split across **three HTTP namespaces** (older + newer + nested subroute) plus a tightly coupled set of services and frontend components. This file is the authoritative map.

## HTTP namespaces

Mounted in [`nodejs-backend/Router/MainRouter.js`](../../../nodejs-backend/Router/MainRouter.js):

```
app.use("/ad-posting",  authenticateJWT, adPostingRoutes);   // legacy: OAuth / pages / posted-ads
app.use("/meta-ads",    authenticateJWT, metaAdRoutes);      // current: Ads Manager dashboard surface
                                            └─ /meta-ads/autopilot/* ← Autopilot subroute, mounted from metaAdRoutes
```

`authenticateJWT` is applied **once at the parent mount**. Subroute files do not re-apply it.

### `/ad-posting/*` — legacy surface

[`Router/adPostingRoutes.js`](../../../nodejs-backend/Router/adPostingRoutes.js) → splits into:
- `/users` → `Router/adPosting/userRoutes.js` — FB OAuth lifecycle. **The disconnect endpoint lives here**: `DELETE /ad-posting/users/:userId`.
- `/pages` → `Router/adPosting/pageRoutes.js` — FB Page management.
- `/ads` → `Router/adPosting/adRoutes.js` — basic ad CRUD against the older `postedAds` collection.

### `/meta-ads/*` — Ads Manager dashboard

[`Router/adPosting/metaAdRoutes.js`](../../../nodejs-backend/Router/adPosting/metaAdRoutes.js) → all routes flow through [`controllers/adPosting/metaAdLauncher.js`](../../../nodejs-backend/controllers/adPosting/metaAdLauncher.js):

| Method | Path | Controller method |
|---|---|---|
| GET | `/get-ad-accounts` | `getAdAccountsList` |
| GET | `/get-dashboard-data` | `getDashboardData` |
| GET | `/get-analytics-data` | `getAnalyticsData` |
| GET | `/get-campaigns` | `getCapaignsByAdAccount` |
| GET | `/get-ad-sets` | `getAdSetsByCampaignId` |
| GET | `/get-campaign-ads` | `getAdsByCampaignId` |
| GET | `/get-ad-set-ads` | `getAdsByAdSetId` |
| GET | `/get-insights` | `getInsights` |
| GET | `/audit` | `runAudit` (rule-based) |
| GET | `/get-pages` | `getPages` |
| GET | `/get-saved-audiences` | `getSavedAudiences` |
| PATCH | `/update-status` | `updateStatus` |
| POST | `/create-campaign` | `createCampaign` |
| POST | `/create-adset` | `createAdSet` |
| POST | `/upload-image` | `uploadAdImage` (multer) |
| POST | `/create-ad` | `createAd` |
| DELETE | `/delete-campaign` | `deleteCampaign` |

### `/meta-ads/autopilot/*` — Autopilot subroute

[`Router/autopilot/autopilotRoutes.js`](../../../nodejs-backend/Router/autopilot/autopilotRoutes.js) splits across three controllers:

- [`controllers/autopilot/autopilotController.js`](../../../nodejs-backend/controllers/autopilot/autopilotController.js) — continuous engine: `/run`, `/run-cycle`, `/audit/run`, `/rename-by-hook`, `/rotate`, `/test-slack`, `/test-email`, `/log`, `/log/:runId`, `/summary`, `/settings` (GET+PATCH), `/config`, `/audit-rules`, `/rotation-queue`, `/approve-generated/:draftId`.
- [`controllers/autopilot/autopilotUserRuleController.js`](../../../nodejs-backend/controllers/autopilot/autopilotUserRuleController.js) — Autopilot v4 user-defined rules: `/rules` CRUD + `/rules/:id/test`, plus `/rule-templates`.
- [`controllers/autopilot/llmAuditController.js`](../../../nodejs-backend/controllers/autopilot/llmAuditController.js) — on-demand LLM audit: `/llm-audit`, `/llm-audit/audits`, `/llm-audit/findings/:auditId`, `/llm-audit/apply-fix/:findingId`, `/llm-audit/dismiss/:findingId`, `/llm-audit/undo/:findingId`, `/llm-audit/fix-log`.

## Backend support modules

| Path | Role |
|---|---|
| [`controllers/adPosting/metaAdLauncher.js`](../../../nodejs-backend/controllers/adPosting/metaAdLauncher.js) | Class singleton + named `invalidateAllUserMetaCache` export. ~1800 lines. Owns nearly every `/meta-ads/*` endpoint. |
| [`services/metaAuditService.js`](../../../nodejs-backend/services/metaAuditService.js) | Rule-based audit engine. Reads `auditRulesConfig.js`. |
| [`config/auditRulesConfig.js`](../../../nodejs-backend/config/auditRulesConfig.js) | 37 rule definitions across campaign/adset/ad. Each has `id`, `severity`, `entity`, `defaults`, `check(d, t)`, `message(d)`. |
| [`config/autopilotConfig.js`](../../../nodejs-backend/config/autopilotConfig.js) | `getAccessTokenForAccount({adAccountId, callerUserId})` resolves the FB token to use; respected by both audit and autopilot cron. |
| [`Validations/meta.validator.js`](../../../nodejs-backend/Validations/meta.validator.js) | Joi schemas. Source of truth — see [`validators.md`](validators.md). |
| [`utils/metaHelpers.js`](../../../nodejs-backend/utils/metaHelpers.js) | `getAdFields`, `getAdSetFields`, `getCampaignFields`, `getInsightsFields` — canonical field lists for SDK reads. Re-exports `formatBudget`. |
| [`utils/formatBudget.js`](../../../nodejs-backend/utils/formatBudget.js) | `Intl.NumberFormat` currency formatter. Returns strings like `"₹100.00"` — see [`gotchas.md`](gotchas.md#currency-strings). |
| [`Module/adPosting/facebookUsers.js`](../../../nodejs-backend/Module/adPosting/facebookUsers.js) | Mongo model for the per-user FB OAuth token (encrypted; decrypt via `utils/crypto`). |
| [`Module/adPosting/metaAuditFinding.js`](../../../nodejs-backend/Module/adPosting/metaAuditFinding.js), [`metaFixLog.js`](../../../nodejs-backend/Module/adPosting/metaFixLog.js) | LLM audit persistence. |

## Frontend layout

```
react-frontend/src/
├── components/MetaAds/
│   ├── MetaAdsDashboard.jsx       ← root; account picker + tab shell
│   ├── MetaAdsPanels.jsx          ← AnalyticsPanel + AuditTab
│   ├── MetaAdsTableView.jsx       ← three-level drilldown (Campaigns → AdSets → Ads)
│   ├── MetaAdsAtoms.jsx           ← StatusBadge, Spinner, EmptyState, Dropdown, ChartTooltip
│   ├── CreateCampaignWizard.jsx   ← 4-step modal (V1 — being rebuilt to V2)
│   ├── LibraryPicker.jsx          ← image picker for the wizard's Ad step
│   └── metaAdsUtils.js            ← DATE_PRESETS, STATUS_MAP, fmt/fmtINR, enum label maps
└── apis/
    ├── metaAds/metaAdsApi.js      ← /meta-ads/* endpoint clients
    └── autopilot/
        ├── autopilotApi.js        ← /meta-ads/autopilot/* (rules, cron, etc.)
        └── llmAuditApi.js         ← /meta-ads/autopilot/llm-audit/*
```

The dashboard has **three tabs**: Analytics | Audit | Campaigns. Each tab loads its data independently through the relevant API client.

## Identity & token resolution

- Per-user FB OAuth token lives in `FacebookUsers` Mongo collection (encrypted).
- Inside any `/meta-ads/*` controller, get the token via `await initApiForUser(userId)` (defined in `metaAdLauncher.js`). It throws an `Error` tagged with `.statusCode` so handlers map cleanly to HTTP.
- Inside Autopilot, use `getAccessTokenForAccount({adAccountId, callerUserId})` from `config/autopilotConfig.js` — this respects the per-account `ownerUserId` for cron runs and falls back to the caller for on-demand requests.
- The legacy `META_SYSTEM_USER_TOKEN` is **retired** — do not introduce code that reaches for it.

## Disconnect flow

`DELETE /ad-posting/users/:userId`:
1. Removes the FB OAuth token from `FacebookUsers`.
2. Calls `invalidateAllUserMetaCache(userId)` (exported from `metaAdLauncher.js`).
3. Wipes every cache prefix in `ALL_CACHE_PREFIXES` for that user.

The frontend disconnect button lives on `MetaAdsDashboard.jsx` and routes the user back to `/ads-manager`.
