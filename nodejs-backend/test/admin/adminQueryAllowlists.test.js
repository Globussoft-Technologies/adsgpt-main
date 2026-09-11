/**
 * The admin list endpoints build Mongo filters straight from the query string.
 * These assertions pin the behaviour that was in place when those filters were
 * rewritten to keep request values out of the query object: the rewrite was
 * meant to be invisible from the outside, and this is what says so.
 */
process.env.ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "test-access-token-secret";

const assert = require("node:assert");
const { RUN_STATUSES, buildRunMatch } = require("../../utils/autopilotRunFilter");
const { ACTIONS, STATUSES } = require("../../utils/ipAccessRule");
const {
  _internals: { buildSort },
} = require("../../controllers/admin/metaUsageDashboard.controller");
const AutopilotRun = require("../../Module/autopilot/autopilotRun");

// ---------------------------------------------------------------------------
// Autopilot run history
// ---------------------------------------------------------------------------
// The filter is only as good as its copy of the enum: if a status is added to
// the schema and not here, that status quietly becomes unfilterable.
assert.deepStrictEqual(
  [...RUN_STATUSES].sort(),
  [...AutopilotRun.schema.path("status").enumValues].sort(),
  "RUN_STATUSES has drifted from the autopilotRun schema enum",
);

assert.deepStrictEqual(buildRunMatch({}), {}, "no query params means no filter");

// A valid status still selects exactly that status.
assert.deepStrictEqual(buildRunMatch({ status: "complete" }), {
  status: { $in: ["complete"] },
});
for (const status of RUN_STATUSES) {
  assert.deepStrictEqual(buildRunMatch({ status }).status, { $in: [status] });
}

// An unrecognised status matches nothing -- the same answer the unvalidated
// filter gave. Dropping the filter instead would widen the table to every run.
assert.deepStrictEqual(buildRunMatch({ status: "bogus" }), { status: { $in: [] } });
assert.deepStrictEqual(buildRunMatch({ status: "Complete" }), { status: { $in: [] } });

// Repeated `?status=` params arrive as an array and still select every status
// named -- Mongoose used to cast that to `$in` itself, so the table keeps the
// multi-select it already had. Unknown names in the list are simply dropped.
assert.deepStrictEqual(buildRunMatch({ status: ["running", "complete"] }), {
  status: { $in: ["running", "complete"] },
});
assert.deepStrictEqual(buildRunMatch({ status: ["complete", "running"] }).status.$in.sort(), [
  "complete",
  "running",
]);
assert.deepStrictEqual(buildRunMatch({ status: ["running", "bogus"] }), {
  status: { $in: ["running"] },
});

// Operator shapes cannot reach the query, with or without the sanitize
// middleware in front of it. This is the one intended change in what the
// endpoint returns: `?status[$ne]=complete` used to select every other run.
assert.deepStrictEqual(buildRunMatch({ status: { $ne: "complete" } }), {
  status: { $in: [] },
});
assert.deepStrictEqual(buildRunMatch({ status: { $gt: "" } }), { status: { $in: [] } });

// Dates: `from` is taken as given, `to` is pushed to end-of-day only when it
// arrives as a bare date, which is what the picker sends.
const range = buildRunMatch({ from: "2026-01-01", to: "2026-01-31" });
assert.strictEqual(range.startedAt.$gte.toISOString(), "2026-01-01T00:00:00.000Z");
assert.strictEqual(range.startedAt.$lte.toISOString(), "2026-01-31T23:59:59.999Z");

const instant = buildRunMatch({ to: "2026-01-31T08:00:00.000Z" });
assert.strictEqual(instant.startedAt.$lte.toISOString(), "2026-01-31T08:00:00.000Z");
assert.ok(!("$gte" in instant.startedAt), "no `from` means no lower bound");

// dryRun is a tri-state: absent leaves the filter off entirely.
assert.strictEqual(buildRunMatch({ dryRun: "true" }).dryRun, true);
assert.strictEqual(buildRunMatch({ dryRun: "false" }).dryRun, false);
assert.ok(!("dryRun" in buildRunMatch({ dryRun: "yes" })));
assert.ok(!("dryRun" in buildRunMatch({})));

// ---------------------------------------------------------------------------
// Meta usage sort
// ---------------------------------------------------------------------------
assert.deepStrictEqual(buildSort({}), { calls: -1 }, "default sort");
assert.deepStrictEqual(buildSort({ sort: "failures" }), { failures: -1 });
assert.deepStrictEqual(buildSort({ sort: "calls", order: "asc" }), { calls: 1 });
assert.deepStrictEqual(buildSort({ sort: "calls", order: "ASC" }), { calls: 1 });
assert.deepStrictEqual(buildSort({ sort: "calls", order: "sideways" }), { calls: -1 });

// Anything off the list falls back to `calls` rather than becoming a field name.
for (const sort of ["__proto__", "constructor", "secretField", { a: 1 }, ["calls"]]) {
  assert.deepStrictEqual(buildSort({ sort }), { calls: -1 });
}
assert.deepStrictEqual(Object.keys(buildSort({ sort: "__proto__" })), ["calls"]);

// ---------------------------------------------------------------------------
// IP access rules
// ---------------------------------------------------------------------------
// The controller filters on these directly; changing them changes the API.
assert.deepStrictEqual(ACTIONS, ["allow", "block"]);
assert.deepStrictEqual(STATUSES, ["active", "inactive"]);
assert.strictEqual(ACTIONS.find((a) => a === "deny"), undefined);
assert.strictEqual(STATUSES.find((s) => s === "archived"), undefined);

console.log("Admin query allowlist tests passed");
