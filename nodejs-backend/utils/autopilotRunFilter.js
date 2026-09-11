/**
 * Mongo filter for the Autopilot run-history table.
 *
 * Lives here rather than in the controller for the same reason
 * `utils/ipAccessRule.js` does: the controller pulls in Redis and the run
 * model on require, so a filter that sits inside it cannot be asserted
 * without standing those up. Nothing in here touches the database.
 */

// The `status` enum from Module/autopilot/autopilotRun.js. Kept as the accepted
// filter values so a request string never reaches the query itself.
const RUN_STATUSES = Object.freeze(["running", "complete", "failed", "skipped"]);

/**
 * Build the `find` filter for GET /admin/autopilot-runs.
 *
 * Every value written here is either a literal or a `Date`; nothing from the
 * query string is passed through as-is. `status` in particular is matched
 * against the schema enum with `$in`, which keeps the two behaviours that
 * matter: a valid status filters to it, and an unrecognised one yields an
 * empty list -- i.e. no runs -- rather than silently dropping the filter and
 * widening the table to everything, which is what a typo would otherwise do.
 */
function buildRunMatch(query = {}) {
  const match = {};
  // Date range, same shape the Meta usage dashboard uses. `to` arrives as a
  // date-only string from the picker; without the end-of-day push, "today"
  // would exclude every run that happened today -- the bug already fixed
  // once on the Meta usage endpoint, not worth repeating here.
  const { from, to } = query;
  if (from || to) {
    match.startedAt = {};
    if (from) match.startedAt.$gte = new Date(String(from));
    if (to) {
      const end = new Date(String(to));
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
        end.setUTCHours(23, 59, 59, 999);
      }
      match.startedAt.$lte = end;
    }
  }
  if (query.status) {
    // Repeated `?status=` params arrive as an array, which Mongoose used to
    // cast to `$in` on its own -- so multi-select keeps working. Each name is
    // matched against the enum and it is the enum's own entry that goes into
    // the query, never the request string that matched it.
    const requested = (Array.isArray(query.status) ? query.status : [query.status]).map(String);
    match.status = { $in: RUN_STATUSES.filter((s) => requested.includes(s)) };
  }
  if (query.dryRun === "true") match.dryRun = true;
  if (query.dryRun === "false") match.dryRun = false;
  return match;
}

module.exports = { RUN_STATUSES, buildRunMatch };
