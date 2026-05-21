# Meta LLM Audit & Fix System

> ⚠️ **Moved (2026-04-27).** This feature was merged into Autopilot. Code paths and route prefixes have changed:
>
> - Controller: `controllers/adPosting/metaAuditFix.js` → `controllers/autopilot/llmAuditController.js`
> - Routes: `POST /meta-ads/llm-audit` → `POST /meta-ads/autopilot/llm-audit`; `/meta-ads/audit/*` → `/meta-ads/autopilot/llm-audit/*`
> - Frontend: `components/MetaAds/AIAudit/*` → `components/Autopilot/LLMAudit/*`; tab moved from Ads Manager → Autopilot.
> - Token policy: now uses per-user FB OAuth (`getAccessTokenForAccount`) — same path as the cron lane.
> - Apply when live writes are globally disabled (`AUTOPILOT_LIVE_ACTIONS_ALLOWED` not `true`) is now refused with 423 and recorded as a dry-run row in `autopilotActionLog`.
>
> Mongo collections (`MetaAuditFinding`, `MetaFixLog`) are unchanged — historical data is preserved. The architectural diagrams below describe the original module layout; the **logic flow is identical**, only the file paths and route prefixes changed.

End-to-end documentation for the LLM-powered Meta Ads audit feature: what it does, how each API works, and how to render it on the frontend.

---

## 1. What this system does

Given a Meta ad account, the system:

1. Pulls 14 days of live performance data (campaigns, ad sets, ads, insights, previous-period comparisons).
2. Sends the normalized data to **Gemini** and asks it to identify issues and opportunities.
3. Gets back a list of structured **findings** — each with a severity, reasoning, and an **executable fix action**.
4. Persists findings to MongoDB so the user can apply fixes one-by-one, dismiss them, or undo them.
5. When a user clicks "Apply Fix" on the frontend, the backend re-validates the fix, calls the Meta Marketing API, logs the change, and busts Redis caches.

The key idea: the LLM doesn't generate raw Meta API calls. It picks from a **closed catalog of fix actions** that the backend knows how to execute safely.

---

## 2. Architecture

```
┌────────────────┐    POST /llm-audit     ┌────────────────────────┐
│   Frontend     │ ─────────────────────▶ │ metaAuditFix controller│
│  (user clicks  │                        │                        │
│   "Run Audit") │ ◀───────────────────── │ 1. Fetch Meta data      │
└────────────────┘    auditId + findings  │ 2. Normalize            │
                                          │ 3. Call Gemini          │
                                          │ 4. Validate + persist   │
                                          └──┬───────────┬─────────┘
                                             │           │
                                   ┌─────────▼──┐    ┌───▼─────────────┐
                                   │  Gemini    │    │ MongoDB         │
                                   │ 2.5 Flash  │    │ MetaAuditFinding│
                                   └────────────┘    │ MetaFixLog      │
                                                     └─────────────────┘

┌────────────────┐    POST /apply-fix    ┌────────────────────────┐
│   Frontend     │ ─────────────────────▶ │ metaAuditFix controller│
│  (user clicks  │                        │                        │
│   "Fix This")  │ ◀───────────────────── │ 1. Load finding        │
└────────────────┘    updated finding     │ 2. Safety checks       │
                                          │ 3. Dispatch by         │
                                          │    action_type         │
                                          │ 4. Call Meta API       │
                                          │ 5. Log + cache bust    │
                                          └────────────────────────┘
```

---

## 3. Lifecycle of a finding

```
                       ┌────────────┐
                       │  pending   │ ← created by runLLMAudit
                       └─────┬──────┘
              ┌──────────────┼──────────────┬──────────────────┐
              ▼              ▼              ▼                  ▼
         ┌────────┐   ┌────────────┐   ┌──────────┐      ┌────────┐
         │applied │   │ dismissed  │   │  stale   │      │ failed │
         └───┬────┘   └────────────┘   └──────────┘      └────────┘
             │             (user skip)    (24h TTL)      (Meta call err)
             │ undo (within 1h)
             ▼
         ┌────────┐
         │pending │ (back to pending after undo, can re-apply)
         └────────┘
```

