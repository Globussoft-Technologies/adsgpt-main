/**
 * userRuleOrchestrator — Autopilot v4 cron entry point.
 *
 * Replaces the v3 model ("37 backend rules iterate every selected ad
 * account") with a rule-driven model: every paused/alerted entity was
 * matched by a rule the user themselves authored and explicitly attached
 * to a specific campaign.
 *
 * Per-cycle flow:
 *   1. Find all enabled user-rules (optionally filtered by userIds for
 *      manual triggers).
 *   2. Group rules by userId → adAccountId.
 *   3. For each (user, account):
 *        a. Resolve the user's FB token from facebookUsers.
 *        b. Fetch the account's normalized entities (campaigns/adsets/ads
 *           + insights) ONCE — re-uses metaAuditService.runAuditForAccount
 *           with guards off, ignores its findings.
 *        c. For each rule, walk its attachments[] for THIS account:
 *           - Look up the attached campaign in the fetched data.
 *           - If missing → mark attachment.orphan = true, skip evaluation.
 *           - Otherwise, collect targets at the rule's evaluateOn level
 *             (the campaign itself, or its adsets, or its ads).
 *           - Run `evaluateRule(rule, target)`. If it matches:
 *               • action 'pause' → effectiveDryRun gate, then pauseEntity,
 *                                  unless the entity is already PAUSED
 *                                  (re-uses the v3 already-paused guard
 *                                  pattern).
 *               • action 'alert' → no Meta call; logged with action:
 *                                  'alert_only', folded into the cycle
 *                                  summary so alertService picks it up.
 *               • action 'scale' → move the entity's daily budget by the
 *                                  rule's signed `pct` (`applyScale`).
 *                                  Budgets live on campaigns/ad sets, so an
 *                                  ad-level rule scales the parent ad set.
 *                                  Bounded by scalePolicy.js (7-day
 *                                  cumulative RATIO ceilings up and down,
 *                                  per-account per-cycle delta caps) and by
 *                                  the shared actionBudget.js count.
 *        d. Resume pass (`resumeAtAccount`): re-evaluate each rule against
 *           the entities IT previously paused and un-pause the ones it no
 *           longer matches, subject to the flap cooldown and the
 *           manual-intervention guard. Gated per user by
 *           `autopilotSettings.autoResumeEnabled` (default on).
 *   4. Build a v3-shaped cycle summary and call notifyAutopilotCycle so
 *      the existing per-user Slack/email fan-out works unchanged.
 *
 * Per-account, per-cycle ACTION BUDGET (actionBudget.js) is shared by scale
 * and resume. It is what bounds a first tick against an account with weeks of
 * accumulated pauses, and what stops fifty simultaneous winners from all
 * being raised in one hour.
 *
 * Design intent:
 *   - Action services (autoPauseService, autoScaleService, rotationService,
 *     adRenameService) stay in source but are unwired from the cron —
 *     they're only used by the now-deprecated manual /run and /run-cycle
 *     HTTP endpoints, which keep working but are no longer the primary
 *     surface. autoResumeService is the exception: the v4 resume pass
 *     reuses its guards (`countFlaps`, `detectManualIntervention`) and its
 *     two SDK wrappers rather than reimplementing them.
 *   - The action log row schema is unchanged; the meaning of `ruleId`
 *     becomes the user's rule._id (was 'AUD-XX'), `ruleSeverity` becomes
 *     low|medium|high (was critical|warning|opportunity), `ruleMessage`
 *     becomes the user's rule.name (was the 37-rule's `message(d)`
 *     output).
 */

const { randomUUID } = require("node:crypto");
const { redisClient } = require("../../db/redis");
const AutopilotUserRule = require("../../Module/autopilot/autopilotUserRule");
const AutopilotSettings = require("../../Module/autopilot/autopilotSettings");
const FBUsers = require("../../Module/adPosting/facebookUsers");
const AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");
const { decrypt } = require("../../utils/crypto");
const {
  effectiveDryRun,
  normalizeAdAccountId,
} = require("../../config/autopilotConfig");
const { runAuditForAccount } = require("../metaAuditService");
const { evaluateRule } = require("./userRuleEvaluator");
const { pickMetricsSnapshot } = require("./metricsSnapshot");
const { notifyAutopilotCycle } = require("./alertService");
const {
  _internals: { listUserAdAccounts },
} = require("./targetDiscovery");
// Resume reuses the v3 guards rather than reimplementing them: `countFlaps`
// and `detectManualIntervention` are pure and already unit-covered, and the
// two SDK wrappers are thin. This is the only v3 service the v4 cron touches.
const {
  countFlaps,
  detectManualIntervention,
  _internals: { resumeEntity, getEntityMeta },
} = require("./autoResumeService");
// Scaling ceilings + the pure math behind them. Engine-owned, not editable
// from a rule — see the module header for why.
const {
  resolveScalePolicy,
  cumulativeRatio,
  computeStep,
  accountCapAbsolute,
  withinAccountCap,
  scaledBudget,
} = require("./scalePolicy");
// How many actions Autopilot may take on one account in one tick. Shared by
// scale and resume; resume needs it to survive its cold start.
const { createActionBudget } = require("./actionBudget");
// Every autopilotActionLog read the cron makes. Extracted so a verification
// script can exercise the REAL queries against a REAL database — the unit
// stubs ignore the query object, so a broken $match would pass every test.
const {
  autopilotPausesFor,
  flapHistoryFor,
  retirementRecorded,
  scaleHistoryFor,
} = require("./actionLogQueries");
// Meta's Business Use Case rate-limit meters, read per ad account BEFORE we
// spend the expensive insights calls on it. See rateLimitProbe.js for why the
// App Dashboard's rate-limit page can read 100% remaining while a single
// account is throttled.
const {
  probeAccountUsage,
  shouldDefer,
  formatUsage,
} = require("./rateLimitProbe");

let _bizSdk;
function bizSdk() {
  if (!_bizSdk) _bizSdk = require("facebook-nodejs-business-sdk");
  return _bizSdk;
}

let _logger;
function getLogger() {
  if (_logger) return _logger;
  try {
    _logger = require("../../utils/logger");
  } catch {
    _logger = console;
  }
  return _logger;
}

const LOCK_KEY = "autopilot:lock";
const LOCK_TTL_SECONDS = 55 * 60; // matches v3, prevents double-fire

// Terminal state for the resume retrial loop: the entity ran out of trials
// and Autopilot has stopped retrying it. Written once per pause — see
// resumeAtAccount. The UI keys off this string to surface the entity.
const RETIRED_SKIP_REASON = "retired-out-of-retries";

async function acquireLock(runId) {
  const r = await redisClient.set(LOCK_KEY, runId, "EX", LOCK_TTL_SECONDS, "NX");
  return r === "OK";
}
async function releaseLock(runId) {
  try {
    const cur = await redisClient.get(LOCK_KEY);
    if (cur === runId) await redisClient.del(LOCK_KEY);
  } catch (err) {
    getLogger().error(
      `[autopilot v4] releaseLock failed for runId=${runId}: ${err.message}`,
    );
  }
}

// ─── pure helpers (exported for tests) ─────────────────────────────────────

/**
 * Resolve a rule's effective lookback window:
 *   - `lookbackPreset: 'this_month'` → days since the 1st of the current
 *     month (1 on the 1st, 26 on the 26th, …). Recomputed every cron tick
 *     so the window walks the calendar correctly.
 *   - `lookbackPreset: 'maximum'` → the Meta lifetime-fetch token.
 *   - otherwise → the rule's numeric `lookbackDays` (default 14 if absent).
 *
 * Pure-ish: depends on `new Date()` so a test must mock `now` to assert
 * the calendar branch. Kept here (not in evaluator) because lookback is
 * a FETCH-time concern, not a per-condition concern.
 */
