# AdsGPT Autopilot — Developer README

> Continuous, rule-driven ad-operations automation for Meta Ads. Every hour the cron walks every opted-in user's connected Meta accounts, evaluates 37 audit rules against live insights, and takes intelligent actions: pause losers, resume recovered, scale winners, rotate creative.
>
> **Tagline:** *Set budget. Set objective. Walk away.*

This README is a developer-oriented overview of the feature as it stands today. For full product context see [AUTOPILOT_PRD.md](AUTOPILOT_PRD.md); for an in-progress status log see [AUTOPILOT_STATUS.md](AUTOPILOT_STATUS.md). Note that both of those predate the v3 multi-tenant refactor, so trust the code and this document over them where they conflict.

---

## 1. What Autopilot Is

Autopilot is the automation layer on top of AdsGPT's Meta Ads integration. The rest of the product helps a user *create* ads; Autopilot *operates* them on the user's behalf.

A scheduled cycle runs every hour. Each cycle:

1. Discovers every (user, ad-account) target dynamically — no hardcoded list.
2. Pulls live insights from Meta for each target (per-user OAuth token).
3. Evaluates 37 audit rules across campaigns / adsets / ads.
4. Decides what to act on, *if anything* — every action is gated by multiple layers of safety controls.
5. Logs every action (or would-be action in dry-run) to MongoDB.

Autopilot also exposes an on-demand *AI Audit* lane (Gemini 2.5 Pro) that produces qualitative findings the user can apply, dismiss, or undo. Both lanes share the same action log, undo path, and safety gates.

### Capabilities by phase

| Phase | Capability                                                                                        | Status              |
|-------|---------------------------------------------------------------------------------------------------|---------------------|
| 2     | Auto-pause ads hitting critical rules (CPA, zero conversions, frequency, disapproved, ...)        | Live                |
| 3     | Hourly orchestrator across all opted-in tenants with Redis distributed lock                       | Live (env-gated)    |
| 4     | Run summaries, action log, per-user settings, metrics snapshots                                   | Live                |
| 5     | Auto-resume ads when their rules no longer fire (3-strike / 7-day flap cooldown)                  | Live                |
| 6     | Scale-winners (raise budgets per AUD-32/33/34) with 7-day per-entity + per-run account caps       | Live                |
| 7a    | Hook-based rename (`[Hook] <first line of copy>`)                                                 | Live                |
| 7b    | Whisper transcription for video creative renames                                                  | Not started         |
| 8     | Per-user Slack + email alerts (multi-tenant). Each tenant's webhook + email come from their `autopilotSettings.alerts.*`; each gets a slack post / email containing only their own accounts. Per-user, per-channel Redis throttle. Email via SendGrid. | Live                |
| 9     | Creative rotation: swap fatigued ads with drafts from the rotation queue                          | Live (queue empty)  |
| 10    | Auto-generation of replacement creative when the rotation queue runs dry                          | Approval path live; generation core deferred |

### What's new in v3 (multi-tenant)

The earlier design ran the cron against a hardcoded 4-account list resolved via a single `AUTOPILOT_OWNER_USER_ID` env var. v3 replaces that with:

- **Per-tenant target discovery** at the start of every cycle (`services/autopilot/targetDiscovery.js`).
- **Per-user opt-in** via `autopilotSettings.enabled === true`. Default is `false`; users turn it on in the Settings tab.
- **Per-account opt-in** via `autopilotSettings.selectedAdAccountIds`. Default is `[]` — the cron acts on **only** the ad accounts the user explicitly checked in their Settings, never on every account they happen to see on Meta. An `enabled: true` user with no selection is skipped (warn-logged).
- **Per-user FB OAuth tokens only.** No system token, no shared owner mapping.
- **One global live-write env flag** (`AUTOPILOT_LIVE_ACTIONS_ALLOWED`) instead of a per-account `liveActionsAllowed` field.

---

## 2. The 37 Audit Rules

Defined in [nodejs-backend/config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js). Three severity levels:

- **Critical (10):** `AUD-01` zero conversions, `AUD-08` ROAS below threshold, `AUD-09` low CTR, `AUD-10` low conversion rate, `AUD-11` CPM surge, `AUD-12` high frequency, `AUD-13` disapproved, `AUD-14` learning limited, `AUD-15` zero impressions, ...
- **Warning (11):** `AUD-03`–`AUD-05`, `AUD-16`–`AUD-24`.
- **Opportunity (7):** `AUD-06`–`AUD-07`, `AUD-25`–`AUD-31`.
- **Scaling (`AUD-32`–`AUD-37`):** campaign ROAS > 2× target, adset CPA below 50% target, top-CTR ad scaling, 7-day cumulative cap, ad fatigue WoW, per-run account budget cap.

