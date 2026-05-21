---
name: meta-ads-manager
description: Use when working on AdsGPT's Meta Ads Manager surface — ad accounts, campaigns, ad sets, ads, analytics, audit, the Create Campaign Wizard, Autopilot rules + LLM audit, or any /meta-ads or /meta-ads/autopilot endpoint. TRIGGER when files match nodejs-backend/{Router,controllers,services,Validations,utils}/**/{meta,autopilot,adPosting}*, react-frontend/src/{components,apis}/{MetaAds,metaAds,autopilot}/**, docs/AUTOPILOT_*.md, or docs/CAMPAIGN_CREATION_PARITY_PLAN.md. ALSO trigger when the user mentions Meta Ads, Ads Manager, the wizard, Autopilot, audit findings, FB OAuth, or campaign creation. SKIP for unrelated marketing API providers (Google Ads, TikTok), unrelated ad-posting features (the older /ad-posting users/pages routes are tangential — only invoke if the user explicitly asks about them).
---

# Meta Ads Manager skill

This skill packages the full architectural picture of AdsGPT's Meta Ads Manager surface — the dashboard, campaign creation wizard, audit engines, Autopilot, and the in-flight full-parity rebuild plan. Before making any changes to this surface, **read the relevant references in the order listed below** so your changes align with the cache strategy, validator patterns, and the parity plan.

## When to invoke

- User opens or asks about files under:
  - `nodejs-backend/Router/adPosting/`, `nodejs-backend/Router/autopilot/`
  - `nodejs-backend/controllers/adPosting/`, `nodejs-backend/controllers/autopilot/`
  - `nodejs-backend/services/metaAuditService.js`, `nodejs-backend/services/autopilot/**`
  - `nodejs-backend/Validations/meta.validator.js`
  - `nodejs-backend/utils/metaHelpers.js`, `nodejs-backend/utils/formatBudget.js`
  - `nodejs-backend/config/auditRulesConfig.js`, `nodejs-backend/config/autopilotConfig.js`
  - `react-frontend/src/components/MetaAds/**`
  - `react-frontend/src/apis/metaAds/**`, `react-frontend/src/apis/autopilot/**`
  - `docs/AUTOPILOT_*.md`, `docs/CAMPAIGN_CREATION_PARITY_PLAN.md`
- User mentions: Meta Ads, Ads Manager, the wizard, campaign creation, ad set, ad creative, Autopilot rules, LLM audit, audit findings, FB OAuth, ad account picker, Pixel/CAPI integration, lead form, catalog ads, custom audience.
- User asks about cache TTLs, invalidation, why a metric is stale, or why two date presets disagree.

## When NOT to invoke

- User is working on Google Ads, TikTok Ads, LinkedIn Ads — unrelated providers.
- User is working on the `/ad-posting/users` or `/ad-posting/pages` legacy routes purely (the older surface) — only invoke if they cross into Meta Ads Manager territory.
- User is asking general programming or LLM API questions — use `claude-api` skill instead if they're integrating Anthropic SDK.

## Step 1 — Read these references first

Pick references based on what the user is doing. **Always** read [`gotchas.md`](references/gotchas.md) before touching code in this surface — it lists the bugs that have hit us repeatedly.

| Working on… | Read |
|---|---|
| Anything (always) | [`gotchas.md`](references/gotchas.md) |
| Routes / mounting / which controller owns what | [`architecture.md`](references/architecture.md) |
| Why a cached value is stale; adding a new cache key; bulk invalidation | [`cache-strategy.md`](references/cache-strategy.md) |
| Adding/editing a Joi schema, especially for the wizard | [`validators.md`](references/validators.md) |
| Anything in `CreateCampaignWizard.jsx` or about the parity rebuild | [`create-wizard.md`](references/create-wizard.md) |
| Audit findings, audit rules, LLM audit, apply-fix | [`audit-engines.md`](references/audit-engines.md) |
| Autopilot cron, user-defined rules, rotation, slack/email actions | [`autopilot.md`](references/autopilot.md) |

## Step 2 — Apply the architecture patterns

These patterns are non-negotiable. Violating them is what produces the bugs we keep fixing.