function resolveEffectiveLookback(rule, now = new Date()) {
  if (rule && rule.lookbackPreset === "maximum") {
    return "maximum";
  }
  if (rule && rule.lookbackPreset === "this_month") {
    return Math.max(1, now.getDate()); // 1..31
  }
  return Number((rule && rule.lookbackDays) || 14);
}

/**
 * Does any rule in this batch read a previous-period field?
 *
 * Three of the six insights queries exist solely to populate `prev_*`, and
 * they cost the same as the current-period ones. Most rules compare against
 * absolute thresholds ("cpi > 40"), never touching a `prev_*` field — so for
 * them half the insights CPU is spent on data nothing reads. Business Use Case
 * rate limits meter `total_cputime`, which is what makes that waste matter.
 */
function batchNeedsPreviousPeriod(rules) {
  return (rules || []).some((r) =>
    (r?.conditions?.rules || []).some(
      (c) => typeof c.field === "string" && c.field.startsWith("prev_"),
    ),
  );
}

/**
 * Group rules by user, then by ad-account derived from rule.attachments.
 * One rule can attach to multiple accounts so it surfaces under each one.
 */
function groupRulesByUserAndAccount(rules) {
  const out = new Map(); // userId → Map<acctKey, rules[]>
  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.attachments)) continue;
    const seenAccountsForRule = new Set();
    for (const att of rule.attachments) {
      const acct = normalizeAdAccountId(att.adAccountId);
      if (!acct || seenAccountsForRule.has(acct)) continue;
      seenAccountsForRule.add(acct);
      if (!out.has(rule.userId)) out.set(rule.userId, new Map());
      const byAcct = out.get(rule.userId);
      if (!byAcct.has(acct)) byAcct.set(acct, []);
      byAcct.get(acct).push(rule);
    }
  }
  return out;
}

/**
 * Pick the entity rows the rule should evaluate against, walking from
 * the attached campaign down through its adsets / ads as needed.
 *
 * `entities` is the normalized data returned by metaAuditService:
 *   { campaigns: [...], adsets: [...], ads: [...] }
 *
 * The campaign/adset/ad row shape uses Meta-style snake_case
 * (`campaign_id`, `adset_id`) so we read accordingly.
 */
function collectTargetsForRule(rule, entities, campaignId, adsetId = null) {
  if (!entities) return [];
  const sameCampaign = (x) => String(x.campaign_id) === String(campaignId);
  // An attachment may narrow to ONE ad set inside the campaign. ABO campaigns
  // are usually geo-split — IND / USA / Canada ad sets under one campaign,
  // with completely different economics — so "every ad set in this campaign"
  // is the wrong scope for a threshold that is only correct for one of them.
  const sameAdset = (x) => String(x.adset_id) === String(adsetId);

  if (rule.evaluateOn === "campaign") {
    // Guarded at the validator: a campaign-level rule can't hold an ad-set
    // attachment. Belt-and-braces here so a hand-written document can't make
    // the cron score a whole campaign the author meant to scope down.
    if (adsetId) return [];
    const c = (entities.campaigns || []).find(sameCampaign);
    return c ? [c] : [];
  }
  if (rule.evaluateOn === "adset") {
    const pool = (entities.adsets || []).filter(sameCampaign);
    return adsetId ? pool.filter(sameAdset) : pool;
  }
  if (rule.evaluateOn === "ad") {
    const pool = (entities.ads || []).filter(sameCampaign);
    // Ad-level rule under an ad-set attachment = only that ad set's ads.
    return adsetId ? pool.filter(sameAdset) : pool;
  }
  return [];
}

// Pull the human-readable cause out of a facebook-nodejs-business-sdk error.
// The SDK flattens Meta's response body straight onto `err.response` (NOT
// `err.response.error`), so the useful strings live at
// `err.response.error_user_title` / `error_user_msg`. `err.message` alone is
// the generic top-level text ("Invalid parameter") that tells us nothing
// about WHICH parameter or why — surfacing the user-facing pair is how we
// learn that, say, an ad is still in review or its parent is archived.
function formatMetaError(err) {
  const r = err && err.response;
  const title = r && r.error_user_title;
  const msg = r && r.error_user_msg;
  const code = r && (r.code || (r.error && r.error.code));
  const sub = r && (r.error_subcode || (r.error && r.error.error_subcode));
  const human = [title, msg].filter(Boolean).join(" — ");
  const base = human || (err && err.message) || String(err);
  const codeTag = [code, sub].filter((x) => x != null).join("/");
  return codeTag ? `${base} (code ${codeTag})` : base;
}

// ─── Meta write — pause an entity ──────────────────────────────────────────
async function pauseEntity({ level, entityId }) {
  const sdk = bizSdk();
  if (level === "campaign") {
    await new sdk.Campaign(entityId).update([sdk.Campaign.Fields.status], {
      [sdk.Campaign.Fields.status]: "PAUSED",
    });
    return;
  }
  if (level === "adset") {
    await new sdk.AdSet(entityId).update([sdk.AdSet.Fields.status], {
      [sdk.AdSet.Fields.status]: "PAUSED",
    });
    return;
  }
  if (level === "ad") {
    await new sdk.Ad(entityId).update([sdk.Ad.Fields.status], {
      [sdk.Ad.Fields.status]: "PAUSED",
    });
    return;
  }
  throw new Error(`Unknown level: ${level}`);
}

// ─── orphan attachment marker ──────────────────────────────────────────────
// Persist the orphan flag onto the matching attachment in the rule doc so
// the UI can show "this campaign was deleted on Meta" without re-checking
// every cycle.
async function markAttachmentOrphan({ ruleId, adAccountId, campaignId, adsetId = null }) {
  try {
    await AutopilotUserRule.updateOne(
      { _id: ruleId, "attachments.campaignId": campaignId },
      {
        $set: {
          "attachments.$[a].orphan": true,
          "attachments.$[a].orphanedAt": new Date(),
        },
      },
      {
        arrayFilters: [
          {
            "a.adAccountId": adAccountId,
            "a.campaignId": campaignId,
            // Must be part of the filter, not just the query: two attachments
            // can share a campaign and differ only by ad set (the whole point
            // of ABO geo-splits). Without this, flagging the India ad set
            // would flag the USA one too. Mongo matches `null` against a
            // missing field, so campaign-level attachments still resolve.
            "a.adsetId": adsetId,
          },
        ],
      },
    );
  } catch (err) {
    getLogger().warn(
      `[autopilot v4] orphan mark failed rule=${ruleId} campaign=${campaignId}: ${err.message}`,
    );
  }
}

// Inverse of markAttachmentOrphan — clears the orphan flag once a
// previously-flagged campaign reappears on Meta. Without this, a
// paused-then-resumed campaign would stay flagged forever despite being
// fine to evaluate.
async function unmarkAttachmentOrphan({ ruleId, adAccountId, campaignId, adsetId = null }) {
  try {
    await AutopilotUserRule.updateOne(
      { _id: ruleId, "attachments.campaignId": campaignId },
      {
        $set: {
          "attachments.$[a].orphan": false,
          "attachments.$[a].orphanedAt": null,
        },
      },
      {
        arrayFilters: [
          {
            "a.adAccountId": adAccountId,
            "a.campaignId": campaignId,
            // Must be part of the filter, not just the query: two attachments
            // can share a campaign and differ only by ad set (the whole point
            // of ABO geo-splits). Without this, flagging the India ad set
            // would flag the USA one too. Mongo matches `null` against a
            // missing field, so campaign-level attachments still resolve.
            "a.adsetId": adsetId,
          },
        ],
      },
    );
  } catch (err) {
    getLogger().warn(
      `[autopilot v4] orphan unmark failed rule=${ruleId} campaign=${campaignId}: ${err.message}`,
    );
  }
}

