/**
 * rotationService — Phase 9.
 *
 * Reads AUD-36 (ad CTR fatigue WoW) findings from a shared audit, picks an
 * unused rotation-ready draft from `adRotationDraft`, and posts a new Meta
 * Ad on the fatigued ad's parent adset referencing the draft's pre-built
 * creative. Then pauses the fatigued ad. Both actions are written to
 * `autopilotActionLog` with a shared `rotationGroupId` so the UI can show
 * the swap as one logical event.
 *
 * Why AUD-36 only (not AUD-12):
 *   AUD-12 fires on adsets with frequency > 6 — the entity is the adset, not
 *   a specific ad, so "rotate" would have to touch every ad in the adset.
 *   That's too aggressive for v1. We use AUD-36 (ad-level) as the trigger;
 *   AUD-12 may inform a future "high-frequency adset → soft refresh" mode.
 *
 * Safety
 *   - dryRun=true by default. The orchestrator path inherits its dryRun.
 *   - effectiveDryRun() forces dryRun=true whenever the global env flag
 *     AUTOPILOT_LIVE_ACTIONS_ALLOWED is not 'true' (the production default).
 *   - Per-adset cap (AUTOPILOT_MAX_ROTATIONS_PER_ADSET_PER_30D, default 3
 *     per PRD) prevents churn even when there's a long queue.
 *   - status: 'PAUSED' on every newly-created ad — Phase 10 may add an
 *     opt-in "auto-activate rotations" flag; for v1 the user must un-pause
 *     manually after reviewing.
 *
 * Idempotency
 *   - usedByAutopilotAt on the draft is stamped before the Meta call so a
 *     concurrent runner can't pick the same draft twice. (Atomic
 *     findOneAndUpdate with `usedByAutopilotAt: null` predicate.)
 *
 * Ordering of writes (live mode)
 *   1. Reserve the draft (atomic mark used).
 *   2. Create the new Ad on Meta. If this fails, unmark + log failure.
 *   3. Pause the fatigued ad on Meta. If this fails, log warning but the
 *      new ad stays — the queue should never lose a creative because the
 *      pause-half failed; the user can manually pause the old one.
 *   4. Log both actions with shared rotationGroupId.
 */

const { randomUUID } = require("node:crypto");
const { pickMetricsSnapshot } = require("./metricsSnapshot");
// Reuse the existing pause helper from autoPauseService rather than duplicate
// the SDK call. Pause is also implemented HTTP-side in
// controllers/adPosting/metaAdLauncher.js:updateStatus, but that's behind a
// req/res; this is the service-layer reuse path.
let _pauseEntity;
function pauseEntity(args) {
  if (!_pauseEntity)
    _pauseEntity = require("./autoPauseService")._internals.pauseEntity;
  return _pauseEntity(args);
}

let _bizSdk;
let _AutopilotActionLog;
let _AdRotationDraft;
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
function AdRotationDraft() {
  if (!_AdRotationDraft)
    _AdRotationDraft = require("../../Module/autopilot/adRotationDraft");
  return _AdRotationDraft;
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
 * Filter audit findings down to ad-level fatigue triggers — currently
 * AUD-36 only. Each finding must carry `data.adset_id` so the rotation
 * service can resolve the parent adset. Drops any finding missing that
 * field rather than crashing later.
 */
function isRotationFinding(f) {
  if (!f || f.entity_type !== "ad") return false;
  if (f.rule_id !== "AUD-36") return false;
  if (!f.data || !f.data.adset_id) return false;
  return true;
}

/**
 * Pick the best draft for a fatigued ad. Preference order:
 *   1. Drafts pinned to the same `adsetId` (most targeted).
 *   2. Generic drafts with `adsetId: null` (any-adset candidates).
 *   3. Among ties, oldest `createdAt` first (FIFO queue).
 *
 * Pure — does not mutate input. Returns the chosen draft or null.
 */
function pickRotationDraft(drafts, adsetId) {
  if (!Array.isArray(drafts) || drafts.length === 0) return null;
  const eligible = drafts.filter(
    (d) => d && d.rotationReady === true && !d.usedByAutopilotAt,
  );
  if (eligible.length === 0) return null;
  const same = eligible.filter((d) => d.adsetId === adsetId);
  const generic = eligible.filter((d) => !d.adsetId);
  const pool = same.length > 0 ? same : generic;
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  return sorted[0];
}

/**
 * Count rotations applied to `adsetId` in the past `days`. Reads from a
 * pre-fetched array of action-log rows (shape: `{ adsetId, runAt }`). Pure.
 *
 * Used to enforce per-adset 30d cap without re-querying Mongo per finding.
 */
function countRecentRotations(rows, adsetId, days = 30) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter(
    (r) =>
      r &&
      r.adsetId === adsetId &&
      r.runAt &&
      new Date(r.runAt).getTime() >= cutoff,
  ).length;
}

