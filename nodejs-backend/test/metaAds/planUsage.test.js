const assert = require("assert");
const { filterActiveCampaigns, sumCounts } = require("../../utils/planUsagePure");

// ── filterActiveCampaigns ───────────────────────────────────────────────────
// Only ACTIVE/PAUSED count against the plan cap — deleting or archiving a
// campaign must free up a slot.
assert.deepStrictEqual(
  filterActiveCampaigns([
    { id: "1", status: "ACTIVE" },
    { id: "2", status: "PAUSED" },
    { id: "3", status: "ARCHIVED" },
    { id: "4", status: "DELETED" },
  ]),
  [
    { id: "1", status: "ACTIVE" },
    { id: "2", status: "PAUSED" },
  ],
);

// Empty/absent input is safe.
assert.deepStrictEqual(filterActiveCampaigns([]), []);
assert.deepStrictEqual(filterActiveCampaigns(null), []);
assert.deepStrictEqual(filterActiveCampaigns(undefined), []);

// A malformed row (missing status) is dropped, not thrown on.
assert.deepStrictEqual(filterActiveCampaigns([{ id: "1" }]), []);

// ── sumCounts ────────────────────────────────────────────────────────────────
assert.strictEqual(sumCounts([1, 2, 3]), 6);
assert.strictEqual(sumCounts([]), 0);
assert.strictEqual(sumCounts(null), 0);
// A failed per-connection/per-account fetch resolves to a non-numeric or
// missing entry rather than throwing (see planUsage.js's catch blocks) — the
// total must still be well-defined instead of producing NaN.
assert.strictEqual(sumCounts([1, undefined, 2, NaN]), 3);

console.log("planUsage tests passed");