Rules fire **per ad-account**, respect **optional ops-level threshold pins** (see [`autopilotConfig.accounts`](../nodejs-backend/config/autopilotConfig.js)), and have *gates* that prevent action when conditions are not met (entity younger than 24h, spend below floor, etc.).

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            AdsGPT Autopilot                          │
│                                                                      │
│  ┌────────────┐   hourly    ┌──────────────────────────────────┐     │
│  │ node-cron  │────────────►│   autopilotOrchestrator.js       │     │
│  │ (in-proc)  │             │                                  │     │
│  └────────────┘             │  await discoverAutopilotTargets()│     │
│        ▲                    │   ↓                              │     │
│   Redis lock                │   for each (user, adAccount):    │     │
│   (prevent                  │     audit → pause → resume       │     │
│    overlap)                 │            → scale → rotate      │     │
│                             └──────────────┬───────────────────┘     │
│                                            │                         │
│                ┌───────────────────────────┴────────────┐            │
│                ▼                                        ▼            │
│  ┌─────────────────────────────┐         ┌────────────────────────┐  │
│  │  targetDiscovery.js          │         │  metaAuditService.js   │  │
│  │   AutopilotSettings.enabled  │         │  37 rules + insights   │  │
│  │   ∩ FacebookUsers (token)    │         └──────────┬─────────────┘  │
│  │   ∩ Meta /me/adaccounts      │                    │                │
│  │   (Redis-cached 2h)          │                    ▼                │
│  └─────────────────────────────┘            ┌──────────────────┐     │
│                                              │ actionExecutor   │     │
│                                              │ pause/resume/... │     │
│                                              └────────┬─────────┘     │
│                                                       │               │
│                  ┌────────────────────────────────────┼─────────┐     │
│                  ▼                                    ▼         ▼     │
│           ┌────────────┐                       ┌──────────┐ ┌───────┐ │
│           │ Meta SDK   │                       │ action   │ │ Slack │ │
│           │ (mutations)│                       │ Log      │ │ /mail │ │
│           └────────────┘                       └──────────┘ └───────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Key design choices:

- **Multi-tenant target discovery.** The cron's target list is computed at runtime: every AdsGPT user whose `autopilotSettings.enabled === true` × every ad account they've checked in `autopilotSettings.selectedAdAccountIds`. There is no hardcoded list, and the cron does not act on every account a user *could* see on Meta — only the ones they've explicitly opted in.
- **Per-user OAuth only.** Tokens come from the `facebookUsers` collection (encrypted, decrypted at use). No system token. No shared owner mapping.
- **In-process scheduler.** `node-cron` lives inside the main Node backend; no separate worker process.
- **Audit once per (user, account).** The orchestrator runs the 37-rule audit once per target, then passes the result to pause / resume / scale / rotate. Cuts Meta API calls roughly 4×.
- **Action log as source of truth.** Every action (or would-be action in dry-run) writes to MongoDB `autopilotActionLog`. The UI never re-queries Meta to drill down.
- **Redis distributed lock.** A single `autopilot:lock` key (55-min TTL) prevents two orchestrator ticks overlapping in multi-pod deployments.
- **Per-user error isolation in discovery.** A user with no FacebookUsers row, an expired token, or a failed `/me/adaccounts` call is skipped (warn-logged); the cycle continues for everyone else.

---

## 4. Backend Layout

All paths relative to [nodejs-backend/](../nodejs-backend/).

### Configuration & models

| File                                                                                                                    | Purpose                                                                                              |
|-------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| [config/autopilotConfig.js](../nodejs-backend/config/autopilotConfig.js)                                                | Optional ops-level threshold pins (`accounts` is empty by default in v3); the global safety-gate helper `isLiveActionsAllowed()`; the HTTP token resolver `getAccessTokenForAccount()`. |
| [config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js)                                              | The 37 rule definitions with parameterized thresholds.                                               |
| [Module/autopilot/autopilotActionLog.js](../nodejs-backend/Module/autopilot/autopilotActionLog.js)                      | Mongo schema: every pause/resume/scale/rotate/rename action with full audit trail.                   |
| [Module/autopilot/autopilotSettings.js](../nodejs-backend/Module/autopilot/autopilotSettings.js)                        | Mongo schema: per-user settings. Holds both v3 opt-in gates: `enabled` (master switch) and `selectedAdAccountIds` (per-account picker). |
| [Module/autopilot/adRotationDraft.js](../nodejs-backend/Module/autopilot/adRotationDraft.js)                            | Mongo schema: rotation draft queue.                                                                  |

### Services (business logic)