1. **The HTTP namespace split is meaningful.** `/ad-posting/*` is the older OAuth/page/post surface. `/meta-ads/*` is the Ads Manager surface. `/meta-ads/autopilot/*` is mounted as a **subroute** of meta-ads, not a peer. Auth is applied once at the parent mount in `MainRouter.js` — do not re-apply.
2. **Validators are the source of truth.** Backend Joi schemas in `meta.validator.js` define what the API accepts. Do not validate on the frontend "instead of" the backend; validate on both for UX, but never trust the client.
3. **Cache keys are namespaced per user.** Every cache write uses a key prefixed with the entity type and the calling `userId`. Status mutations invalidate `STATUS_CACHE_PREFIXES`; FB disconnect invalidates `ALL_CACHE_PREFIXES`. Do not introduce a cache that escapes this convention.
4. **TTL tiers exist for a reason.** `REDIS_TTL = 7200` (2 h, stable lists) vs `VOLATILE_TTL = 300` (5 min, volatile metrics) vs inline `1800` (30 min, audit). When you add a new cache, decide which tier it belongs to. See [`cache-strategy.md`](references/cache-strategy.md).
5. **Wizard state cache prevents duplicate creation.** `CreateCampaignWizard.jsx`'s `created` state ({campaignId, adSetId, imageHash}) makes step retries idempotent. When you add a new step (e.g. lead form, catalog binding, pixel selection), extend this cache, don't bypass it.
6. **Currency strings, not numbers.** `formatBudget()` returns `"₹100.00"` style strings. `parseFloat("₹100.00")` returns `NaN`. Always strip non-numeric chars before parsing.
7. **bid_type on Ad is legacy.** It nearly always returns `ABSOLUTE_OCPM`. The user-meaningful bid choice is `bid_strategy` on the AdSet.
8. **Errors from the SDK are flattened onto `error.response`,** not `.response.error`. Use `formatMetaError` / `logMetaError` from `metaAdLauncher.js`. The rich human-readable strings are `error_user_msg` and `error_user_title`.

## Step 3 — Coordinate with the in-flight rebuild

The Create Campaign Wizard is being rebuilt to full Meta parity per [`docs/CAMPAIGN_CREATION_PARITY_PLAN.md`](../../docs/CAMPAIGN_CREATION_PARITY_PLAN.md). Any new wizard work goes into **V2** (config-driven from `wizardSchema`), not V1. V1 is feature-frozen and gets deleted at end of Phase 6.

Before adding a new field / objective / location to the wizard:
- Confirm whether you're in V1 or V2.
- If V2, update `wizardSchema` first; the renderer + validator derive from it.
- If the field affects an existing live objective, check the parity plan's phase status (will live in `docs/CAMPAIGN_CREATION_STATUS.md` once Phase 0 starts).

## Step 4 — Test contract

Whenever you change Meta Ads Manager code, verify:

- [ ] Joi validator rejects payloads missing required fields with a clear `error_user_msg`-equivalent string.
- [ ] Cache invalidation runs on the mutation path. Read after write returns fresh data, not the stale cached snapshot.
- [ ] Frontend handles the backend error envelope `{ error, details, meta: { code, subcode, fbtraceId, data } }`.
- [ ] If you added a new field shown in a list view, update the relevant label map in `metaAdsUtils.js` if it's a SCREAMING_SNAKE enum.
- [ ] If you added a new mutation endpoint, decide which `STATUS_CACHE_PREFIXES` (or `ALL_CACHE_PREFIXES`) it should bust.

## Repository pointers

- **Plan & status:** [`docs/CAMPAIGN_CREATION_PARITY_PLAN.md`](../../docs/CAMPAIGN_CREATION_PARITY_PLAN.md), [`docs/AUTOPILOT_PRD.md`](../../docs/AUTOPILOT_PRD.md), [`docs/AUTOPILOT_STATUS.md`](../../docs/AUTOPILOT_STATUS.md)
- **Big controller:** [`nodejs-backend/controllers/adPosting/metaAdLauncher.js`](../../nodejs-backend/controllers/adPosting/metaAdLauncher.js) (~1800 lines)
- **Validators:** [`nodejs-backend/Validations/meta.validator.js`](../../nodejs-backend/Validations/meta.validator.js)
- **Routes (Meta Ads):** [`nodejs-backend/Router/adPosting/metaAdRoutes.js`](../../nodejs-backend/Router/adPosting/metaAdRoutes.js)
- **Routes (Autopilot):** [`nodejs-backend/Router/autopilot/autopilotRoutes.js`](../../nodejs-backend/Router/autopilot/autopilotRoutes.js)
- **Audit rules:** [`nodejs-backend/config/auditRulesConfig.js`](../../nodejs-backend/config/auditRulesConfig.js)
- **Audit service:** [`nodejs-backend/services/metaAuditService.js`](../../nodejs-backend/services/metaAuditService.js)
- **Wizard:** [`react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx`](../../react-frontend/src/components/MetaAds/CreateCampaignWizard.jsx)
- **Dashboard:** [`react-frontend/src/components/MetaAds/MetaAdsDashboard.jsx`](../../react-frontend/src/components/MetaAds/MetaAdsDashboard.jsx)
- **Tables:** [`react-frontend/src/components/MetaAds/MetaAdsTableView.jsx`](../../react-frontend/src/components/MetaAds/MetaAdsTableView.jsx)
- **API clients:** [`react-frontend/src/apis/metaAds/metaAdsApi.js`](../../react-frontend/src/apis/metaAds/metaAdsApi.js), [`react-frontend/src/apis/autopilot/`](../../react-frontend/src/apis/autopilot/)
- **Shared utils:** [`react-frontend/src/components/MetaAds/metaAdsUtils.js`](../../react-frontend/src/components/MetaAds/metaAdsUtils.js)