// ─── log row writer ────────────────────────────────────────────────────────
async function writeActionLogRow({
  runId,
  userId,
  acctKey,
  acctName,
  rule,
  entity,
  level,
  outcome,
  skipReason,
  error,
  dryRun,
  metaLatencyMs,
}) {
  try {
    // Pull parent identity off the entity. The normalizers in
    // metaAuditService include campaign_id/campaign_name on every level,
    // and adset_id/adset_name on adset+ad levels — see
    // metaAuditService.normalizeAdset/Ad.
    const isAdLevel = level === "ad";
    const isAdsetLevel = level === "adset";
    await AutopilotActionLog.create({
      runId,
      userId,
      adAccountId: acctKey,
      adAccountName: acctName,
      level,
      entityId:
        entity[`${level}_id`] || entity.id || entity.campaign_id || "",
      entityName:
        entity[`${level}_name`] || entity.name || entity.campaign_name || "",
      campaignId:
        isAdLevel || isAdsetLevel ? entity.campaign_id || undefined : undefined,
      campaignName:
        isAdLevel || isAdsetLevel
          ? entity.campaign_name || undefined
          : undefined,
      adsetId: isAdLevel ? entity.adset_id || undefined : undefined,
      adsetName: isAdLevel ? entity.adset_name || undefined : undefined,
      ruleId: String(rule._id),
      ruleSeverity: rule.severity,
      ruleMessage: rule.name,
      metricsSnapshot: pickMetricsSnapshot(entity),
      action: rule.action.type === "pause" ? "pause" : "alert_only",
      dryRun,
      outcome,
      skipReason: skipReason || undefined,
      error: error || undefined,
      metaApiLatencyMs: metaLatencyMs,
      runAt: new Date(),
      pausedBy: "autopilot",
    });
  } catch (logErr) {
    getLogger().error(
      `[autopilot v4] log write failed runId=${runId}: ${logErr.message}`,
    );
  }
}

// ─── core: evaluate one rule against its attached campaigns ────────────────
async function evaluateRuleAtAccount({
  rule,
  acctKey,
  acctName,
  entities,
  finalDryRun,
  runId,
  userId,
  acctSummary,
  // Account-scoped scaling state: ceilings, the per-cycle budget deltas, the
  // shared action budget, and the memoised 7d-history lookup. Shared across
  // every rule at this account so the account cap caps the ACCOUNT rather
  // than each rule independently. Null when no rule here scales.
  scaleContext = null,
  // Set of campaign ids the user's plan lets them automate, or null when the
  // plan is uncapped (then nothing is filtered). Resolved once per user run.
  managedCampaignIds = null,
}) {
  // Walk the rule's attachments, but only those for THIS account.
  const myAttachments = (rule.attachments || []).filter(
    (a) => normalizeAdAccountId(a.adAccountId) === acctKey,
  );
  // Authoritative roster of campaigns that exist on Meta right now —
  // independent of whether they delivered insights in the lookback
  // window. `entities.campaigns` only contains insight-bearing campaigns,
  // so using it here was falsely marking new / paused / silent campaigns
  // as orphan the moment a user attached them.
  const allIds = new Set(
    (entities.allCampaignIds || (entities.campaigns || []).map((c) => c.campaign_id))
      .map((s) => String(s)),
  );
  // Same idea one level down, for ad-set-scoped attachments. Falls back to the
  // insight-bearing list only when the roster is missing, which would
  // false-positive a silent ad set — so prefer allAdsetIds.
  const allAdsetIds = new Set(
    (entities.allAdsetIds || (entities.adsets || []).map((s) => s.adset_id))
      .map((s) => String(s)),
  );
  for (const att of myAttachments) {
    // Plan gate — skip campaigns outside the user's managed slots. Silent by
    // design: this is not an error or an orphan, the rule is simply dormant
    // for that campaign until the user manages it again or upgrades, and
    // logging it every tick would flood the action log.
    if (managedCampaignIds && !managedCampaignIds.has(String(att.campaignId))) {
      continue;
    }
    // Orphan check — does the attached thing still exist on Meta at all?
    // An ad-set attachment dies if EITHER the ad set or its campaign is gone,
    // so both are checked; without the ad-set half, deleting one ad set out of
    // an ABO campaign would leave the rule looking healthy while silently
    // matching nothing.
    const campaignAlive = allIds.has(String(att.campaignId));
    const adsetAlive = !att.adsetId || allAdsetIds.has(String(att.adsetId));
    if (!campaignAlive || !adsetAlive) {
      if (!att.orphan) {
        await markAttachmentOrphan({
          ruleId: rule._id,
          adAccountId: acctKey,
          campaignId: att.campaignId,
          adsetId: att.adsetId || null,
        });
      }
      continue;
    }
    // Self-heal: campaign is alive but the attachment was previously
    // flagged orphan (e.g. transient API blip, false positive from the
    // old insight-only check). Clear the flag so the UI stops surfacing
    // a stale warning.
    if (att.orphan) {
      await unmarkAttachmentOrphan({
        ruleId: rule._id,
        adAccountId: acctKey,
        campaignId: att.campaignId,
        adsetId: att.adsetId || null,
      });
    }

    const targets = collectTargetsForRule(
      rule,
      entities,
      att.campaignId,
      att.adsetId || null,
    );
    for (const target of targets) {
      if (!evaluateRule(rule, target)) continue;

      // Scale owns its whole branch: budgets don't live where ads do, the
      // ceilings are different, and the account-level state is shared across
      // rules. Threading that through the pause path would tangle both.
      if (rule.action.type === "scale") {
        await applyScale({
          rule,
          target,
          entities,
          acctKey,
          acctName,
          finalDryRun,
          runId,
          userId,
          scaleContext,
        });
        continue;
      }

      const isPause = rule.action.type === "pause";

      // Already-paused entities are a no-op: skip silently with no log
      // row and no counter bump. Without this guard the cron would write
      // a fresh `skipped/already-paused` row every hour for the same
      // entity, drowning the action log in noise. Pause action + status
      // already PAUSED = nothing to do, nothing to record.
      if (isPause && (target.status || "").toUpperCase() === "PAUSED") {
        continue;
      }

      let outcome = "success";
      let error = null;
      const attemptStart = Date.now();

      if (isPause && !finalDryRun) {
        try {
          await pauseEntity({
            level: rule.evaluateOn,
            entityId:
              target[`${rule.evaluateOn}_id`] || target.id,
          });
        } catch (err) {
          outcome = "failed";
          error = formatMetaError(err);
          getLogger().error(
            `[autopilot v4] pause failed rule=${rule._id} entity=${target[`${rule.evaluateOn}_id`]}: ${error}`,
          );
        }
      }

      await writeActionLogRow({
        runId,
        userId,
        acctKey,
        acctName,
        rule,
        entity: target,
        level: rule.evaluateOn,
        outcome,
        skipReason: null,
        error,
        dryRun: finalDryRun,
        metaLatencyMs: Date.now() - attemptStart,
      });

      // Update per-account summary tallies for the alert payload.
      if (isPause) {
        if (outcome === "success") {
          if (finalDryRun) acctSummary.would_pause += 1;
          else acctSummary.paused += 1;
          acctSummary.actionable_count += 1;
          acctSummary.findings_count += 1;
        } else if (outcome === "failed") {
          acctSummary.failed += 1;
          acctSummary.findings_count += 1;
        }
      } else {
        // alert_only — informational, only counts toward findings.
        acctSummary.findings_count += 1;
      }
    }
  }
}

// ─── scale: move a winner's (or loser's) budget ────────────────────────────
//
// Budgets live on campaigns and ad sets, never on ads — so an ad-level rule
// scales the ad's PARENT AD SET and records which ad triggered it.
//
// The user's rule owns the trigger and the step; every ceiling above that is
// engine policy (scalePolicy.js) and the per-cycle action count is a shared
// budget (actionBudget.js). See those files for why none of it is editable
// from the rule form.

/**
 * Where does the budget for this match actually live?
 * Returns null when an ad has no resolvable parent ad set.
 */
