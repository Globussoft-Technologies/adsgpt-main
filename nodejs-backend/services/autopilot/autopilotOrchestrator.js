/**
 * autopilotOrchestrator — Phase 3 (v3 multi-tenant target discovery).
 *
 * One tick discovers every (user, ad-account) target from
 * `targetDiscovery.discoverAutopilotTargets()` — i.e. every AdsGPT user with
 * `autopilotSettings.enabled === true` × every ad account they have on Meta
 * — and runs audit + pause + resume (+ scale, + rotate when enabled) for
 * each pair using THAT user's FB OAuth token. There is no hardcoded
 * account list and no system token: per-user OAuth is the only source of
 * Meta credentials, for both the cron and on-demand triggers.
 *
 * Concurrency: a Redis lock prevents two ticks (same process or two pods)
 * from overlapping. Lock value is the runId so a crashed run doesn't unlock
 * another active run accidentally; lock TTL is 55 min so a crashed tick
 * self-resolves before the next hourly fire.
 *
 * Discovery handles its own per-user error isolation — a user with no
 * FacebookUsers row, an expired token, or a failed `/me/adaccounts` call
 * is skipped (warn-logged) and the cycle continues for everyone else.
 */

const { randomUUID } = require("node:crypto");
const { redisClient } = require("../../db/redis");
const { autoPauseForAccount } = require("./autoPauseService");
const { autoResumeForAccount } = require("./autoResumeService");
const { autoScaleForAccount } = require("./autoScaleService");
const { rotateForAccount } = require("./rotationService");
const { notifyAutopilotCycle } = require("./alertService");
const { discoverAutopilotTargets } = require("./targetDiscovery");
const { runAuditForAccount } = require("../metaAuditService");

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
const LOCK_TTL_SECONDS = 55 * 60; // 55 min — under the hourly cron cadence.