// ---------------------------------------------------------------------------
// Meta writes
// ---------------------------------------------------------------------------

/**
 * Create a new ad on `adsetId` referencing an existing creative. Returns
 * the new ad id. Always created `PAUSED` so the user reviews before
 * spending — Phase 10 may add an opt-in to launch ACTIVE.
 *
 * Note: this is the only Meta SDK write we own here. Pause is delegated to
 * autoPauseService._internals.pauseEntity (no duplication). The HTTP
 * `/ad-posting/create` controller path also creates ads, but it's req/res-
 * bound + writes a PostedAd Mongo doc (which isn't right for rotation —
 * we want the rotation log to be the source of truth, not the manual-post
 * collection). So the SDK call is reproduced minimally here.
 */
async function createRotationAd({ adAccountId, adsetId, creativeId, name }) {
  const sdk = bizSdk();
  const acctKey = adAccountId.startsWith("act_")
    ? adAccountId
    : `act_${adAccountId}`;
  const account = new sdk.AdAccount(acctKey);
  const ad = await account.createAd([], {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: sdk.Ad.Status ? sdk.Ad.Status.paused : "PAUSED",
  });
  return ad && ad.id ? ad.id : null;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.adAccountId
 * @param {string} args.accessToken    decrypted Meta token (optional when
 *                                     `audit` is provided)
 * @param {boolean} [args.dryRun=true]
 * @param {string}  [args.runId]
 * @param {Object}  [args.audit]       pre-fetched audit (orchestrator path
 *                                     shares this with pause/resume/scale)
 *
 * @returns {Promise<{
 *   runId, adAccountId, dryRun, findings_count, evaluated, rotated,
 *   would_rotate, skipped, failed, actions, durationMs
 * }>}
 */
async function rotateForAccount({
  userId,
  adAccountId: rawAdAccountId,
  accessToken,
  dryRun = true,
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
  const Drafts = AdRotationDraft();

  const gated = effectiveDryRun({ adAccountId, requestedDryRun: dryRun });
  const finalDryRun = gated.dryRun;
  const safetyOverride = gated.forced;

  const cap30d = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_MAX_ROTATIONS_PER_ADSET_PER_30D || "3", 10) ||
      3,
  );
  const maxPerRun = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_MAX_ROTATIONS_PER_RUN || "10", 10) || 10,
  );

  logger.info(
    `[autopilot] rotation start | runId=${finalRunId} acct=${adAccountId} ` +
      `dryRun=${finalDryRun}${safetyOverride ? " (SAFETY OVERRIDE)" : ""} ` +
      `cap30d=${cap30d} maxPerRun=${maxPerRun}` +
      `${providedAudit ? " (shared audit)" : ""}`,
  );

  const audit =
    providedAudit ||
    (await runAuditForAccount({
      userId,
      adAccountId,
      accessToken,
      options: { enforceAgeGuard: true, enforceSpendFloor: true },
    }));

  const fatigueFindings = (audit.findings || []).filter(isRotationFinding);

  const result = {
    runId: finalRunId,
    adAccountId,
    accountName: audit.account_name,
    dryRun: finalDryRun,
    findings_count: fatigueFindings.length,
    evaluated: 0,
    rotated: 0,
    would_rotate: 0,
    skipped: 0,
    failed: 0,
    actions: [],
    durationMs: 0,
  };

  if (fatigueFindings.length === 0) {
    result.durationMs = Date.now() - started;
    logger.info(
      `[autopilot] rotation end | runId=${finalRunId} acct=${adAccountId} no fatigue findings`,
    );
    return result;
  }

  // Pre-fetch the 30d rotation history once for the account so the cap
  // check is in-memory per finding. Same pattern as autoScaleService.
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRotationLogs = await Log.find(
    {
      adAccountId,
      action: "rotate_creative",
      outcome: "success",
      dryRun: false,
      runAt: { $gte: cutoff30d },
    },
    { actionPayload: 1, runAt: 1 },
  ).lean();
  const recentRotationsForCount = recentRotationLogs.map((r) => ({
    adsetId: (r.actionPayload && r.actionPayload.adsetId) || null,
    runAt: r.runAt,
  }));

  // Pre-fetch unused rotation-ready drafts once. We pick from this pool in
  // memory and atomically reserve via findOneAndUpdate when we commit.
  const draftPool = await Drafts.find({
    adAccountId,
    rotationReady: true,
    usedByAutopilotAt: null,
  }).lean();

  const helper = async ({ ruleId, ruleSeverity, ruleMessage, level, entityId, entityName, metricsSnapshot, skipReason, actionPayload, action, outcome, error, rotationGroupId }) => {
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
        action,
        actionPayload: { ...(actionPayload || {}), rotationGroupId },
        dryRun: finalDryRun,
        outcome,
        skipReason,
        error,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] rotation log write failed (${ruleId}/${entityId}): ${logErr.message}`,
      );
    }
  };

  for (const f of fatigueFindings) {
    if (result.rotated + result.would_rotate >= maxPerRun) {
      result.skipped += 1;
      result.actions.push({
        ruleId: f.rule_id,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        outcome: "skipped",
        skipReason: "max-per-run-cap",
      });
      await helper({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason: "max-per-run-cap",
        actionPayload: {
          adsetId: f.data.adset_id,
          max_per_run: maxPerRun,
          triggering_rule_id: f.rule_id,
        },
        action: "rotate_creative",
        outcome: "skipped",
        rotationGroupId: null,
      });
      continue;
    }

    result.evaluated += 1;
    const adsetId = f.data.adset_id;
    const recentCount = countRecentRotations(recentRotationsForCount, adsetId);
    if (recentCount >= cap30d) {
      result.skipped += 1;
      const skipReason = `30d-cap-reached (prior ${recentCount} vs cap ${cap30d})`;
      result.actions.push({
        ruleId: f.rule_id,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        adsetId,
        outcome: "skipped",
        skipReason,
      });
      await helper({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason,
        actionPayload: {
          adsetId,
          cap_30d: cap30d,
          prior_count: recentCount,
          triggering_rule_id: f.rule_id,
        },
        action: "rotate_creative",
        outcome: "skipped",
        rotationGroupId: null,
      });
      continue;
    }

    const draft = pickRotationDraft(draftPool, adsetId);
    if (!draft) {
      result.skipped += 1;
      result.actions.push({
        ruleId: f.rule_id,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        adsetId,
        outcome: "skipped",
        skipReason: "no-rotation-draft-available",
      });
      await helper({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: f.message,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        skipReason: "no-rotation-draft-available",
        actionPayload: {
          adsetId,
          triggering_rule_id: f.rule_id,
        },
        action: "rotate_creative",
        outcome: "skipped",
        rotationGroupId: null,
      });
      continue;
    }

    // Remove from in-memory pool so the next finding doesn't re-pick it
    // (in-memory dedupe; Mongo atomic reserve happens in live mode below).
    const idx = draftPool.findIndex((d) => String(d._id) === String(draft._id));
    if (idx >= 0) draftPool.splice(idx, 1);

    const rotationGroupId = randomUUID();
    let outcome = "success";
    let error = null;
    let newAdId = null;
    const draftIdStr = String(draft._id);

    if (finalDryRun) {
      // Dry-run: write log rows showing what we WOULD do, but no Meta
      // calls and don't reserve the draft (so a subsequent live run can
      // still consume it).
      result.would_rotate += 1;
    } else {
      // Live: atomic reserve first. If another runner won, the
      // findOneAndUpdate returns null and we move on.
      try {
        const reserved = await Drafts.findOneAndUpdate(
          { _id: draft._id, usedByAutopilotAt: null },
          {
            $set: {
              usedByAutopilotAt: new Date(),
              usedByEntityId: f.entity_id,
              rotationGroupId,
            },
          },
          { new: true },
        );
        if (!reserved) {
          throw new Error(
            "draft reserved by concurrent runner before we got it",
          );
        }
        // Build a name; "rotation" suffix lets users see how this ad
        // arrived in their account.
        const newName = `${draft.name || "Rotation"} (autopilot rotation)`;
        newAdId = await createRotationAd({
          adAccountId,
          adsetId,
          creativeId: draft.creativeId,
          name: newName,
        });
        // Pause the fatigued ad via the shared autoPauseService helper. If
        // pause fails, leave the new ad as-is — we don't want to roll back
        // the rotation queue + the new ad because the pause half failed.
        try {
          await pauseEntity({ level: "ad", entityId: f.entity_id });
        } catch (pauseErr) {
          logger.warn(
            `[autopilot] rotation: new ad ${newAdId} created but pause of ` +
              `fatigued ${f.entity_id} failed: ${pauseErr.message}. ` +
              `Manual cleanup required.`,
          );
        }
      } catch (err) {
        outcome = "failed";
        error = err && err.message ? err.message : String(err);
        logger.error(
          `[autopilot] rotation failed | ad=${f.entity_id} draft=${draftIdStr}: ${error}`,
        );
        // Best-effort unreserve so the draft is still available for next run
        try {
          await Drafts.updateOne(
            { _id: draft._id, rotationGroupId },
            {
              $set: {
                usedByAutopilotAt: null,
                usedByEntityId: null,
                rotationGroupId: null,
              },
            },
          );
        } catch (unreserveErr) {
          logger.warn(
            `[autopilot] rotation: failed to unreserve draft ${draftIdStr}: ${unreserveErr.message}`,
          );
        }
      }
    }

    if (outcome === "success") {
      if (finalDryRun) {
        // would_rotate already incremented above
      } else {
        result.rotated += 1;
      }
    } else {
      result.failed += 1;
    }

    // Two log rows per rotation: the create-creative action and the
    // pause-fatigued action, sharing rotationGroupId.
    await helper({
      ruleId: f.rule_id,
      ruleSeverity: f.severity,
      ruleMessage: f.message,
      level: "ad",
      entityId: f.entity_id,
      entityName: f.entity_name,
      metricsSnapshot: pickMetricsSnapshot(f.data),
      actionPayload: {
        adsetId,
        triggering_rule_id: f.rule_id,
        draft_id: draftIdStr,
        creative_id: draft.creativeId,
        new_ad_id: newAdId,
      },
      action: "rotate_creative",
      outcome,
      error,
      rotationGroupId,
    });
    if (outcome === "success" && !finalDryRun) {
      await helper({
        ruleId: f.rule_id,
        ruleSeverity: f.severity,
        ruleMessage: `Paused fatigued ad — replacement posted via rotation`,
        level: "ad",
        entityId: f.entity_id,
        entityName: f.entity_name,
        metricsSnapshot: pickMetricsSnapshot(f.data),
        actionPayload: {
          adsetId,
          triggering_rule_id: f.rule_id,
          replaced_by_ad_id: newAdId,
          draft_id: draftIdStr,
        },
        action: "pause",
        outcome: "success",
        rotationGroupId,
      });
    }

    result.actions.push({
      ruleId: f.rule_id,
      level: "ad",
      entityId: f.entity_id,
      entityName: f.entity_name,
      adsetId,
      outcome,
      newAdId,
      draftId: draftIdStr,
      rotationGroupId,
      ...(error ? { error } : {}),
    });
  }

  result.durationMs = Date.now() - started;
  logger.info(
    `[autopilot] rotation end | runId=${finalRunId} acct=${adAccountId} ` +
      `findings=${result.findings_count} evaluated=${result.evaluated} ` +
      `rotated=${result.rotated} would_rotate=${result.would_rotate} ` +
      `skipped=${result.skipped} failed=${result.failed} dur=${result.durationMs}ms`,
  );

  return result;
}

module.exports = {
  rotateForAccount,
  // exported for tests
  isRotationFinding,
  pickRotationDraft,
  countRecentRotations,
  _internals: { createRotationAd },
};
