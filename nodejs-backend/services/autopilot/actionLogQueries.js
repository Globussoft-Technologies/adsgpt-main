/**
 * actionLogQueries — every read the v4 cron makes against autopilotActionLog.
 *
 * WHY THESE ARE A MODULE AND NOT INLINE: the orchestrator's unit tests stub
 * the model, and the stubs return fixtures while ignoring the query object
 * entirely. That means a wrong field name, or a `$match` that can never
 * match, passes every test. The downstream logic is well covered; the
 * queries themselves were covered by nothing.
 *
 * The failure mode is silent, not loud. If `scaleHistoryFor` quietly returns
 * nothing, every entity reads as "no budget movement yet", gets FULL headroom
 * every hour, and the 7-day ceiling is effectively switched off — with no
 * error anywhere. Same shape of problem for the resume candidate lookup: an
 * over-narrow `$match` means resume silently never fires and looks like it is
 * simply behaving.
 *
 * Extracted here so `scripts/verify-autopilot-queries.js` can run the REAL
 * functions against a REAL database rather than a copy that might drift.
 * Every one of these is a pure query — no policy, no decisions.
 */

const AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");

const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

/**
 * Entities these rules actually paused, for real, inside the window — the
 * resume pass's candidate list.
 *
 * `dryRun: false` matters: a dry-run row never touched Meta, so there is
 * nothing to reverse. `pausedBy: 'autopilot'` is what keeps Autopilot from
 * un-pausing something a human paused.
 *
 * Grouped by (level, entityId) taking the most recent pause, because an
 * entity paused repeatedly should be judged against its LATEST pause.
 */
async function autopilotPausesFor({ userId, adAccountId, ruleIds, sinceDays }) {
  return AutopilotActionLog.aggregate([
    {
      $match: {
        userId,
        adAccountId,
        ruleId: { $in: ruleIds },
        action: "pause",
        outcome: "success",
        dryRun: false,
        pausedBy: "autopilot",
        runAt: { $gte: daysAgo(sinceDays) },
      },
    },
    { $sort: { runAt: -1 } },
    {
      $group: {
        _id: { level: "$level", entityId: "$entityId" },
        entityName: { $first: "$entityName" },
        campaignId: { $first: "$campaignId" },
        lastPausedAt: { $first: "$runAt" },
        ruleId: { $first: "$ruleId" },
      },
    },
  ]);
}

/**
 * Pause/resume rows for one entity, oldest first, for the flap counter.
 * Only real actions count — a dry-run row represents nothing that happened.
 */
async function flapHistoryFor({ adAccountId, entityId, sinceDays }) {
  return AutopilotActionLog.find(
    {
      adAccountId,
      entityId,
      pausedBy: "autopilot",
      dryRun: false,
      runAt: { $gte: daysAgo(sinceDays) },
    },
    { action: 1, runAt: 1 },
  )
    .sort({ runAt: 1 })
    .lean();
}

/**
 * Has the retirement row for THIS pause already been written? Scoped to
 * `runAt >= since` (the entity's last pause) so a fresh pause starts a fresh
 * trial budget rather than inheriting an old retirement.
 */
async function retirementRecorded({
  adAccountId,
  entityId,
  ruleId,
  skipReason,
  since,
}) {
  const found = await AutopilotActionLog.exists({
    adAccountId,
    entityId,
    ruleId,
    action: "resume",
    skipReason,
    runAt: { $gte: since },
  });
  return !!found;
}

/**
 * Committed budget changes for one entity inside the cumulative window,
 * OLDEST FIRST — the caller wants `[0].actionPayload.prev_budget` as the
 * baseline the current budget is compared against.
 *
 * `dryRun: false` again: a dry-run row logged a budget that was never set,
 * so counting it would make the ceiling reject real moves that never
 * happened.
 */
async function scaleHistoryFor({ adAccountId, entityId, sinceDays }) {
  return AutopilotActionLog.find(
    {
      adAccountId,
      entityId,
      action: "scale_budget",
      outcome: "success",
      dryRun: false,
      runAt: { $gte: daysAgo(sinceDays) },
    },
    { actionPayload: 1, runAt: 1 },
  )
    .sort({ runAt: 1 })
    .lean();
}

module.exports = {
  autopilotPausesFor,
  flapHistoryFor,
  retirementRecorded,
  scaleHistoryFor,
  _internals: { daysAgo, DAY_MS },
};