- **pending** — default state; eligible for apply/dismiss.
- **applied** — fix was executed against Meta. Stores `beforeState`/`afterState`.
- **dismissed** — user chose to skip.
- **stale** — expired (24h since creation); must re-run audit.
- **failed** — Meta API call failed; `lastError` is stored.

---

## 4. Data models

### `MetaAuditFinding` ([Module/adPosting/metaAuditFinding.js](../Module/adPosting/metaAuditFinding.js))

| Field | Type | Notes |
|---|---|---|
| `auditId` | string | UUID grouping all findings from one audit run |
| `userId` | string | Owner |
| `adAccountId` | string | Scope |
| `severity` | enum | `critical` \| `warning` \| `opportunity` |
| `entity_type` | enum | `campaign` \| `adset` \| `ad` |
| `entity_id` | string | Meta ID of the target |
| `entity_name` | string | Human-readable name for UI |
| `title` | string | Short headline, one-line |
| `reasoning` | string | LLM's explanation; reference metrics |
| `fix.action_type` | string | One of 11 actions (see §6) |
| `fix.params` | object | Validated params matching the action's schema |
| `fix.risk_level` | enum | `low` \| `medium` \| `high` |
| `fix.reversible` | boolean | If false, undo is disabled |
| `status` | enum | `pending` \| `applied` \| `dismissed` \| `stale` \| `failed` |
| `expiresAt` | Date | createdAt + 24h |
| `appliedAt` | Date | Set when fix applied |
| `dismissedAt` | Date | Set when dismissed |
| `beforeState` | object | Snapshot of Meta entity before fix (for undo) |
| `afterState` | object | Snapshot after fix |
| `lastError` | string | If apply failed |

### `MetaFixLog` ([Module/adPosting/metaFixLog.js](../Module/adPosting/metaFixLog.js))

Immutable audit trail. One row per apply / undo.

| Field | Notes |
|---|---|
| `findingId` | FK → MetaAuditFinding |
| `action_type`, `params` | What was done |
| `beforeState`, `afterState` | Diff for inspection |
| `status` | `success` \| `failed` \| `reverted` |
| `error` | If failed |

---

## 5. API reference

All routes are under `/meta-ads` and require the JWT middleware. See [Router/adPosting/metaAdRoutes.js](../Router/adPosting/metaAdRoutes.js).

### 5.1 Run an audit

```
POST /meta-ads/llm-audit?adAccountId=<id>
```

Fetches 14 days of live Meta data for the account, sends it to Gemini, validates the response, persists findings, and returns them.

**Request**

| Param | In | Required | Notes |
|---|---|---|---|
| `adAccountId` | query | yes | Numeric ID, no `act_` prefix |

**Response 200**

```json
{
  "status": true,
  "auditId": "c9c7a3fd-1a9f-4c1a-9d2a-84a3e0e0dd60",
  "account_name": "Acme Store",
  "expiresAt": "2026-04-24T14:02:00.000Z",
  "summary": { "critical": 3, "warning": 5, "opportunity": 4 },
  "findings": [ /* MetaAuditFinding docs */ ],
  "rejected": [
    { "title": "…", "reason": "Params invalid: ..." }
  ]
}
```

**Error responses**

| Code | Meaning |
|---|---|
| 400 | Missing `adAccountId` |
| 404 | FB user not linked |
| 502 | LLM returned non-JSON |
| 500 | Meta API failure |

**Cost / latency profile**

- ~5–20s (Meta data fetches dominate; LLM call is ~2–4s)
- Gemini input ~50–200k tokens on a typical account (full account dump)
- Not cached — always fresh. If you need rate-limiting, add it at this endpoint.

---

### 5.2 List findings for an audit

```
GET /meta-ads/audit/findings/:auditId
```

Useful if the frontend wants to re-load findings without re-auditing (e.g., page refresh).

**Response 200**

```json
{
  "status": true,
  "auditId": "...",
  "count": 12,
  "findings": [ /* ... */ ]
}
```

---

### 5.3 Apply a fix

```
POST /meta-ads/audit/apply-fix/:findingId
```

**Request body**

```json
{
  "confirmed": true,
  "acknowledgeRisk": false,
  "paramOverrides": {}
}
```

