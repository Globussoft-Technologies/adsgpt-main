/**
 * autoScaleService — Phase 6.
 *
 * Finds "opportunity/action=scale" findings from the audit engine and
 * increases budgets on those entities (via Meta's daily_budget update)
 * with multiple safety rails:
 *
 *   - AUTOPILOT_SCALE_PCT_PER_RUN        default 20  (per action +20%)
 *   - AUTOPILOT_SCALE_PCT_CAP_7D         default 100 (cumulative +100% in 7d)
 *   - AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN default 10 (hard cap per account)
 *
 * For AUD-34 (ad-level) the parent adset is what's budget-scaled — ads don't
 * have their own budget. The finding's `data.adset_id` (attached by
 * `ruleEvaluator`) is the retarget; the originating ad id is preserved in
 * `actionPayload.triggering_ad` for "we scaled adset X because ad Y won"
 * traceability.
 *
 * Dry-run default. Every attempt writes to autopilotActionLog with
 * action='scale_budget' and actionPayload={prev_budget, new_budget, pct_change}.
 */

const { randomUUID } = require("node:crypto");
const rules = require("../../config/auditRulesConfig");
const { pickMetricsSnapshot } = require("./metricsSnapshot");
const { getEffectiveThresholds } = require("../../config/autopilotConfig");