function resolveScaleTarget(rule, target, entities) {
  if (rule.evaluateOn === "campaign") {
    return {
      level: "campaign",
      entityId: target.campaign_id || target.id,
      entityName: target.campaign_name || target.name,
      entity: target,
      triggeringAd: null,
    };
  }
  if (rule.evaluateOn === "adset") {
    return {
      level: "adset",
      entityId: target.adset_id || target.id,
      entityName: target.adset_name || target.name,
      entity: target,
      triggeringAd: null,
    };
  }
  // Ad level — walk up. The ad row carries adset_id/adset_name; the ad set's
  // own row (for its status) may or may not be in this window's fetch.
  const adsetId = target.adset_id;
  if (!adsetId) return null;
  const adsetRow = (entities.adsets || []).find(
    (s) => String(s.adset_id) === String(adsetId),
  );
  return {
    level: "adset",
    entityId: adsetId,
    entityName: target.adset_name || (adsetRow && adsetRow.adset_name),
    entity: adsetRow || null,
    triggeringAd: {
      ad_id: target.ad_id,
      ad_name: target.ad_name,
    },
  };
}

// Budget read that does NOT throw on "no daily budget". v3's readEntityBudget
// threw, which as an hourly cron action means a `failed` row every hour
// forever for an entity that will never be scalable. Here the absence is
// information: it tells us whether this is a lifetime-budget entity or a CBO
// child, and both become skips with a specific reason.
async function readBudget({ level, entityId }) {
  const sdk = bizSdk();
  const Klass = level === "campaign" ? sdk.Campaign : sdk.AdSet;
  const res = await new Klass(entityId).read([
    Klass.Fields.daily_budget,
    Klass.Fields.lifetime_budget,
  ]);
  const data = (res && res._data) || res || {};
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  };
  return {
    dailyBudget: toInt(data.daily_budget),
    lifetimeBudget: toInt(data.lifetime_budget),
  };
}

async function writeBudget({ level, entityId, newBudget }) {
  const sdk = bizSdk();
  const Klass = level === "campaign" ? sdk.Campaign : sdk.AdSet;
  await new Klass(entityId).update([Klass.Fields.daily_budget], {
    [Klass.Fields.daily_budget]: newBudget,
  });
}

/**
 * Budget movement already applied to this entity inside the cumulative
 * window, as the oldest `prev_budget` we can compare today's budget against.
 * Memoised per entity for the cycle — two rules targeting the same ad set
 * must not each get a fresh (and by then stale) reading.
 */
async function oldestBudgetInWindow({ acctKey, entityId, windowDays, memo }) {
  const key = String(entityId);
  if (memo.has(key)) return memo.get(key);
  let oldest = null;
  try {
    const rows = await scaleHistoryFor({
      adAccountId: acctKey,
      entityId: key,
      sinceDays: windowDays,
    });
    if (rows && rows.length) {
      const p = rows[0].actionPayload || {};
      oldest = Number.isFinite(Number(p.prev_budget))
        ? Number(p.prev_budget)
        : null;
    }
  } catch (err) {
    // Unknown history — treating it as "no movement yet" would grant full
    // headroom, so signal the caller to skip instead.
    getLogger().warn(
      `[autopilot v4] scale: 7d history read failed ${entityId}: ${err.message}`,
    );
    memo.set(key, undefined); // undefined = unknown, distinct from null
    return undefined;
  }
  memo.set(key, oldest);
  return oldest;
}

async function applyScale({
  rule,
  target,
  entities,
  acctKey,
  acctName,
  finalDryRun,
  runId,
  userId,
  scaleContext,
}) {
  if (!scaleContext) return;
  const logger = getLogger();
  const c = scaleContext.counters;
  const { policy, budget, deltaUp, deltaDown } = scaleContext;

  c.findings_count += 1;

  const resolved = resolveScaleTarget(rule, target, entities);
  if (!resolved || !resolved.entityId) {
    c.skipped += 1;
    return;
  }
  const { level, entityId, entityName, entity, triggeringAd } = resolved;

  // Scaling a paused entity spends nothing and helps nobody.
  if (entity && (entity.status || "").toUpperCase() === "PAUSED") {
    c.skipped += 1;
    return;
  }

  // Per-cycle action budget. Logged once per account so the user learns the
  // cycle hit its ceiling, without a row per remaining candidate.
  if (!budget.canSpend("scale")) {
    c.skipped += 1;
    if (!scaleContext.budgetExhaustedLogged) {
      scaleContext.budgetExhaustedLogged = true;
      await writeScaleLogRow({
        runId,
        userId,
        acctKey,
        acctName,
        rule,
        entity: entity || target,
        level,
        entityId,
        entityName,
        outcome: "skipped",
        skipReason: "action-budget-exhausted",
        actionPayload: {
          limit: budget.limits.scale,
          detail: `Autopilot already made ${budget.limits.scale} budget changes on this account this cycle and stopped for the hour.`,
        },
        dryRun: finalDryRun,
      });
    }
    return;
  }

  let budgets;
  try {
    budgets = await readBudget({ level, entityId });
  } catch (err) {
    c.failed += 1;
    logger.error(
      `[autopilot v4] scale: budget read failed ${level}=${entityId}: ${formatMetaError(err)}`,
    );
    return;
  }

  if (!budgets.dailyBudget) {
    c.skipped += 1;
    const isLifetime = budgets.lifetimeBudget > 0;
    await writeScaleLogRow({
      runId,
      userId,
      acctKey,
      acctName,
      rule,
      entity: entity || target,
      level,
      entityId,
      entityName,
      outcome: "skipped",
      skipReason: isLifetime ? "lifetime-budget" : "no-budget-on-entity",
      actionPayload: {
        lifetime_budget: budgets.lifetimeBudget || undefined,
        detail: isLifetime
          ? "This uses a lifetime budget. Autopilot only adjusts daily budgets."
          : "No budget on this entity — its campaign most likely uses campaign budget optimisation. Point the rule at the campaign instead.",
      },
      dryRun: finalDryRun,
    });
    return;
  }

  const oldestPrev = await oldestBudgetInWindow({
    acctKey,
    entityId,
    windowDays: policy.cumulativeWindowDays,
    memo: scaleContext.priorByEntity,
  });
  if (oldestPrev === undefined) {
    // History unreadable — refuse rather than assume full headroom.
    c.skipped += 1;
    return;
  }

  const ratioSoFar = cumulativeRatio(budgets.dailyBudget, oldestPrev);
  const step = computeStep({
    pctStep: rule.action.pct,
    ratioSoFar,
    maxRatio7d: policy.maxRatio7d,
    minRatio7d: policy.minRatio7d,
  });
  if (!step.allowed) {
    c.skipped += 1;
    await writeScaleLogRow({
      runId,
      userId,
      acctKey,
      acctName,
      rule,
      entity: entity || target,
      level,
      entityId,
      entityName,
      outcome: "skipped",
      skipReason: step.reason,
      actionPayload: {
        prev_budget: budgets.dailyBudget,
        cumulative_ratio_7d: ratioSoFar,
        max_ratio_7d: policy.maxRatio7d,
        min_ratio_7d: policy.minRatio7d,
        detail:
          step.reason === "cap-reached-up"
            ? `Budget is already ${ratioSoFar.toFixed(2)}x its level ${policy.cumulativeWindowDays} days ago — at the ceiling.`
            : `Budget is already down to ${ratioSoFar.toFixed(2)}x its level ${policy.cumulativeWindowDays} days ago — at the floor.`,
      },
      dryRun: finalDryRun,
    });
    return;
  }

  const newBudget = scaledBudget(budgets.dailyBudget, step.pctStep);
  const pendingDelta = newBudget - budgets.dailyBudget;
  const goingUp = pendingDelta > 0;

  const acct = withinAccountCap({
    accumulatedDelta: goingUp ? deltaUp.value : deltaDown.value,
    pendingDelta,
    accountCapAbsolute: scaleContext.accountCap,
  });
  if (!acct.allowed) {
    c.skipped += 1;
    await writeScaleLogRow({
      runId,
      userId,
      acctKey,
      acctName,
      rule,
      entity: entity || target,
      level,
      entityId,
      entityName,
      outcome: "skipped",
      skipReason: goingUp ? "account-cap-up" : "account-cap-down",
      actionPayload: {
        prev_budget: budgets.dailyBudget,
        would_be_budget: newBudget,
        pending_delta: pendingDelta,
        account_cap: scaleContext.accountCap,
        detail: `This cycle has already moved the account's daily budget as far ${goingUp ? "up" : "down"} as it may.`,
      },
      dryRun: finalDryRun,
    });
    return;
  }

  budget.spend("scale");

  const attemptStart = Date.now();
  let outcome = "success";
  let error = null;
  if (!finalDryRun) {
    try {
      await writeBudget({ level, entityId, newBudget });
    } catch (err) {
      outcome = "failed";
      error = formatMetaError(err);
      logger.error(
        `[autopilot v4] scale failed rule=${rule._id} ${level}=${entityId}: ${error}`,
      );
    }
  }

  if (outcome === "success") {
    // Only a committed change moves the cycle's running totals; a failed
    // write moved nothing, so it must not consume account headroom.
    if (goingUp) deltaUp.value += Math.abs(pendingDelta);
    else deltaDown.value += Math.abs(pendingDelta);
    if (finalDryRun) c.would_scale += 1;
    else c.scaled += 1;
  } else {
    c.failed += 1;
  }

  await writeScaleLogRow({
    runId,
    userId,
    acctKey,
    acctName,
    rule,
    entity: entity || target,
    level,
    entityId,
    entityName,
    outcome,
    error,
    actionPayload: {
      prev_budget: budgets.dailyBudget,
      new_budget: newBudget,
      pct_change: step.pctStep,
      requested_pct: rule.action.pct,
      cumulative_ratio_7d: ratioSoFar,
      ...(triggeringAd && triggeringAd.ad_id ? { triggering_ad: triggeringAd } : {}),
    },
    dryRun: finalDryRun,
    metaLatencyMs: Date.now() - attemptStart,
  });
}

