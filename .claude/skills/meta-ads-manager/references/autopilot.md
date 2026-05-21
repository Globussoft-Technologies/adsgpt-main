# Autopilot

Autopilot is the **scheduled-action layer** over Meta Ads Manager. It runs the rule audit on a cron, applies safe actions when allowed, and offers a user-defined rule layer ("v4") so users can attach custom rules to specific campaigns. It also hosts the LLM audit (covered in [`audit-engines.md`](audit-engines.md)).

Authoritative product doc: [`docs/AUTOPILOT_PRD.md`](../../../docs/AUTOPILOT_PRD.md). Live status: [`docs/AUTOPILOT_STATUS.md`](../../../docs/AUTOPILOT_STATUS.md). **Read those first** when changing Autopilot core behavior — they are kept in sync with the engine.

## Mount

`/meta-ads/autopilot/*` is a subroute of `/meta-ads`. See [`architecture.md`](architecture.md) for the route table.

## Three controllers

| Controller | Concern |
|---|---|
| [`autopilotController.js`](../../../nodejs-backend/controllers/autopilot/autopilotController.js) | Continuous engine: cron entry points (`/run`, `/run-cycle`), action dispatch (`/rotate`, `/rename-by-hook`), settings (`/settings` GET+PATCH), config (`/config`), action log (`/log`, `/log/:runId`, `/summary`), test endpoints (`/test-slack`, `/test-email`), rotation queue, draft approval. |
| [`autopilotUserRuleController.js`](../../../nodejs-backend/controllers/autopilot/autopilotUserRuleController.js) | v4 user-defined rules: CRUD on `/rules`, `/rules/:id/test`, `/rule-templates`. |
| [`llmAuditController.js`](../../../nodejs-backend/controllers/autopilot/llmAuditController.js) | LLM audit + apply / dismiss / undo / fix-log. See [`audit-engines.md`](audit-engines.md). |

## Token resolution

`getAccessTokenForAccount({adAccountId, callerUserId})` from [`config/autopilotConfig.js`](../../../nodejs-backend/config/autopilotConfig.js):

- **Cron path**: resolves the FB token via `ownerUserId` configured per account in `autopilotConfig`. The `META_SYSTEM_USER_TOKEN` system-user token is **retired** — do not reach for it.
- **On-demand path**: uses the caller's own FB OAuth (`callerUserId`), falls back to `ownerUserId` if missing.

## Safety model

Every account-level action is gated by `liveActionsAllowed: true` in `autopilotConfig`. Without it:
- Cron runs in DRY-RUN mode — logs the would-be action to `autopilotActionLog` with a `dryRun: true` flag.
- LLM audit `apply-fix` returns **423 Locked** with a dry-run row.

The `/autopilot` UI shows a yellow "DRY-RUN ONLY" badge per non-opted-in account so the safety state is unmissable.

## v4 user-defined rules

Form-based rules attached to specific campaigns (replaces the previous "37 fixed rules iterate every selected ad-account" model).

### Shape

```js
{
  userId, adAccountId, campaignId,
  ruleTemplateId,           // optional — cloned from a template
  trigger: { metric, comparator, threshold, window },
  action: { type, params }, // pause | scale | rename | rotate | slack | email
  status: "active" | "paused",
}
```

### Templates

Curated starting points exposed at `GET /rule-templates`. Examples: "Pause if frequency > 4 over 7 days", "Scale up adset if ROAS > 2× baseline 5 days running". Users clone a template, adjust thresholds + entity attachment, save.

### Cron iteration

Each cron tick (`/run-cycle`) evaluates **only attached (rule × entity) pairs**. No rule iterates the full account anymore — this is intentional, both for performance and so users see the rules applied to their stuff specifically.

## Action catalog

Actions Autopilot can take (cron + LLM apply-fix share this catalog):

| Action | What it does |
|---|---|
| `pause` | Sets entity status to PAUSED |
| `resume` | Sets entity status to ACTIVE |
| `scale-up` | Increases daily/lifetime budget by configured % |
| `scale-down` | Decreases budget by configured % |
| `rename` | Renames entity per a hook function (used to surface findings in the entity name) |
| `rotate` | Rotates a specific creative variant out and a draft variant in (depends on the rotation queue) |
| `change-bid-strategy` | Changes the AdSet's `bid_strategy` |
| `swap-creative` | Replaces an Ad's creative with a draft creative |
| `slack` | Posts to configured Slack webhook |
| `email` | Sends email via configured transport |
| `add-target` | Adds an interest/behavior to AdSet targeting |
| `remove-target` | Removes one |

Adding an action requires:
1. A handler in `services/autopilot/actions/<action>.js`.
2. A `beforeState` capture path so `undo` can reverse it.
3. A schema entry in `applyFixSchema` if it should be invocable from LLM audit.
4. A row in the `action` enum in `autopilotActionLog` so it can be logged.

## Action log

Mongo collection `autopilotActionLog`. Every action — applied, dry-run, skipped, failed — produces a row with:
- `entity` (level + id + name).
- `rule` (id + severity).
- `why` (rule message + skipReason).
- `metricsSnapshot` (full metric set at evaluation time).
- `actionPayload` (the params that were sent / would have been sent).
- `outcome` ("success" | "failed" | "skipped").
- `dryRun: boolean`.

The Autopilot UI's Activity Summary drilldown reads this log and groups by action.

## Cron schedule

Autopilot core runs **hourly** (configured via the deployment's cron, not in-code). On-demand triggers via `/run-cycle` are also accepted but rate-limited per account.

## Slack / email

Both are configured per-account in `autopilotConfig` (`slackWebhookUrl`, `emailRecipients`). `/test-slack` and `/test-email` send a canned test message — useful for sanity-checking config without waiting for a real audit hit.

## Frontend

- `apis/autopilot/autopilotApi.js` — rule + cron + log + settings clients.
- `apis/autopilot/llmAuditApi.js` — LLM audit clients.
- The Autopilot page itself isn't in the MetaAds folder — it's a separate page (`pages/Autopilot/...` or similar). When changing Autopilot UI, search for `autopilot` rather than assuming it lives in MetaAds.

## Coordination with the wizard rebuild

When the wizard parity rebuild adds new fields to AdSet/Ad creation, Autopilot rules may need to mutate them post-launch. Open question tracked in [`docs/CAMPAIGN_CREATION_PARITY_PLAN.md`](../../../docs/CAMPAIGN_CREATION_PARITY_PLAN.md) — Phase 0 owners must check with the Autopilot owner before adding mutable fields.
