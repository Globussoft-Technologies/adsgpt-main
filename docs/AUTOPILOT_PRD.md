# AdsGPT Autopilot — Product Requirements Document

> **Status:** v1.6 (2026-04-27 evening) — Phases 1, 2, 3, 4, 5, 6, 7a, 8, 9 all shipped. Phase 10 partial. Phase 7b not started. **37 audit rules**. AI Audit (LLM) merged into Autopilot as a second audit lane. System-user token retired in favour of per-user FB OAuth. End-to-end live FB ad-account selection + dry-run on `/autopilot` with per-finding drill-down (entity, rule, why, metrics). Live progress lives in [AUTOPILOT_STATUS.md](./AUTOPILOT_STATUS.md) — read that for current state before touching code.
> **Owner:** Sumit Ghosh · **Last updated:** 2026-04-27 (evening)

## v1.6 update — end-to-end live FB account flow + drill-down

Building on v1.5's two-lane audit merge, the v1.6 work made `/autopilot` actually usable end-to-end with a real Facebook user:

| Capability | What changed |
|---|---|
| **Live ad-account picker** | `/autopilot` now hydrates the dropdown from `/meta-ads/get-ad-accounts` (full FB list — every account the authenticated user has access to). Picker is lifted to `AutopilotPage` and shared across every tab. |
| **Connect Facebook button** | Persistent FB-blue button (`#1877F2`) visible in every render branch (header, blank state, error state, loading). Re-clicking re-runs OAuth so the user can grant access to additional ad accounts via FB's "Edit settings" dialog. |
| **DRY-RUN MODE badge** | Accounts not in `autopilotConfig` with `liveActionsAllowed: true` show a yellow "DRY-RUN ONLY" badge so the safety state is unmissable. |
| **Cache busting on OAuth** | FB callback now invalidates every per-user Meta cache (`metaAdAccounts`, `metaCampaigns`, …) so newly granted accounts appear immediately instead of waiting out the 2h Redis TTL. `/get-ad-accounts` accepts `?refresh=true`. `/autopilot?auth=success` auto-force-refreshes. |
| **Activity Summary drill-down** | Each per-account row in the by_account table is now expandable. Click → fetches the windowed action log → groups rows by action (Paused / Resumed / Scaled / Renamed) → shows per row: Entity (name + level + id), Rule (id + severity), Why (rule message + skipReason), Key metrics (spend / ctr / cpa / roas / frequency / prev_* / status — formatted), Outcome (success / failed / skipped + dry-run flag). "Show raw" toggle reveals full `metricsSnapshot` + `actionPayload` JSON for debugging. Lazy-fetched. |

## v1.5 — two audit lanes, one frontend

Autopilot exposes **two complementary audit engines**, both under the same `/autopilot` UI and sharing the same safety gate (`liveActionsAllowed`), action log (`autopilotActionLog`), and token resolution (`getAccessTokenForAccount`):

| Lane | Engine | Trigger | Action surface | Frontend tab |
|---|---|---|---|---|
| Rule audit | Deterministic 37-rule engine in `auditRulesConfig.js` | Hourly cron + on-demand `POST /autopilot/audit/run` | Cron applies pause/resume/scale/rename/rotate when `liveActionsAllowed: true` (per-account opt-in). On-demand mode is read-only — returns findings only. | Overview |
| LLM audit | Gemini 2.5 Pro with structured-output schema + 11-action fix catalog | On-demand only `POST /autopilot/llm-audit` | Per-finding apply / dismiss / undo with 60-min undo window and `beforeState` snapshots. Apply on a non-opted-in account → 423 + dry-run row in action log. | AI Audit |

Token policy: cron resolves the FB token from `FacebookUsers` via `ownerUserId` configured per account; on-demand requests use the caller's own FB OAuth (or fall back to `ownerUserId`). `META_SYSTEM_USER_TOKEN` is no longer used.


