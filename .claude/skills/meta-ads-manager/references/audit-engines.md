# Audit engines

AdsGPT runs **two complementary audit engines** under the same `/meta-ads` umbrella. They are deliberately separate; do not conflate them.

| Engine | Trigger | Lives at | Action surface | UI |
|---|---|---|---|---|
| **Rule-based audit** | Hourly cron (Autopilot) + on-demand `GET /meta-ads/audit` | `services/metaAuditService.js` + `config/auditRulesConfig.js` (37 rules) | Cron applies pause/resume/scale/rename/rotate when `liveActionsAllowed: true`; on-demand mode returns findings only | Audit tab on dashboard |
| **LLM audit** | On-demand only `POST /meta-ads/autopilot/llm-audit` | `controllers/autopilot/llmAuditController.js` | Per-finding apply / dismiss / undo with 60-min undo window + `beforeState` snapshots | Autopilot's "AI Audit" tab |

Both engines share:
- The same safety gate (`liveActionsAllowed`, set per ad-account in `config/autopilotConfig.js`).
- The same action log (Autopilot's `autopilotActionLog` collection).
- The same token resolution (`getAccessTokenForAccount`).

## Rule-based audit

### Engine

[`services/metaAuditService.js`](../../../nodejs-backend/services/metaAuditService.js) — `runAuditForAccount({userId, adAccountId, accessToken, options})`. Loads insights for the past 14 days (fixed window — see [`gotchas.md`](gotchas.md#audit-window-is-fixed)), iterates every rule against every entity (campaign / adset / ad), returns findings.

### Rule shape

Rules in [`config/auditRulesConfig.js`](../../../nodejs-backend/config/auditRulesConfig.js):

```js
{
  id: "AUD-25",                   // human-readable rule id
  severity: "opportunity",        // "critical" | "warning" | "opportunity"
  entity: "ad",                   // "campaign" | "adset" | "ad"
  defaults: { min_spend: 10000, min_ctr: 3 },
  check: (d, t) => d.spend > t.min_spend && d.ctr >= t.min_ctr,
  message: (d) => `${d.ad_name} has excellent CTR at ${d.ctr.toFixed(2)}%`,
}
```

`d` is a flattened metrics object the engine builds per-entity (spend, ctr, cpa, roas, frequency, prev_*, status, etc.). `t` is the resolved thresholds (defaults overridden by per-account config when present).

### Adding a rule

1. Pick a free `id` (`AUD-XX`). Keep increment monotonic.
2. Add to `auditRulesConfig.js`. Pick `entity`, `severity`, define `defaults`, `check`, `message`.
3. **Use `.toFixed()` for any percentage / float in the message** — naked `${d.ctr}` produces `4.848967%`, which we keep getting bugs about. See [`gotchas.md`](gotchas.md#numeric-formatting-in-audit-messages).
4. If your rule introduces a new metric, extend the metric flattening in `metaAuditService.js`.
5. Optional: add an Autopilot action handler if the rule should auto-fix (see [`autopilot.md`](autopilot.md)).

### Cache

Audit results are cached `metaAudit:<userId>:<adAccountId>` for **30 min** (inline TTL, not `REDIS_TTL`). Wiped on `invalidateAllUserMetaCache` (FB disconnect) and on delete-campaign.

### Frontend

`AuditTab` in [`react-frontend/src/components/MetaAds/MetaAdsPanels.jsx`](../../../react-frontend/src/components/MetaAds/MetaAdsPanels.jsx). Filter pills: `all` | `critical` | `warning` | `opportunity`. **Default filter is `all`** — defaulting to a severity bucket that's empty makes the tab look broken (was a bug; fixed).

Findings are grouped by entity (one card per finding). Clicking does nothing — rule audit is intentionally informational. Apply-fix lives only in the LLM audit lane.

## LLM audit

### Trigger

`POST /meta-ads/autopilot/llm-audit` with `{ adAccountId }` — kicks off a Gemini 2.5 Pro call with a structured-output schema and an 11-action fix catalog.

### Persistence

Findings stored in `MetaAuditFinding` collection ([`Module/adPosting/metaAuditFinding.js`](../../../nodejs-backend/Module/adPosting/metaAuditFinding.js)). Each finding has:
- `auditId` (groups findings from one run).
- `recommendedAction` (one of the 11 fix actions: pause, resume, scale-up, scale-down, rename, swap-creative, change-bid-strategy, etc.).
- `severity`, `confidence`, `rationale`, `risk`.
- `entity` (ref to campaign/adset/ad).

### Apply / dismiss / undo

| Endpoint | What it does |
|---|---|
| `POST /llm-audit/apply-fix/:findingId` | Validates with `applyFixSchema`. If account has `liveActionsAllowed: true`, applies the action via the SDK and snapshots `beforeState` into [`MetaFixLog`](../../../nodejs-backend/Module/adPosting/metaFixLog.js). If not, records a dry-run row and returns 423. |
| `POST /llm-audit/dismiss/:findingId` | Marks finding dismissed. No Meta call. |
| `POST /llm-audit/undo/:findingId` | Reverses the action using `beforeState` from `MetaFixLog`. **60-min window** — past that, returns an error to prevent accidental rollbacks of long-running changes. |
| `GET /llm-audit/fix-log` | Returns the full applied/undo log for the account. |

### When to invoke which engine

- "What's wrong with my account right now?" → rule audit (Audit tab).
- "Tell me what to do, with the option to apply directly" → LLM audit (Autopilot AI Audit tab).
- Cron / scheduled workflows → rule audit only. LLM audit is on-demand by design (cost + latency).

### Don't

- Don't add a rule to the deterministic engine that requires an LLM judgment call ("creative looks tired"). The rule engine must be deterministic and explainable.
- Don't add a fix action to the LLM catalog without a `beforeState` capture path. Undo depends on it.
- Don't share thresholds between the two engines silently. If both engines need to know the "low CTR" cutoff, define it once and import on both sides.
