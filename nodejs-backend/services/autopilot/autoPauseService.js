/**
 * autoPauseService — Phase 2 of the Autopilot roadmap.
 *
 * Closes the loop from `runAuditForAccount` findings to an actual Meta
 * pause call, and writes every attempted action to `autopilotActionLog`.
 *
 * Entry point:
 *   autoPauseForAccount({
 *     userId, adAccountId, accessToken,
 *     dryRun = true, severityFloor = 'critical', runId,
 *   })
 *
 * Contract
 *   - Dry-run is the default. Callers must explicitly opt out.
 *   - Every actionable finding produces a log row, even in dry-run.
 *   - Meta API failures are caught per-finding and logged; one bad entity
 *     does not abort the run.
 *   - Pure helpers (`filterActionable`, `severityAtLeast`) are exported for
 *     unit tests so the engine can be exercised without the Meta SDK.
 */

const { randomUUID } = require("node:crypto");
const { pickMetricsSnapshot } = require("./metricsSnapshot");

// Heavy deps (FB SDK, Mongoose model, audit service) are loaded lazily so the
// pure helpers at the top of the file stay importable in minimal test
// environments that don't ship node_modules.
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
    _runAuditForAccount =
      require("../metaAuditService").runAuditForAccount;
  return _runAuditForAccount(args);
}