// Scale rows carry `action: 'scale_budget'` — already in the action-log enum
// and already rendered by the Action Log UI as "Budget +". Kept separate from
// writeActionLogRow because that one derives its action from
// `rule.action.type`, which for a scale rule is 'scale', not 'scale_budget'.
async function writeScaleLogRow({
  runId,
  userId,
  acctKey,
  acctName,
  rule,
  entity,
  level,
  entityId,
  entityName,
  outcome,
  skipReason,
  error,
  actionPayload,
  dryRun,
  metaLatencyMs,
}) {
  try {
    const e = entity || {};
    const isAdset = level === "adset";
    await AutopilotActionLog.create({
      runId,
      userId,
      adAccountId: acctKey,
      adAccountName: acctName,
      level,
      entityId: String(entityId),
      entityName: entityName || e[`${level}_name`] || e.name || undefined,
      campaignId: isAdset ? e.campaign_id || undefined : undefined,
      campaignName: isAdset ? e.campaign_name || undefined : undefined,
      ruleId: String(rule._id),
      ruleSeverity: rule.severity,
      ruleMessage: rule.name,
      metricsSnapshot: pickMetricsSnapshot(e),
      action: "scale_budget",
      actionPayload,
      dryRun,
      outcome,
      skipReason: skipReason || undefined,
      error: error || undefined,
      metaApiLatencyMs: metaLatencyMs,
      runAt: new Date(),
      pausedBy: "autopilot",
    });
  } catch (logErr) {
    getLogger().error(
      `[autopilot v4] scale log write failed runId=${runId}: ${logErr.message}`,
    );
  }
}

