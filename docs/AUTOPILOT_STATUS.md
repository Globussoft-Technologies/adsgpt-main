# AdsGPT Autopilot — live status

> **Purpose:** single place a fresh Claude Code session (or any engineer) can catch up in 2 minutes.
>
> **Last updated:** 2026-04-27 (evening) — AI Audit merged into Autopilot, per-user FB OAuth replaces system-user token, live ad-account picker on `/autopilot`, persistent Connect Facebook button + cache busting on OAuth, expandable per-account drill-down with rule + entity + metrics. All shipped to dev (commits `58ff6e4` → `99578ed`).
>
> **Full spec:** [AUTOPILOT_PRD.md](./AUTOPILOT_PRD.md). This doc is a living progress file, not the spec.

## 2026-04-27 (evening) — Live ad-account flow + drill-down

After the morning's AI Audit merge (below), the afternoon focused on making `/autopilot` actually usable end-to-end with a real Facebook account, and giving the user a "why was this paused?" drill-down.

| Change | Commit |
|---|---|
| `/autopilot` now hydrates the ad-account picker from `/meta-ads/get-ad-accounts` (the FB user's full list — not the hardcoded 4 Globussoft entries). Account picker lifted to `AutopilotPage` and shared across every tab (AI Audit, Overview single-account dry-run, Action Log filter, Rotation Queue). | `608124c` |
| Persistent FB-blue **Connect Facebook / Reconnect Facebook** button visible in every render branch (header, blank state, error state, loading state). Lucide `Facebook` icon, `#1877F2`. Re-clicking re-runs OAuth so the user can grant access to additional ad accounts (e.g., a newly added test account). | `8855a72` |
| **DRY-RUN MODE badge** on accounts whose id isn't in `autopilotConfig` with `liveActionsAllowed: true`. Backend already enforces dry-run for unknown accounts via `effectiveDryRun()`; the badge just makes the safety state visible. | `608124c` |
| FB OAuth callback now busts every per-user Meta cache (`metaAdAccounts:`, `metaCampaigns:`, `metaAdsets:`, `metaCampaignAds:`, `metaAdSetAds:`, `metaDashboard:`, `metaAnalytics:`, `metaInsights:`, `metaAudit:`) so newly granted accounts show up immediately instead of waiting out the 2-hour TTL. `/get-ad-accounts` accepts `?refresh=true` to bypass cache on demand. `/autopilot` auto-fires a force-refresh when it lands with `?auth=success` after the OAuth round-trip. | `0ee772c` |
| **Activity Summary per-account drill-down** — each row in the by_account table is now expandable. On click, fetches the full action-log rows for that account in the current window via `GET /autopilot/log?adAccountId=X&from=...`, groups them by action type (Paused / Resumed / Scaled / Renamed), and renders columns: Entity (name + level + id), Rule (id + severity badge), Why (rule message + skipReason), Key metrics (spend, ctr, cpa, roas, frequency, prev_* deltas, status — formatted), Outcome (success/failed/skipped + dry-run flag). Per-row "show raw" toggle reveals full `metricsSnapshot` + `actionPayload` JSON. Lazy-fetched (only on first expand). | `99578ed` |
| Smoke harness now treats `accounts: []` as a valid response (silent-skip-no-owner is the new correct behaviour when no `ownerUserId` is configured) — was failing CI deploys with the previous "no accounts iterated" assertion. | `31b31a1` |

**End-to-end flow now working at `https://adsgpt-staging.poweradspy.com/autopilot`:**

1. Sign in to AdsGPT (aMember / `/dev-auth`).
2. Click **Connect Facebook** → FB OAuth → click **Edit settings** in the FB dialog (NOT Continue) to grant access to additional ad accounts including any test account.
3. Land back on `/autopilot?auth=success` — auto force-refresh fetches the new account list.
4. Pick any ad account from the dropdown → DRY-RUN MODE badge confirms it's gated.
5. Click **AI Audit** tab → "Run AI Audit" — Gemini analyses 14 days, returns findings, every "Apply Fix" is force-promoted to `dryRun: true` for non-opted-in accounts (returns 423 + writes a dry-run row to `autopilotActionLog` with `source: 'llm-audit'`).
6. Or back on **Overview** → click any account row in Activity Summary → expanded drill-down shows every entity that fired a rule, the rule, the message, the metric snapshot.

## 2026-04-27 (morning) — AI Audit merged into Autopilot

The standalone "AI Audit" tab inside Ads Manager (LLM-driven, on-demand, with apply/dismiss/undo) is **gone** — its routes, controller, components, and API client all moved into Autopilot's namespace. Autopilot is now the single frontend for both audit lanes.

| Change | Where |
|---|---|
| Old `controllers/adPosting/metaAuditFix.js` deleted | — |
| New `controllers/autopilot/llmAuditController.js` (with `liveActionsAllowed` safety gate + autopilotActionLog stamping) | `nodejs-backend/controllers/autopilot/llmAuditController.js` |
| Old routes `POST /meta-ads/llm-audit` + `/meta-ads/audit/*` removed | `nodejs-backend/Router/adPosting/metaAdRoutes.js` |
| New routes mounted at `POST /meta-ads/autopilot/llm-audit*` | `nodejs-backend/Router/autopilot/autopilotRoutes.js` |
| New `POST /meta-ads/autopilot/audit/run` (on-demand 37-rule audit, read-only) | same |
| Token policy: **system-user token retired**. Cron + on-demand both resolve via `getAccessTokenForAccount({adAccountId, callerUserId})` against `FacebookUsers`. Configured accounts hold an `ownerUserId` pointer. | `config/autopilotConfig.js` |
| `Module/adPosting/metaAuditFinding.js` + `metaFixLog.js` collections **kept as-is** (no migration needed) | — |
| Frontend: `components/MetaAds/AIAudit/*` → `components/Autopilot/LLMAudit/*`. `AIAuditTab` renamed `AutopilotLLMAudit`. | — |
| New `apis/autopilot/llmAuditApi.js`; old methods removed from `apis/metaAds/metaAdsApi.js` | — |
| Autopilot page now has a 5th tab: `Overview · AI Audit · Action log · Rotation queue · Settings` | `pages/Autopilot/AutopilotPage.jsx` |
| `MetaAdsDashboard.jsx`'s "AI Audit" tab removed | — |
| `liveActionsAllowed: false` enforced inside `applyFix` — apply on a non-opted-in account returns `423` and writes a dry-run row to `autopilotActionLog` (source: `llm-audit`) | `llmAuditController.applyFix` |
| Smoke harness now also probes the new routes for mount-status (400 vs 404) | `scripts/smoke-autopilot.js` |
| Tests: removed obsolete `shouldUseSystemToken`/`getSystemUserToken`/`META_SYSTEM_USER_TOKEN` cases; added `getOwnerUserId` checks | `test/autopilot/auditRules.test.js` |

**Required env / config to bring the cron back online with the new token policy:**

1. Set `AUTOPILOT_OWNER_USER_ID` to the AdsGPT `user_id` whose `FacebookUsers` row holds an FB OAuth token with access to the 4 Globussoft ad accounts. (Or hard-code per-account `ownerUserId` in `config/autopilotConfig.js`.) Without this, the cron silently skips every account — that's intentional: the orchestrator never makes a Meta call without a resolvable token.
2. `META_SYSTEM_USER_TOKEN` is no longer read; safe to remove from server env.
3. Existing `liveActionsAllowed: false` flags stay in effect — every account is read-only until reviewed.

**Why this merge:** one frontend (Autopilot) for both audit lanes. The cron runs 37-rule deterministic audits hourly; users can also trigger the rule audit on demand from the same UI ("Run Rule Audit") or run an LLM audit ("Run AI Audit"). LLM applies share the same per-account safety gate, the same action log, and the same token resolution as the cron.



---

## Where we are right now

| Piece | Status | Commit |
|---|---|---|
| PRD | on main | `a02d19c` |
| GitHub Actions CI/CD | on main + secrets set + two real deploys survived | `9fcbdc7` |
| Phase 1 — extract audit core + per-account rule overrides | live on server | `7760e8e` |
| Phase 2 — auto-pause + Mongo action log | live | `f1a3a0d` |
| Meta System User token wiring (4 Globussoft targets) | live | `4ba51db` |
| Paise/rupee threshold calibration fix | live | `5dc4b55` |
| Phase 3 — hourly scheduler w/ Redis lock | live (gated off via env) | `5dc4b55` |
| Phase 5 — auto-resume + flap cooldown | live | `5dc4b55` |
| Phase 6 — scale-winners (AUD-32/33/34 + budget action) | live (gated off) | `5dc4b55` |
| Phase 7a — hook rename from creative.body | live | `5dc4b55` |
| Phase 8 — Slack webhook alerts | live (silent — webhook URL unset) | `5dc4b55` |
| Phase 4 — React dashboard UI | **live** | `b0bbaa7` |
| `/dev-auth` cookie-setter (internal testing helper) | live | `dbbb12b` |
| **Safety gate — `liveActionsAllowed: false` per-account** | **live; real Globussoft accounts can't be written to** | `047872c` |
| Phase 4 — AutopilotSettings persistence (model + GET/PATCH + editable UI) | live | `e32af39` |
| Phase 4 — settings plumbed into runNow + runCycle, metricsSnapshot captured in pause + scale log rows | live | `96339ac` |
| Phase 6 — AUD-35 (scale 7d cap policy) + AUD-36 (ad CTR fatigue WoW) added; autoScaleService logs cap-skip rows with `ruleId: AUD-35` | live | `9442b73` |
| Priority C — within-run audit cache: orchestrator runs audit once per account, shares with pause + resume + scale (3× → 1× Meta API load per account per cycle) | live | `d136f4e` |
| Phase 9 — creative rotation: `adRotationDraft` model + `rotationService` + orchestrator hook (`AUTOPILOT_ROTATION_ENABLED`, default off) + `POST /autopilot/rotate` | live (gated off, drafts queue empty) | `4cf0485` |
| Phase 4 — Rotation Queue UI tab + `GET /autopilot/config` (replaces hardcoded CONFIGURED_ACCOUNTS) + `GET /autopilot/rotation-queue` | live | pending-commit |
| Phase 8 polish — Slack throttling (Redis 1msg/cycle/hr), Meta Ads Manager deep-links in row text, email channel via nodemailer (gated by `AUTOPILOT_EMAIL_ENABLED`) | live | pending-commit |
| Phase 10 scaffolding — `POST /autopilot/approve-generated/:draftId` + queue-depth helper. Generation core (call to `/adCreative` etc.) deferred until test ad account + endpoint contract review | partial — review/approve path live, generation core not built | pending-commit |
| **AI Audit merged into Autopilot** — controller moved (`controllers/autopilot/llmAuditController.js`), routes mounted at `/meta-ads/autopilot/llm-audit/*`, frontend moved (`components/Autopilot/LLMAudit/*`), 5th tab on Autopilot dashboard, safety gate + autopilotActionLog stamping in `applyFix`. Removed the AI Audit tab from Ads Manager. | live | `58ff6e4` |
| **Token policy v2** — system-user token retired. Cron + on-demand both resolve via `getAccessTokenForAccount({adAccountId, callerUserId})` against `FacebookUsers` (caller's token preferred, fall back to per-account `ownerUserId`). New `POST /autopilot/audit/run` endpoint for on-demand 37-rule audit. | live | `58ff6e4` |
| **Live ad-account picker on `/autopilot`** — hydrates from `/meta-ads/get-ad-accounts` (full FB list), lifted to `AutopilotPage` and shared across every tab. Persistent FB-blue Connect/Reconnect button. DRY-RUN MODE badge for non-configured accounts. | live | `608124c`, `8855a72` |
| **OAuth callback cache busting + Refresh button** — FB callback drops `metaAdAccounts:` and other per-user Meta cache keys. `/get-ad-accounts?refresh=true` bypasses cache. `/autopilot?auth=success` auto-fires a force-refresh after OAuth. | live | `0ee772c` |
| **Activity Summary drill-down** — per-account row in `by_account` table is now expandable. On expand: fetches windowed action log, groups by action, renders entity + rule + why + key metrics + outcome per row. "Show raw" toggle reveals full metricsSnapshot + actionPayload JSON. | live | `99578ed` |
| Phase 7b — Whisper video transcription | not started (Python worker; needs Docker + cross-language integration) | — |

**TL;DR:** Backend + UI both shipped. All 4 Globussoft production accounts are triple-gated — request-level dry-run default, env-level dry-run default, AND per-account `liveActionsAllowed: false`. Nothing can pause a real ad without an explicit config edit + redeploy. Phase 4 settings now persist per-user in Mongo but the orchestrator + services don't yet read them. See the §"Known gaps in shipped phases" and §"Pending work" sections below for what still needs filling in.

---

## Known gaps in shipped phases

A 2026-04-25 deep-read of the implementation found that several phases marked "live" above are actually partial. These are tracked here so the next person doesn't assume they're complete.

| Phase | Gap | Impact |
|---|---|---|
| 3 — scheduler | Per-account inner Redis lock (PRD §12.2) not implemented; only the global `autopilot:lock` exists. | If a tick runs >55min, the next hour's tick could touch the same account twice. Low risk while system-token accounts are 4 small ones; matters at scale. |
| 4 — UI | ~~`metricsSnapshot` is written as `null` on every pause action.~~ **Resolved 2026-04-25** — `pickMetricsSnapshot()` strips internals from the normalised entity row and writes the user-facing metrics on every pause + scale log row. Resume + rename intentionally skipped (resume's "still firing" / "flap-cooldown" `skipReason` is sufficient context; rename's `actionPayload` already captures hook + names). | — |
| 4 — UI | `GET /autopilot/summary` endpoint (24h/7d/30d aggregates) and `GET /autopilot/log/:runId` not wired. | Overview tab cannot show the Summary cards spec'd by PRD §11.1. |
| 4 — UI | ~~"Rotation Queue" is a 4th tab in PRD §11.1 — not built (depends on Phase 9).~~ **Resolved 2026-04-26** — `AutopilotRotationQueue.jsx` mounted as the 4th tab in `AutopilotPage.jsx`. Reads `GET /autopilot/rotation-queue` for draft list + counts, `GET /autopilot/config` for the account picker (replacing the hardcoded `CONFIGURED_ACCOUNTS` constant), and `POST /autopilot/rotate` for dry-run preview. Auto-generated drafts awaiting review get a one-click "Approve" button that calls `POST /autopilot/approve-generated/:draftId`. | — |
| 4 — settings | ~~Persistence layer is in (`e32af39`) but the orchestrator + `/run` + `/run-cycle` controllers don't yet read user-saved settings.~~ **Resolved 2026-04-25** — `runNow` and `runCycle` read settings via `_loadSettings(userId)`, `resolveRunOptions(source, settings)` merges caller params over saved prefs over defaults, `settings.enabled === false` returns 409 for live runs (dry-runs preview through), and `settings.alerts.slackWebhookUrl` overrides the env webhook for `runCycle`. Cron stays user-agnostic. | — |
| 6 — scale | ~~AUD-35 (PRD safety cap rule) is enforced as the env var `AUTOPILOT_SCALE_PCT_CAP_7D`, not as a rule in `auditRulesConfig.js`.~~ **Resolved 2026-04-26** — AUD-35 is now a policy rule in the catalog (entity `campaign`, action `scale_cap`, defaults `cap_7d_pct: 100`). `autoScaleService.resolveCap7dPct(adAccountId)` reads it via `getEffectiveThresholds` (per-account override aware); env still wins for back compat. Cap-reached skips write a log row with `ruleId: 'AUD-35'` plus the original triggering rule id in the payload. Max-per-run and ad-level skips also write to the log now. | — |
| 6 — scale | ~~AUD-34 fires on best-CTR ads but the service skips with `ad-level-scale-not-yet-implemented`.~~ **Resolved 2026-04-26** — `findingTargets` resolution step at the top of `autoScaleForAccount` retargets ad findings to their parent adset using `f.data.adset_id` (the normaliser already populates it). 7d cumulative-pct lookup also re-keyed on target ids so previous AUD-32 scales on the same adset count toward the cap. `actionPayload.triggering_ad = { ad_id, ad_name }` preserved for audit trail. | — |
| 6 — scale | Per-account budget cap (max % of account total per run, PRD §6) not implemented. Per-entity step + 7d cap are. | A run could lift many entities by 20% each and exceed a sane account-level cap. |
| 8 — alerts | ~~Email channel not implemented (Slack only). Throttling not coded. Slack messages have no Meta Ads Manager deep-links.~~ **Resolved 2026-04-26** — Slack messages now wrap account names in `<deep-link|*Name*>` block-kit syntax pointing at `business.facebook.com/adsmanager/manage/accounts?act=...`. Redis-backed `reserveAlertSlot` throttles each `(channel)` cycle to `AUTOPILOT_ALERT_THROTTLE_MINUTES` (default 60min); fail-open when Redis is unavailable. Email channel via nodemailer + SMTP (lazy-loaded so the dep is optional); gated by `AUTOPILOT_EMAIL_ENABLED` and reads `to` from `settings.alerts.emailTo` first, then `AUTOPILOT_EMAIL_TO` env. Plain-text body for email + Slack text fallback shares one builder. | — |
| 5 — auto-resume | ~~Manual-pause guard checks `pausedBy === 'autopilot'` in the log only, not Meta's `updated_time`.~~ **Resolved 2026-04-26** — new pure helper `detectManualIntervention(updatedTime, lastAutopilotPauseAt, graceMs=60000)` plus an internal `getEntityMeta()` SDK read. Resume loop reads each entity's `updated_time` before resuming and skips with `skipReason: 'manual-intervention'` (logged) when `updated_time > lastAutopilotPauseAt + 60s grace`. Cost: +1 Meta API call per autopilot-paused entity per cycle (~12 extra calls/hour at current scale). 6 new unit tests. | — |
| Cross-cutting | ~~`runAuditForAccount` runs 3× per account per cycle~~ **Resolved 2026-04-26** — orchestrator runs audit once per account and passes it to pause + resume + scale via the new optional `audit` param on each service. Per-account Meta API load drops from 27 calls (9 × 3 services) to 9 calls. Standalone HTTP `/run` and direct service calls still fetch their own audit. | — |
| Cross-cutting | ~~Tests are pure-logic only.~~ **Partially resolved 2026-04-26** — added `scripts/smoke-autopilot.js` + `npm run smoke:autopilot` that hits live `/run-cycle?dryRun=true&force=true` and asserts response shape + non-zero account coverage. **Wired into the CI deploy workflow** — every push to main touching `nodejs-backend/**` runs the smoke harness server-side via `--jwt-from-mint` after the pm2 restart; failure auto-triggers the existing rollback step. Verified against 4 Globussoft accounts: ~11s wall, 54 findings, 12 would_pause. Still no per-finding integration test ("create a known-bad campaign, verify AUD-08 fires") — that needs the test ad account. | — |
| 6 — scale | ~~Per-account budget cap (max % of account total per run).~~ **Resolved 2026-04-26** — new policy rule **AUD-37** (`scale_account_cap`, default `cap_pct_per_run: 10`). `metaAuditService` now sums all campaign + adset `daily_budget` into `audit.accountDailyBudget` (paise) and returns it on the response. `autoScaleService` reads prev_budget BEFORE deciding to commit (split into `readEntityBudget` + `writeEntityBudget`), accumulates `cycleAccountDelta` across the loop (counts dry-runs too), and skips with `ruleId: 'AUD-37'` + payload `{cap_pct_per_run, account_daily_budget, account_cap_absolute, cycle_accumulated_delta, pending_delta, prev_budget, would_be_new_budget, triggering_rule_id}` when the cap would be exceeded. Pure helper `withinAccountCap()` + 5 unit tests. Env override: `AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN`. | — |
| 4 — UI | ~~`GET /autopilot/summary` endpoint and `GET /autopilot/log/:runId` not wired.~~ **Resolved 2026-04-26** — new `services/autopilot/summaryService.js` with pure `buildSummary(rows)` + `buildRunDetail({runId, rows})` helpers. New routes `GET /summary?windowDays=7` (default 7, max 90) and `GET /log/:runId`. Both scoped to `userId in [req.user.user_id, "SYSTEM"]` so the dashboard reflects user-triggered + scheduler runs. Frontend `AutopilotOverview.jsx` now leads with a SummarySection (window picker, 6 stat cards, top-firing-rule chips, per-account breakdown). 12 new unit tests. Verified live against the 4 Globussoft accounts: 143 actions in 7d, AUD-08 / AUD-10 / AUD-01 are top firing rules. | — |
| Cross-cutting | `_internals` exports across services exist for tests; ship to production. | Cosmetic; cleanup pass eventually. |
| Cron — token policy v2 | The orchestrator now requires `ownerUserId` on each `autopilotConfig.accounts` entry (or `AUTOPILOT_OWNER_USER_ID` env). Without it, the cron silently skips every account. | This is **the** thing that needs to be set on the dev server for the cron to run anything. Until then `/run-cycle` returns `accounts: []` (now treated as a valid response by the smoke harness, but means zero work happens). |
| AI Audit safety gate | `applyFix` returns 423 + writes a `dryRun: true` row to `autopilotActionLog` for non-opted-in accounts. `MetaFixLog` row is also written with status `failed` + `error: 'safety-gate: …'`. The frontend handles 423 and shows a toast. | Working; documented for future reference. |
| Phase 9 / Phase 10 | Rotation queue still empty in production. Generation core not built. | Both depend on the test ad account landing so we can populate drafts and exercise the full rotation flow end-to-end. |
| Phase 7b — Whisper | Not started. Needs a Python worker (Docker + cross-language integration). | ~2 days of work; deferred until Phase 9 + Phase 10 close. |

---

## Pick-up-and-go URL (dev auth, valid 24h from ~14:41 UTC 2026-04-24)

Paste this exact URL into a browser — `/dev-auth` sits outside `RunBackLog` so the aMember redirect doesn't fire. The route reads the JWT from the URL hash (# — never hits the server logs), sets the `access-token` cookie on `.poweradspy.com`, strips the hash, and navigates to `/autopilot`.

**https://adsgpt-staging.poweradspy.com/dev-auth#t=eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJzdGF0dXMiOnRydWUsInVzZXJfaWQiOiI0MTQiLCJsb2dpbiI6ImNoYW5kcnVfdGVzdCIsInVzZXJfbmFtZSI6IkNoYW5kcmFzaGVrYXIgTSBSIiwidXNlcl9lbWFpbCI6ImNoYW5kcmFzaGVrYXJAZ2xvYnVzc29mdC5pbiIsIm5hbWVfZiI6IkNoYW5kcmFzaGVrYXIiLCJuYW1lX2wiOiJNIFIiLCJ1c2VyU3Vic2NyaXB0aW9uVHlwZSI6eyIyMyI6IjIwMjYtMDUtMDMifSwiY3JlYXRlZF9mcm9tIjoiR1BUIiwiaWF0IjoxNzc3MDQxNjYyLCJleHAiOjE3NzcxMjgwNjJ9.9NzzsD22yIysxzlK4U8Eg_JMceQenNPArTzTUfDVxBHGulgZQejjcel995143EFz-EljAnR6Qam2ZoSlgUpziQ**

If you hit it and still land on aMember, hard-reload (Ctrl/Cmd+Shift+R) or open in incognito — it's browser cache of the pre-dev-auth SPA.

Login identity behind this JWT: user_id `414` → aMember login `chandru_test` → Chandrashekar M R (`chandrashekar@globussoft.in`). Starter plan valid through 2026-05-03.

### Minting a fresh JWT from a new session

SSH to the server and run:

```bash
ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18
cd /home/pas-adsgpt-dev-ftp/adsgpt-back-end/ads-gpt-nodejs-backend
sudo -u pas-adsgpt-dev-ftp -H bash -lc 'source ~/.nvm/nvm.sh && node -e "
  require(\"dotenv\").config();
  const jwt = require(\"jsonwebtoken\");
  const payload = { status: true, user_id: \"414\", login: \"chandru_test\",
    user_name: \"Chandrashekar M R\", user_email: \"chandrashekar@globussoft.in\",
    name_f: \"Chandrashekar\", name_l: \"M R\",
    userSubscriptionType: {\"23\": \"2026-05-03\"}, created_from: \"GPT\" };
  console.log(jwt.sign(payload, process.env.JWT_SECRET_KEY,
    { algorithm: \"HS512\", expiresIn: \"24h\" }));
"'
```

Append the token to `https://adsgpt-staging.poweradspy.com/dev-auth#t=<token>` and click.

---

## Live endpoints (all JWT-authenticated)

Base: `https://adsgpt-dev-api.poweradspy.com` (pm2 `gateway`, port 7000).

| Method | Path | Phase |
|---|---|---|
| GET | `/adsgpt/meta-ads/get-ad-accounts?refresh=true` | pre-Autopilot — list every ad account the FB user has access to. `?refresh=true` bypasses the 2h Redis cache. |
| GET | `/adsgpt/meta-ads/audit?adAccountId=X` | pre-Autopilot, refactored Phase 1 |
| PATCH | `/adsgpt/meta-ads/update-status` | pre-Autopilot |
| POST | `/adsgpt/meta-ads/autopilot/run` | 2 — single-account auto-pause |
| POST | `/adsgpt/meta-ads/autopilot/run-cycle` | 3 — orchestrator: pause+resume (+scale if enabled) across all `ownerUserId`-configured accounts |
| **POST** | **`/adsgpt/meta-ads/autopilot/audit/run`** | **on-demand 37-rule audit (read-only) — preferred path for the "Run Rule Audit Now" button** |
| POST | `/adsgpt/meta-ads/autopilot/rename-by-hook` | 7a |
| POST | `/adsgpt/meta-ads/autopilot/test-slack` | 8 — send sample payload to webhook |
| GET | `/adsgpt/meta-ads/autopilot/log?adAccountId=&from=&...` | 2 — paginated action log; backs the **drill-down UI** |
| GET | `/adsgpt/meta-ads/autopilot/log/:runId` | 4 — per-run drilldown (single-tick rollup + rows) |
| GET | `/adsgpt/meta-ads/autopilot/summary?windowDays=7` | 4 — windowed aggregations (Overview cards) |
| GET | `/adsgpt/meta-ads/autopilot/settings` | 4 — read current user's preferences (returns defaults if none saved) |
| PATCH | `/adsgpt/meta-ads/autopilot/settings` | 4 — merge-update preferences (upserts on first save) |
| POST | `/adsgpt/meta-ads/autopilot/rotate` | 9 — single-account rotation trigger (creates new ad on adset + pauses fatigued ad). Dry-run by default. |
| GET | `/adsgpt/meta-ads/autopilot/config` | 4/8 — read-only view of `autopilotConfig.accounts` (used by the UI to render the configured-accounts whitelist). |
| GET | `/adsgpt/meta-ads/autopilot/rotation-queue?adAccountId=X` | 4/9 — list `adRotationDraft` rows for an account + summary counts. |
| POST | `/adsgpt/meta-ads/autopilot/approve-generated/:draftId` | 10 — flip an auto-generated draft to `rotationReady: true`. |
| **POST** | **`/adsgpt/meta-ads/autopilot/llm-audit?adAccountId=X`** | **LLM audit (Gemini 2.5 Pro) — returns findings + executable fix per finding** |
| GET | `/adsgpt/meta-ads/autopilot/llm-audit/audits?adAccountId=X` | LLM — list past audits for an account |
| GET | `/adsgpt/meta-ads/autopilot/llm-audit/findings/:auditId` | LLM — fetch findings of a single audit |
| POST | `/adsgpt/meta-ads/autopilot/llm-audit/apply-fix/:findingId` | LLM — apply a fix; safety-gated (423 if `liveActionsAllowed: false`) |
| POST | `/adsgpt/meta-ads/autopilot/llm-audit/dismiss/:findingId` | LLM — mark a finding dismissed |
| POST | `/adsgpt/meta-ads/autopilot/llm-audit/undo/:findingId` | LLM — undo within 60-min window using captured `beforeState` |
| GET | `/adsgpt/meta-ads/autopilot/llm-audit/fix-log` | LLM — apply/undo log |

---

## Full code map (everything that exists today)

### nodejs-backend

| File | Phase | Role |
|---|---|---|
| `config/auditRulesConfig.js` | 1 + 6 + B | 36 rules (AUD-01…AUD-34 + AUD-35 policy + AUD-36 fatigue); thresholds in smallest currency unit |
| `config/autopilotConfig.js` | 1 + system-token + **safety gate** | Per-account overrides; `useSystemToken`, `liveActionsAllowed`, `effectiveDryRun()` |
| `utils/formatBudget.js` | 1 | Currency formatter, split from metaHelpers |
| `utils/cron.js` | 3 | `registerAutopilotCron()` inside existing `runCronJobs()` |
| `services/metaAuditService.js` | 1 | `runAuditForAccount()` — fetch + normalise + run rules |
| `services/autopilot/ruleEvaluator.js` | 1 | Pure `evaluateRules()` — no SDK deps |
| `services/autopilot/autoPauseService.js` | 2 + gate | `autoPauseForAccount()`; safety-gated |
| `services/autopilot/autoResumeService.js` | 5 + gate | `autoResumeForAccount()`; flap cooldown; safety-gated |
| `services/autopilot/autoScaleService.js` | 6 + gate | `autoScaleForAccount()`; 7d cap math; safety-gated |
| `services/autopilot/adRenameService.js` | 7a + gate | `proposeHookRenamesForAccount()`; safety-gated |
| `services/autopilot/alertService.js` | 8 | Slack payload + post |
| `services/autopilot/autopilotOrchestrator.js` | 3 | `runAutopilotCycle()` — pause → resume → scale → alert, Redis lock |
| `Module/autopilot/autopilotActionLog.js` | 2 | Mongo model — action source of truth |
| `controllers/autopilot/autopilotController.js` | 2/3/7a/8 | HTTP layer |
| `controllers/adPosting/metaAdLauncher.js` | 1 + system-token | `runAudit()` thin wrapper |
| `Router/autopilot/autopilotRoutes.js` | 2/3/7a/8 | Sub-router under `/meta-ads/autopilot` |
| `test/autopilot/auditRules.test.js` | 1 + 6 + gate + B | 36 tests (8 of those cover AUD-35/36) |
| `test/autopilot/autoPause.test.js` | 2 | 16 tests |
| `test/autopilot/phase3-8.test.js` | 3/5/6/7a/8 + B + C + 8-polish + manual-intervention + AUD-37 | 64 tests |
| `test/autopilot/summary.test.js` | 4 (Overview cards) | 12 tests for `buildSummary` + `buildRunDetail` |
| `services/autopilot/summaryService.js` | 4 | Pure aggregation helpers feeding `/summary` + `/log/:runId` |
| `scripts/smoke-autopilot.js` | post-deploy | one-command live `/run-cycle` smoke test; runs in CI after every deploy via `--jwt-from-mint` |
| `test/autopilot/phase4-settings.test.js` | 4 | 39 tests |
| `Module/autopilot/autopilotSettings.js` | 4 | Per-user settings Mongo model |
| `Validations/autopilotSettings.validator.js` | 4 | Joi PATCH body validator |
| `services/autopilot/metricsSnapshot.js` | 4 | `pickMetricsSnapshot(data)` — strip internals, keep user-facing metrics |
| `services/autopilot/runOptions.js` | 4 | `resolveRunOptions(source, settings)` — pure caller-vs-settings precedence |
| `services/autopilot/rotationService.js` | 9 | `rotateForAccount()` + `isRotationFinding`/`pickRotationDraft`/`countRecentRotations` |
| `Module/autopilot/adRotationDraft.js` | 9 | Mongo model — rotation draft queue |
| `test/autopilot/phase9-rotation.test.js` | 9 | 22 tests (rotation finding filter + queue picker + cap counter + arg validation) |

`npm run test:autopilot` → **184 passed, 0 failed** locally (server-side: ~196 once joi/mongoose-deps tests run).
`npm run smoke:autopilot` → live end-to-end smoke against `/run-cycle?dryRun=true`. Requires `AUTOPILOT_JWT` env or `--jwt` flag (or `--jwt-from-mint` server-side). **Wired into the CI deploy workflow** — runs automatically after every deploy; failure triggers rollback. Last verified 2026-04-26: 11s wall, 4 accounts, dryRun confirmed.

### react-frontend

| File | Role |
|---|---|
| `src/apis/autopilot/autopilotApi.js` | Axios wrappers for all `/autopilot/*` endpoints |
| `src/pages/Autopilot/AutopilotPage.jsx` | Tabs container |
| `src/pages/DevAuth/DevAuthPage.jsx` | `/dev-auth#t=<JWT>` cookie-setter (outside `RunBackLog`) |
| `src/components/Autopilot/AutopilotOverview.jsx` | Run dry-run button + per-account summary |
| `src/components/Autopilot/AutopilotActionLog.jsx` | Paginated filterable table |
| `src/components/Autopilot/AutopilotSettings.jsx` | Configured targets + Slack test + hook rename trigger |
| `src/routes/router.jsx` | Routes: `/autopilot`, `/dev-auth` |
| `src/components/layout/sidebar/AppSidebar.jsx` | Sidebar entry (Gauge icon) |

Sidebar entry: bottom of the nav list, below "Ads Manager". Uses `lucide-react` `Gauge`.

---

## Server state — what's where (dev server `155.248.244.18`)

| Service | PM2 process | Port | Source dir |
|---|---|---|---|
| API gateway | `gateway` | 7000 | `/home/pas-adsgpt-dev-ftp/adsgpt-back-end/ads-gpt-nodejs-backend` |
| React frontend | `frontend` | 6000 | `/home/pas-adsgpt-dev-ftp/new-adsgpt-front-end/adsgpt-front-end` |
| Ads microservice | `ads-scroller` | 9090 | `/home/pas-adsgpt-dev-ftp/microservices/AdsScrollServer` |

Host: `https://adsgpt-staging.poweradspy.com` (user-facing) · `https://adsgpt-dev-api.poweradspy.com` (API).

### Deploy pipeline

Push to `main` touching a service dir → GitHub Actions workflow → rsync + npm install (if lock changed) + pm2 restart + health check. See [DEPLOY_CICD.md](./DEPLOY_CICD.md). Secrets configured in repo settings: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_KNOWN_HOSTS`.

---

## Env surface (server `.env`)

Already set (required for Autopilot to function at all):

```
META_SYSTEM_USER_TOKEN=EAAUkrQ7NaAIB…                # claude-mcp system user
META_SYSTEM_USER_BUSINESS_ID=1525787951959331
```

Optional, everything off by default:

```
# Phase 3 scheduler
AUTOPILOT_ENABLED=false                              # master switch
AUTOPILOT_CRON="0 * * * *"
AUTOPILOT_DRY_RUN=true
AUTOPILOT_SEVERITY_FLOOR=critical

# Phase 5 flap cooldown
AUTOPILOT_FLAP_COOLDOWN_STRIKES=3
AUTOPILOT_FLAP_COOLDOWN_DAYS=7
AUTOPILOT_AUTO_RESUME_LOOKBACK_DAYS=30

# Phase 6 scaling
AUTOPILOT_SCALE_ENABLED=false
AUTOPILOT_SCALE_PCT_PER_RUN=20
AUTOPILOT_SCALE_PCT_CAP_7D=100
AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN=10

# Phase 8 alerts
AUTOPILOT_SLACK_WEBHOOK_URL=                         # unset = silent
AUTOPILOT_ALERT_DRY_RUN_TOO=false

# Phase 9 rotation
AUTOPILOT_ROTATION_ENABLED=false                     # off; gates orchestrator's 4th step
AUTOPILOT_MAX_ROTATIONS_PER_ADSET_PER_30D=3          # PRD safety cap
AUTOPILOT_MAX_ROTATIONS_PER_RUN=10

# Phase 8 polish — throttling + email
AUTOPILOT_ALERT_THROTTLE_MINUTES=60                  # Redis cooldown per (channel)
AUTOPILOT_EMAIL_ENABLED=false                        # off; flip + provide SMTP to enable
AUTOPILOT_EMAIL_FROM=noreply@adsgpt.io
AUTOPILOT_EMAIL_TO=                                  # default; settings.alerts.emailTo wins
AUTOPILOT_EMAIL_SMTP_HOST=                           # nodemailer transport
AUTOPILOT_EMAIL_SMTP_PORT=587
AUTOPILOT_EMAIL_SMTP_SECURE=false
AUTOPILOT_EMAIL_SMTP_USER=
AUTOPILOT_EMAIL_SMTP_PASS=
```

If `AUTOPILOT_EMAIL_ENABLED=true` and `nodemailer` isn't installed, email gracefully no-ops with `reason: 'email-not-configured'`. Add `nodemailer` to `nodejs-backend/package.json` to actually send.

**Even if all the env switches above are flipped on, the 4 Globussoft accounts stay read-only** because `liveActionsAllowed: false` in `autopilotConfig.js` force-promotes `dryRun` to `true` inside every action service. The only path to real writes is editing that config file and redeploying.

---

## Pending work — what's actually open

Earlier-priority items A through F are all done (see Session logs below for narrative). What remains:

### 🔴 Blocking real production use

These need the test ad account to land before any of them are useful, but the action items above ARE the required preparation work:

1. **Test ad account onboarding** — Sumit's call. Updated step-by-step (post token-policy v2):
   1. Create the account in Business Manager, fund with ~₹50–100/day cap.
   2. Create 3–5 tiny campaigns — one zero-conv, one low-CTR, one high-frequency, one healthy control. Let run 2–3 days for metrics to land.
   3. Sign in to `/autopilot` → click **Connect Facebook** → in the FB OAuth dialog click **Edit settings** (NOT Continue) → tick the new test account in the businesses/ad-accounts list → Continue. The OAuth callback now busts the per-user ad-account cache automatically; the dropdown will show the new account immediately.
   4. (Optional, only if you want the *cron* to act on it) add to `nodejs-backend/config/autopilotConfig.js`:
      ```js
      act_TEST_ID: {
        name: "TEST sandbox",
        ownerUserId: process.env.AUTOPILOT_OWNER_USER_ID || "",
        liveActionsAllowed: true,   // opt-in to writes
        overrides: {},
      },
      ```
      and set `AUTOPILOT_OWNER_USER_ID` on the server `.env` to your AdsGPT user_id.
   5. The on-demand AI Audit + Rule Audit + single-account dry-run will work for the test account immediately (using your per-user OAuth token) — without any config changes. Only the cron needs the `ownerUserId` mapping.
   6. Hit `/autopilot` → pick the test account → "AI Audit" or single-account dry-run on Overview. Action Log + Activity Summary drill-down show the entities + rules + metrics that fired.

2. **Phase 9 — Rotation queue population.** No UI yet for users to mark a draft as `rotationReady: true`. Needs either: (a) connect existing `Draft` model's `rotationReady` field to AdStudio's chat-session draft view (~2h), OR (b) Phase 10 auto-generation lands and populates the queue automatically. Until either, `rotateForAccount` always skips with `no-rotation-draft-available`.

3. **Phase 10 — generation core deferred.** Approval path is live (`POST /autopilot/approve-generated/:draftId`); the generator itself isn't built. Needs (a) test ad account to validate `/adCreative` call shape against, (b) contract review of `/adCreative` body for rotation-specific brief shape, (c) `UnifiedCreditController` integration for credit deduction. Wiring is small once those are clear: `services/autopilot/generationService.js` called by the orchestrator when `AUTOPILOT_GENERATION_ENABLED=true` and queue depth < threshold.

4. **Phase 7b — Whisper video transcription.** Port of [pipeboard/transcribe_ads.py](https://github.com/indianbill007/pipeboard/blob/main/transcribe_ads.py). New Python Redis worker under `python-backend/adrename/`. Cross-language coordination. ~2d.

### 🟡 Nice-to-have hardening (no blocker)

- **`AUTOPILOT_OWNER_USER_ID` env on the dev server** — must be set to the AdsGPT user_id whose `FacebookUsers` row holds the FB OAuth token with access to the 4 Globussoft accounts. Until then the cron silently skips every account. ~1 line in `.env` + pm2 restart.
- **Per-account inner Redis lock** (PRD §12.2). Today only the global `autopilot:lock` exists. Matters when scale grows past 4 accounts or runs go long. ~30min when needed.
- **Multi-user cron iteration.** Today the cron iterates `autopilotConfig.accounts` and resolves the FB token via each account's `ownerUserId`. To support N customers (each with their own FB connection), the cron needs to also walk `FacebookUsers.find()` and audit every account each user can see. ~1h. Not urgent until we onboard a second customer.
- **Clean up `_internals` exports** across services (cosmetic).
- **Per-rule integration test fixtures.** Synthetic normalised entity rows hitting each rule's threshold boundary. Useful debugging tool. ~2h.
- **`adAccountId` consistency** — historical action-log rows have a mix of `act_…` and bare-id formats; the summary's by_account groups them separately. Either normalise at write time or strip `act_` in `summaryService.buildSummary` group key. ~30min. *(Discovered 2026-04-26 during /summary live test.)*

---

## Session logs

### 2026-04-27 session
- **AI Audit merged into Autopilot** (commit `58ff6e4`). Old `controllers/adPosting/metaAuditFix.js` deleted, new `controllers/autopilot/llmAuditController.js` with `liveActionsAllowed` safety gate + `autopilotActionLog` stamping. Routes moved to `/meta-ads/autopilot/llm-audit/*`. Frontend folders renamed (`MetaAds/AIAudit/*` → `Autopilot/LLMAudit/*`). 5th tab on Autopilot dashboard. AI Audit tab removed from Ads Manager.
- **Token policy v2** (same commit). System-user token retired. New `getAccessTokenForAccount({adAccountId, callerUserId})` helper resolves FB token from `FacebookUsers` (caller-first, fall back to `ownerUserId`). Both cron and on-demand use it. New `POST /autopilot/audit/run` endpoint for read-only on-demand 37-rule audit. 188 unit tests pass. Smoke harness updated to tolerate empty `accounts: []` (silent-skip-no-owner).
- **Live FB ad-account flow on `/autopilot`** (`608124c`, `8855a72`). Replaced hardcoded `CONFIGURED_ACCOUNTS` dropdown with the FB user's full ad-account list from `/meta-ads/get-ad-accounts`. Picker lifted to `AutopilotPage` and shared with every tab. Persistent FB-blue Connect/Reconnect button (`#1877F2` + lucide `Facebook` icon) visible in every render branch. DRY-RUN MODE badge for non-configured accounts.
- **OAuth callback cache busting** (`0ee772c`). FB callback now drops every per-user Meta cache key (`metaAdAccounts:`, `metaCampaigns:`, …). `/get-ad-accounts?refresh=true` bypasses cache on demand. `/autopilot?auth=success` auto-fires force-refresh. Fixed the symptom where re-auth granted access to a new account but the dropdown kept showing the old list for 2h.
- **Activity Summary drill-down** (`99578ed`). Per-account row in `by_account` now expandable. On expand: fetches windowed action log via `getActionLog({adAccountId, from})`, groups rows by action, renders entity + rule + why + key metrics + outcome per row. "Show raw" toggle reveals full `metricsSnapshot` + `actionPayload` JSON.
- **CI fix** (`31b31a1`). Smoke harness was failing the deploy on empty `accounts: []` — that's the new correct response when no `ownerUserId` is configured. Now treats it as a non-fatal warning.
- **Tests: 188 / 0 local.** Server-side suite includes the joi/mongoose-dependent tests and was at ~196 prior to this session — should still pass once deps load.

### 2026-04-26 late-evening session (continuation)
- **#1 — CI smoke integration** (commit `203c014`). Added "Autopilot smoke test" step to `.github/workflows/deploy-nodejs-backend.yml` after the existing health check. SSHes to server, runs `node scripts/smoke-autopilot.js --jwt-from-mint` server-side (mints a 10-min JWT from the deployed `.env`, no GitHub-secret plumbing needed). Failure cascades into the existing "Rollback on failure" step. **Validated immediately on the deploy that introduced it** — smoke step ran, hit `/run-cycle?dryRun=true&force=true`, returned SMOKE PASSED in 11s. Every push to `main` touching `nodejs-backend/**` is now auto-validated end-to-end.
- **#3 — Per-account budget cap (AUD-37)** (commit `50d3388`). New no-op policy rule mirroring AUD-35's shape. Defaults `{ cap_pct_per_run: 10 }`. `metaAuditService` now computes + returns `accountDailyBudget` (sum of every campaign + adset `daily_budget`, paise). `autoScaleService` refactored: `readEntityBudget` + `writeEntityBudget` split out of `scaleBudget` so the cap-check pass can read prev_budget before deciding to commit. New pure helper `withinAccountCap()`. Loop tracks `cycleAccountDelta` (counts dry-runs too — preview can't over-promise what live couldn't deliver). When cap is exceeded, log row stamped `ruleId: 'AUD-37'` with full payload (`cap_pct_per_run, account_cap_absolute, cycle_accumulated_delta, pending_delta, prev_budget, would_be_new_budget, triggering_rule_id`). 9 new unit tests; rule count 36 → 37.
- **#2 — Summary + run-detail endpoints + Overview tab cards** (commit `1d18384`). New pure `services/autopilot/summaryService.js` with `buildSummary(rows)` + `buildRunDetail({runId, rows})`. New routes `GET /autopilot/summary?windowDays=7` and `GET /autopilot/log/:runId` — both scoped to `userId IN [user, "SYSTEM"]` so the dashboard reflects scheduler runs too. Frontend `AutopilotOverview.jsx` now leads with a SummarySection: window picker (24h/7d/30d), 6 stat cards (Total / Paused / Resumed / Scaled / Renamed / Dry-run vs Live), top-5 firing-rule chips, per-account breakdown table. Auto-refreshes after each dry-run. 12 new unit tests. Verified live: 143 actions in 7d, AUD-08 / AUD-10 / AUD-01 leading rule firings across all 4 accounts.
- **Tests: 184/0** local. Server-side suite expected 196 once `joi` + `mongoose`-dependent test files run. Smoke: 11s, post-every-deploy.

### 2026-04-26 evening session (earlier, same day)
- First end-to-end dry-run cycle against the 4 real Globussoft production accounts: 12s wall, 54 findings, 12 would_pause. **Validated ~80% of the system in production conditions** (real audit fetch via system-user token, real normaliser, real rules firing on real ads, real Mongo log writes, real orchestrator with shared audit cache). Globussoft AI's account override correctly produced 0 findings (threshold elevated to ₹1000).
- **AUD-34 ad-level scale fix** (commit `255aca3`). Refactored `autoScaleForAccount` to retarget ad findings to their parent adset via `f.data.adset_id`. 7d cumulative-pct lookup re-keyed on TARGET entity ids (so a previous AUD-32 scale on adset X correctly counts against an AUD-34 finding on an ad inside X). `actionPayload.triggering_ad` preserves originating ad for traceability. log row's `entityName` now reflects the adset name.
- **Phase 5 manual-pause guard** (same commit). New pure helper `detectManualIntervention(updatedTime, lastAutopilotPauseAt, graceMs)` + internal `getEntityMeta()` SDK read. Before resuming, fetch the entity's Meta `updated_time` and skip with `skipReason: 'manual-intervention'` (logged) when newer than autopilot's pause + 60s grace window. 6 new unit tests.
- **Smoke harness** (same commit). `scripts/smoke-autopilot.js` + `npm run smoke:autopilot`. Hits live `/run-cycle?dryRun=true&force=true` and asserts response shape, non-zero account coverage, dryRun:true contract, 60s budget. Pure node http/https + dotenv mint. Verified against post-deploy server: 11s wall, SMOKE PASSED.

### 2026-04-26 (earlier)
- **Priority B done**: AUD-35 (scale 7d cap policy rule) + AUD-36 (ad CTR fatigue WoW) added to `auditRulesConfig.js`. AUD-35 is a no-op rule whose defaults `autoScaleService.resolveCap7dPct()` reads via `getEffectiveThresholds` (per-account override aware; env wins for back compat). All scale-skip cases (`max-per-run-cap`, `ad-level-scale-not-yet-implemented`, 7d cap reached) now write rows to `autopilotActionLog` with appropriate `ruleId` + `metricsSnapshot` so Phase 4 UI can show why scaling was passed over.
- AUD-36 required new normalised ad fields: added `adInsightsPrev` Promise to `metaAuditService.runAuditForAccount`, built `prevAdMap`, threaded it through `buildNormalisers`, extended `normalizeAd` to populate `status`, `prev_ctr`, `prev_spend`, `prev_impressions`. AUD-36 fires when prev_ctr > 0, current spend ≥ floor (₹50 default), status === ACTIVE (or null), and (prev_ctr − ctr) / prev_ctr > 0.3. No action service consumes the finding yet — Phase 9 picks it up.
- **Priority C done**: within-run audit cache. `autoPauseForAccount`, `autoResumeForAccount`, and `autoScaleForAccount` each accept an optional `audit` param; orchestrator runs `runAuditForAccount` once per account and passes the result to all three services. Per-account Meta API load drops from 27 calls (9 × 3 services) to 9 calls per cycle. Service entry validation rejects when neither `accessToken` nor `audit` is provided. 4 new tests.
- 18 new unit tests across B + C; suite is 129/0 (was 108).
- **Phase 9 backend done (gated off)**: new `Module/autopilot/adRotationDraft.js` Mongoose model + `services/autopilot/rotationService.js` with pure helpers (`isRotationFinding`, `pickRotationDraft`, `countRecentRotations`) and `rotateForAccount`. Orchestrator gains a 4th step gated by `AUTOPILOT_ROTATION_ENABLED` (default false). New `POST /autopilot/rotate` route. Meta SDK reuse: pause is delegated to `autoPauseService._internals.pauseEntity` to avoid duplicating the existing review/pause path in `metaAdLauncher.js`. 22 new tests; suite **151/0**. Live operation requires (a) the `adRotationDraft` queue to be populated, (b) the Phase 4 UI Rotation Queue tab, and (c) Sumit's test ad account — none touched in this commit.
- **Phase 8 polish, Phase 4 UI rotation tab, Phase 10 review path** (commit `pending`). Slack messages now wrap account names in Meta Ads Manager deep-link block-kit syntax; per-cycle Redis-backed throttling via `reserveAlertSlot` (default 60-min cooldown, fail-open if Redis unavailable); email channel via nodemailer + SMTP, gated off, `to` reads from `settings.alerts.emailTo` first, `AUTOPILOT_EMAIL_TO` env second; runCycle controller passes both per-user webhook + emailTo through. New `GET /autopilot/config` returns the configured-accounts list (UI replaces hardcoded `CONFIGURED_ACCOUNTS` with this fetch on mount; the constant kept as a fallback). New `GET /autopilot/rotation-queue?adAccountId=X` returns drafts + counts. New `POST /autopilot/approve-generated/:draftId` handles the Phase 10 review step (refuses already-used drafts, idempotent on already-ready). New 4th UI tab `AutopilotRotationQueue.jsx` showing queue depth, drafts table, Run-rotation-dry-run button, and Approve buttons on auto-gen drafts. 11 new alert-helper tests; suite **162/0** (was 151).

### 2026-04-25 session
- README banner + dev-deployment table fixed to reflect post-Bitbucket-migration reality (commit `ac05133`); positively identified the Python services on ports 3000 / 7001 / 8000 (`adcreatives/server/app.py`, `advideo-revamped/app/main.py`, `adfactory/gateway_api`) and dropped `ad-metric-dev` from the doc — it belongs to a different `pas-*` user.
- Phase 4 settings persistence backfill (commit `e32af39`): `Module/autopilot/autopilotSettings.js` Mongoose model + `Validations/autopilotSettings.validator.js` Joi PATCH validator + `getSettings`/`updateSettings` controller methods + `GET`/`PATCH /autopilot/settings` routes + 19-test Joi/defaults suite (total: 88/0). Frontend `AutopilotSettings.jsx` rewritten as an editable form (7 phase toggles, severity select, slack webhook + email inputs, `alertOn` checkboxes); `getAutopilotSettings`/`updateAutopilotSettings` API wrappers.
- Whole-codebase audit + deep-read pass: produced the §"Known gaps in shipped phases" section above and re-prioritized §"Pending work" accordingly.
- **Priority A — Phase 4 backfill round 2**: settings now influence runtime via `resolveRunOptions` (pure helper in `services/autopilot/runOptions.js`); `metricsSnapshot` populated on every pause + scale log row via `pickMetricsSnapshot()` over `finding.data` (which `ruleEvaluator` now attaches). `runCycle` accepts a per-user Slack webhook from `settings.alerts.slackWebhookUrl`. Refused-disabled gate returns 409 for live runs when `settings.enabled === false` (dry-runs preview through). 20 new unit tests; suite is 108/0.

### 2026-04-24 session 2 (afternoon + evening)
- Set `META_SYSTEM_USER_TOKEN` + `META_SYSTEM_USER_BUSINESS_ID` on server `.env`.
- Wired `useSystemToken` in config + controllers — 4 Globussoft targets work without per-user OAuth.
- Fixed paise/rupee threshold calibration bug (every spend-based default ×100).
- Shipped Phases 3 + 5 + 6 + 7a + 8 (commit `5dc4b55`).
- Shipped Phase 4 React dashboard (commit `b0bbaa7`).
- Shipped `/dev-auth` cookie-setter (commit `dbbb12b`) after aMember-redirect-loop diagnosis.
- Verified end-to-end with headless Chrome: JWT paste → cookie set → `/autopilot` rendered.
- Shipped safety gate — `liveActionsAllowed: false` across all 4 production accounts + enforced in all 4 action services (commit `047872c`).
- 69/69 autopilot tests passing.

### 2026-04-24 session 1
- PRD, Phase 1, Phase 2, CI/CD, first deploys. Commits `a02d19c` through `f1a3a0d`.

---

## Conventions (read before touching the repo)

- **Commit direct to `main`.** No feature branches, no PRs. Sumit is the lead dev and repo owner.
- **CI runs on push-to-main.** Failing tests block deploy (`needs: test`).
- **Dry-run is always the starting posture.** Even Phase 3 with `AUTOPILOT_ENABLED=true` defaults to `AUTOPILOT_DRY_RUN=true`.
- **`liveActionsAllowed` is opt-in per account.** Editing that flag requires a code change + redeploy — no env shortcut.
- **Server paths are FROZEN.** The 3 auto-deployed dirs above. See [DEPLOY_CICD.md](./DEPLOY_CICD.md).
- **PAS services off-limits** (`pas-adminpanel-*`, `pas-python-api-*`, etc. — not the same as `pas-adsgpt-*`).
- **Don't commit `.env` or the PEM.** Both gitignored.

---

## How to resume from a fresh Claude session at home

1. **Clone the repo.** `git log --oneline -20` → orient on the last ~20 commits.
2. **Read this file top to bottom.** It supersedes the PRD for current state.
3. **Skim [AUTOPILOT_PRD.md](./AUTOPILOT_PRD.md)** only if you need full spec context (rule catalog, phase definitions, env surface table).
4. **First task is almost certainly real-account validation** (see "Pending work" §1 above) — Sumit was going to create a low-budget test account and onboard it. Once that's done, that becomes the highest-leverage thing to do. If the test account isn't ready yet, pick from §2 (rotation queue UI) or the hardening list.
5. **Open the dashboard** via the dev-auth URL above. Mint a fresh JWT first if the inline one has expired (24h). Mint instructions in the "Pick-up-and-go URL" section above.
6. **SSH access:** `ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18`. NOPASSWD sudo. PEM lives at `d:/gbs projects/adsgpt/adsgpt-development-test.pem` on Sumit's local laptop (gitignored — must be transferred manually to a new machine).
7. **Server-side tests:**
   ```
   ssh -i adsgpt-development-test.pem adsgpt-development-test@155.248.244.18 \
     'sudo -u pas-adsgpt-dev-ftp -H bash -lc "source ~/.nvm/nvm.sh && cd /home/pas-adsgpt-dev-ftp/adsgpt-back-end/ads-gpt-nodejs-backend && npm run test:autopilot"'
   ```
   Expects ~196/0 (184 locally where joi/mongoose-dep tests skip).
8. **Smoke test (live `/run-cycle?dryRun=true`)** — runs automatically in CI on every nodejs-backend deploy. Manual:
   ```
   cd nodejs-backend && AUTOPILOT_JWT=<token> npm run smoke:autopilot
   ```
   Expects `SMOKE PASSED ✓` in <60s.
9. **Don't merge anything to a feature branch — push direct to main.** That's the team's working agreement (no PR rituals on this repo).
10. **If this session ends mid-task, update this file before signing off** — every commit beyond what's listed here = stale handoff = wasted time next session.
7. Recommended next task — **once the test ad account arrives**: add it to `autopilotConfig.js` with `liveActionsAllowed: true`, populate one or two `adRotationDraft` rows, then `POST /autopilot/rotate?dryRun=false` to validate the create-ad SDK call end-to-end. After that lands cleanly, the Phase 10 generation core (call into `/adCreative` for auto-population) becomes safe to wire.