// Logger is loaded lazily so pure helpers stay importable without Winston.
let _logger;
function getLogger() {
  if (_logger) return _logger;
  _logger = require("../../utils/logger");
  return _logger;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const SEVERITY_RANK = { critical: 3, warning: 2, opportunity: 1 };

function severityAtLeast(severity, floor) {
  const s = SEVERITY_RANK[severity] || 0;
  const f = SEVERITY_RANK[floor] || 0;
  return s >= f;
}

/**
 * Keep only findings at or above `severityFloor`.
 * Pure; does not mutate the input.
 */
function filterActionable(findings, severityFloor) {
  if (!Array.isArray(findings)) return [];
  return findings.filter((f) => severityAtLeast(f.severity, severityFloor));
}

// Rule ids whose `action` field declares a non-pause action — scale, rotate,
// or policy. autoPauseService should never flip these to PAUSED; they're
// either informational (caps) or owned by a different service (autoScale,
// rotation). Logged as `alert_only` rows so the user still sees them in
// the Action log, but with the correct semantic tag.
let _NON_PAUSE_RULE_IDS = null;
function nonPauseRuleIds() {
  if (_NON_PAUSE_RULE_IDS) return _NON_PAUSE_RULE_IDS;
  // Lazy-load to avoid a require cycle in case auditRulesConfig grows imports.
  const rules = require("../../config/auditRulesConfig");
  _NON_PAUSE_RULE_IDS = new Set(
    rules.filter((r) => r.action).map((r) => r.id),
  );
  return _NON_PAUSE_RULE_IDS;
}

/**
 * Decide what `action` field to write for this finding's log row.
 *
 *   - 'pause'      — critical/warning issue we should flip to PAUSED
 *   - 'alert_only' — opportunity (informational, never paused) OR a rule
 *                    owned by a different service (scale / rotate). The row
 *                    still appears in the Action log for transparency, but
 *                    with the correct semantic tag — no pause attempted.
 *
 * Pure helper, exported for tests.
 */
function classifyFindingAction(finding) {
  if (!finding || !finding.severity) return "alert_only";
  if (finding.severity === "opportunity") return "alert_only";
  if (finding.rule_id && nonPauseRuleIds().has(finding.rule_id))
    return "alert_only";
  return "pause";
}

// ---------------------------------------------------------------------------
// Meta write action — wrapped so the orchestrator can try/catch per-finding
// without knowing SDK internals. Mirrors metaAdLauncher.updateStatus(),
// deliberately not refactored into a shared helper yet to keep Phase 2 scope
// tight; revisit if Phase 5 auto-resume duplicates the logic.
// ---------------------------------------------------------------------------

async function pauseEntity({ level, entityId }) {
  const sdk = bizSdk();
  let obj;
  let StatusField;

  if (level === "campaign") {
    obj = new sdk.Campaign(entityId);
    StatusField = sdk.Campaign.Fields;
  } else if (level === "adset") {
    obj = new sdk.AdSet(entityId);
    StatusField = sdk.AdSet.Fields;
  } else if (level === "ad") {
    obj = new sdk.Ad(entityId);
    StatusField = sdk.Ad.Fields;
  } else {
    throw new Error(`unknown entity level: ${level}`);
  }

  await obj.update([StatusField.status], {
    [StatusField.status]: "PAUSED",
  });
}

// ---------------------------------------------------------------------------
// Public: one-account dry-run or live auto-pause
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.adAccountId    numeric or 'act_…'
 * @param {string} args.accessToken    decrypted Meta token
 * @param {boolean} [args.dryRun=true]
 * @param {'critical'|'warning'|'opportunity'} [args.severityFloor='critical']
 * @param {string} [args.runId]        caller-provided; used when the future
 *                                     scheduler fans out across many accounts
 *                                     and wants every per-account log to share
 *                                     a single runId.
 * @param {Object} [args.audit]        pre-fetched audit result from
 *                                     runAuditForAccount(). When provided we
 *                                     skip the internal fetch — used by the
 *                                     orchestrator to share one audit across
 *                                     pause + resume + scale per cycle (cuts
 *                                     Meta API load 3×). Caller is responsible
 *                                     for keeping this consistent with
 *                                     adAccountId; no defensive check.
 *
 * @returns {Promise<{
 *   runId, adAccountId, accountName, dryRun, severityFloor,
 *   findings_count, actionable_count, paused, would_pause, failed, skipped,
 *   actions: Array<{ruleId, severity, level, entityId, entityName, outcome, error?}>,
 *   durationMs,
 * }>}
 */
async function autoPauseForAccount({
  userId,
  adAccountId: rawAdAccountId,
  accessToken,
  dryRun = true,
  severityFloor = "critical",
  runId,
  audit: providedAudit,
} = {}) {
  if (!userId) throw new Error("userId is required");
  if (!rawAdAccountId) throw new Error("adAccountId is required");
  if (!accessToken && !providedAudit)
    throw new Error("accessToken is required when no pre-fetched audit is provided");

  // Normalize to canonical `act_<id>` shape on entry so log rows have one
  // consistent shape regardless of caller (cron passes `act_*`, the UI's
  // single-account button used to send bare ids — different shapes broke
  // the per-account filter in the Action log).
  const {
    effectiveDryRun,
    normalizeAdAccountId,
  } = require("../../config/autopilotConfig");
  const adAccountId = normalizeAdAccountId(rawAdAccountId);

  const logger = getLogger();
  const finalRunId = runId || randomUUID();
  const started = Date.now();

  // Safety gate. Even if caller passes dryRun=false, if the account isn't
  // explicitly opted-in to live writes, we force dryRun=true.
  const gated = effectiveDryRun({ adAccountId, requestedDryRun: dryRun });
  const finalDryRun = gated.dryRun;
  const safetyOverride = gated.forced;

  logger.info(
    `[autopilot] run start | runId=${finalRunId} acct=${adAccountId} ` +
      `dryRun=${finalDryRun}${safetyOverride ? " (SAFETY OVERRIDE)" : ""} floor=${severityFloor}` +
      `${providedAudit ? " (shared audit)" : ""}`,
  );

  // 1) Run the audit if not provided. Enable age + spend guards so we don't
  //    flag ads still in Meta's learning phase or ads with not enough spend
  //    to judge.
  const audit =
    providedAudit ||
    (await runAuditForAccount({
      userId,
      adAccountId,
      accessToken,
      options: {
        enforceAgeGuard: true,
        enforceSpendFloor: true,
      },
    }));

  // 2) Filter to findings at or above severityFloor.
  const actionable = filterActionable(audit.findings, severityFloor);

  // 3) For each, attempt pause (unless dryRun) and log.
  const actions = [];
  let paused = 0; // live pauses that actually succeeded against Meta
  let would_pause = 0; // would-have-paused (dry-run successes)
  let failed = 0;
  let skipped = 0;

  for (const finding of actionable) {
    const attemptStart = Date.now();
    let outcome = "success";
    let error = null;
    let skipReason = null;
    const findingAction = classifyFindingAction(finding);

    // Several rules (AUD-08, AUD-10, AUD-11, …) don't filter by status, so
    // they keep flagging campaigns we already paused last cycle. Without
    // this guard, autoPauseService would obediently re-pause the same
    // entity every cron tick — Meta accepts the no-op (paused → paused),
    // we log it as a successful action, and the user sees the same
    // campaign get "paused" forever. Trust the audit's fresh `data.status`
    // field rather than re-reading from Meta per finding (cheap + correct).
    const currentStatus = (finding.data?.status || "").toUpperCase();
    const alreadyPaused =
      findingAction === "pause" && currentStatus === "PAUSED";

    if (alreadyPaused) {
      outcome = "skipped";
      skipReason = "already-paused";
    } else if (findingAction === "pause" && !finalDryRun) {
      try {
        await pauseEntity({
          level: finding.entity_type,
          entityId: finding.entity_id,
        });
      } catch (err) {
        outcome = "failed";
        error = err && err.message ? err.message : String(err);
        logger.error(
          `[autopilot] pause failed | runId=${finalRunId} ` +
            `${finding.entity_type}=${finding.entity_id} rule=${finding.rule_id} err=${error}`,
        );
      }
    }

    // Counters track pause-eligible outcomes only. alert_only rows are
    // informational — they shouldn't inflate the "would pause" totals shown
    // in the Action log header / Slack rollup.
    if (findingAction === "pause") {
      if (outcome === "success") {
        if (finalDryRun) would_pause += 1;
        else paused += 1;
      } else if (outcome === "failed") {
        failed += 1;
      } else if (outcome === "skipped") {
        skipped += 1;
      }
    }

    // Log the row. Log errors are caught so a DB hiccup on one row does not
    // abort the rest of the run.
    try {
      await AutopilotActionLog().create({
        runId: finalRunId,
        userId,
        adAccountId,
        adAccountName: audit.account_name,
        level: finding.entity_type,
        entityId: finding.entity_id,
        entityName: finding.entity_name,
        ruleId: finding.rule_id,
        ruleSeverity: finding.severity,
        ruleMessage: finding.message,
        metricsSnapshot: pickMetricsSnapshot(finding.data),
        action: findingAction,
        dryRun: finalDryRun,
        outcome,
        error,
        skipReason,
        metaApiLatencyMs: Date.now() - attemptStart,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] log write failed | runId=${finalRunId} ` +
          `entity=${finding.entity_id}: ${logErr.message}`,
      );
    }

    actions.push({
      ruleId: finding.rule_id,
      severity: finding.severity,
      level: finding.entity_type,
      entityId: finding.entity_id,
      entityName: finding.entity_name,
      message: finding.message,
      action: findingAction,
      outcome,
      ...(skipReason ? { skipReason } : {}),
      ...(error ? { error } : {}),
    });
  }

  const result = {
    runId: finalRunId,
    adAccountId,
    accountName: audit.account_name,
    dryRun: finalDryRun,
    severityFloor,
    findings_count: audit.findings.length,
    actionable_count: actionable.length,
    paused,
    would_pause,
    failed,
    skipped,
    actions,
    durationMs: Date.now() - started,
  };

  logger.info(
    `[autopilot] run end | runId=${finalRunId} acct=${adAccountId} ` +
      `evaluated=${result.findings_count} actionable=${result.actionable_count} ` +
      `paused=${paused} would_pause=${would_pause} failed=${failed} skipped=${skipped} ` +
      `dur=${result.durationMs}ms`,
  );

  return result;
}

module.exports = {
  autoPauseForAccount,
  // exported for tests:
  severityAtLeast,
  filterActionable,
  classifyFindingAction,
  // internal — exported for future orchestrator reuse (Phase 3):
  _internals: { pauseEntity },
};
