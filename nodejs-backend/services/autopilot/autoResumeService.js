/**
 * autoResumeService — Phase 5.
 *
 * Complement to autoPauseService. For every ad/adset/campaign that autopilot
 * previously paused (action=pause, outcome=success, pausedBy=autopilot) on
 * this adAccountId, re-run the audit. If NO rule at the current severity
 * floor fires against the entity in the fresh audit, resume it (ACTIVE).
 *
 * Safety rails
 *   - dryRun=true by default (same as pause).
 *   - Flap cooldown: if autopilot has flipped this entity between paused and
 *     resumed >= AUTOPILOT_FLAP_COOLDOWN_STRIKES times in the last
 *     AUTOPILOT_FLAP_COOLDOWN_DAYS days, skip with outcome=skipped,
 *     skipReason=flap-cooldown. Prevents ping-pong on borderline ads.
 *   - We only consider entities paused more recently than the oldest flap
 *     window — ancient pauses are ignored by default (lookback driven by
 *     AUTOPILOT_AUTO_RESUME_LOOKBACK_DAYS, default 30).
 *
 * Not handled here
 *   - A pause performed manually by a human (pausedBy !== 'autopilot') is
 *     never touched. Autopilot only reverses its own actions.
 *   - Phase 2 stored metricsSnapshot + ruleMessage in the log row; Phase 5
 *     doesn't use those for the resume decision — it does a fresh audit
 *     because the current metrics are what matter.
 */

const { randomUUID } = require("node:crypto");
const { filterActionable } = require("./autoPauseService");

// Lazy requires keep the module importable in minimal test envs that don't
// have facebook-nodejs-business-sdk / mongoose installed.
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
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Count how many times this entity has been paused/resumed by autopilot
 * within the cooldown window. Given a list of log rows sorted by runAt desc,
 * this flips every time the action changes.
 *
 * @param {Array<{action:string, runAt: Date}>} rows
 * @returns {number} flips (0 = stable)
 */
function countFlaps(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return 0;
  // Sort oldest -> newest and count transitions between pause/resume.
  const sorted = [...rows].sort(
    (a, b) => new Date(a.runAt) - new Date(b.runAt),
  );
  let flaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].action !== sorted[i - 1].action) flaps += 1;
  }
  return flaps;
}

// ---------------------------------------------------------------------------
// Meta write — mirror of pauseEntity in autoPauseService
// ---------------------------------------------------------------------------

async function resumeEntity({ level, entityId }) {
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
    [StatusField.status]: "ACTIVE",
  });
}

/**
 * Read `updated_time` + status fields off Meta so we can compare against the
 * autopilot pause log timestamp. Used by the manual-intervention guard below
 * to refuse to resume something a human just touched. Returns null if Meta
 * call fails — caller decides how to fail-safe.
 */