>
> **TL;DR.** Turn AdsGPT from a creative studio (generate → post → done) into an ad operator (generate → post → continuously optimize → generate replacements → repeat). We fold the [Pipeboard](https://github.com/indianbill007/pipeboard) scheduler concept into AdsGPT's existing 31-rule Meta audit engine, add action execution, creative rotation, and auto-generation of replacement creative. The result is a user experience where a user connects Meta once, sets a budget and objective, and AdsGPT runs the account — pausing losers, scaling winners, generating new creative when variants fatigue, and alerting humans only on ambiguity.

---

## Table of contents

1. [Vision](#1-vision)
2. [Problem](#2-problem)
3. [Personas](#3-personas)
4. [Non-goals](#4-non-goals)
5. [Current state](#5-current-state)
6. [Architecture](#6-architecture)
7. [Phased scope (Phase 1–10)](#7-phased-scope)
8. [Data model changes](#8-data-model-changes)
9. [API surface](#9-api-surface)
10. [Configuration](#10-configuration)
11. [Frontend](#11-frontend)
12. [Scheduler & concurrency](#12-scheduler--concurrency)
13. [Observability](#13-observability)
14. [Safety & rollout](#14-safety--rollout)
15. [Success metrics](#15-success-metrics)
16. [Risks](#16-risks)
17. [Timeline](#17-timeline)
18. [Open questions](#18-open-questions)
19. [Deferred / future work](#19-deferred--future-work)
20. [Pipeboard code disposition](#20-pipeboard-code-disposition)
21. [Appendix A — existing audit rule catalog](#appendix-a--existing-audit-rule-catalog)
22. [Appendix B — glossary](#appendix-b--glossary)

---

## 1. Vision

**AdsGPT Autopilot** is a continuous ad-operations layer baked into the AdsGPT backend. A user connects Meta once, sets a monthly budget and campaign objective, approves a brand kit + creative template library, and walks away. Every hour, for every connected account, AdsGPT:

- **Watches** — pulls fresh insights; 31+ rules evaluate every campaign / adset / ad.
- **Kills waste** — pauses ads that hit critical rules (CPA > threshold, zero conversions, frequency, disapproved).
- **Rescues** — auto-resumes ads whose rules no longer fire.
- **Scales winners** — lifts budget on top performers by a capped %.
- **Rotates creative** — when an ad fatigues, pulls a fresh variant from the AdsGPT creative draft queue.
- **Generates replacements** — when the queue runs dry, calls the existing `/adCreative` + `/adVideo` generators to produce new variants from the user's brand kit. *Ad dies → new ad born → no human in the loop.*
- **Renames by hook** — every new ad is auto-named `[Hook] <first line of copy>` or transcribed hook for video.
- **Alerts humans** — Slack / email on critical findings or budget anomalies.
- **Remembers** — logs every action with rule fired, metric value, and outcome.
- **Learns (v2)** — per-account rule thresholds tune over time based on what worked.

Autopilot turns AdsGPT from a **tool** into an **ad operator**.

### Tagline

> **Set budget. Set objective. Walk away.**

---

## 2. Problem

AdsGPT users today do **three separate jobs** on the platform:

1. Generate copy / creative / video (AdsGPT does this well).
2. Post to Meta (AdsGPT wires the Meta Business SDK; works).
3. **Babysit performance** — watch CPA, pause losers, scale winners, generate replacements when fatigue hits. *This is the job AdsGPT does not help with.*

The third job is where media buyers spend 60–80% of their time, and it is where the Pipeboard experiment originated ([pause_ads.py](../../pipeboard/pause_ads.py)). Pipeboard proved the concept with 5 simple rules on a Python cron script. AdsGPT's Node backend already contains a **31-rule audit engine** ([config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js)), but it is only triggered by a "Run audit" button in the UI and it **only reports** — no action is taken, no schedule, no cross-account iteration.

The integration opportunity: replace Pipeboard's standalone Python automation with a native Node-side automation layer that reuses AdsGPT's existing audit engine, existing Meta SDK integration, existing Mongo infrastructure, and existing `node-cron` scheduler.

---

## 3. Personas

### P1 — Solo marketer (primary)
- Runs 1–3 Meta ad accounts for their own brand.
- No time or skill to watch metrics hourly.
- Wants: "set it and forget it" with safety rails.
- Trust level: **high** — willing to let Autopilot pause/resume without approval; reviews weekly summary.

### P2 — Agency media buyer (secondary)
- Manages 5–20 client accounts.
- Needs per-client rule thresholds and action log for client reports.
- Trust level: **medium** — wants dry-run first, then auto-pause for clear losers, but approval-required for scaling or budget changes.

### P3 — Agency principal (reviewer)
- Doesn't operate accounts but reviews what Autopilot did weekly.
- Needs: high-level summary, dollars saved, budget optimization impact.

### P4 — Internal ops (Globussoft)
- Runs Autopilot on internal accounts (AdsGPT `act_2025486534637313`, Globussoft AI `act_475821441756869`, Social Reel Farm, EmpMonitor).
- Dogfood persona; provides the first week of dry-run data.

---

## 4. Non-goals

- **Not a replacement for Meta Ads Manager.** Users still have full manual control.
- **Not a reporting product.** Autopilot logs what it did; it does not build pivot tables or dashboards for performance analysis.
- **Not cross-platform.** v1 is Meta only. Google / LinkedIn / Pinterest / Reddit / TikTok come later (same rule engine, different SDK adapters).
- **Not a bidding optimizer.** We pause / resume / change budgets; we do not tune bids, placements, or audience targeting.
- **Not AI-driven threshold tuning** in v1. Per-account overrides are human-configured.
- **No learning-phase interference.** Ads younger than `min_age_hours` (24h default) are untouched.

---

## 5. Current state

### 5.1 What AdsGPT already has (reuse as-is)

| Capability | File | Ready? |
|---|---|---|
| 31-rule audit engine | [config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js) | ✅ |
| `runAudit()` controller (reports findings) | [controllers/adPosting/metaAdLauncher.js:961](../nodejs-backend/controllers/adPosting/metaAdLauncher.js#L961) | ✅ |
| `updateStatus()` (pause/resume) | [controllers/adPosting/metaAdLauncher.js:902](../nodejs-backend/controllers/adPosting/metaAdLauncher.js#L902) | ✅ |
| `getInsights()` (with date presets, level filters) | [controllers/adPosting/metaAdLauncher.js:765](../nodejs-backend/controllers/adPosting/metaAdLauncher.js#L765) | ✅ |
| Meta OAuth + encrypted token storage | [controllers/adPosting/authController.js](../nodejs-backend/controllers/adPosting/authController.js), [Module/adPosting/facebookUsers.js](../nodejs-backend/Module/adPosting/facebookUsers.js) | ✅ |
| Facebook Business SDK `^24.0.1` | [package.json](../nodejs-backend/package.json) | ✅ |
| `node-cron` scheduler hooked into main process | [utils/cron.js](../nodejs-backend/utils/cron.js), called from [index.js:75](../nodejs-backend/index.js#L75) | ✅ |
| Redis (ioredis) for distributed locks | infra | ✅ |
| Creative + video generation pipelines | `/adCreative`, `/adVideo` routes | ✅ |
| Winston logger with daily rotation | [utils/logger.js](../nodejs-backend/utils/logger.js) | ✅ |

### 5.2 What's missing (this PRD delivers)

| Gap | Delivered in |
|---|---|
| Scheduled trigger (currently user-initiated) | Phase 3 |
| Action execution from findings | Phase 2 |
| Multi-account iteration per user | Phase 2 |
| Per-account rule overrides | Phase 1 |
| `min_age_hours` / `min_spend_before_eval` guards | Phase 1 |
| Persistent action log (Mongo) | Phase 2 |
| Auto-resume when rule stops firing | Phase 5 |
| Scale-winner action | Phase 6 |
| Hook rename from copy | Phase 7a |
| Hook rename from video transcription | Phase 7b |
| Slack / email alerts | Phase 8 |
| Creative fatigue rotation | Phase 9 |
| Auto-generate replacement creative | Phase 10 |
| UI — automation settings + history | Phase 4 |

### 5.3 What Pipeboard gave us that we keep

- **The scheduler + dry-run discipline pattern** (we implement in Node, not Python).
- **Per-account YAML override shape** (we mirror in JS config).
- **Whisper transcription approach** for video hook extraction (we run it as a Python Redis worker, not a local script).
- **Action log format** (`ad_id, name, account, rule, value`).
- **Conversion-counting edge cases** — family-based dedup across `offsite_conversion.fb_pixel_*` variants ([pause_ads_v2.py:54](../../pipeboard/pause_ads_v2.py#L54)). Port the logic, not the code.
- **System User OAuth playbook** — [META_SYSTEM_USER_SETUP.md](../../pipeboard/docs/META_SYSTEM_USER_SETUP.md) stays as the ops doc.

### 5.4 What Pipeboard gave us that we drop

- Python scheduler (`scheduler.py`) — redundant; `node-cron` is already in AdsGPT.
- MCP + Anthropic path (`pause_ads.py` v1) — costly, fragile, and we have a stronger rule engine in Node.
- Standalone `pause_ads_v2.py` — logic ports to `metaAuditService.js`; the script itself is not deployed.
- YAML config — migrates to `auditRulesConfig.js` + optional Mongo overrides.

### 5.5 Deployment reality (from server probe 2026-04-24)

- Dev server `poweradspy-development-vnic` (155.248.244.18) hosts AdsGPT under two users: `pas-adsgpt-dev-ftp` (Node) and `pas-adsgpt-dev-chatbot-ftp` (Python). PM2 manages 6 Node services; Python has no auto-start.
- **Zero existing automation cron/systemd timer touches Meta ads.** We have a clean install field.
- Server also hosts unrelated **PowerAdSpy (PAS)** services under other `pas-*` users. Autopilot does not touch those.

---

## 6. Architecture

### 6.1 High-level

```
┌────────────────────────────────────────────────────────────────────┐
│                           AdsGPT Autopilot                          │
│                                                                     │
│  ┌────────────┐     hourly     ┌────────────────────────────────┐   │
│  │ node-cron  │──────────────► │   autopilotOrchestrator.js     │   │
│  │ (in-proc)  │                │   iterates users → accounts    │   │
│  └────────────┘                └────────────┬───────────────────┘   │
│         ▲                                   │                       │
│    Redis lock                               ▼                       │
│    (prevent                        ┌────────────────────┐           │
│     overlap)                       │ metaAuditService   │           │
│                                    │ .runAuditForAcct() │           │
│                                    └────────┬───────────┘           │
│                                             │ findings[]            │
│                                             ▼                       │
│                               ┌─────────────────────────────┐       │
│                               │     actionExecutor          │       │
│                               │   pause / resume / scale /  │       │
│                               │   rotate / regenerate       │       │
│                               └────────┬────────────────────┘       │
│                                        │                            │
│         ┌──────────────────────────────┼──────────────────┐         │
│         ▼                              ▼                  ▼         │
│   ┌──────────┐                   ┌──────────┐       ┌──────────┐    │
│   │  Meta    │                   │ autopilot│       │  alerts  │    │
│   │ Biz SDK  │                   │ ActionLog│       │ Slack/mail│   │
│   └──────────┘                   └──────────┘       └──────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Creative regeneration path (Phase 9–10):                    │   │
│  │  fatigue detected → draftQueue.next() OR trigger /adCreative │   │
│  │  → post-paused via /ad-posting → actionLog records "born"    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 6.2 Key design choices

- **In-process scheduler.** We do not introduce a separate worker service. `node-cron` inside the main Node backend is already running; we piggyback. Redis lock handles multi-instance safety.
- **Service layer, not controller.** `runAudit()`'s FB SDK + rule logic extracts to `services/metaAuditService.js`. The existing HTTP controller becomes a thin wrapper. This lets the cron job call the audit without fabricating an `req/res`.
- **Action log as source of truth.** Every Autopilot action writes to Mongo `autopilotActionLog`. UI reads from log. Weekly summary reads from log. If log is missing, the action did not happen.
- **Dry-run first, always.** Every phase ships with a dry-run mode wired to an env var (`AUTOPILOT_DRY_RUN=true` default). Flip per-feature after a week of production observations.
- **Per-user token, not system user.** Autopilot uses the same `FacebookUsers` encrypted tokens as the manual flow for both lanes (cron + on-demand). Resolution goes through one helper, `getAccessTokenForAccount({adAccountId, callerUserId})` — caller's own OAuth preferred, falls back to per-account `ownerUserId` for the cron path. The earlier `META_SYSTEM_USER_TOKEN` model was retired in v1.5 (2026-04-27).

---

## 7. Phased scope

Ten phases across three tiers. Each phase = one PR, one deploy, one week of observation before the next.

### Tier 1 — Autopilot MVP (Phases 1–4)

#### **Phase 1 — Extract audit core & rule overrides**
*Goal:* reshape existing code so it's callable from a cron job and configurable per account. Zero behavior change for HTTP users.

- Move FB SDK init + data fetching + rule eval out of `metaAdLauncher.runAudit(req, res)` into `services/metaAuditService.js`:
  ```js
  runAuditForAccount({ userId, adAccountId, accessToken, options }) → { findings, normalized, accountInfo }
  ```
- Existing `GET /meta-ads/audit` becomes a thin wrapper. Response shape identical.
- Refactor `auditRulesConfig.js` rules from hardcoded literal thresholds to threshold-parameterized closures:
  ```js
  { id: 'AUD-01', severity: 'critical', entity: 'campaign',
    thresholds: { min_spend: 50 },
    check: (d, t) => d.status === 'ACTIVE' && d.purchases === 0 && d.spend > t.min_spend, … }
  ```
- Introduce `config/autopilotConfig.js`:
  ```js
  module.exports = {
    defaults: { min_age_hours: 24, min_spend_before_eval: 0, lookback_days: 14 },
    accounts: {
      'act_475821441756869': { name: 'Globussoft AI', overrides: { 'AUD-01': { min_spend: 1000 } } },
      'act_2025486534637313': { name: 'AdsGPT' },
      'act_715702414895109': { name: 'Social Reel Farm' },
      'act_162086793500612': { name: 'EmpMonitor Ads' },
    },
  };
  ```
- Port Pipeboard `min_age_hours` + `min_spend_before_eval` guards into the normalizer.

**Acceptance:**
- `GET /meta-ads/audit?adAccountId=X` returns byte-for-byte identical output to pre-refactor.
- `metaAuditService.runAuditForAccount({...})` callable from a Node REPL and returns same findings.
- Per-account override test: `act_475821441756869` with `AUD-01` override fires only above ₹1000 spend.
- Unit tests for rule evaluator with threshold injection.

**Effort:** 1.5d.

---

#### **Phase 2 — Auto-pause action + action log**
*Goal:* close the loop from findings → actual pause calls, with full audit trail.

- New Mongoose model `Module/autopilot/autopilotActionLog.js`:
  ```
  { userId, adAccountId, adAccountName, level, entityId, entityName, ruleId,
    ruleSeverity, metricsSnapshot, action: 'pause'|'resume'|'scale_budget'|'rotate_creative'|'generate_creative'|'rename',
    actionPayload, dryRun: Boolean, outcome: 'success'|'failed'|'skipped', error,
    runId (UUID per orchestrator run), runAt, pausedBy: 'autopilot' }
  ```
- Extend `metaAuditService` with:
  ```js
  autoPauseForAccount({ userId, adAccountId, accessToken, dryRun, severityFloor = 'critical' })
  ```
  - Calls `runAuditForAccount`
  - Filters findings where `severity ≥ severityFloor`
  - For each: calls `Campaign/AdSet/Ad.update({ status: 'PAUSED' })` unless `dryRun`
  - Logs to `autopilotActionLog`
  - Returns `{ runId, evaluated, paused, skipped, actions: [] }`
- Add manual trigger route: `POST /meta-ads/autopilot/run` (respects `dryRun` query).
- Add history route: `GET /meta-ads/autopilot/log?adAccountId=&runId=&from=&to=`.
- Add `updateAdStatusSchema` trust: an existing ad paused by Autopilot records `pausedBy: 'autopilot'` in log so manual resume doesn't confuse.

**Acceptance:**
- Dry-run on `act_475821441756869`: log rows populate, nothing paused on Meta.
- Live run on a test ad account with a deliberately bad ad: ad transitions to PAUSED; log reflects it; re-run doesn't re-pause (idempotent on state).
- Log has enough data to reconstruct "why was this paused" without re-querying Meta.

**Effort:** 1.5d.

---

#### **Phase 3 — Scheduler**
*Goal:* make it actually automatic. Add to `utils/cron.js`.

- Add job to `runCronJobs()`:
  ```js
  cron.schedule(process.env.AUTOPILOT_CRON || '0 * * * *', autopilotOrchestrator);
  ```
- `autopilotOrchestrator()`:
  1. Acquire Redis lock `autopilot:lock` (TTL 55min; EXPIRE on success/failure).
  2. Query all `FacebookUsers`.
  3. For each user, decrypt token, list ad accounts via `me/adaccounts`.
  4. For each account, call `autoPauseForAccount({dryRun: AUTOPILOT_DRY_RUN === 'true'})`.
  5. Release lock.
- Emit Winston logs at every stage with `runId`.
- Crash-safe: orchestrator try/catch per account; one bad account does not halt others.

**Acceptance:**
- Deploy with `AUTOPILOT_DRY_RUN=true` + hourly cron. After 24h, `autopilotActionLog` has ≥24 `runId`s across 4 internal accounts.
- Two backend pods (if scaled): only one runs per tick (lock works).
- Manually kill orchestrator mid-run: lock expires within 55min; next tick proceeds.

**Effort:** 1d.

---

#### **Phase 4 — Frontend: automation settings + history**
*Goal:* give users visibility and control.

- New React route `/meta-ads/autopilot` under `/meta-ads`. Sub-tabs:
  - **Settings** — toggle `enabled`, pick severity floor (critical/warning/opportunity), set dry-run, view per-account thresholds (read-only in v1).
  - **Action Log** — paginated table: when, account, entity, rule, action, outcome, metric snapshot expand.
  - **Summary** — last 24h / 7d: N paused, N skipped, top 3 rules fired.
- Wire to new routes:
  - `GET /meta-ads/autopilot/settings`
  - `PATCH /meta-ads/autopilot/settings`
  - `GET /meta-ads/autopilot/log?…`
  - `POST /meta-ads/autopilot/run` (manual "Run now" button, dry-run-preselected).
- Add nav entry in Sidebar.

**Acceptance:**
- From the UI, user sees every action the cron took in the last 7 days.
- Manual "Run now — dry-run" returns results in < 30s for a small account.
- Settings persist to new `AutopilotSettings` Mongo collection keyed by `userId`.

**Effort:** 2d.

---

### Tier 2 — Autopilot Pro (Phases 5–8)

#### **Phase 5 — Auto-resume**
*Goal:* don't leave ads paused forever if the condition clears.

- On every run, for each ad the log shows previously paused by `autopilot`:
  - Re-evaluate all rules.
  - If no rule fires AND ad age > `min_age_hours`, resume with `ACTIVE`.
  - Log `action: 'resume'`.
- Guard: don't resume if user manually paused after Autopilot paused (check `updatedTime > pauseLogEntry.runAt` via Meta `updated_time`).
- Cooldown: don't auto-resume an ad Autopilot has already flapped 3× in 7 days (hysteresis to prevent ping-ponging).

**Acceptance:**
- Seed scenario: pause an ad, wait for metrics to improve in dry-run, re-run → Autopilot proposes resume.
- Flapping ad hits 3-strike cooldown; log records `outcome: 'skipped', reason: 'flap-cooldown'`.

**Effort:** 1d.

---

#### **Phase 6 — Scale winners**
*Goal:* lift budget on top performers.

- New rule class: severity `opportunity` → `action: 'scale_budget'`.
- Seed rules (add to `auditRulesConfig.js` as AUD-32 … AUD-35):
  - `AUD-32`: campaign with ROAS > 2× target AND spend > threshold → +20% daily_budget.
  - `AUD-33`: adset with CPA < 50% target AND frequency < 2 → +30% daily_budget.
  - `AUD-34`: ad with CTR > 2× campaign average AND spend > threshold → increase parent adset budget +20%.
  - `AUD-35`: never scale more than 50% of original daily_budget in a 7-day window (safety).
- Implementation: `AdSet/Campaign.update({ daily_budget: newAmount })`.
- Cap per-run: max 10% of account total budget modified per run.

**Acceptance:**
- Dry-run surfaces scaling proposals with before/after budget + reasoning.
- Live run respects the 50%/7d safety cap.
- Log entry has `actionPayload: { prev_budget, new_budget, pct_change }`.

**Effort:** 1.5d.

---

#### **Phase 7 — Hook rename**
Two sub-phases; 7a is independent of 7b.

##### **Phase 7a — Rename from creative.body**
Port of [hook_rename.py](../../pipeboard/hook_rename.py) to Node.
- New service `services/adRenameService.js`:
  ```js
  proposeHookRenames({ userId, adAccountId, prefix = '[Hook]', maxChars = 80, dryRun = true })
  ```
- Iterates active ads in account, reads `creative.body`, extracts first line / first sentence / word-boundary truncation.
- Writes proposals to `autopilotActionLog` with `action: 'rename'`.
- Live apply only if `dryRun=false`.
- Route: `POST /meta-ads/autopilot/rename-by-hook`.

##### **Phase 7b — Rename from video transcription**
Port of [transcribe_ads.py](../../pipeboard/transcribe_ads.py).
- Whisper stays Python (Torch required). New worker: `python-backend/adrename/` subscribing to Redis channel `transcribeAdRequest`.
- Message shape: `{ adId, videoUrl, userId, runId }` → worker publishes `transcribeAdResponse: { adId, hook, language, transcript }`.
- Node side: `services/adRenameService.js:proposeHookRenamesFromVideo()` enqueues, listens on response channel, builds proposal, writes to log.
- Dockerfile for the worker; whisper `base` model default.

**Acceptance:**
- 7a dry-run on an account with 20 active ads: proposals file shows human-readable hooks.
- 7b runs whisper on one sample video ad, transcript appears in log within 60s.
- Live rename applied via Meta SDK once dry-run cleared.

**Effort:** 7a = 1d, 7b = 2d.

---

#### **Phase 8 — Alerts**
*Goal:* humans get a ping when something interesting happens.

- Two channels:
  - **Slack** — webhook from `SLACK_WEBHOOK_URL` per user (optional). One message per run summarizing actions + critical findings.
  - **Email** — SMTP via existing mailer if present, else nodemailer with AWS SES. Daily digest or on-critical.
- Alert policies per user (stored in `AutopilotSettings`):
  ```
  // v4: alertOn chips mirror per-rule severity (low|medium|high)
  { slackWebhookUrl, emailTo, alertOn: ['high', 'medium'] }
  ```
- Built-in throttling: no more than 1 Slack message per account per hour; email digest consolidates.
- Alert template includes direct Meta Ads Manager deep link to each entity (per Pipeboard's [ads_manager_url](../../pipeboard/pause_ads_v2.py#L217)).

**Acceptance:**
- Dry-run action produces Slack message with "would pause" list + deep links.
- Email digest generated at `AUTOPILOT_DIGEST_CRON` (default `0 9 * * *` — 9am local).
- Test webhook button in settings UI.

**Effort:** 1.5d.

---

### Tier 3 — Autopilot Autonomous (Phases 9–10)

#### **Phase 9 — Creative rotation**
*Goal:* when an ad fatigues, auto-post a replacement from the user's drafted variants.

- Detection: existing AUD-12 (frequency > 6) + new AUD-36 (CTR decline >30% week-over-week with spend > threshold).
- Precondition: user has drafted variants in `Draft` collection tagged for "rotation-ready" (new field `rotationReady: Boolean`).
- Action flow:
  1. Find an unposted draft matching adset constraints (same campaign, placement, objective).
  2. Call existing `/ad-posting/create-ad` with draft payload + `status: 'PAUSED'` (safer default) or `'ACTIVE'` if user opted in to "auto-activate rotations."
  3. Pause the fatigued ad.
  4. Log both actions linked by `rotationGroupId`.
- New Mongo field `Draft.rotationReady`, `Draft.usedByAutopilotAt`.
- Cap: max 3 creative rotations per adset per 30d (avoid churn).
- UI: "Drafts ready for rotation" panel shows queue size per account.

**Acceptance:**
- Test: seed an adset with 1 fatigued ad + 2 rotation-ready drafts → rotation swaps in draft #1, logs both, queue shows 1 remaining.
- Autopilot never posts the same draft twice (`usedByAutopilotAt` idempotency).

**Effort:** 2d.

---

#### **Phase 10 — Auto-generate replacement creative**
*Goal:* the queue never runs dry.

- Trigger: when rotation runs and the rotation queue for an adset < 2 drafts.
- Flow:
  1. Read brand kit + objective + creative template preferences from `brandNames` + user prefs.
  2. Call existing `/adCreative` (for static) or `/adVideo` (for video) generation endpoints with templated brief.
  3. Generated creative lands in `Draft` with `rotationReady: false, autoGenerated: true`.
  4. User reviews via a new "Review generated" UI queue; one-click approve flips `rotationReady: true`.
  5. **Auto-approve mode** (trust level P1): skip review, set `rotationReady: true` immediately. Off by default.
- Budget/credit: deducts AdsGPT credits per generation (existing [UnifiedCreditController.js](../nodejs-backend/controllers/UnifiedCreditController.js)). If out of credits, log `outcome: 'skipped', reason: 'insufficient_credits'` and alert user.
- Rate-limit: max 1 generation per adset per 24h (avoid credit burn).

**Acceptance:**
- Seed an adset whose rotation queue hits zero → next run produces 1 generated draft, awaiting review.
- Auto-approve mode: generated draft flips to `rotationReady: true` and rotation picks it up next run.
- Credit exhaustion path: logged + alerted, no crash.

**Effort:** 2.5d.

---

## 8. Data model changes

### 8.1 New collections

```js
// Module/autopilot/autopilotActionLog.js
{
  _id: ObjectId,
  runId: String,              // UUID per orchestrator run
  userId: String,             // AdsGPT user id (GPT-xxx or PAS-xxx)
  adAccountId: String,        // 'act_475821441756869'
  adAccountName: String,      // 'Globussoft AI'
  level: 'campaign'|'adset'|'ad',
  entityId: String,
  entityName: String,
  ruleId: String,             // 'AUD-01', etc.
  ruleSeverity: String,
  metricsSnapshot: Mixed,     // {spend, ctr, cpa, roas, frequency, conversions, ...}
  action: 'pause'|'resume'|'scale_budget'|'rotate_creative'|'generate_creative'|'rename'|'alert_only',
  actionPayload: Mixed,       // {prev_budget, new_budget, proposed_name, …}
  dryRun: Boolean,
  outcome: 'success'|'failed'|'skipped',
  skipReason: String,         // 'flap-cooldown'|'insufficient_credits'|'age-gate'|…
  error: String,              // Meta API error message
  metaApiLatencyMs: Number,
  runAt: Date,
  createdAt, updatedAt,
}
// indexes: (userId, runAt desc), (adAccountId, runAt desc), (runId), (entityId, runAt desc)
```

```js
// Module/autopilot/autopilotSettings.js
{
  _id: ObjectId,
  userId: String,  // unique
  enabled: Boolean,           // master switch
  dryRunGlobal: Boolean,      // per-user override of env default
  severityFloor: 'critical'|'warning'|'opportunity',
  autoResumeEnabled: Boolean,
  scaleWinnersEnabled: Boolean,
  creativeRotationEnabled: Boolean,
  creativeAutoGenerateEnabled: Boolean,
  creativeAutoApproveGenerated: Boolean,  // skip human review
  alerts: {
    slackWebhookUrl: String,
    emailTo: String,
    alertOn: [String],
  },
  perAccountOverrides: Mixed,  // shape from autopilotConfig.js, user-editable subset
  createdAt, updatedAt,
}
```

### 8.2 Changes to existing collections

```js
// Draft model — add
{
  rotationReady: Boolean,       // default false
  autoGenerated: Boolean,       // default false
  usedByAutopilotAt: Date,      // idempotency
  rotationGroupId: String,      // pair with fatigued ad
}
```

```js
// brandNames — ensure a "rotation brief" field exists
{
  autopilotBrief: {             // template for auto-generation
    objective: String,
    tone: String,
    cta: String,
    lockedElements: [String],   // always include brand name, logo, etc.
  }
}
```

---

## 9. API surface

All routes mounted under `/adsgpt/meta-ads/autopilot` (JWT-authenticated via existing middleware).

| Method | Path | Purpose | Phase |
|---|---|---|---|
| `GET` | `/autopilot/settings` | Read current user's Autopilot settings | 4 |
| `PATCH` | `/autopilot/settings` | Update settings | 4 |
| `POST` | `/autopilot/run` | Manually trigger orchestrator for current user (respects `?dryRun=true`) | 2,4 |
| `GET` | `/autopilot/log` | Paginated action log (filters: `adAccountId, runId, from, to, action, outcome`) | 2,4 |
| `GET` | `/autopilot/log/:runId` | Full run detail | 4 |
| `GET` | `/autopilot/summary` | Aggregated summary for 24h / 7d / 30d | 4 |
| `POST` | `/autopilot/rename-by-hook` | Trigger copy-based rename (`?dryRun`) | 7a |
| `POST` | `/autopilot/transcribe-and-rename` | Trigger video transcription rename (`?dryRun`) | 7b |
| `POST` | `/autopilot/slack-test` | Send test webhook | 8 |
| `GET` | `/autopilot/rotation-queue` | Per-adset rotation queue depth | 9 |
| `POST` | `/autopilot/approve-generated/:draftId` | Human flip to `rotationReady: true` | 10 |

**No breaking changes** to existing `/meta-ads/*` routes. `runAudit` remains byte-identical.

---

## 10. Configuration

### 10.1 New env vars (nodejs-backend)

```bash
# Autopilot core
AUTOPILOT_ENABLED=true
AUTOPILOT_CRON=0 * * * *                    # hourly at :00 UTC
AUTOPILOT_DRY_RUN=true                      # flip to false after 1 week dry-run per feature
AUTOPILOT_SEVERITY_FLOOR=critical
AUTOPILOT_MIN_AGE_HOURS=24
AUTOPILOT_LOOKBACK_DAYS=14

# Safety caps
AUTOPILOT_MAX_BUDGET_CHANGE_PCT_PER_RUN=50  # per-ad cap
AUTOPILOT_MAX_BUDGET_CHANGE_PCT_PER_7D=100  # per-ad cap
AUTOPILOT_MAX_ACCOUNT_BUDGET_MODIFIED_PER_RUN=10  # % of total account budget
AUTOPILOT_FLAP_COOLDOWN_STRIKES=3
AUTOPILOT_FLAP_COOLDOWN_DAYS=7
AUTOPILOT_MAX_GENERATIONS_PER_ADSET_PER_24H=1
AUTOPILOT_MAX_ROTATIONS_PER_ADSET_PER_30D=3

# Cron token resolution (v2 — 2026-04-27 onwards)
# AUTOPILOT_OWNER_USER_ID points to the AdsGPT user_id whose FacebookUsers
# row holds the FB OAuth token used by the cron. Each autopilotConfig.accounts
# entry can override per-account via its own `ownerUserId` field. Without
# this, the cron silently skips every account (intentional: no Meta call
# without a resolvable per-user token). META_SYSTEM_USER_TOKEN is no longer
# read.
AUTOPILOT_OWNER_USER_ID=414                 # required for cron; on-demand uses caller's OAuth

# Alerts
SLACK_WEBHOOK_URL_DEFAULT=                  # fallback if user has no per-user webhook
AUTOPILOT_DIGEST_CRON=0 9 * * *
AUTOPILOT_EMAIL_FROM=noreply@adsgpt.io

# Creative regeneration
AUTOPILOT_AUTO_APPROVE_GENERATED=false      # global guardrail
AUTOPILOT_CREATIVE_GENERATION_ENDPOINT=http://localhost:7000/adsgpt/adCreative/generate-for-autopilot
```

### 10.2 Non-env config: `config/autopilotConfig.js`

Per-account overrides live here. Version-controlled, reviewable in PRs. Shape matches Pipeboard's `config.yaml` but in JS for consistency with the rest of the Node codebase. User-editable subset flows through the UI → `AutopilotSettings.perAccountOverrides` which merges on top at runtime.

Merge order: **rule defaults < config/autopilotConfig.js account overrides < user-set perAccountOverrides**.

---

## 11. Frontend

New route `/adsgpt/meta-ads/autopilot` in [react-frontend](../react-frontend/).

### 11.1 Pages (4 sub-tabs)

1. **Overview** — cards: status (enabled/dry-run), last run time, 24h summary (paused/resumed/scaled), next run ETA.
2. **Action Log** — searchable/filterable table; expand row for metric snapshot, Meta Ads Manager link, re-run rule button.
3. **Settings** — toggles (enabled, dry-run, autoResume, scaleWinners, creativeRotation, autoGenerate, autoApprove), severity floor, Slack webhook, email, per-account override editor (JSON textarea v1; proper form v2).
4. **Rotation Queue** (Phase 9+) — per-adset: active ad, fatigued candidates, ready drafts, auto-generated awaiting review.

### 11.2 New components

- `AutopilotOverviewCard.jsx`
- `AutopilotActionLogTable.jsx`
- `AutopilotSettingsForm.jsx`
- `AutopilotRotationQueuePanel.jsx`
- `AutopilotRuleOverrideEditor.jsx`

### 11.3 Redux slices

- `autopilotSettingsSlice` (CRUD settings)
- `autopilotActionLogSlice` (paginated log)
- `autopilotSummarySlice` (24h/7d/30d aggregates, cached 5min)

### 11.4 UX copy

- Marketing language: "Set budget. Set objective. Walk away."
- Onboarding modal explains dry-run, shows last dry-run proposals, "Turn on Autopilot" CTA only after user has reviewed at least one dry-run summary.

---

## 12. Scheduler & concurrency

### 12.1 Scheduler

- `node-cron` in the same Node process as the gateway. No separate worker service.
- Single hourly tick (`0 * * * *` UTC) invokes `autopilotOrchestrator()`.
- Digest cron (`0 9 * * *` local) sends daily email summary.

### 12.2 Concurrency safety

- **Redis distributed lock** `autopilot:lock` with 55-minute TTL. `SET NX EX` pattern.
- If lock exists, next tick skips with log `"run-skipped: lock held by runId=X"`.
- Lock auto-expires so a crashed orchestrator doesn't wedge the system.
- Per-account `SET NX` inner lock `autopilot:lock:act_X` so accidental double-run doesn't double-act.

### 12.3 Rate limiting (Meta API)

- Meta Ads API has per-app call limits. We batch insights requests per account using `level='ad' filtering=[{field: 'ad.id', operator: 'IN', value: [...]}]` (Pipeboard's pattern).
- Exponential backoff on 4xx rate-limit response (2s, 4s, 8s, 16s; max 4 retries).
- Cache hit for `getInsights` already exists; Autopilot uses a separate Redis key prefix `autopilotInsights:` with 5-minute TTL to avoid colliding with user-facing cached results.

---

## 13. Observability

### 13.1 Logs

- Winston logger prefixes every Autopilot log line with `[autopilot]` + `runId=…`.
- Existing daily-rotate file `logs/application-YYYY-MM-DD.log`.
- **Action log is the source of truth**, not Winston logs. Winston is for debugging.

### 13.2 Metrics (Phase 4+)

In-Mongo aggregates via `$group`, no Prometheus needed v1. Dashboard computes:

- Actions per run (pause / resume / scale / rotate / generate).
- Success rate per action type.
- Per-account total actions / 7d.
- Total ad spend "saved" (proxy: sum of `(spend_14d / 14) × days_since_pause` for ads paused by Autopilot).
- Flap count (ads paused → resumed → paused within 7d).

### 13.3 Traceable run IDs

Every Autopilot action in the log shares a `runId`. User clicks "Why was this paused?" → modal shows entire run context including sibling decisions.

---

## 14. Safety & rollout

### 14.1 Dry-run discipline

Every phase ships **dry-run default = true**. Timeline per feature:

| Phase | Feature | Dry-run window | Go-live trigger |
|---|---|---|---|
| 2 | Auto-pause | 7 days | 0 false positives in log review |
| 5 | Auto-resume | 7 days | 0 bad resumes (check manual pause followed by auto-resume flap) |
| 6 | Scale winners | 14 days | Scaling proposals reviewed by human; caps work |
| 7a/b | Hook rename | 7 days | Proposals approved manually before live |
| 9 | Creative rotation | 7 days per user | User opts in explicitly |
| 10 | Auto-generate | 14 days | User opts in; auto-approve stays off |

### 14.2 Kill switches

- **Global**: `AUTOPILOT_ENABLED=false` — orchestrator short-circuits, no Meta calls.
- **Per-user**: `autopilotSettings.enabled = false`.
- **Per-account**: `autopilotSettings.perAccountOverrides[acctId].enabled = false`.
- **Per-action**: individual flags in `autopilotSettings` (`scaleWinnersEnabled`, `autoResumeEnabled`, etc.).

### 14.3 Rollback

Autopilot actions are **reversible via Meta API**:
- Pause → resume (log entry provides original state).
- Scale budget → revert to `actionPayload.prev_budget`.
- Rotate → re-activate old ad, pause rotation.
- Rename → revert to `actionPayload.prev_name`.
- Generate creative → mark draft `rotationReady: false`, log a revert.

Manual `POST /meta-ads/autopilot/rollback/:runId` reverts an entire run. Stretch goal for Phase 4.

### 14.4 Staged rollout

1. Internal Globussoft accounts only (4 accounts from Pipeboard config) for first 2 weeks.
2. Opt-in beta for 10 external users after 2 weeks clean.
3. GA after 30 days + 0 support escalations from beta.

---

## 15. Success metrics

### 15.1 Business

- **Adoption**: % of AdsGPT users with Meta OAuth who enable Autopilot (target: 30% in 60 days).
- **Spend under management**: $ USD (or INR) of ad spend under Autopilot (target: $100K/mo in 90 days).
- **Retention lift**: churn delta between Autopilot users and non-Autopilot users (target: -20%).

### 15.2 Product

- **Actions per account per week** (healthy = 3–10; too few = useless, too many = over-aggressive rules).
- **Flap rate** (paused+resumed same ad in 7d): target < 5% of actions.
- **Dry-run → live conversion**: % of users who flip off dry-run within 14 days (target: 60%).
- **Credit burn from auto-generation**: credits/user/month on rotation (informs pricing).

### 15.3 Quality

- **False-positive pauses**: ads resumed by user within 24h of Autopilot pause. Target < 2% of actions.
- **Meta API error rate**: < 1% of actions.
- **p95 orchestrator run time**: < 15 minutes (so we comfortably fit the hour).

---

## 16. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Autopilot pauses a winning ad due to data lag (Meta attribution delay) | Medium | High | 14-day lookback default; `min_age_hours=24`; dry-run discipline |
| Per-user Meta tokens expire mid-run | Medium | Medium | Detect 401 → log `outcome: 'failed'` with error, flag user; Phase 8 alert on token expiry |
| Meta API rate-limit during orchestrator run | Medium | Medium | Exponential backoff; per-account locks; consider Phase 3+1 "slow mode" (2h cadence) per-user |
| Credit exhaustion from auto-generation | Low | Medium | Hard rate-limit; alert on low credits; skip-and-log when out |
| Ping-pong (pause→resume→pause) on borderline ads | Medium | Low | Flap cooldown (3 strikes / 7d) |
| Rule regression — a threshold change breaks many accounts | Low | High | Rule-change PRs require dry-run diff; config review by a second engineer |
| UI shows stale log due to cache | Low | Low | 5min TTL on summary; live refresh on Action Log page |
| Legal / compliance (auto-acting on customer accounts) | Low | High | TOS update: user authorizes automated actions; dry-run window documents consent |
| User turns off Autopilot — who reverts the pauses? | Low | Medium | Sticky pause (do nothing); document in help text |
| Scope creep into non-Meta platforms | High | Medium | Hard non-goal for v1; revisit after 90d on Meta |

---

## 17. Timeline

**Target: 26 working days end-to-end, with 1-week dry-run observation windows overlapping.**

```
Week 1 (Phases 1–2):   Extract audit core + auto-pause + log          [3d]
Week 2 (Phase 3–4):    Scheduler + UI basics                          [3d]
         [dry-run observation begins — 7d]
Week 3 (Phase 5–6):    Auto-resume + scale winners                    [2.5d]
Week 4 (Phase 7a/b):   Hook rename (copy + video)                     [3d]
Week 5 (Phase 8):      Alerts                                         [1.5d]
         [Tier 2 dry-run observation — 7d]
Week 6 (Phase 9):      Creative rotation                              [2d]
Week 7 (Phase 10):     Auto-generate                                  [2.5d]
         [Tier 3 dry-run — 14d]
Week 8:                GA polish, docs, pricing, onboarding flow      [5d]
```

### Dependency graph

- Phase 2 depends on Phase 1 (service extraction).
- Phase 3 depends on Phase 2 (action function).
- Phase 4 depends on Phase 2 (log shape).
- Phase 5 depends on Phase 2 (log lookup).
- Phase 6 depends on Phase 1 (rule engine).
- Phase 7a independent (can ship anytime after Phase 1).
- Phase 7b depends on 7a (log + rename flow).
- Phase 8 depends on Phase 2 (events to alert on).
- Phase 9 depends on Phase 2 (pause action) + Draft model extension.
- Phase 10 depends on Phase 9 (queue mechanics).

---

## 18. Open questions

1. **Credit pricing for auto-generated creative** — does a rotation-generated ad deduct the same credits as a user-initiated generation? (Assumed yes for now.) Needs BizDev call.
2. **Per-user vs per-account concurrency** — if a single user has 20 ad accounts, is hourly across all of them too aggressive? Consider per-account cadence override.
3. **Legal sign-off** — TOS update for automated action. Owner: Sumit + legal.
4. **Language model for auto-generation** — we already use Gemini 2.5 Flash Lite for creative. Keep it. No decision needed v1.
5. **Multi-region deployment** — does Autopilot run in 1 region or multiple? Today AdsGPT is single-region (Oracle Cloud). No change v1.
6. **Token rotation** — 60-day Meta token rotation is handled by existing OAuth refresh. Confirm it works for tokens that haven't been touched in 30+ days (Autopilot accesses silently).
7. **Ad-level budget changes** — Meta allows budget at Campaign level (CBO) or Ad Set level. Detect which and scale appropriately. (Phase 6 design decision.)
8. **Who owns the System User token for Globussoft-internal accounts?** — stored in which vault? Env only? Or secret manager?
9. **Multi-user ad account ownership** — an account may be connected by multiple AdsGPT users. First-in wins for Autopilot? Or merge settings? (v1: first-in wins + read-only for others.)
10. **Reporting-grade export of action log** — CSV for agencies to send to clients. Nice-to-have, defer to post-GA.

---

## 19. Deferred / future work

Out of scope for this PRD. Revisit post-GA.

- **Cross-platform** (Google Ads, LinkedIn, Pinterest, Reddit, TikTok).
- **Cross-account reporting** / benchmarking across an agency's clients.
- **Duplicate-winner-across-accounts** (take a top performer from client A, clone to client B).
- **Dayparting** (pause at night, resume in morning, per ad-account schedule).
- **Convert-and-exclude** (auto-add converters to custom audiences as exclusions).
- **Budget reallocation between campaigns** (real CBO-level optimizer).
- **ML-driven rule threshold tuning** — needs 3+ months of action-log data as training signal.
- **Multi-region Autopilot** (currently single Oracle Cloud dev server).
- **Autopilot for non-Meta AdsGPT platforms** (the product supports 7+ ad networks on the creative side).
- **Marketplace for rule packs** (share / buy rule configurations).
- **Agency tier pricing** with per-client Autopilot seats.

---

## 20. Pipeboard code disposition

| File | Action | Notes |
|---|---|---|
| [scheduler.py](../../pipeboard/scheduler.py) | ❌ Drop | Replaced by `node-cron` in existing `utils/cron.js` |
| [pause_ads.py](../../pipeboard/pause_ads.py) | ❌ Drop | MCP + Anthropic path, superseded by Node rule engine |
| [pause_ads_v2.py](../../pipeboard/pause_ads_v2.py) | 🔄 Port logic | Conversion-counting dedup families → `services/metaAuditService.js` helpers |
| [hook_rename.py](../../pipeboard/hook_rename.py) | 🔄 Port | → `services/adRenameService.js` (Phase 7a) |
| [transcribe_ads.py](../../pipeboard/transcribe_ads.py) | 🔄 Port | → `python-backend/adrename/` Redis worker + Node service (Phase 7b) |
| [diagnose_mcp.py](../../pipeboard/diagnose_mcp.py) | ❌ Drop | One-off debug tool; not needed once we stop using MCP |
| [config.yaml](../../pipeboard/config.yaml) | 🔄 Port | → `config/autopilotConfig.js` + `AutopilotSettings` collection |
| [requirements.txt](../../pipeboard/requirements.txt) | ❌ Drop | Node takes over; `apscheduler, anthropic, dotenv, PyYAML` no longer needed |
| [.env.example](../../pipeboard/.env.example) | 🔄 Port | New env vars in `nodejs-backend/.env.example` (to be created) |
| [docs/META_SYSTEM_USER_SETUP.md](../../pipeboard/docs/META_SYSTEM_USER_SETUP.md) | ✅ Keep | Ops doc; move to `docs/ops/` in this repo |
| [README.md](../../pipeboard/README.md) | ❌ Drop | Pipeboard-specific; this PRD supersedes it |

**Net effect:** the `pipeboard/` directory sits outside the monorepo today. Once this PRD is executed, it is archived (or the useful docs migrate here). No Python standalone scripts survive.

---

## Appendix A — existing audit rule catalog

All **37 rules** from [config/auditRulesConfig.js](../nodejs-backend/config/auditRulesConfig.js). Autopilot inherits these; new rules added in Phase 6 (AUD-32/33/34/35), Phase 6-hardening (AUD-37), and Phase 9 (AUD-36).

### Critical (10)

| ID | Entity | Trigger | Default threshold |
|---|---|---|---|
| AUD-01 | campaign | ACTIVE, zero purchases, spend > X | 50 |
| AUD-02 | campaign | budget pacing > X | 1.2 |
| AUD-08 | campaign | spend > X AND ROAS < Y | 200 / 0.5 |
| AUD-09 | campaign | spend > X AND CTR < Y% | 100 / 0.5 |
| AUD-10 | campaign | conversion_rate < X% AND clicks > Y | 0.5 / 200 |
| AUD-11 | campaign | CPM surge > X% vs prev 14d | 50 |
| AUD-12 | adset | frequency > X | 6 |
| AUD-13 | ad | review_status === DISAPPROVED | — |
| AUD-14 | adset | learning_status === LEARNING_LIMITED AND spend > X | 100 |
| AUD-15 | campaign | ACTIVE AND impressions === 0 | — |

### Warning (11)

AUD-03, AUD-04, AUD-05, AUD-16, AUD-17, AUD-18, AUD-19, AUD-20, AUD-21, AUD-22, AUD-23, AUD-24.

### Opportunity (7)

AUD-06, AUD-07, AUD-25, AUD-26, AUD-27, AUD-28, AUD-29, AUD-30, AUD-31.

### New in Phase 6 (scaling)

| ID | Entity | Trigger | Action | Status |
|---|---|---|---|---|
| AUD-32 | campaign | ROAS > 2× target AND spend > threshold | +20% daily_budget | ✓ live |
| AUD-33 | adset | CPA < 50% target AND frequency < 2 | +30% daily_budget | ✓ live |
| AUD-34 | ad | top-CTR ad in campaign AND spend > threshold | +20% parent adset budget (retargeted via `f.data.adset_id`) | ✓ live (was skipping until 2026-04-26) |
| AUD-35 | (policy) | per-entity 7d cumulative cap (default 100%) | — (policy rule, never fires; cap-skip logs stamped with this ruleId) | ✓ live |

### New in Phase 6 hardening (PRD §6 account cap)

| ID | Entity | Trigger | Action | Status |
|---|---|---|---|---|
| AUD-37 | (policy) | per-cycle account-level cap (default 10% of total daily_budget) | — (policy rule; `autoScaleService.withinAccountCap()` enforces, cap-skips stamped with this ruleId) | ✓ live (2026-04-26) |

### New in Phase 9 (fatigue)

| ID | Entity | Trigger | Action | Status |
|---|---|---|---|---|
| AUD-36 | ad | CTR decline >30% WoW AND spend > threshold | rotate_creative | ✓ rule live, action gated off (queue empty) |

---

## Appendix B — glossary

- **Autopilot** — the AdsGPT automation layer delivered by this PRD.
- **runId** — UUID attached to every action in a single orchestrator tick.
- **Dry-run** — Autopilot evaluates and logs but never calls Meta mutating APIs.
- **Flap** — an ad paused and resumed (or vice versa) repeatedly; subject to cooldown.
- **Severity floor** — lowest rule severity Autopilot will act on this run.
- **Rotation queue** — drafts marked `rotationReady` awaiting fatigue-triggered swap-in.
- **Generation** — AdsGPT creating a new ad creative via its existing LLM+image pipeline.
- **Action log** — Mongo `autopilotActionLog` — source of truth for everything Autopilot ever did.
- **Kill switch** — any of: `AUTOPILOT_ENABLED` env, `autopilotSettings.enabled`, per-account override flag, per-action flag.

---

## Sign-off

- [ ] Product: Sumit Ghosh
- [ ] Engineering: TBD
- [ ] Legal / TOS: TBD (Phase 2 pre-live)
- [ ] Finance (credit pricing): TBD (Phase 10 pre-live)

*End of PRD v1.*