async function acquireLock(runId) {
  // ioredis: SET key value EX seconds NX. Returns "OK" on success, null on
  // NX-failure (key already present).
  const result = await redisClient.set(
    LOCK_KEY,
    runId,
    "EX",
    LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
}

async function releaseLock(runId) {
  // Compare-and-delete so a slow run that outlived its TTL doesn't blow
  // away a newer run's lock.
  try {
    const current = await redisClient.get(LOCK_KEY);
    if (current === runId) {
      await redisClient.del(LOCK_KEY);
    }
  } catch (err) {
    getLogger().error(
      `[autopilot] releaseLock failed for runId=${runId}: ${err.message}`,
    );
  }
}

/**
 * Run one full cycle: every (opted-in user × ad-account) target discovered
 * by `discoverAutopilotTargets()` gets a dry-run or live auto-pause attempt
 * using that user's own FB OAuth token. Results are returned AND persisted
 * to autopilotActionLog via each service.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=true]
 * @param {boolean} [opts.force=false]  skip the Redis lock check
 * @param {Array<string>} [opts.userIds]  restrict discovery to specific
 *                                         AdsGPT user_ids (used by tests
 *                                         and ad-hoc triggers).
 *
 * `severityFloor` is no longer a cycle-level param — each target carries
 * its OWN floor sourced from that user's `autopilotSettings.severityFloor`
 * (default 'critical'). Same for the alert channels (Slack + email):
 * resolved per-user inside alertService.
 *
 * @returns summary with per-target rollup
 */
async function runAutopilotCycle({
  dryRun = true,
  force = false,
  userIds,
} = {}) {
  const logger = getLogger();
  const runId = randomUUID();

  if (!force) {
    const got = await acquireLock(runId);
    if (!got) {
      logger.info(
        `[autopilot] orchestrator skipped: lock held (another run in progress)`,
      );
      return {
        runId,
        skipped: true,
        reason: "lock-held",
        durationMs: 0,
      };
    }
  }

  const startedAt = Date.now();
  const summaries = [];

  try {
    // Discover targets dynamically: every (user, ad-account) pair where
    // the user has opted in via autopilotSettings AND has a valid FB token
    // AND has at least one ad account on Meta. No hardcoded list.
    const targets = await discoverAutopilotTargets(
      userIds ? { userIds } : undefined,
    );

    logger.info(
      `[autopilot] orchestrator start | runId=${runId} targets=${targets.length} ` +
        `dryRun=${dryRun}`,
    );

    for (const target of targets) {
      const {
        userId: resolvedUserId,
        adAccountId: acctKey,
        accessToken,
        name,
        severityFloor: targetSeverityFloor = "critical",
        thresholdOverrides: targetThresholdOverrides = {},
      } = target;
      const acctSummary = {
        adAccountId: acctKey,
        name,
        ownerUserId: resolvedUserId,
        severityFloor: targetSeverityFloor,
        ok: true,
      };

      try {
        // Run the audit ONCE per account and share the result across pause +
        // resume + scale + rotate. Cuts Meta API load 4×. Each per-service
        // safety guard still fires on its own findings filter; only the
        // data fetch is shared.
        //
        // `thresholdOverrides` is the user's per-account rule customisations
        // from autopilotSettings.perAccountOverrides (e.g. raise AUD-01's
        // min_spend on a high-volume account so it doesn't pause too eagerly).
        const auditStart = Date.now();
        const audit = await runAuditForAccount({
          userId: resolvedUserId,
          adAccountId: acctKey,
          accessToken,
          options: {
            enforceAgeGuard: true,
            enforceSpendFloor: true,
            thresholdOverrides: targetThresholdOverrides,
          },
        });
        acctSummary.audit = {
          findings_count: audit.findings.length,
          summary: audit.summary,
          durationMs: Date.now() - auditStart,
        };

        const pauseRes = await autoPauseForAccount({
          userId: resolvedUserId,
          adAccountId: acctKey,
          accessToken,
          dryRun,
          severityFloor: targetSeverityFloor,
          runId,
          audit,
        });
        acctSummary.pause = {
          findings_count: pauseRes.findings_count,
          actionable_count: pauseRes.actionable_count,
          paused: pauseRes.paused,
          would_pause: pauseRes.would_pause,
          failed: pauseRes.failed,
          durationMs: pauseRes.durationMs,
        };

        const resumeRes = await autoResumeForAccount({
          userId: resolvedUserId,
          adAccountId: acctKey,
          accessToken,
          dryRun,
          severityFloor: targetSeverityFloor,
          runId,
          audit,
        });
        acctSummary.resume = {
          evaluated: resumeRes.evaluated,
          resumed: resumeRes.resumed,
          would_resume: resumeRes.would_resume,
          skipped: resumeRes.skipped,
          failed: resumeRes.failed,
          durationMs: resumeRes.durationMs,
        };

        // Scale winners — gated by env; off by default because scaling a
        // misconfigured budget is costlier than leaving a winner underfunded.
        const scaleEnabled =
          String(
            process.env.AUTOPILOT_SCALE_ENABLED || "false",
          ).toLowerCase() === "true";
        if (scaleEnabled) {
          const scaleRes = await autoScaleForAccount({
            userId: resolvedUserId,
            adAccountId: acctKey,
            accessToken,
            dryRun,
            runId,
            audit,
            thresholdOverrides: targetThresholdOverrides,
          });
          acctSummary.scale = {
            findings_count: scaleRes.findings_count,
            scaled: scaleRes.scaled,
            would_scale: scaleRes.would_scale,
            skipped: scaleRes.skipped,
            failed: scaleRes.failed,
            durationMs: scaleRes.durationMs,
          };
        }

        // Phase 9 rotation — gated separately. Same shared audit. Creates
        // new Meta ads (always PAUSED) referencing rotation-ready drafts;
        // the global AUTOPILOT_LIVE_ACTIONS_ALLOWED safety gate still
        // forces dry-run when off, even when this env is true.
        const rotationEnabled =
          String(
            process.env.AUTOPILOT_ROTATION_ENABLED || "false",
          ).toLowerCase() === "true";
        if (rotationEnabled) {
          const rotateRes = await rotateForAccount({
            userId: resolvedUserId,
            adAccountId: acctKey,
            accessToken,
            dryRun,
            runId,
            audit,
          });
          acctSummary.rotate = {
            findings_count: rotateRes.findings_count,
            evaluated: rotateRes.evaluated,
            rotated: rotateRes.rotated,
            would_rotate: rotateRes.would_rotate,
            skipped: rotateRes.skipped,
            failed: rotateRes.failed,
            durationMs: rotateRes.durationMs,
          };
        }
      } catch (err) {
        logger.error(
          `[autopilot] orchestrator: account ${acctKey} (${name}) for userId=${resolvedUserId} failed: ${err.message}`,
        );
        acctSummary.ok = false;
        acctSummary.error = err.message;
      }
      summaries.push(acctSummary);
    }
  } finally {
    if (!force) await releaseLock(runId);
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    `[autopilot] orchestrator end | runId=${runId} accounts=${summaries.length} ` +
      `dur=${durationMs}ms`,
  );

  const result = {
    runId,
    dryRun,
    durationMs,
    accounts: summaries,
  };

  // Fire-and-forget alerts. alertService swallows failures internally and
  // resolves both Slack webhooks and email recipients per-user from each
  // tenant's autopilotSettings.alerts.*
  try {
    await notifyAutopilotCycle(result);
  } catch (err) {
    logger.warn(`[autopilot] alert dispatch threw (swallowed): ${err.message}`);
  }

  return result;
}

module.exports = {
  runAutopilotCycle,
  // internal — exposed for tests
  _internals: { acquireLock, releaseLock, LOCK_KEY, LOCK_TTL_SECONDS },
};