| File                                                                                                              | Purpose                                                                                              |
|-------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| **[services/autopilot/targetDiscovery.js](../nodejs-backend/services/autopilot/targetDiscovery.js)**              | **v3 multi-tenant target discovery.** `discoverAutopilotTargets({ userIds? })` yields `{userId, adAccountId, accessToken, ...}` tuples. |
| [services/metaAuditService.js](../nodejs-backend/services/metaAuditService.js)                                    | Core audit. `runAuditForAccount({userId, adAccountId, accessToken})` → `{findings, normalized, accountInfo}`. |
| [services/autopilot/ruleEvaluator.js](../nodejs-backend/services/autopilot/ruleEvaluator.js)                      | Pure helper for parameterized threshold rules.                                                       |
| [services/autopilot/autoPauseService.js](../nodejs-backend/services/autopilot/autoPauseService.js)                | Phase 2 — `autoPauseForAccount()`.                                                                   |
| [services/autopilot/autoResumeService.js](../nodejs-backend/services/autopilot/autoResumeService.js)              | Phase 5 — `autoResumeForAccount()` with flap cooldown and manual-pause guard.                        |
| [services/autopilot/autoScaleService.js](../nodejs-backend/services/autopilot/autoScaleService.js)                | Phase 6 — `autoScaleForAccount()` with per-entity 7-day cap and per-run account cap.                 |
| [services/autopilot/adRenameService.js](../nodejs-backend/services/autopilot/adRenameService.js)                  | Phase 7a — `proposeHookRenamesForAccount()`.                                                         |
| [services/autopilot/rotationService.js](../nodejs-backend/services/autopilot/rotationService.js)                  | Phase 9 — `rotateForAccount()` picks an unused rotation-ready draft and creates a paused replacement Ad. |
| [services/autopilot/autopilotOrchestrator.js](../nodejs-backend/services/autopilot/autopilotOrchestrator.js)      | Phase 3 — `runAutopilotCycle({ userIds? })` acquires the Redis lock, calls `discoverAutopilotTargets()`, runs audit + actions per target, releases lock. |
| [services/autopilot/alertService.js](../nodejs-backend/services/autopilot/alertService.js)                        | Phase 8 — both Slack and email are per-user multi-tenant. Webhook from `autopilotSettings.alerts.slackWebhookUrl`; recipient from `autopilotSettings.alerts.emailTo`; email via SendGrid. Per-user throttle keys (`autopilot:alert:user:<userId>:slack`/`:email`). No env-level webhook/recipient fallback. |
| [services/autopilot/summaryService.js](../nodejs-backend/services/autopilot/summaryService.js)                    | Phase 4 — `buildSummary(rows)` and `buildRunDetail({runId, rows})`.                                  |
| [services/autopilot/metricsSnapshot.js](../nodejs-backend/services/autopilot/metricsSnapshot.js)                  | Phase 4 — captures user-facing metrics (spend, CTR, CPA, ROAS, frequency, conversions) for the log.  |
| [services/autopilot/runOptions.js](../nodejs-backend/services/autopilot/runOptions.js)                            | Phase 4 — merges caller query params over saved settings over defaults; enforces `enabled` check.    |

### Scheduler

[utils/cron.js](../nodejs-backend/utils/cron.js) registers a `node-cron` job (default `0 * * * *`, hourly at :00 UTC) that invokes `runAutopilotCycle()` with no `userIds` filter — i.e. across every opted-in tenant.

### Controllers & routes

| File                                                                                                                | Purpose                                                                                              |
|---------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| [controllers/autopilot/autopilotController.js](../nodejs-backend/controllers/autopilot/autopilotController.js)      | HTTP layer: `runNow`, `runCycle`, `runAudit`, `rotate`, `getSettings`, `updateSettings`, `listLog`, `getSummary`, `getRunDetail`, `approveGenerated`, ... `/run-cycle` is scoped to the calling user only — only the cron fans out across every tenant. |
| [controllers/autopilot/llmAuditController.js](../nodejs-backend/controllers/autopilot/llmAuditController.js)        | LLM audit lane (Gemini 2.5 Pro): `runLLMAudit`, `applyFix`, `dismissFinding`, `undoFix`, `getFixLog`. Same global safety gate + action log as the rule lane. |
| [Router/autopilot/autopilotRoutes.js](../nodejs-backend/Router/autopilot/autopilotRoutes.js)                        | Route definitions; mounted at `/meta-ads/autopilot/*`. JWT-authenticated at the parent mount.        |

---

## 5. API Endpoints

All routes are JWT-authenticated. Base path:

```
<API_BASE>/meta-ads/autopilot/...
```

(Default dev base: `https://adsgpt-dev-api.poweradspy.com/adsgpt`.)

### Continuous rule-based audit + actions

| Method | Path                              | Purpose                                                                                            |
|--------|-----------------------------------|----------------------------------------------------------------------------------------------------|
| POST   | `/run`                            | Single-account auto-pause for the calling user (dry-run by default).                               |
| POST   | `/run-cycle`                      | Manual cycle scoped to the **calling user** (uses the same orchestrator the cron uses, but with `userIds: [callerUserId]`). |
| POST   | `/audit/run`                      | On-demand 37-rule audit for the calling user (read-only, no actions).                              |
| POST   | `/rename-by-hook`                 | Propose / apply copy-based renames (Phase 7a).                                                     |
| POST   | `/rotate`                         | Single-account creative rotation (dry-run by default).                                             |
| POST   | `/test-slack`                     | Send a sample payload to the configured Slack webhook.                                             |
| GET    | `/log`                            | Paginated action log. Filters: `adAccountId, runId, entityId, action, outcome, from, to`.         |
| GET    | `/log/:runId`                     | Drill-down for a single orchestrator tick (rows + rollup).                                         |
| GET    | `/summary`                        | Windowed aggregations (24h / 7d / 30d): paused / resumed / scaled, top firing rules, per-account.  |
| GET    | `/settings`                       | Read the calling user's Autopilot settings (returns defaults if none saved).                       |
| PATCH  | `/settings`                       | Merge-update user settings; upserts on first save.                                                 |
| GET    | `/config`                         | Read-only: `{ liveActionsAllowed, accountOverrides }`. The list of accounts the cron acts on is **not** returned here — it's discovered per-tick. |
| GET    | `/rotation-queue`                 | List `adRotationDraft` rows for an account + counts.                                               |
| POST   | `/approve-generated/:draftId`     | Flip auto-generated draft to `rotationReady: true`.                                                |