| Field | Required | Notes |
|---|---|---|
| `confirmed` | yes, must be `true` | Idiot-proof confirmation flag |
| `acknowledgeRisk` | only for high-risk actions | See risk levels in §6 |
| `paramOverrides` | optional | User edits (e.g., budget slider) — merged over LLM's params; re-validated |

**Flow on the server**

1. Load finding, verify ownership (`userId`).
2. Reject if `status !== "pending"`.
3. Reject + mark `stale` if `expiresAt < now`.
4. If `risk === "high"` and `!acknowledgeRisk` → 400 with prompt to confirm.
5. Merge `paramOverrides` and re-run the action's Joi schema.
6. Re-fetch entity state from Meta → snapshot as `beforeState`.
7. Call Meta API (dispatcher → action handler).
8. Snapshot `afterState`.
9. Save finding with `status: "applied"`, `appliedAt`, `beforeState`, `afterState`.
10. Write `MetaFixLog` row with `status: "success"`.
11. Bust Redis caches for the ad account.

**Response 200**

```json
{
  "status": true,
  "message": "ADJUST_BUDGET applied to campaign 120330...",
  "finding": { /* updated doc */ },
  "undoAvailableUntil": "2026-04-23T15:02:00.000Z"
}
```

**Error responses**

| Code | Meaning |
|---|---|
| 400 | Missing `confirmed`, or high-risk without `acknowledgeRisk`, or invalid overrides |
| 404 | Finding not found |
| 409 | Finding already applied/dismissed/failed |
| 410 | Finding is `stale` — must re-run audit |
| 500 | Meta API call failed (finding marked `failed`, error logged) |

---

### 5.4 Dismiss a finding

```
POST /meta-ads/audit/dismiss/:findingId
```

No body needed. Only works on `pending` findings.

**Response 200**

```json
{ "status": true, "finding": { /* status: "dismissed" */ } }
```

---

### 5.5 Undo a fix

```
POST /meta-ads/audit/undo/:findingId
```

Restores the entity from the stored `beforeState`. Only works if:

- Finding is `applied`
- Action is `reversible: true`
- Within 1 hour of `appliedAt`
- `beforeState` is present

Writes a `MetaFixLog` row with `status: "reverted"`. Flips finding back to `pending` so the user could re-apply if desired.

**Response 200**

```json
{ "status": true, "message": "Fix reverted", "finding": { /* ... */ } }
```

**Error responses**

| Code | Meaning |
|---|---|
| 400 | Action not reversible / no before state |
| 404 | Finding not found |
| 409 | Finding isn't in `applied` state |
| 410 | Undo window expired |

---

### 5.6 Get fix log

```
GET /meta-ads/audit/fix-log?auditId=<optional>&limit=50
```

Immutable audit trail across all audits for the user (or scoped to one `auditId`). Useful for an "Activity" tab.

**Response 200**

```json
{
  "status": true,
  "count": 17,
  "logs": [ /* MetaFixLog docs, newest first */ ]
}
```

---

## 6. Fix-action catalog

Defined in [config/metaFixActions.js](../config/metaFixActions.js). Each action has a Joi params schema and a risk level.

| action_type | Entities | Risk | Reversible | Params |
|---|---|---|---|---|
| `PAUSE_ENTITY` | campaign, adset, ad | low | yes | `{level, id}` |
| `ACTIVATE_ENTITY` | campaign, adset, ad | low | yes | `{level, id}` |
| `ADJUST_BUDGET` | campaign, adset | medium | yes | `{level, id, new_daily_budget?, new_lifetime_budget?}` — values in **minor units** (cents/paise). Clamped 0.3x–3x current. |
| `ADJUST_BID` | adset | medium | yes | `{adset_id, new_bid_amount}` in minor units |
| `NARROW_AUDIENCE` | adset | **high** | yes | `{adset_id, targeting_patch}` — Meta targeting fragment, merged onto current spec |
| `BROADEN_AUDIENCE` | adset | **high** | yes | Same shape as above |
| `EXTEND_SCHEDULE` | campaign, adset | low | yes | `{level, id, new_stop_time}` ISO 8601 |
| `END_EARLY` | campaign, adset | medium | yes | Same shape as above |
| `CHANGE_OPTIMIZATION_GOAL` | adset | **high** | yes | `{adset_id, new_goal}` from Meta's goal enum (resets learning) |
| `DUPLICATE_AND_MODIFY` | campaign, adset, ad | medium | **no** | `{source_level, source_id, overrides}` |
| `SWAP_CREATIVE` | ad | medium | yes | `{ad_id, new_creative_id}` |