// Lazy requires — keep module importable without node_modules for tests
let _bizSdk;
let _AutopilotActionLog;
let _runAuditForAccount;
function bizSdk() {
  if (!_bizSdk) _bizSdk = require("facebook-nodejs-business-sdk");
  return _bizSdk;
}
function AutopilotActionLog() {
  if (!_AutopilotActionLog)
    _AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");
  return _AutopilotActionLog;
}
function runAuditForAccount(args) {
  if (!_runAuditForAccount)
    _runAuditForAccount = require("../metaAuditService").runAuditForAccount;
  return _runAuditForAccount(args);
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const SCALE_RULE_IDS = new Set(
  rules.filter((r) => r.action === "scale").map((r) => r.id),
);

// Policy rule (AUD-35) — its defaults document the per-entity 7d budget cap.
// Lookup once at module load; per-account overrides are applied per call
// via getEffectiveThresholds().
const AUD35 = rules.find((r) => r.id === "AUD-35") || null;
const AUD35_DEFAULT_CAP = (AUD35 && AUD35.defaults && AUD35.defaults.cap_7d_pct) || 100;

// Policy rule (AUD-37) — account-level per-cycle scale cap. Mirrors AUD-35
// shape so the per-account override pathway is identical.
const AUD37 = rules.find((r) => r.id === "AUD-37") || null;
const AUD37_DEFAULT_CAP =
  (AUD37 && AUD37.defaults && AUD37.defaults.cap_pct_per_run) || 10;

/**
 * Effective 7d cap %: env wins (legacy back-compat) if set non-empty;
 * otherwise rule defaults with per-account overrides applied (ops-level
 * config + the user's autopilotSettings.perAccountOverrides, the latter
 * passed in by the orchestrator as `userOverrides`).
 */
function resolveCap7dPct(adAccountId, userOverrides) {
  const envRaw = process.env.AUTOPILOT_SCALE_PCT_CAP_7D;
  if (envRaw !== undefined && envRaw !== "") {
    const parsed = parseInt(envRaw, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!AUD35) return AUD35_DEFAULT_CAP;
  const t = getEffectiveThresholds(
    AUD35.defaults,
    "AUD-35",
    adAccountId,
    userOverrides,
  );
  return t.cap_7d_pct || AUD35_DEFAULT_CAP;
}

/**
 * Effective account-level per-cycle cap %: env > caller userOverrides >
 * per-account ops-level pin > AUD-37 default. The cap means "any single
 * Autopilot cycle may not raise total account daily_budget by more than N%."
 */
function resolveCapAccountPctPerRun(adAccountId, userOverrides) {
  const envRaw = process.env.AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN;
  if (envRaw !== undefined && envRaw !== "") {
    const parsed = parseInt(envRaw, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!AUD37) return AUD37_DEFAULT_CAP;
  const t = getEffectiveThresholds(
    AUD37.defaults,
    "AUD-37",
    adAccountId,
    userOverrides,
  );
  return t.cap_pct_per_run || AUD37_DEFAULT_CAP;
}

function isScaleFinding(f) {
  return SCALE_RULE_IDS.has(f.rule_id);
}

/**
 * Given the cumulative % budget change already applied to this entity in the
 * 7d window and the per-run step, return { allowed, pctStep } where allowed
 * is false if we've hit the cap.
 */
function computeStep({ priorCumulativePct, stepPct, cap7dPct }) {
  const headroom = cap7dPct - priorCumulativePct;
  if (headroom <= 0) return { allowed: false, pctStep: 0 };
  return { allowed: true, pctStep: Math.min(stepPct, headroom) };
}

/**
 * Pure helper: is this scale's budget delta within the account-level cap
 * once added to the cycle's running total? Returns { allowed, headroomDelta }.
 *
 * @param {number} accumulatedDelta  delta already applied this cycle, paise
 * @param {number} pendingDelta      delta this scale would add, paise
 * @param {number} accountCapAbsolute absolute cap in paise (computed once)
 */
function withinAccountCap({ accumulatedDelta, pendingDelta, accountCapAbsolute }) {
  if (accountCapAbsolute <= 0) {
    // Cap can be 0 if account has no daily_budget at all (lifetime-only).
    // In that case we can't enforce a meaningful cap; let the per-entity
    // and 7d caps do the heavy lifting.
    return { allowed: true, headroomDelta: Number.POSITIVE_INFINITY };
  }
  const projected = accumulatedDelta + pendingDelta;
  if (projected > accountCapAbsolute) {
    return { allowed: false, headroomDelta: accountCapAbsolute - accumulatedDelta };
  }
  return { allowed: true, headroomDelta: accountCapAbsolute - projected };
}

// ---------------------------------------------------------------------------
// Meta write
// ---------------------------------------------------------------------------

/**
 * Build SDK object + field constants for a level. Internal helper.
 */
function _entityHandle(level, entityId) {
  const sdk = bizSdk();
  if (level === "campaign") {
    return { obj: new sdk.Campaign(entityId), Fields: sdk.Campaign.Fields };
  }
  if (level === "adset") {
    return { obj: new sdk.AdSet(entityId), Fields: sdk.AdSet.Fields };
  }
  throw new Error(`level must be campaign or adset (got ${level})`);
}

/**
 * Read current daily_budget without writing. Used by the cap-check pass so
 * we know the delta before deciding to commit.
 *
 * Throws if the entity has no daily_budget (lifetime-budget-only entities
 * are unscalable via this code path; refusal makes the failure visible
 * upstream rather than silently returning 0).
 */
async function readEntityBudget({ level, entityId }) {
  const { obj, Fields } = _entityHandle(level, entityId);
  const current = await obj.read([Fields.daily_budget, Fields.lifetime_budget]);
  const prevBudget = parseInt(current._data.daily_budget || "0", 10);
  if (!prevBudget) {
    throw new Error(
      `${level} ${entityId} has no daily_budget (uses lifetime_budget or none); refusing to scale`,
    );
  }
  return { prevBudget };
}

/**
 * Write a new daily_budget. Caller owns the math.
 */
async function writeEntityBudget({ level, entityId, newBudget }) {
  const { obj, Fields } = _entityHandle(level, entityId);
  await obj.update([Fields.daily_budget], {
    [Fields.daily_budget]: newBudget,
  });
}

/**
 * Convenience wrapper kept for tests and any caller that wants the old
 * read-and-write behavior in one shot. Internally just composes the two.
 */
async function scaleBudget({ level, entityId, pctStep }) {
  const { prevBudget } = await readEntityBudget({ level, entityId });
  const newBudget = Math.round(prevBudget * (1 + pctStep / 100));
  await writeEntityBudget({ level, entityId, newBudget });
  return { prevBudget, newBudget };
}

// ---------------------------------------------------------------------------
// Public: scale winners for one account
// ---------------------------------------------------------------------------

async function autoScaleForAccount({
  userId,
  adAccountId: rawAdAccountId,
  accessToken,
  dryRun = true,
  runId,
  audit: providedAudit,
  thresholdOverrides,
} = {}) {
  if (!userId) throw new Error("userId is required");
  if (!rawAdAccountId) throw new Error("adAccountId is required");
  if (!accessToken && !providedAudit)
    throw new Error(
      "accessToken is required when no pre-fetched audit is provided",
    );

  // Canonical `act_<id>` shape on entry — see autoPauseService for rationale.
  const {
    normalizeAdAccountId,
  } = require("../../config/autopilotConfig");
  const adAccountId = normalizeAdAccountId(rawAdAccountId);

  const logger = getLogger();
  const finalRunId = runId || randomUUID();
  const started = Date.now();
  const Log = AutopilotActionLog();

  const stepPct = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_SCALE_PCT_PER_RUN || "20", 10) || 20,
  );
  // 7d cumulative cap: AUD-35 policy rule (with per-account overrides), env
  // wins for back compat. Step cannot exceed the cap.
  // `thresholdOverrides` carries the user's autopilotSettings.perAccountOverrides
  // for THIS account (orchestrator-supplied) — folds into the resolveCap*
  // helpers as the user-overrides slot for AUD-35/AUD-37.
  const cap7dPct = Math.max(
    stepPct,
    resolveCap7dPct(adAccountId, thresholdOverrides),
  );
  // Account-level per-cycle cap: AUD-37. Applied as an absolute paise budget
  // computed from the audit's pre-aggregated `accountDailyBudget` so we don't
  // re-fetch.
  const capAccountPctPerRun = resolveCapAccountPctPerRun(
    adAccountId,
    thresholdOverrides,
  );
  const maxPerRun = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN || "10", 10) || 10,
  );

  // Safety gate — same as autoPauseService.
  const { effectiveDryRun } = require("../../config/autopilotConfig");
  const gated = effectiveDryRun({ adAccountId, requestedDryRun: dryRun });
  const finalDryRun = gated.dryRun;
  const safetyOverride = gated.forced;

  logger.info(
    `[autopilot] scale start | runId=${finalRunId} acct=${adAccountId} ` +
      `dryRun=${finalDryRun}${safetyOverride ? " (SAFETY OVERRIDE)" : ""} step=${stepPct}% cap7d=${cap7dPct}% capAcct=${capAccountPctPerRun}%`,
  );

  const audit =
    providedAudit ||
    (await runAuditForAccount({
      userId,
      adAccountId,
      accessToken,
      options: { enforceAgeGuard: true, enforceSpendFloor: true },
    }));

  // Only scale rules; we don't scale on regular opportunity findings.
  const scaleFindings = audit.findings.filter(isScaleFinding);

  // Resolve each finding's *target* entity (campaign/adset findings target
  // themselves; ad findings target their parent adset since ads have no
  // budget). Done once, up front, so the 7d-prior lookup uses the same key
  // the action will eventually write under.
  const findingTargets = scaleFindings.map((f) => {
    if (f.entity_type === "ad") {
      return {
        finding: f,
        targetLevel: "adset",
        targetEntityId: f.data && f.data.adset_id ? f.data.adset_id : null,
        targetEntityName:
          f.data && f.data.adset_name ? f.data.adset_name : f.entity_name,
      };
    }
    return {
      finding: f,
      targetLevel: f.entity_type,
      targetEntityId: f.entity_id,
      targetEntityName: f.entity_name,
    };
  });

  // Compute cumulative pct per-target already applied in the last 7d. Keyed
  // by target entityId, so a previous AUD-32 scale on adset X is counted
  // toward an AUD-34 finding on an ad inside X (its target is also X).
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const priorByEntity = new Map();
  if (findingTargets.length) {
    const targetIds = [
      ...new Set(
        findingTargets.map((t) => t.targetEntityId).filter(Boolean),
      ),
    ];
    if (targetIds.length) {
      const rows = await Log.find(
        {
          adAccountId,
          action: "scale_budget",
          outcome: "success",
          dryRun: false,
          entityId: { $in: targetIds },
          runAt: { $gte: cutoff7d },
        },
        { entityId: 1, actionPayload: 1 },
      ).lean();
      for (const r of rows) {
        const p = r.actionPayload || {};
        const pct = typeof p.pct_change === "number" ? p.pct_change : 0;
        priorByEntity.set(
          r.entityId,
          (priorByEntity.get(r.entityId) || 0) + pct,
        );
      }
    }
  }

  // Account-level cap math. accountDailyBudget is summed by the audit (sum
  // of every campaign + adset daily_budget across the account, paise). When
  // it's 0 (lifetime-only account) the account cap is degenerate and
  // withinAccountCap() short-circuits to allowed=true.
  const accountDailyBudget = (audit && audit.accountDailyBudget) || 0;
  const accountCapAbsolute = Math.floor(
    (accountDailyBudget * capAccountPctPerRun) / 100,
  );
  let cycleAccountDelta = 0;

  const actions = [];
  let scaled = 0;
  let would_scale = 0;
  let failed = 0;
  let skipped = 0;

  // Helper — write a skip row to the action log so the Phase 4 UI can show
  // why a scaling opportunity was passed over. Caught locally so a DB hiccup
  // on one row doesn't abort the run.
  const logSkip = async ({
    ruleId,
    ruleSeverity,
    ruleMessage,
    level,
    entityId,
    entityName,
    metricsSnapshot,
    skipReason,
    actionPayload,
  }) => {
    try {
      await Log.create({
        runId: finalRunId,
        userId,
        adAccountId,
        adAccountName: audit.account_name,
        level,
        entityId,
        entityName,
        ruleId,
        ruleSeverity,
        ruleMessage,
        metricsSnapshot,
        action: "scale_budget",
        actionPayload,
        dryRun: finalDryRun,
        outcome: "skipped",
        skipReason,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] scale skip-log failed (${ruleId}/${entityId}): ${logErr.message}`,
      );
    }
  };

  for (const { finding: f, targetLevel, targetEntityId, targetEntityName } of findingTargets) {
    if (scaled + would_scale >= maxPerRun) {
      skipped += 1;
      const skipReason = "max-per-run-cap";
      actions.push({
        ruleId: f.rule_id,
        level: f.entity_type,
        entityId: f.entity_id,
        entityName: f.entity_name,
        outcome: "skipped",
        skipReason,
      });
      await logSkip({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        level: f.entity_type,
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason,
        actionPayload: { max_per_run: maxPerRun },
      });
      continue;
    }

    // AUD-34 ad findings retarget to the parent adset (ads have no budget).
    // findingTargets already resolved this; if the parent adset_id isn't on
    // the normalised row for some reason, skip with a visible reason rather
    // than guessing.
    if (!targetEntityId) {
      skipped += 1;
      const skipReason = "missing-target-entity-id";
      actions.push({
        ruleId: f.rule_id,
        level: f.entity_type,
        entityId: f.entity_id,
        entityName: f.entity_name,
        outcome: "skipped",
        skipReason,
      });
      await logSkip({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        level: f.entity_type,
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason,
        actionPayload: { reason: "ad finding had no parent adset_id" },
      });
      continue;
    }

    // For AUD-34 retargeted findings, capture the originating ad so the log
    // explains "we scaled adset X because ad Y was the best CTR performer."
    const triggerAd =
      f.entity_type === "ad"
        ? { ad_id: f.entity_id, ad_name: f.entity_name }
        : null;

    const priorPct = priorByEntity.get(targetEntityId) || 0;
    const step = computeStep({
      priorCumulativePct: priorPct,
      stepPct,
      cap7dPct,
    });
    if (!step.allowed) {
      skipped += 1;
      const skipReason = `7d-cap-reached (prior ${priorPct}% vs cap ${cap7dPct}%)`;
      actions.push({
        ruleId: f.rule_id,
        level: targetLevel,
        entityId: targetEntityId,
        entityName: targetEntityName,
        outcome: "skipped",
        skipReason,
      });
      // Stamp the cap-skip with AUD-35 (the policy rule) so it's greppable
      // in the action log; carry the original triggering rule id in the
      // payload for full traceability.
      await logSkip({
        ruleId: "AUD-35",
        ruleSeverity: "opportunity",
        ruleMessage: `7d budget scale cap reached (cap ${cap7dPct}%, prior ${priorPct}%)`,
        level: targetLevel,
        entityId: targetEntityId,
        entityName: targetEntityName,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason,
        actionPayload: {
          cap_7d_pct: cap7dPct,
          prior_7d_cumulative_pct: priorPct,
          triggering_rule_id: f.rule_id,
          ...(triggerAd ? { triggering_ad: triggerAd } : {}),
        },
      });
      continue;
    }

    // Read current budget always (dry-run + live), so the cap check sees the
    // real delta. Read failures abort this entity but don't blow up the run.
    const attemptStart = Date.now();
    let outcome = "success";
    let error = null;
    let prevBudget = null;
    let newBudget = null;
    try {
      const r = await readEntityBudget({
        level: targetLevel,
        entityId: targetEntityId,
      });
      prevBudget = r.prevBudget;
    } catch (err) {
      // E.g. lifetime-budget-only adset, or transient SDK error.
      outcome = "failed";
      error = err && err.message ? err.message : String(err);
      logger.warn(
        `[autopilot] scale read failed | ${targetLevel}=${targetEntityId}: ${error}`,
      );
    }

    // Compute would-be new budget + delta (paise). Only meaningful if the
    // read succeeded.
    let pendingDelta = 0;
    if (prevBudget) {
      newBudget = Math.round(prevBudget * (1 + step.pctStep / 100));
      pendingDelta = newBudget - prevBudget;
    }

    // Account-level cap: would committing this scale exceed the per-cycle
    // budget headroom for the account? Stamp skip with AUD-37.
    if (outcome === "success" && prevBudget) {
      const acctCheck = withinAccountCap({
        accumulatedDelta: cycleAccountDelta,
        pendingDelta,
        accountCapAbsolute,
      });
      if (!acctCheck.allowed) {
        skipped += 1;
        const skipReason = `account-cap-reached (cycle delta would be +${cycleAccountDelta + pendingDelta} paise > cap ${accountCapAbsolute} paise = ${capAccountPctPerRun}% of acct daily ${accountDailyBudget})`;
        actions.push({
          ruleId: f.rule_id,
          level: targetLevel,
          entityId: targetEntityId,
          entityName: targetEntityName,
          outcome: "skipped",
          skipReason,
        });
        await logSkip({
          ruleId: "AUD-37",
          ruleSeverity: "opportunity",
          ruleMessage: `Account-level scale cap reached (cap ${capAccountPctPerRun}% of total daily, ${accountCapAbsolute} paise)`,
          level: targetLevel,
          entityId: targetEntityId,
          entityName: targetEntityName,
          metricsSnapshot: pickMetricsSnapshot(f.data),
          skipReason,
          actionPayload: {
            cap_pct_per_run: capAccountPctPerRun,
            account_daily_budget: accountDailyBudget,
            account_cap_absolute: accountCapAbsolute,
            cycle_accumulated_delta: cycleAccountDelta,
            pending_delta: pendingDelta,
            prev_budget: prevBudget,
            would_be_new_budget: newBudget,
            triggering_rule_id: f.rule_id,
            ...(triggerAd ? { triggering_ad: triggerAd } : {}),
          },
        });
        continue;
      }
    }

    // Commit the write — live only.
    if (outcome === "success" && !finalDryRun && prevBudget) {
      try {
        await writeEntityBudget({
          level: targetLevel,
          entityId: targetEntityId,
          newBudget,
        });
      } catch (err) {
        outcome = "failed";
        error = err && err.message ? err.message : String(err);
        logger.error(
          `[autopilot] scale write failed | ${targetLevel}=${targetEntityId}: ${error}`,
        );
      }
    }

    // Track the delta against the per-cycle account cap. Counts dry-runs too
    // so a dry-run cycle's previewed total stays within bounds — otherwise
    // the dry-run would over-promise what a live run could deliver.
    if (outcome === "success" && prevBudget) {
      cycleAccountDelta += pendingDelta;
    }

    if (outcome === "success") {
      if (finalDryRun) would_scale += 1;
      else scaled += 1;
    } else failed += 1;

    try {
      await Log.create({
        runId: finalRunId,
        userId,
        adAccountId,
        adAccountName: audit.account_name,
        level: targetLevel,
        entityId: targetEntityId,
        entityName: targetEntityName,
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        action: "scale_budget",
        actionPayload: {
          pct_change: step.pctStep,
          prev_budget: prevBudget,
          new_budget: newBudget,
          prior_7d_cumulative_pct: priorPct,
          ...(triggerAd ? { triggering_ad: triggerAd } : {}),
        },
        dryRun: finalDryRun,
        outcome,
        error,
        metaApiLatencyMs: Date.now() - attemptStart,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] scale log write failed: ${logErr.message}`,
      );
    }

    actions.push({
      ruleId: f.rule_id,
      level: targetLevel,
      entityId: targetEntityId,
      entityName: targetEntityName,
      outcome,
      pctStep: step.pctStep,
      prevBudget,
      newBudget,
      ...(triggerAd ? { triggeringAd: triggerAd } : {}),
      ...(error ? { error } : {}),
    });
  }

  const durationMs = Date.now() - started;
  logger.info(
    `[autopilot] scale end | runId=${finalRunId} acct=${adAccountId} ` +
      `findings=${scaleFindings.length} scaled=${scaled} would_scale=${would_scale} ` +
      `skipped=${skipped} failed=${failed} dur=${durationMs}ms`,
  );

  return {
    runId: finalRunId,
    adAccountId,
    accountName: audit.account_name,
    dryRun: finalDryRun,
    findings_count: scaleFindings.length,
    scaled,
    would_scale,
    failed,
    skipped,
    actions,
    durationMs,
  };
}

module.exports = {
  autoScaleForAccount,
  // tests
  computeStep,
  withinAccountCap,
  isScaleFinding,
  resolveCap7dPct,
  resolveCapAccountPctPerRun,
  _internals: {
    scaleBudget,
    readEntityBudget,
    writeEntityBudget,
    SCALE_RULE_IDS,
    AUD35_DEFAULT_CAP,
    AUD37_DEFAULT_CAP,
  },
};