### LLM audit lane

| Method | Path                                         | Purpose                                                              |
|--------|----------------------------------------------|----------------------------------------------------------------------|
| POST   | `/llm-audit`                                 | Run a Gemini audit (on-demand only).                                 |
| GET    | `/llm-audit/audits`                          | List past LLM audits for an account.                                 |
| GET    | `/llm-audit/findings/:auditId`               | Findings of a single LLM audit.                                      |
| POST   | `/llm-audit/apply-fix/:findingId`            | Apply LLM fix. Returns 423 if `AUTOPILOT_LIVE_ACTIONS_ALLOWED` is off. |
| POST   | `/llm-audit/dismiss/:findingId`              | Mark finding dismissed.                                              |
| POST   | `/llm-audit/undo/:findingId`                 | Undo fix within a 60-minute window.                                  |
| GET    | `/llm-audit/fix-log`                         | Combined apply / undo log.                                           |

Source of truth: [nodejs-backend/Router/autopilot/autopilotRoutes.js](../nodejs-backend/Router/autopilot/autopilotRoutes.js).

---

## 6. Database Models

### `autopilotActionLog`

Source of truth for every action Autopilot takes (or *would* take in dry-run).

```js
{
  _id, runId,                         // UUID per orchestrator tick
  userId,                             // AdsGPT user_id ("SYSTEM" for cron-internal rows)
  adAccountId, adAccountName,
  level: 'campaign' | 'adset' | 'ad',
  entityId, entityName,
  ruleId,                             // 'AUD-01', 'AUD-36', ...
  ruleSeverity: 'critical' | 'warning' | 'opportunity',
  ruleMessage,                        // human-readable, e.g. "Zero purchases"
  metricsSnapshot,                    // { spend, ctr, cpa, roas, frequency, conversions, ... }
  action: 'pause' | 'resume' | 'scale_budget'
        | 'rotate_creative' | 'rename' | 'alert_only',
  actionPayload,                      // { prev_budget, new_budget, prev_name, ... }
  dryRun,
  outcome: 'success' | 'failed' | 'skipped',
  skipReason,                         // 'age-gate', 'flap-cooldown', 'manual-intervention', ...
  error, metaApiLatencyMs, runAt,
  rotationGroupId,                    // (Phase 9) pairs create + pause within a rotation
  createdAt, updatedAt,
}
```

### `autopilotSettings`