// ─── resume: reverse Autopilot's own pauses ────────────────────────────────
//
// Autopilot only ever un-pauses entities IT paused for real (`pausedBy:
// 'autopilot'`, `outcome: 'success'`, `dryRun: false`). A human-paused entity
// is never touched, and neither is one a human has edited since — see the
// manual-intervention guard below.
//
// RESUME IS A RETRIAL, NOT RECOVERY DETECTION. Read this before changing it.
//
// You cannot detect that a paused entity recovered. Pausing removes the very
// delivery that would produce the metrics a rule reads, so every candidate
// predicate reduces to the same thing: the pause-time evidence rolled out of
// the window. `spend > X` stops matching because the entity is OFF, not
// because it improved.
//
// So this is modelled honestly as a trial, and each part has a job:
//
//   - The trigger is `evaluateRule` no longer matching. That is a real check
//     while pause-time evidence is still inside the window — it stops us
//     resuming something that is visibly still bad. Once the evidence ages
//     out it degrades into a timer, which is exactly what a retrial is.
//   - One TRIAL CYCLE is the rule's own lookback: that is how long the
//     pause-time evidence takes to cycle out.
//   - The STRIKE WINDOW must therefore span at least two trial cycles, or
//     `countFlaps` sees at most one transition and the brake is decorative.
//     Hence flapDays scales off the lookback; the env var is only a floor.
//   - After `flapStrikes` trials the entity is RETIRED: it stays paused, and
//     we write that down ONCE so it stops being invisible. Without that row
//     a permanently-paused entity silently disappears from the log.
//
// Runs per lookback group so each rule is re-evaluated against the same
// window it was paused on.
async function resumeAtAccount({
  rules,
  effectiveLookback,
  actionBudget,
  acctKey,
  acctName,
  entities,
  finalDryRun,
  runId,
  userId,
  resumeCounters,
  managedCampaignIds = null,
}) {
  const logger = getLogger();

  const flapStrikes = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_FLAP_COOLDOWN_STRIKES || "3", 10) || 3,
  );
  // The env value is a FLOOR, not the window — see the note above. The window
  // has to cover two trial cycles, and a cycle is this group's lookback. The
  // 'maximum' preset has no rolling window (lifetime evidence never ages
  // out), so there is nothing to scale against and the floor stands.
  const trialCycleDays = Number.isFinite(Number(effectiveLookback))
    ? Number(effectiveLookback)
    : 0;
  const flapDays = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_FLAP_COOLDOWN_DAYS || "7", 10) || 7,
    trialCycleDays * 2,
  );
  const lookbackDays = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_AUTO_RESUME_LOOKBACK_DAYS || "30", 10) || 30,
  );

  // Only rules that OPTED IN. Reversal is per-rule because rules differ in
  // whether their cause can resolve on its own: "spent a lot, zero installs"
  // deserves another trial once the evidence ages out; "ad was disapproved"
  // is a policy state that waiting does not fix, and retrying just earns
  // another disapproval. Filtering here (rather than per candidate) also
  // means an account whose rules all opted out costs zero database work.
  const ruleById = new Map(
    rules.filter((r) => r.autoResume === true).map((r) => [String(r._id), r]),
  );
  if (!ruleById.size || !entities) return;

  // Log the budget ceiling once per account per cycle, not per candidate.
  const resumeBudgetLogged = { value: false };

  // Distinct entities these rules really paused inside the lookback window.
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  let pausedRows = [];
  try {
    pausedRows = await autopilotPausesFor({
      userId,
      adAccountId: acctKey,
      ruleIds: Array.from(ruleById.keys()),
      sinceDays: lookbackDays,
    });
  } catch (err) {
    logger.error(
      `[autopilot v4] resume: paused-entity lookup failed acct=${acctKey}: ${err.message}`,
    );
    return;
  }

  for (const row of pausedRows) {
    const level = row._id.level;
    const entityId = row._id.entityId;
    const rule = ruleById.get(String(row.ruleId));

    // Rule deleted or switched off since the pause. Autopilot stops acting
    // rather than guessing — the entity stays paused for a human to decide.
    if (!rule || rule.enabled === false) continue;

    // Plan gate, same as the pause side. A campaign that lost its managed
    // slot is not automated in either direction; leaving it paused is the
    // safe half of that.
    const campaignId = row.campaignId || entityId;
    if (managedCampaignIds && !managedCampaignIds.has(String(campaignId))) {
      continue;
    }

    // Find the entity in the freshly-fetched window.
    const pool =
      level === "campaign"
        ? entities.campaigns
        : level === "adset"
          ? entities.adsets
          : entities.ads;
    const entity = (pool || []).find(
      (e) => String(e[`${level}_id`] || e.id) === String(entityId),
    );
    // No row this window — deleted, archived, or delivering nothing. Skip
    // silently; re-evaluating against absent data would resume on a
    // technicality.
    if (!entity) continue;

    // Someone already brought it back. Nothing to do, and no row — this
    // would otherwise repeat every hour (same reasoning as the pause side's
    // already-PAUSED guard).
    if ((entity.status || "").toUpperCase() !== "PAUSED") continue;

    // Still matching → stay paused. Counted, not logged: an unchanged
    // verdict every hour is noise, not information.
    if (evaluateRule(rule, entity)) {
      resumeCounters.skipped += 1;
      continue;
    }

    // Flap cooldown. Counts pause↔resume transitions this entity has been
    // through recently; past the strike limit Autopilot stands down and
    // leaves it to a human.
    let flaps = 0;
    try {
      const history = await flapHistoryFor({
        adAccountId: acctKey,
        entityId,
        sinceDays: flapDays,
      });
      flaps = countFlaps(history);
    } catch (err) {
      // Can't prove it's stable — treat as unsafe and leave it paused.
      logger.warn(
        `[autopilot v4] resume: flap history read failed ${level}=${entityId}: ${err.message}`,
      );
      resumeCounters.skipped += 1;
      continue;
    }
    if (flaps >= flapStrikes) {
      resumeCounters.skipped += 1;
      // Out of trials — the entity is retired: it stays paused until a human
      // decides otherwise. Record that ONCE per pause so the UI can surface
      // "Autopilot stopped retrying this" instead of the entity silently
      // vanishing from the log. Re-writing it hourly would be the same noise
      // the other silent skips exist to avoid.
      let alreadyRecorded = false;
      try {
        alreadyRecorded = await retirementRecorded({
          adAccountId: acctKey,
          entityId,
          ruleId: String(rule._id),
          skipReason: RETIRED_SKIP_REASON,
          since: row.lastPausedAt,
        });
      } catch (err) {
        // Can't prove we haven't already written it — stay silent rather
        // than risk an hourly duplicate.
        logger.warn(
          `[autopilot v4] resume: retire-check failed ${level}=${entityId}: ${err.message}`,
        );
        continue;
      }
      if (!alreadyRecorded) {
        await writeResumeLogRow({
          runId,
          userId,
          acctKey,
          acctName,
          rule,
          entity,
          level,
          entityId,
          entityName: row.entityName,
          outcome: "skipped",
          skipReason: RETIRED_SKIP_REASON,
          actionPayload: {
            priorPausedAt: row.lastPausedAt,
            flapsInWindow: flaps,
            strikeLimit: flapStrikes,
            windowDays: flapDays,
            detail:
              `Paused and retried ${flaps} times in ${flapDays} days — ` +
              `Autopilot has stopped retrying and will leave this paused.`,
          },
          dryRun: finalDryRun,
        });
      }
      continue;
    }

    // Per-cycle action budget. Checked here — after every cheap skip, before
    // the first Meta read — so a run of skips can't exhaust it and an
    // exhausted budget costs no API calls. This is what stops the very first
    // tick after deploy from resuming a 30-day backlog all at once.
    if (actionBudget && !actionBudget.canSpend("resume")) {
      resumeCounters.skipped += 1;
      if (!resumeBudgetLogged.value) {
        resumeBudgetLogged.value = true;
        getLogger().info(
          `[autopilot v4] resume: per-cycle budget of ${actionBudget.limits.resume} reached for ${acctKey} — remaining candidates roll to the next tick`,
        );
      }
      continue;
    }

    // Manual-intervention guard — if Meta's `updated_time` is newer than our
    // pause, a human has been in here. Autopilot reverses its own actions,
    // not theirs.
    let entityMeta = null;
    try {
      entityMeta = await getEntityMeta({ level, entityId });
    } catch (err) {
      logger.warn(
        `[autopilot v4] resume: updated_time read failed ${level}=${entityId}: ${err.message}`,
      );
    }
    const manualCheck = detectManualIntervention(
      entityMeta && entityMeta.updated_time,
      row.lastPausedAt,
    );
    if (manualCheck.intervened) {
      resumeCounters.skipped += 1;
      // Worth one row: "you touched this, we stood down" is a one-time
      // event a user should be able to find in the log.
      await writeResumeLogRow({
        runId,
        userId,
        acctKey,
        acctName,
        rule,
        entity,
        level,
        entityId,
        entityName: row.entityName,
        outcome: "skipped",
        skipReason: "manual-intervention",
        actionPayload: {
          priorPausedAt: row.lastPausedAt,
          entityUpdatedTime: entityMeta && entityMeta.updated_time,
          entityEffectiveStatus: entityMeta && entityMeta.effective_status,
          detail: manualCheck.reason,
        },
        dryRun: finalDryRun,
      });
      continue;
    }

    if (actionBudget) actionBudget.spend("resume");

    const attemptStart = Date.now();
    let outcome = "success";
    let error = null;
    if (!finalDryRun) {
      try {
        await resumeEntity({ level, entityId });
      } catch (err) {
        outcome = "failed";
        error = formatMetaError(err);
        logger.error(
          `[autopilot v4] resume failed rule=${rule._id} ${level}=${entityId}: ${error}`,
        );
      }
    }

    if (outcome === "success") {
      if (finalDryRun) resumeCounters.would_resume += 1;
      else resumeCounters.resumed += 1;
    } else {
      resumeCounters.failed += 1;
    }

    await writeResumeLogRow({
      runId,
      userId,
      acctKey,
      acctName,
      rule,
      entity,
      level,
      entityId,
      entityName: row.entityName,
      outcome,
      error,
      actionPayload: {
        priorPausedAt: row.lastPausedAt,
        flapsInWindow: flaps,
      },
      dryRun: finalDryRun,
      metaLatencyMs: Date.now() - attemptStart,
    });
  }
}

// Resume rows carry `action: 'resume'` and the rule that caused the original
// pause, so the log reads as a matched pair. Kept separate from
// writeActionLogRow because that one derives its action from `rule.action.type`
// — which for a resume is still 'pause'.
async function writeResumeLogRow({
  runId,
  userId,
  acctKey,
  acctName,
  rule,
  entity,
  level,
  entityId,
  entityName,
  outcome,
  skipReason,
  error,
  actionPayload,
  dryRun,
  metaLatencyMs,
}) {
  try {
    const isAdLevel = level === "ad";
    const isAdsetLevel = level === "adset";
    await AutopilotActionLog.create({
      runId,
      userId,
      adAccountId: acctKey,
      adAccountName: acctName,
      level,
      entityId,
      entityName:
        entityName || entity[`${level}_name`] || entity.name || undefined,
      campaignId:
        isAdLevel || isAdsetLevel ? entity.campaign_id || undefined : undefined,
      campaignName:
        isAdLevel || isAdsetLevel
          ? entity.campaign_name || undefined
          : undefined,
      adsetId: isAdLevel ? entity.adset_id || undefined : undefined,
      adsetName: isAdLevel ? entity.adset_name || undefined : undefined,
      ruleId: String(rule._id),
      ruleSeverity: rule.severity,
      ruleMessage: rule.name,
      metricsSnapshot: pickMetricsSnapshot(entity),
      action: "resume",
      actionPayload,
      dryRun,
      outcome,
      skipReason: skipReason || undefined,
      error: error || undefined,
      metaApiLatencyMs: metaLatencyMs,
      runAt: new Date(),
      pausedBy: "autopilot",
    });
  } catch (logErr) {
    getLogger().error(
      `[autopilot v4] resume log write failed runId=${runId}: ${logErr.message}`,
    );
  }
}