### Why "high-risk" requires `acknowledgeRisk`

`NARROW_AUDIENCE`, `BROADEN_AUDIENCE`, `CHANGE_OPTIMIZATION_GOAL` can reset the adset's learning phase or materially change delivery. The UX should show a second-step warning modal before the user proceeds.

### Budget clamp

The LLM can suggest any `new_daily_budget`, but the server clamps it to `[0.3 × current, 3 × current]` before calling Meta. This prevents 10x runaway changes from a hallucination.

---

## 7. Safety rails (summary)

| Rail | Where | Purpose |
|---|---|---|
| `action_type` enum | Gemini `responseSchema` | LLM can only pick allowed actions |
| Joi per-action param schema | `metaFixActions.validateFixParams` | Params are shape-checked before persist |
| Entity-allowed check | `action.entities.includes(entity_type)` | e.g., can't `ADJUST_BID` on a campaign |
| 24h TTL | `expiresAt` on finding | Forces re-audit after staleness |
| Budget clamp | `clampBudget()` | 0.3x–3x current |
| Confirmation flag | `applyFixSchema` | `confirmed: true` required |
| Risk ack | High-risk gating | User must click twice |
| Status gate | Controller | Only `pending` findings can apply |
| Undo window | 1h | Bounded reversibility |
| Cache bust | `bustAccountCaches` | Stale dashboard data cleared after every fix |

---

## 8. Frontend representation guide

### 8.1 Audit screen

**Header card**
- "Run Audit" primary button → `POST /llm-audit?adAccountId=...`
- Loading state: "Analyzing your account…" spinner (5–20s)
- On success, show the summary pill row:
  - `3 Critical` (red)
  - `5 Warnings` (amber)
  - `4 Opportunities` (green)
- Show "Audit valid until: {expiresAt}" timer — after expiry, disable fix buttons and show a "Re-run Audit" nudge.

**Findings list**
Group by severity. Each finding card:
```
┌──────────────────────────────────────────────────────┐
│ [CRITICAL]   Campaign: Summer Sale Retargeting       │
│                                                       │
│ Zero conversions after ₹12,000 spend in 14 days      │
│                                                       │
│ Why: This campaign has spent ₹12,000 over 14 days    │
│ generating 1,847 clicks but 0 purchases. CTR is      │
│ 0.6% (below 1% threshold) and ROAS is 0. The        │
│ audience may be fatigued (frequency 4.2x).          │
│                                                       │
│ Suggested fix: Pause this campaign                   │
│                                                       │
│ [  Apply Fix  ]  [ Dismiss ]  [ View Details ]      │
└──────────────────────────────────────────────────────┘
```

### 8.2 Rendering by `fix.action_type`

| action_type | Suggested UI |
|---|---|
| `PAUSE_ENTITY` / `ACTIVATE_ENTITY` | Simple button. "Pause campaign" / "Resume adset". |
| `ADJUST_BUDGET` | Button opens modal with a slider or input prefilled to `params.new_daily_budget / 100`, current value shown. Allow user edit → submit via `paramOverrides`. |
| `ADJUST_BID` | Same pattern — editable bid slider. |
| `NARROW_AUDIENCE` / `BROADEN_AUDIENCE` | Render `targeting_patch` as a readable diff vs current targeting. Show warning badge ("This resets learning"). |
| `EXTEND_SCHEDULE` / `END_EARLY` | Date picker prefilled to `params.new_stop_time`. |
| `CHANGE_OPTIMIZATION_GOAL` | Dropdown prefilled to `params.new_goal`. Show warning. |
| `DUPLICATE_AND_MODIFY` | Preview: "A copy of {entity_name} will be created with these changes: …". No undo button. |
| `SWAP_CREATIVE` | Thumbnail preview of new creative before confirm. |

### 8.3 Confirmation modal