async function getEntityMeta({ level, entityId }) {
  const sdk = bizSdk();
  let obj;
  let Fields;
  if (level === "campaign") {
    obj = new sdk.Campaign(entityId);
    Fields = sdk.Campaign.Fields;
  } else if (level === "adset") {
    obj = new sdk.AdSet(entityId);
    Fields = sdk.AdSet.Fields;
  } else if (level === "ad") {
    obj = new sdk.Ad(entityId);
    Fields = sdk.Ad.Fields;
  } else {
    throw new Error(`unknown entity level: ${level}`);
  }
  const result = await obj.read([
    Fields.updated_time,
    Fields.effective_status,
    Fields.status,
  ]);
  return {
    updated_time: result._data.updated_time,
    effective_status: result._data.effective_status,
    status: result._data.status,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Decide whether the entity has been manually touched since autopilot
 * paused it. Returns { intervened: boolean, reason?: string }.
 *
 * @param {string|Date|null} entityUpdatedTime  Meta's updated_time
 * @param {string|Date}      lastAutopilotPauseAt  log row's runAt
 * @param {number} [graceMs=60000]  small grace window so the autopilot's own
 *                                  pause write isn't flagged as intervention
 */
function detectManualIntervention(
  entityUpdatedTime,
  lastAutopilotPauseAt,
  graceMs = 60_000,
) {
  if (!entityUpdatedTime) {
    return { intervened: false }; // no signal — trust the log
  }
  const updatedAt = new Date(entityUpdatedTime).getTime();
  const pausedAt = new Date(lastAutopilotPauseAt).getTime();
  if (Number.isNaN(updatedAt) || Number.isNaN(pausedAt)) {
    return { intervened: false };
  }
  if (updatedAt > pausedAt + graceMs) {
    return {
      intervened: true,
      reason: `entity updated_time ${new Date(updatedAt).toISOString()} is later than autopilot pause ${new Date(pausedAt).toISOString()}`,
    };
  }
  return { intervened: false };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{
 *   runId, adAccountId, dryRun, evaluated, resumed, would_resume, skipped, failed,
 *   actions: Array, durationMs,
 * }>}
 */
async function autoResumeForAccount({
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
    throw new Error(
      "accessToken is required when no pre-fetched audit is provided",
    );

  // Canonical `act_<id>` shape on entry — see autoPauseService for rationale.
  const {
    effectiveDryRun,
    normalizeAdAccountId,
  } = require("../../config/autopilotConfig");
  const adAccountId = normalizeAdAccountId(rawAdAccountId);

  const logger = getLogger();
  const finalRunId = runId || randomUUID();
  const started = Date.now();
  const Log = AutopilotActionLog();

  // Safety gate — same as autoPauseService.
  const gated = effectiveDryRun({ adAccountId, requestedDryRun: dryRun });
  const finalDryRun = gated.dryRun;
  const safetyOverride = gated.forced;

  const flapStrikes = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_FLAP_COOLDOWN_STRIKES || "3", 10) || 3,
  );
  const flapDays = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_FLAP_COOLDOWN_DAYS || "7", 10) || 7,
  );
  const lookbackDays = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_AUTO_RESUME_LOOKBACK_DAYS || "30", 10) || 30,
  );

  logger.info(
    `[autopilot] auto-resume start | runId=${finalRunId} acct=${adAccountId} ` +
      `dryRun=${finalDryRun}${safetyOverride ? " (SAFETY OVERRIDE)" : ""} floor=${severityFloor}`,
  );

  // 1) Find distinct entity ids Autopilot has paused in the lookback window.
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const pausedRows = await Log.aggregate([
    {
      $match: {
        adAccountId,
        action: "pause",
        outcome: "success",
        dryRun: false, // only real pauses; dry-run entries never touched Meta
        pausedBy: "autopilot",
        runAt: { $gte: cutoff },
      },
    },
    { $sort: { runAt: -1 } },
    {
      $group: {
        _id: { level: "$level", entityId: "$entityId" },
        entityName: { $first: "$entityName" },
        lastPausedAt: { $first: "$runAt" },
        ruleId: { $first: "$ruleId" },
      },
    },
  ]);

  if (!pausedRows.length) {
    logger.info(
      `[autopilot] auto-resume: no prior autopilot-paused entities in the last ${lookbackDays}d`,
    );
    return {
      runId: finalRunId,
      adAccountId,
      dryRun: finalDryRun,
      severityFloor,
      evaluated: 0,
      resumed: 0,
      would_resume: 0,
      skipped: 0,
      failed: 0,
      actions: [],
      durationMs: Date.now() - started,
    };
  }

  // 2) Fresh audit so we know what's still critical. The orchestrator path
  //    passes a shared audit so all three services hit Meta once per account.
  const audit =
    providedAudit ||
    (await runAuditForAccount({
      userId,
      adAccountId,
      accessToken,
      options: { enforceAgeGuard: true, enforceSpendFloor: true },
    }));
  const stillFiring = new Set(
    filterActionable(audit.findings, severityFloor).map((f) => f.entity_id),
  );

  const actions = [];
  let resumed = 0;
  let would_resume = 0;
  let skipped = 0;
  let failed = 0;
  let evaluated = 0;

  // 3) For each previously-paused entity, decide.
  for (const row of pausedRows) {
    const level = row._id.level;
    const entityId = row._id.entityId;
    evaluated += 1;

    // If the rule still fires, don't resume. Leave it paused.
    if (stillFiring.has(entityId)) {
      skipped += 1;
      actions.push({
        level,
        entityId,
        entityName: row.entityName,
        outcome: "skipped",
        skipReason: "rule-still-firing",
      });
      continue;
    }

    // Flap cooldown — count prior pause+resume transitions in the cooldown window.
    const flapCutoff = new Date(Date.now() - flapDays * 24 * 60 * 60 * 1000);
    const history = await Log.find(
      {
        adAccountId,
        entityId,
        pausedBy: "autopilot",
        dryRun: false,
        runAt: { $gte: flapCutoff },
      },
      { action: 1, runAt: 1 },
    )
      .sort({ runAt: 1 })
      .lean();

    const flaps = countFlaps(history);
    if (flaps >= flapStrikes) {
      skipped += 1;
      actions.push({
        level,
        entityId,
        entityName: row.entityName,
        outcome: "skipped",
        skipReason: `flap-cooldown (${flaps} flips in ${flapDays}d)`,
      });
      continue;
    }

    // Manual-intervention guard. If the entity's Meta `updated_time` is
    // newer than autopilot's last pause for this entity, somebody else
    // touched it (most likely a human re-pausing or twiddling something).
    // Refuse to resume — autopilot only reverses its own actions.
    let entityMeta = null;
    try {
      entityMeta = await getEntityMeta({ level, entityId });
    } catch (err) {
      logger.warn(
        `[autopilot] resume: updated_time read failed for ${level}=${entityId}: ${err.message}`,
      );
    }
    const manualCheck = detectManualIntervention(
      entityMeta && entityMeta.updated_time,
      row.lastPausedAt,
    );
    if (manualCheck.intervened) {
      skipped += 1;
      const skipReason = "manual-intervention";
      actions.push({
        level,
        entityId,
        entityName: row.entityName,
        outcome: "skipped",
        skipReason,
      });
      // Log the skip so Phase 4 UI can show "we noticed you touched this
      // and stood down".
      try {
        await Log.create({
          runId: finalRunId,
          userId,
          adAccountId,
          adAccountName: audit.account_name,
          level,
          entityId,
          entityName: row.entityName,
          ruleId: row.ruleId,
          ruleSeverity: null,
          action: "resume",
          actionPayload: {
            priorPausedAt: row.lastPausedAt,
            entityUpdatedTime: entityMeta && entityMeta.updated_time,
            entityEffectiveStatus: entityMeta && entityMeta.effective_status,
            detail: manualCheck.reason,
          },
          dryRun: finalDryRun,
          outcome: "skipped",
          skipReason,
          runAt: new Date(),
          pausedBy: "autopilot",
        });
      } catch (logErr) {
        logger.error(
          `[autopilot] manual-intervention skip log failed: ${logErr.message}`,
        );
      }
      continue;
    }

    // Attempt resume (or log intent if finalDryRun).
    const attemptStart = Date.now();
    let outcome = "success";
    let error = null;
    if (!finalDryRun) {
      try {
        await resumeEntity({ level, entityId });
      } catch (err) {
        outcome = "failed";
        error = err && err.message ? err.message : String(err);
        logger.error(
          `[autopilot] resume failed | ${level}=${entityId}: ${error}`,
        );
      }
    }

    if (outcome === "success") {
      if (finalDryRun) would_resume += 1;
      else resumed += 1;
    } else failed += 1;

    try {
      await Log.create({
        runId: finalRunId,
        userId,
        adAccountId,
        adAccountName: audit.account_name,
        level,
        entityId,
        entityName: row.entityName,
        ruleId: row.ruleId, // the rule that originally triggered the pause
        ruleSeverity: null,
        action: "resume",
        actionPayload: { priorPausedAt: row.lastPausedAt },
        dryRun: finalDryRun,
        outcome,
        error,
        metaApiLatencyMs: Date.now() - attemptStart,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] resume log write failed: ${logErr.message}`,
      );
    }

    actions.push({
      level,
      entityId,
      entityName: row.entityName,
      outcome,
      ...(error ? { error } : {}),
    });
  }

  const durationMs = Date.now() - started;
  logger.info(
    `[autopilot] auto-resume end | runId=${finalRunId} acct=${adAccountId} ` +
      `evaluated=${evaluated} resumed=${resumed} would_resume=${would_resume} ` +
      `skipped=${skipped} failed=${failed} dur=${durationMs}ms`,
  );

  return {
    runId: finalRunId,
    adAccountId,
    accountName: audit.account_name,
    dryRun: finalDryRun,
    severityFloor,
    evaluated,
    resumed,
    would_resume,
    skipped,
    failed,
    actions,
    durationMs,
  };
}

module.exports = {
  autoResumeForAccount,
  // exported for tests
  countFlaps,
  detectManualIntervention,
  _internals: { resumeEntity, getEntityMeta },
};