// ─── public entry ──────────────────────────────────────────────────────────
async function runUserRuleCycle({
  dryRun = false,
  force = false,
  userIds,
} = {}) {
  const logger = getLogger();
  const runId = randomUUID();

  if (!force) {
    const got = await acquireLock(runId);
    if (!got) {
      logger.info(`[autopilot v4] skipped — lock held`);
      return {
        runId,
        skipped: true,
        reason: "lock-held",
        durationMs: 0,
        accounts: [],
      };
    }
  }

  const startedAt = Date.now();
  const summaries = [];

  try {
    // 1. Find enabled rules (optionally scoped to userIds).
    const ruleQuery = { enabled: true };
    if (Array.isArray(userIds) && userIds.length > 0) {
      ruleQuery.userId = { $in: userIds };
    }
    const allRules = await AutopilotUserRule.find(ruleQuery).lean();

    if (allRules.length === 0) {
      logger.info(`[autopilot v4] no enabled rules — nothing to do`);
    } else {
      logger.info(
        `[autopilot v4] start runId=${runId} rules=${allRules.length} dryRun=${dryRun}`,
      );
    }

    // 2. Group by user → account.
    const grouped = groupRulesByUserAndAccount(allRules);

    // 3. Iterate.
    for (const [userId, byAccount] of grouped.entries()) {
      // Per-user settings gate. The orchestrator must respect the user's
      // master toggle and dry-run preference even if their rules are
      // enabled — `enabled: false` on the settings doc means "Autopilot
      // is paused for me, don't act on any of my rules this cycle."
      // Missing settings doc = legacy user (never visited Settings); we
      // proceed with defaults so they aren't silently locked out.
      let userSettings = null;
      try {
        userSettings = await AutopilotSettings.findOne(
          { userId },
          {
            enabled: 1,
            dryRunGlobal: 1,
            autoResumeEnabled: 1,
          },
        ).lean();
      } catch (err) {
        logger.warn(
          `[autopilot v4] userId=${userId} settings lookup failed: ${err.message} — proceeding with defaults`,
        );
      }
      if (userSettings && userSettings.enabled === false) {
        logger.info(
          `[autopilot v4] userId=${userId} disabled in settings — skipped`,
        );
        continue;
      }

      // Plan gate: on a capped plan, only campaigns holding a slot may be
      // automated. Attaching an unmanaged campaign is already refused at the
      // API (autopilotUserRuleController), but a rule attached BEFORE a
      // downgrade — or to a campaign the user has since released — would
      // otherwise keep running. Resolved once per user per run.
      // `null` = uncapped plan, every attachment allowed.
      let managedCampaignIds = null;
      try {
        const {
          getCampaignLimit,
          listManagedCampaignIds,
        } = require("../managedCampaigns");
        if ((await getCampaignLimit(userId)) !== null) {
          managedCampaignIds = await listManagedCampaignIds(userId);
        }
      } catch (err) {
        // Fail open — an unautomated campaign is a worse outcome than a
        // briefly-unenforced plan limit.
        logger.warn(
          `[autopilot v4] userId=${userId} managed-campaign lookup failed: ${err.message} — proceeding unrestricted`,
        );
      }

      // Token resolution — same per-user OAuth model as v3.
      let fbUser = await FBUsers.findOne({ userId }).lean();
      let fbUsers = fbUser ? [fbUser] : [];
      if (typeof FBUsers.find === "function") {
        fbUsers = await FBUsers.find({ userId }).lean();
        fbUsers.sort(
          (a, b) =>
            new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime(),
        );
        fbUser = fbUsers[0] || null;
      }
      if (!fbUser || fbUsers.length === 0) {
        logger.warn(
          `[autopilot v4] userId=${userId} has no FacebookUsers row or empty token — skipped`,
        );
        continue;
      }
      // Pick the newest connection that is both unexpired and decryptable.
      // A broken newest connection must not suppress older valid identities.
      let accessToken;
      for (const candidate of fbUsers) {
        if (
          !candidate.accessToken ||
          (candidate.tokenExpiresAt && candidate.tokenExpiresAt < new Date())
        ) {
          continue;
        }
        try {
          const candidateToken = decrypt(candidate.accessToken);
          if (candidateToken) {
            fbUser = candidate;
            accessToken = candidateToken;
            break;
          }
        } catch {
          // Try the next connected identity.
        }
      }
      if (!accessToken) {
        logger.warn(
          `[autopilot v4] userId=${userId} has no unexpired, decryptable Facebook token — skipped`,
        );
        continue;
      }

      const accessTokensByAccount = new Map();
      const requiresAccountResolution = fbUsers.length > 1;
      if (requiresAccountResolution) {
        for (const connection of fbUsers) {
          if (
            connection.tokenExpiresAt &&
            connection.tokenExpiresAt < new Date()
          ) {
            continue;
          }
          let connectionToken;
          try {
            connectionToken = decrypt(connection.accessToken);
          } catch {
            continue;
          }
          if (!connectionToken) continue;
          const visibleAccounts = await listUserAdAccounts({
            userId,
            facebookId: connection.facebookId,
            accessToken: connectionToken,
          });
          for (const account of visibleAccounts) {
            const key = normalizeAdAccountId(account.id);
            if (!accessTokensByAccount.has(key)) {
              accessTokensByAccount.set(key, connectionToken);
            }
          }
        }
      }

      for (const [acctKey, rulesAtAccount] of byAccount.entries()) {
        const accountAccessToken = requiresAccountResolution
          ? accessTokensByAccount.get(acctKey)
          : accessToken;
        const acctSummary = {
          adAccountId: acctKey,
          name: null,
          ownerUserId: userId,
          ok: true,
          // v3-shaped sub-rollup so alertService renders unchanged.
          pause: {
            findings_count: 0,
            actionable_count: 0,
            paused: 0,
            would_pause: 0,
            failed: 0,
          },
          // v3 wrapped resume/scale/rotate too. resume always exists so
          // alertService's count rollup doesn't trip on a missing field;
          // `scale` is attached lazily below, only when a rule at this
          // account actually scales — alertService renders that block
          // conditionally, and an unconditional `scaled=0` would be noise
          // for the majority of users who never write a scale rule.
          resume: { resumed: 0, would_resume: 0, skipped: 0, failed: 0 },
        };

        // One action budget per account per cycle, shared by scale and
        // resume. See actionBudget.js — resume in particular needs this to
        // survive its first tick against an account with weeks of pauses.
        const actionBudget = createActionBudget();
        // Attached on first sight of a scale rule at this account.
        let scaleContext = null;
        // Quick aliases the per-rule loop writes into.
        const counters = acctSummary.pause;
        const proxyCounters = {
          get findings_count() {
            return counters.findings_count;
          },
          set findings_count(v) {
            counters.findings_count = v;
          },
          get actionable_count() {
            return counters.actionable_count;
          },
          set actionable_count(v) {
            counters.actionable_count = v;
          },
          get paused() {
            return counters.paused;
          },
          set paused(v) {
            counters.paused = v;
          },
          get would_pause() {
            return counters.would_pause;
          },
          set would_pause(v) {
            counters.would_pause = v;
          },
          get failed() {
            return counters.failed;
          },
          set failed(v) {
            counters.failed = v;
          },
        };

        try {
          if (!accountAccessToken) {
            throw new Error(
              `No connected Facebook account can access ${acctKey}`,
            );
          }

          // One cheap call (a single field on the account node) buys the
          // account's BUC meters. Logged every tick so the numbers behind a
          // throttle are visible instead of inferred — `total_cputime` is
          // usually the one that bites, and it is invisible in the App
          // Dashboard.
          const usage = await probeAccountUsage({
            adAccountId: acctKey,
            accessToken: accountAccessToken,
          });
          acctSummary.rateLimit = usage || undefined;
          logger.info(
            `[autopilot v4] ${acctKey} rate-limit ${formatUsage(usage)}`,
          );
          // Defer only when Meta says we are ALREADY blocked. Running then is
          // a guaranteed failure that still costs the calls, so skipping is
          // strictly cheaper and loses nothing — the next tick retries.
          // Threshold-based deferral is deliberately not wired yet: it needs
          // real numbers from the logging above to be set responsibly.
          const deferral = shouldDefer(usage, Number.POSITIVE_INFINITY);
          if (deferral.defer) {
            acctSummary.ok = false;
            acctSummary.error = `Skipped — ${deferral.reason}`;
            logger.warn(
              `[autopilot v4] ${acctKey} deferred: ${deferral.reason}`,
            );
            summaries.push(acctSummary);
            continue;
          }
          // Group this account's rules by lookbackDays. Rules sharing the
          // same window share a single Meta fetch — keeps insights API
          // cost bounded by the number of *distinct* windows in play, not
          // the number of rules. Most users will have all rules at the
          // default (14d), so this is usually one fetch per account.
          // Resolve each rule's effective lookback. A rule with
          // `lookbackPreset: 'this_month'` resolves to "days since the 1st
          // of the current month" (1 on the 1st, growing through the
          // month) — computed fresh every cron tick so the window walks
          // calendar-correctly. Numeric `lookbackDays` rules use that
          // number directly. Group by the resolved value so two rules
          // landing on the same effective window still share one Meta
          // fetch.
          const byLookback = new Map();
          for (const r of rulesAtAccount) {
            const lb = resolveEffectiveLookback(r);
            if (!byLookback.has(lb)) byLookback.set(lb, []);
            byLookback.get(lb).push(r);
          }
         
          // Safety gate, three layers of override (most-conservative wins):
          //   1. Caller-supplied `dryRun` (from cron env or HTTP request).
          //   2. User's saved `settings.dryRunGlobal` — if true, force dry-run
          //      even when the cron asks for live writes.
          //   3. Global `effectiveDryRun()` — env-level kill switch from
          //      AUTOPILOT_LIVE_ACTIONS_ALLOWED + autopilotConfig pin map.
          const userPrefersDryRun =
            !!(userSettings && userSettings.dryRunGlobal);
          const gated = effectiveDryRun({
            adAccountId: acctKey,
            requestedDryRun: dryRun || userPrefersDryRun,
          });
          const finalDryRun = gated.dryRun;

          for (const [
            effectiveLookback,
            rulesAtLookback,
          ] of byLookback.entries()) {
            // Scope the Meta fetch to ONLY the campaigns these rules are
            // attached to (for this account). Without this, runAuditForAccount
            // pulls the whole account's insights — which trips Meta's
            // "Please reduce the amount of data" ceiling on large accounts,
            // even though we only ever evaluate the attached campaigns.
            const campaignIds = Array.from(
              new Set(
                rulesAtLookback.flatMap((r) =>
                  (r.attachments || [])
                    .filter(
                      (a) => normalizeAdAccountId(a.adAccountId) === acctKey,
                    )
                    .map((a) => String(a.campaignId))
                    .filter(Boolean),
                ),
              ),
            );

            // Re-use the existing fetch+normalize pipeline per lookback
            // window. Guards off so user rules see ALL ads (v4 lets users
            // encode their own spend floors via conditions, no service-
            // level guard needed). prevLookbackDays mirrors the current
            // window so prev_* fields compare apples-to-apples.
            const audit = await runAuditForAccount({
              userId,
              adAccountId: acctKey,
              accessToken: accountAccessToken,
              options: {
                enforceAgeGuard: false,
                enforceSpendFloor: false,
                ...(effectiveLookback === "maximum"
                  ? { lookbackPreset: "maximum" }
                  : {
                      lookbackDays: effectiveLookback,
                      prevLookbackDays: effectiveLookback,
                    }),
                campaignIds,
                // Ask for the 16 fields the normalisers read, not the ~37 the
                // shared list carries. The omitted ones (video breakdowns,
                // action values, outbound clicks, uniques) were fetched and
                // discarded, and they are where the server-side cost lives.
                slimInsights: true,
                // Skip the three previous-period queries unless a rule here
                // actually reads a `prev_*` field.
                needsPrevious: batchNeedsPreviousPeriod(rulesAtLookback),
              },
            });
            // Account name is a constant for the (user, account) — first
            // window's response is fine.
            if (!acctSummary.name) acctSummary.name = audit.account_name;

            // Build the scale context lazily, and only once per account even
            // across lookback groups — the per-cycle deltas and the action
            // budget must span the whole account's cycle, not reset per
            // window. `accountDailyBudget` is pre-aggregated by the audit
            // (minor units), so the account cap costs no extra fetch.
            if (
              !scaleContext &&
              rulesAtLookback.some((r) => r.action && r.action.type === "scale")
            ) {
              const policy = resolveScalePolicy();
              acctSummary.scale = {
                findings_count: 0,
                scaled: 0,
                would_scale: 0,
                skipped: 0,
                failed: 0,
              };
              scaleContext = {
                policy,
                counters: acctSummary.scale,
                budget: actionBudget,
                accountCap: accountCapAbsolute(
                  audit.accountDailyBudget,
                  policy.capAccountPct,
                ),
                // Boxed so applyScale can mutate them by reference.
                deltaUp: { value: 0 },
                deltaDown: { value: 0 },
                priorByEntity: new Map(),
                budgetExhaustedLogged: false,
              };
            }

            for (const rule of rulesAtLookback) {
              await evaluateRuleAtAccount({
                rule,
                acctKey,
                acctName: audit.account_name,
                entities: audit.entities,
                finalDryRun,
                runId,
                userId,
                acctSummary: proxyCounters,
                scaleContext,
                managedCampaignIds,
              });
            }

            // Reverse Autopilot's own pauses whose rule no longer matches.
            // Runs inside the lookback loop so every rule is re-evaluated
            // against the same window it was paused on. Honours the user's
            // `autoResumeEnabled` toggle (default true); a user who wants
            // pause-only turns it off in Settings.
            if (!userSettings || userSettings.autoResumeEnabled !== false) {
              await resumeAtAccount({
                rules: rulesAtLookback,
                effectiveLookback,
                actionBudget,
                acctKey,
                acctName: audit.account_name,
                entities: audit.entities,
                finalDryRun,
                runId,
                userId,
                resumeCounters: acctSummary.resume,
                managedCampaignIds,
              });
            }
          }
        } catch (err) {
          logger.error(
            `[autopilot v4] account ${acctKey} (user ${userId}) failed: ${err.message}`,
          );
          acctSummary.ok = false;
          acctSummary.error = err.message;
        }
        summaries.push(acctSummary);
      }
    }
  } finally {
    if (!force) await releaseLock(runId);
  }

  const durationMs = Date.now() - startedAt;
  getLogger().info(
    `[autopilot v4] end runId=${runId} accounts=${summaries.length} dur=${durationMs}ms`,
  );

  const result = {
    runId,
    dryRun,
    durationMs,
    accounts: summaries,
  };

  // Fire-and-forget alerts. alertService is unchanged — feeds it the same
  // shape as v3 cycles produced, so the per-user fan-out + chip filter
  // works without modification.
  try {
    await notifyAutopilotCycle(result);
  } catch (err) {
    getLogger().warn(
      `[autopilot v4] alert dispatch threw (swallowed): ${err.message}`,
    );
  }

  return result;
}

module.exports = {
  runUserRuleCycle,
  // exported for tests
  _internals: {
    groupRulesByUserAndAccount,
    collectTargetsForRule,
    batchNeedsPreviousPeriod,
    pauseEntity,
    markAttachmentOrphan,
    unmarkAttachmentOrphan,
    writeActionLogRow,
    writeResumeLogRow,
    evaluateRuleAtAccount,
    resumeAtAccount,
    applyScale,
    resolveScaleTarget,
    writeScaleLogRow,
    resolveEffectiveLookback,
    LOCK_KEY,
    LOCK_TTL_SECONDS,
    RETIRED_SKIP_REASON,
  },
};
