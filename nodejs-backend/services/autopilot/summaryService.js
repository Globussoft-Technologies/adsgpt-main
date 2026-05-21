/**
 * summaryService — aggregations over autopilotActionLog for the Phase 4 UI.
 *
 * Two callable shapes:
 *
 *   buildSummary(rows)
 *     Pure function: given a list of action-log rows, return the per-window
 *     rollup the Overview tab renders (counts by action/severity/outcome,
 *     top rules, by-account breakdown, etc.). No DB. Unit-testable.
 *
 *   buildRunDetail({ runId, rows })
 *     Pure function: given the rows of a single run, return the run-level
 *     rollup (account-by-account counts) the per-run drilldown renders.
 *
 * The HTTP controllers in autopilotController.js are thin wrappers that
 * load rows from Mongo and pass them to these helpers.
 *
 * Why pure-function-first:
 *   - Tests can fixture rows directly without spinning up Mongo.
 *   - When we add caching later, the HTTP path can read from Redis without
 *     duplicating aggregation logic.
 */

const ACTION_TYPES = [
  "pause",
  "resume",
  "scale_budget",
  "rotate_creative",
  "generate_creative",
  "rename",
  "alert_only",
];
const OUTCOMES = ["success", "failed", "skipped"];
// v4 user-rule severities + legacy v3 audit severities. Both bucket sets
// are tracked so the by_severity rollup keeps working for cycles whose
// rows span the cutover (or for users whose tenants still produce v3
// audit rows alongside v4 user-rule rows).
const SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
  "warning",
  "opportunity",
];

function emptyOutcomeCounts() {
  return {
    success: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
}

/**
 * Build a windowed summary from action-log rows.
 *
 * @param {Array<Object>} rows  autopilotActionLog rows (lean Mongo docs)
 * @returns {Object} summary
 */
function buildSummary(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];

  const by_action = {};
  for (const a of ACTION_TYPES) by_action[a] = emptyOutcomeCounts();

  const by_severity = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
    warning: 0,
    opportunity: 0,
  };
  const by_dryRun = { true: 0, false: 0 };
  const by_account_map = new Map();
  // ruleId → { count, name }. We carry ruleMessage so the UI can render
  // a friendly name for v4 rules (whose `ruleId` is a Mongo ObjectId).
  const rule_counts = new Map();
  // 'YYYY-MM-DD' (UTC) → { date, total, by_action }. Per-day rollup that
  // drives the Overview "Activity over time" chart. Computed here (not
  // from the paginated /log endpoint) so the chart sees EVERY row in the
  // window, not just the most-recent page. Days with zero actions are
  // simply absent — the frontend pre-seeds the full window.
  const by_day_map = new Map();

  let lastRunAt = null;
  let firstRunAt = null;

  for (const r of safeRows) {
    // by_action
    const actionBucket = by_action[r.action] || (by_action[r.action] = emptyOutcomeCounts());
    if (OUTCOMES.includes(r.outcome)) actionBucket[r.outcome] += 1;
    actionBucket.total += 1;

    // by_severity
    if (SEVERITIES.includes(r.ruleSeverity)) by_severity[r.ruleSeverity] += 1;

    // by_dryRun
    by_dryRun[String(!!r.dryRun)] += 1;

    // by_account — keyed by adAccountId, name from first row seen.
    const acctKey = r.adAccountId || "(unknown)";
    if (!by_account_map.has(acctKey)) {
      by_account_map.set(acctKey, {
        adAccountId: acctKey,
        adAccountName: r.adAccountName || null,
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        by_action: {},
      });
    }
    const acct = by_account_map.get(acctKey);
    acct.total += 1;
    if (OUTCOMES.includes(r.outcome)) acct[r.outcome] += 1;
    acct.by_action[r.action] = (acct.by_action[r.action] || 0) + 1;
    // First non-null name wins so tests with mixed rows still show a name
    if (!acct.adAccountName && r.adAccountName) acct.adAccountName = r.adAccountName;

    // rule_counts — capture the rule's friendly name from the first row
    // we see for it; later rows without a name don't overwrite a present one.
    if (r.ruleId) {
      const cur = rule_counts.get(r.ruleId) || { count: 0, name: null };
      cur.count += 1;
      if (!cur.name && r.ruleMessage) cur.name = r.ruleMessage;
      rule_counts.set(r.ruleId, cur);
    }

    // run-time min/max + per-day bucket
    if (r.runAt) {
      const d = new Date(r.runAt);
      const t = d.getTime();
      if (!Number.isNaN(t)) {
        if (lastRunAt === null || t > lastRunAt) lastRunAt = t;
        if (firstRunAt === null || t < firstRunAt) firstRunAt = t;

        // Bucket by UTC calendar day. The frontend pre-seeds its window
        // with UTC days too, so the keys line up regardless of the
        // viewer's timezone.
        const dayKey = d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
        let day = by_day_map.get(dayKey);
        if (!day) {
          day = { date: dayKey, total: 0, by_action: {} };
          by_day_map.set(dayKey, day);
        }
        day.total += 1;
        if (r.action) {
          day.by_action[r.action] = (day.by_action[r.action] || 0) + 1;
        }
      }
    }
  }

  const top_rules = [...rule_counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([ruleId, { count, name }]) => ({ ruleId, count, name }));

  // Sort days ascending so the chart can render left-to-right without
  // re-sorting. Empty days are absent — the frontend fills the gaps.
  const by_day = [...by_day_map.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    total: safeRows.length,
    by_action,
    by_severity,
    by_dryRun,
    by_account: [...by_account_map.values()].sort(
      (a, b) => b.total - a.total,
    ),
    by_day,
    top_rules,
    first_run_at: firstRunAt ? new Date(firstRunAt).toISOString() : null,
    last_run_at: lastRunAt ? new Date(lastRunAt).toISOString() : null,
  };
}

/**
 * Build a per-run drilldown (single runId).
 *
 * @param {Object} args
 * @param {string} args.runId
 * @param {Array<Object>} args.rows  rows for this runId
 */
function buildRunDetail({ runId, rows }) {
  if (!runId || !Array.isArray(rows)) {
    return { runId: runId || null, total: 0, accounts: [], rows: [] };
  }
  const summary = buildSummary(rows);
  // Sort rows oldest → newest so the UI renders chronologically.
  const sortedRows = [...rows].sort(
    (a, b) => new Date(a.runAt || 0) - new Date(b.runAt || 0),
  );
  return {
    runId,
    total: rows.length,
    first_run_at: summary.first_run_at,
    last_run_at: summary.last_run_at,
    by_action: summary.by_action,
    by_account: summary.by_account,
    rows: sortedRows,
  };
}

module.exports = {
  buildSummary,
  buildRunDetail,
  // exported for tests / consistency
  ACTION_TYPES,
  OUTCOMES,
  SEVERITIES,
};