Per-user preferences. **Two opt-in gates live here**: `enabled` (master switch — discovery skips users with `enabled: false`) and `selectedAdAccountIds` (per-account picker — discovery skips users whose list is empty, and intersects /me/adaccounts against this list when it isn't).

```js
{
  _id, userId,                                  // unique
  enabled,                                      // master switch (default false → tenant skipped)
  selectedAdAccountIds: [String],               // bare ids (no `act_`); default [] → user skipped
  dryRunGlobal,                                 // override per-request dryRun
  severityFloor: 'critical' | 'warning' | 'opportunity',
  autoResumeEnabled,
  scaleWinnersEnabled,
  creativeRotationEnabled,
  creativeAutoGenerateEnabled,
  creativeAutoApproveGenerated,                 // skip human review on auto-gen drafts
  alerts: {
    slackWebhookUrl, emailTo,
    // v4: chips mirror per-rule severity (low|medium|high) since the
    // action-log row's `ruleSeverity` is now the user's pick from the
    // rule builder, not the legacy critical/warning/opportunity audit
    // bucket.
    alertOn: ['high', 'medium', ...],
  },
  perAccountOverrides,                          // { adAccountId: { ruleId: { threshold } } }
  createdAt, updatedAt,
}
```

### `adRotationDraft`

Phase 9 rotation queue.

```js
{
  _id, userId, adAccountId,
  adsetId,                            // optional: pin draft to one adset
  creativeId,                         // pre-built Meta creative
  name,                               // proposed ad name
  rotationReady,                      // human-approved for live use
  autoGenerated,                      // machine-suggested (Phase 10)
  usedByAutopilotAt,                  // idempotency: stamped on first use
  usedByEntityId,                     // which fatigued ad id this replaced
  rotationGroupId,                    // pairs with pause-action in autopilotActionLog
  createdAt, updatedAt,
}
```

### `facebookUsers`

The token store Autopilot reads from. Schema in [Module/adPosting/facebookUsers.js](../nodejs-backend/Module/adPosting/facebookUsers.js):

```js
{
  facebookId,                         // Meta user id
  name, email,
  accessToken,                        // AES-encrypted; decrypted at use via utils/crypto
  tokenExpiresAt,                     // discovery skips users past this date
  userId,                             // AdsGPT user_id (the join key with autopilotSettings)
}
```

---

## 7. Frontend Layout

All paths relative to [react-frontend/](../react-frontend/).

### Page

[src/pages/Autopilot/AutopilotPage.jsx](../react-frontend/src/pages/Autopilot/AutopilotPage.jsx) hosts a tabbed dashboard:

- Persistent **Connect Facebook / Reconnect Facebook** button (always visible).
- Live ad-account picker hydrated from `/meta-ads/get-ad-accounts` — i.e. the user's own Meta accounts. There is no hardcoded list anywhere in the frontend.
- A **DRY-RUN ONLY · `AUTOPILOT_LIVE_ACTIONS_ALLOWED` is off** badge whenever the global env flag is off; flips to **LIVE actions enabled** when it's on.

### Tabs and components

| Tab             | Component                                                                                                                                    | What it does                                                                                          |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Overview        | [src/components/Autopilot/AutopilotOverview.jsx](../react-frontend/src/components/Autopilot/AutopilotOverview.jsx)                           | Summary cards (window picker, paused / resumed / scaled / renamed / dry-run counts), top-5 firing rules, per-account breakdown, "Run Cycle (Dry-run)" button (scoped to the calling user). |
| AI Audit        | [src/components/Autopilot/LLMAudit/AutopilotLLMAudit.jsx](../react-frontend/src/components/Autopilot/LLMAudit/AutopilotLLMAudit.jsx)         | On-demand Gemini audit, per-finding apply / dismiss / undo with undo-window timer, fix-log history.   |
| Action Log      | [src/components/Autopilot/AutopilotActionLog.jsx](../react-frontend/src/components/Autopilot/AutopilotActionLog.jsx)                         | Searchable / filterable paginated table; account filter dropdown hydrated from the user's own ad accounts. |
| Rotation Queue  | [src/components/Autopilot/AutopilotRotationQueue.jsx](../react-frontend/src/components/Autopilot/AutopilotRotationQueue.jsx)                 | Per-adset: active ad, fatigued candidates, ready drafts, auto-generated awaiting review.              |
| Settings        | [src/components/Autopilot/AutopilotSettings.jsx](../react-frontend/src/components/Autopilot/AutopilotSettings.jsx)                           | Phase toggles (incl. **Autopilot enabled** — the master switch), severity floor, **Ad accounts checkbox grid** (per-account opt-in, hydrated from `getAdAccounts()`; amber warning when `enabled: true` but no accounts checked), Slack webhook + email, alert-on checkboxes, per-account override JSON editor, "Test Slack webhook" + "Rename by Hook" buttons. |

LLM-audit subcomponents: [AuditsList.jsx](../react-frontend/src/components/Autopilot/LLMAudit/AuditsList.jsx), [AuditFindings.jsx](../react-frontend/src/components/Autopilot/LLMAudit/AuditFindings.jsx), [FindingCard.jsx](../react-frontend/src/components/Autopilot/LLMAudit/FindingCard.jsx), [ApplyFixModal.jsx](../react-frontend/src/components/Autopilot/LLMAudit/ApplyFixModal.jsx), [FixLogDrawer.jsx](../react-frontend/src/components/Autopilot/LLMAudit/FixLogDrawer.jsx).

### API clients

- [src/apis/autopilot/autopilotApi.js](../react-frontend/src/apis/autopilot/autopilotApi.js) — Axios wrappers for all rule-based endpoints.
- [src/apis/autopilot/llmAuditApi.js](../react-frontend/src/apis/autopilot/llmAuditApi.js) — Wrappers for the LLM audit lane.
- The frontend exports **no** static account list. Components needing accounts call `getAdAccounts()` from `metaAds/metaAdsApi`.

---

## 8. How a Cycle Runs

### Hourly cron cycle (Phase 3)

1. **Acquire lock.** `SET NX EX 55min` on `autopilot:lock` — prevents overlapping ticks across pods.
2. **Discover targets.** `discoverAutopilotTargets()` returns one tuple per (opted-in user × selected ad account), each tuple carrying that user's own `severityFloor`. Internally:
   - `AutopilotSettings.find({ enabled: true }, { userId: 1, selectedAdAccountIds: 1, severityFloor: 1 })` → opted-in `userId`s **plus their per-user ad-account selection and severity floor**.
   - **Skip users whose `selectedAdAccountIds` is empty** (no Meta call wasted on a user who hasn't picked any accounts).
   - `FacebookUsers.find({ userId: { $in: ... } })` → row + token per remaining user.
   - Skip users whose token is empty / expired / undecryptable.
   - For each remaining user, fetch `/me/adaccounts` (Redis-cached at `metaAdAccounts:${userId}` for 2h).
   - **Intersect** Meta's response with that user's `selectedAdAccountIds` — yield one tuple per match. Selected ids that aren't in /me/adaccounts (revoked, archived) are silently dropped.
   - Skip users whose Meta call fails (rate limit, revoked permission, ...).
3. **For each (user, ad-account) target:**
   - **Run audit once** — `metaAuditService.runAuditForAccount()` → fetch insights → run 37 rules → return findings.
   - **Pause losers** — `autoPauseForAccount(audit)` filters by severity floor, pauses entities, logs each action with a metrics snapshot.
   - **Resume recovered** — `autoResumeForAccount(audit)` finds previously Autopilot-paused ads, checks if their rules still fire, resumes if not.
   - **Scale winners** *(if `AUTOPILOT_SCALE_ENABLED=true`)* — lifts budgets within 7-day-per-entity and per-run-account caps.
   - **Rotate creative** *(if `AUTOPILOT_ROTATION_ENABLED=true`)* — for `AUD-36` fatigued ads, picks an unused rotation-ready draft, creates a new paused Ad on Meta, pauses the old ad, logs both with a shared `rotationGroupId`.
4. **Alert.** Both channels fan out per-user. The cycle summary is sliced by `ownerUserId`; for each opted-in user the alert service looks up their `autopilotSettings.alerts.slackWebhookUrl` and `.emailTo` in a single Mongo query. Each user with a webhook gets a Slack post containing only their own accounts; each user with an email recipient gets an email containing only their own accounts. Email goes through SendGrid (only if `SENDGRID_API_KEY` is set). Per-user, per-channel throttle keys (`autopilot:alert:user:<userId>:slack` / `:email`) so one tenant's flood doesn't silence another's, and a Slack failure for one user doesn't block their email or anyone else.
5. **Release lock.** Delete `autopilot:lock`.

Per-target failures (a single user's Meta call timing out, a single account's audit throwing) never block other targets in the cycle.

### On-demand run (`POST /run`)

1. Controller `runNow()` validates `adAccountId`, loads the calling user's settings, merges caller query params over settings over defaults.
2. If settings has `enabled: false` *and* `dryRun !== false`: returns 409 (live blocked, dry-run allowed for preview).
3. Resolves token via the *caller's* OAuth row in `facebookUsers` (no fallback).
4. Calls `autoPauseForAccount()` with the resolved token and inherited `dryRun`.
5. Returns `{ status, findings_count, paused, would_pause, ... }`.

### On-demand cycle (`POST /run-cycle`)

Same flow as the hourly cron, but the orchestrator is invoked with `userIds: [callerUserId]`. A user clicking "Run Cycle" can never trigger Autopilot for other tenants.

### Safety gates (defense in depth)

A live Meta mutation requires every layer below to allow it:

| Layer               | Gate                                                | Default     | When overridden                                  |
|---------------------|-----------------------------------------------------|-------------|--------------------------------------------------|
| Global env          | `AUTOPILOT_LIVE_ACTIONS_ALLOWED=true`               | Read-only   | Ops sets it on the server                        |
| Per-user opt-in     | `autopilotSettings.enabled`                         | `false`     | User flips toggle in Settings tab                |
| Per-account opt-in  | `autopilotSettings.selectedAdAccountIds` (non-empty)| `[]`        | User checks accounts in Settings → Ad accounts   |
| Per-user setting    | `autopilotSettings.dryRunGlobal`                    | `true`      | User unchecks "Global dry-run"                   |
| Per-request flag    | `?dryRun=false` query param                         | Dry-run     | Caller explicitly opts out                       |
| Token validity      | `facebookUsers.accessToken` non-empty + non-expired | required    | User reconnects FB                               |

Any layer can force read-only or skip the user entirely; *all* must allow live for a real mutation to occur.

---

## 9. Configuration Reference

### Environment variables

Set in [nodejs-backend/.env](../nodejs-backend/.env) (see `.env.example` if present).

```env
# Core
AUTOPILOT_ENABLED=false                         # master switch for the cron job
AUTOPILOT_CRON="0 * * * *"                      # hourly at :00 UTC
AUTOPILOT_DRY_RUN=true                          # default per-request dryRun if unspecified
AUTOPILOT_LIVE_ACTIONS_ALLOWED=false            # the global live-write kill switch (v3)
# severityFloor is per-user (autopilotSettings.severityFloor); not an env var.

# Scaling & flap guard
AUTOPILOT_SCALE_ENABLED=false
AUTOPILOT_SCALE_PCT_CAP_7D=100
AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN=10
AUTOPILOT_FLAP_COOLDOWN_STRIKES=3
AUTOPILOT_FLAP_COOLDOWN_DAYS=7

# Rotation & generation
AUTOPILOT_ROTATION_ENABLED=false
AUTOPILOT_MAX_ROTATIONS_PER_ADSET_PER_30D=3
AUTOPILOT_GENERATION_ENABLED=false
AUTOPILOT_AUTO_APPROVE_GENERATED=false

# Alerts — both channels are per-user multi-tenant.
# Slack webhook + email recipient are read from autopilotSettings.alerts.*
# per user; there is NO env-level webhook or recipient fallback.
AUTOPILOT_ALERT_THROTTLE_MINUTES=60        # per-user, per-channel cooldown
AUTOPILOT_ALERT_DRY_RUN_TOO=false          # 'true' → alerts also fire on dry-run cycles

# Email — sent via SendGrid.
SENDGRID_API_KEY=                          # required to actually deliver email
AUTOPILOT_EMAIL_FROM=autopilot@adsgpt.io   # must be a verified SendGrid sender
```

`AUTOPILOT_OWNER_USER_ID` is no longer consulted — safe to remove from `.env`.

### Optional ops-level threshold pins

[nodejs-backend/config/autopilotConfig.js](../nodejs-backend/config/autopilotConfig.js) exports an `accounts` map that is **empty by default**. It exists only as an optional ops-level place to pin different rule thresholds for specific ad-account ids. Example:

```js
const accounts = {
  act_475821441756869: {
    min_spend_before_eval: 100000,        // ₹1000 spend floor
    overrides: {
      "AUD-01": { min_spend: 100000 },    // raise zero-conv threshold to ₹1000
    },
  },
};
```

Per-user threshold tweaks should go in `autopilotSettings.perAccountOverrides` instead — those don't require a code change.

---

## 10. How to Test

### 10.1 Unit tests

[nodejs-backend/test/autopilot/](../nodejs-backend/test/autopilot/):

| File                                                                                                          | Coverage                                          |
|---------------------------------------------------------------------------------------------------------------|---------------------------------------------------|
| [auditRules.test.js](../nodejs-backend/test/autopilot/auditRules.test.js)                                     | Rule engine + threshold-merge mechanism           |
| [autoPause.test.js](../nodejs-backend/test/autopilot/autoPause.test.js)                                       | Pause + action log                                |
| [phase3-8.test.js](../nodejs-backend/test/autopilot/phase3-8.test.js)                                         | Orchestrator, resume, scale, rename, alerts       |
| [phase4-settings.test.js](../nodejs-backend/test/autopilot/phase4-settings.test.js)                           | Settings CRUD                                     |
| [phase9-rotation.test.js](../nodejs-backend/test/autopilot/phase9-rotation.test.js)                           | Rotation queue + draft picker                     |
| [summary.test.js](../nodejs-backend/test/autopilot/summary.test.js)                                           | Windowed aggregations                             |
| **[targetDiscovery.test.js](../nodejs-backend/test/autopilot/targetDiscovery.test.js)**                       | **v3 multi-tenant discovery (17 tests)** — opt-in gating, expired-token skip, per-user failure isolation, Redis cache hit/miss, `userIds` opt-in, `selectedAdAccountIds` filter (empty list → skip, subset filter, `act_`-prefixed tolerance, revoked-account drop, missing-field defensive skip), **per-user `severityFloor`** flow + default fallback. |

Run them:

```bash
cd nodejs-backend
npm run test:autopilot
```

Expected: 199 tests pass.

### 10.2 Smoke test (end-to-end against live API, dry-run)

[nodejs-backend/scripts/smoke-autopilot.js](../nodejs-backend/scripts/smoke-autopilot.js) is wired into CI and runs after every backend deploy.

```bash
cd nodejs-backend
AUTOPILOT_JWT=<token> npm run smoke:autopilot
```

An empty `accounts: []` is now a valid response — it means the smoke caller's user hasn't enabled Autopilot in their settings, **or has enabled it but hasn't selected any ad accounts**. Enable it in the Settings tab, check at least one ad account in the Ad-accounts grid, and re-run.

### 10.3 Local manual test via the UI

1. Start the backend and frontend locally (or point at the dev environment).
2. Mint a JWT (or use one issued by the normal login flow). Quick mint script:

   ```bash
   cd nodejs-backend
   node -e "
     require('dotenv').config();
     const jwt = require('jsonwebtoken');
     const payload = { status: true, user_id: '414', login: 'test' };
     console.log(jwt.sign(payload, process.env.JWT_SECRET_KEY, {
       algorithm: 'HS512', expiresIn: '24h',
     }));
   "
   ```

3. Open the dev-auth landing page and paste the token, e.g.

   ```
   https://adsgpt-staging.poweradspy.com/dev-auth#t=<TOKEN>
   ```

4. Connect Facebook if you haven't already (the page-level button) — this populates `facebookUsers` for your AdsGPT user.
5. **Settings tab** → toggle **"Autopilot enabled"** on.
6. **Same tab → "Ad accounts" section** → check the boxes for the ad accounts you want Autopilot to operate on (defaults to none — you must explicitly opt each one in). Save.
7. **Overview tab → click "Run Cycle (Dry-run)"** → verify only your selected accounts appear in the response.
8. **Action Log tab** → confirm rows landed with `dryRun: true`.

### 10.4 Manual API tests via curl

Replace `<JWT>` with your token and `<ACT>` with an ad account id you actually own (e.g. `act_2025486534637313`).

```bash
# Cycle scoped to your user. severityFloor is read per-user from your
# autopilotSettings.severityFloor — change it via the Settings tab or the
# PATCH /settings endpoint, not via this body.
curl -X POST https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/run-cycle \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

# Single-account dry-run
curl -X POST https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/run \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "<ACT>", "dryRun": true}'

# On-demand 37-rule audit (read-only)
curl -X POST https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/audit/run \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"adAccountId": "<ACT>"}'

# Read action log
curl "https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/log?adAccountId=<ACT>&page=1&limit=20" \
  -H "Authorization: Bearer <JWT>"

# Get a 7-day summary
curl "https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/summary?windowDays=7" \
  -H "Authorization: Bearer <JWT>"

# Read / update settings (turn Autopilot ON for this user)
curl https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/settings \
  -H "Authorization: Bearer <JWT>"

curl -X PATCH https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/settings \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "dryRunGlobal": true, "severityFloor": "warning",
       "selectedAdAccountIds": ["475821441756869", "162086793500612"]}'

# Read global config
curl https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/config \
  -H "Authorization: Bearer <JWT>"
# → {"status": true, "liveActionsAllowed": false, "accountOverrides": []}

# Test Slack webhook
curl -X POST https://adsgpt-dev-api.poweradspy.com/adsgpt/meta-ads/autopilot/test-slack \
  -H "Authorization: Bearer <JWT>"
```

### 10.5 What to watch for

- Every action row must have `dryRun: true` unless `AUTOPILOT_LIVE_ACTIONS_ALLOWED=true` AND the caller explicitly passed `dryRun=false` AND the user's `dryRunGlobal` setting is off.
- A cycle that returns `{ accounts: [] }` for an HTTP `/run-cycle` call usually means one of: the calling user has `enabled: false`, has `selectedAdAccountIds: []`, has no `facebookUsers` row, or none of their selected ids are visible from `/me/adaccounts`.
- The hourly cron returning zero `accounts` means *no* user is fully opted in (`enabled: true` AND at least one entry in `selectedAdAccountIds`) — both gates are in user settings, not in env or config.
- The Redis lock should appear briefly during a cycle and disappear after. If it sticks at 55-min TTL, the previous run died — clear it manually with `DEL autopilot:lock`.
- Rotation only fires when `creativeRotationEnabled=true` *and* the rotation queue has at least one `rotationReady: true` draft for the target adset.

---

## 11. Current State (snapshot 2026-04-30)

Shipped & live:

- Phases 1–9 complete (audit, pause, resume, scale, rename, alerts, rotation).
- AI Audit (Gemini) merged into the same dashboard.
- **v3 multi-tenant target discovery.** No hardcoded account list, no system token, no `ownerUserId` mapping.
- **Global `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env safety gate** (replaces the per-account `liveActionsAllowed` flag).
- **Per-user + per-account opt-in.** Settings tab exposes both `enabled` (master switch) and `selectedAdAccountIds` (checkbox grid of the user's own ad accounts). Default is opt-out for both.
- Live ad-account picker, action log drill-down, expandable per-account breakdown.
- Smoke test wired into CI/CD.
- Unit-test coverage of all phases including the new discovery service (209 tests).

Partially complete:

- **Phase 10 generation core** — approval path live, but generation itself (Meta `/adCreative` call) is deferred.
- **Phase 7b** — Whisper-based video transcription rename not started.

For an always-current account see [AUTOPILOT_STATUS.md](AUTOPILOT_STATUS.md) (note: that doc still references the pre-v3 model in places).

---

## 12. Glossary

- **Autopilot** — the feature; the continuous automation layer.
- **Target** — a `(user, ad-account)` pair the cron operates on. Discovered fresh each cycle, never hardcoded.
- **Discovery** — the v3 process of finding targets: `AutopilotSettings.enabled=true ∩ selectedAdAccountIds ∩ FacebookUsers ∩ /me/adaccounts`.
- **runId** — UUID shared by every action in a single orchestrator tick.
- **Dry-run** — evaluate and log, but never call a Meta mutating API.
- **Severity floor** — lowest rule severity Autopilot will act on this run.
- **Flap** — an ad paused and resumed repeatedly; subject to a 3-strike cooldown.
- **Rotation** — swapping a fatigued ad with a fresh creative from the queue.
- **Action log** — Mongo `autopilotActionLog`; source of truth for every Autopilot action.
- **Safety gate** — the global `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env flag; forces read-only when off.
- **Opt-in gates** — two layers in `autopilotSettings`: `enabled` (per-user master switch, default false) and `selectedAdAccountIds` (per-account picker, default `[]`). Both must be set for the cron to act.