Every `Apply Fix` click should open a modal:

```
┌─────────────────────────────────────────┐
│  Apply this fix?                         │
│                                          │
│  Action: Pause campaign "Summer Sale"    │
│  Risk: Low  •  Reversible: Yes          │
│                                          │
│  Editable params: [form as per 8.2]     │
│                                          │
│  [ Cancel ]         [ Confirm ]          │
└─────────────────────────────────────────┘
```

For **high-risk** actions, add a second check:

```
[ ] I understand this will reset the ad set's learning phase
    and may impact delivery.
```

Gate the `Confirm` button until this is checked. On submit:
```js
POST /meta-ads/audit/apply-fix/:findingId
{
  confirmed: true,
  acknowledgeRisk: true,         // only for high-risk
  paramOverrides: { new_daily_budget: 3500 }   // optional user edit
}
```

### 8.4 Applied state

When a finding returns `status: "applied"`:

- Replace the Apply button with a green success pill: "Applied at 14:02 • Undo available for 58m"
- Start a countdown timer to `undoAvailableUntil`
- Show a small "Undo" button while the timer is active
- Show a "View changes" link → modal that diffs `beforeState` vs `afterState`

### 8.5 Stale state

If `expiresAt < now` and user tries to apply:
- Backend returns `410`
- Frontend shows toast: "This audit expired. Run a new one to continue."
- Replace findings list with a "Re-run Audit" CTA.

### 8.6 Activity tab

Render `GET /audit/fix-log` as a timeline:

```
Today
  14:02  Applied ADJUST_BUDGET on campaign "Summer Sale"
         Budget: ₹3,000/day → ₹3,500/day
  14:20  Reverted ADJUST_BUDGET on campaign "Summer Sale"
```

---

## 9. End-to-end example

1. User opens `/dashboard/audit?adAccountId=12345`.
2. Frontend: `POST /meta-ads/llm-audit?adAccountId=12345`.
3. Backend fetches Meta data + calls Gemini. Returns `{ auditId, findings: [...] }`.
4. Frontend persists `auditId` in URL or state: `/dashboard/audit/:auditId`.
5. User clicks "Fix" on a `CHANGE_OPTIMIZATION_GOAL` finding.
6. Modal opens. Shows high-risk warning + dropdown. User checks the ack box.
7. Frontend: `POST /meta-ads/audit/apply-fix/:findingId` with `{ confirmed: true, acknowledgeRisk: true, paramOverrides: { new_goal: "OFFSITE_CONVERSIONS" } }`.
8. Backend re-validates, re-fetches adset, calls Meta, logs, busts caches.
9. Frontend updates the finding card to "Applied" + starts undo countdown.
10. User accidentally clicks Undo within 1h → `POST /meta-ads/audit/undo/:findingId` → adset restored to prior state.

---

## 10. Extending the system

### Add a new fix action

1. In [config/metaFixActions.js](../config/metaFixActions.js), add a new entry to `actions`:
   ```js
   YOUR_NEW_ACTION: {
     risk: "medium",
     reversible: true,
     entities: ["adset"],
     paramsSchema: Joi.object({ /* ... */ }),
     describeForLLM: "YOUR_NEW_ACTION — params: { ... }",
   }
   ```
2. In [controllers/adPosting/metaAuditFix.js](../controllers/adPosting/metaAuditFix.js):
   - Add a handler method: `async _applyYourNewAction({ params })` returning `{ beforeState, afterState }`.
   - Wire it in `_dispatch()`.
3. If the restore logic is non-trivial, extend `_restoreEntity()`.

That's it — the LLM will learn the action from `describeForLLM` in the next audit.

### Swap LLM model

In [controllers/adPosting/metaAuditFix.js](../controllers/adPosting/metaAuditFix.js), change:
```js
model: "gemini-1.5-flash-latest"
```
to `gemini-2.5-flash` (recommended) or `gemini-2.5-pro` (better reasoning, ~4x cost).

### Add caching

`runLLMAudit` deliberately doesn't cache because an audit run should be fresh. If you want to cache per `(userId, adAccountId)` for 30 min, wrap the handler with a Redis `GET/SET` — just don't forget to bust it after any fix is applied.
