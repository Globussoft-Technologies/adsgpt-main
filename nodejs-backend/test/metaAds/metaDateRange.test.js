const assert = require("assert");
const dayjs = require("dayjs");
const {
  resolveDateRange,
  presetWindow,
  precedingWindow,
  FIXED_LENGTH_PRESETS,
  NO_PREVIOUS_PRESETS,
} = require("../../utils/metaDateRange");

// Fixed "now" so calendar-relative presets are deterministic.
const NOW = dayjs("2026-07-15T12:00:00Z");
const at = (q) => resolveDateRange(q, { now: NOW });

const spanDays = (w) => dayjs(w.until).diff(dayjs(w.since), "day") + 1;

// Every preset the UI offers (metaAdsUtils.js DATE_PRESETS).
const UI_PRESETS = [
  "today", "yesterday", "last_3d", "last_7d", "last_14d", "last_28d",
  "last_30d", "last_90d", "this_month", "last_month", "this_quarter",
  "last_quarter", "this_year", "last_year", "lifetime", "maximum",
];

// ── The regression this file exists for ────────────────────────────────────
// getAnalyticsData used to map preset->preset with a 6-entry table and fall
// back to "last_30d". `last_14d` — the DEFAULT — was unmapped, so the default
// dashboard compared 14 days against 30. Every preset must now resolve to a
// concrete preceding window of its own length.
for (const preset of UI_PRESETS) {
  const r = at({ datePreset: preset });
  assert.strictEqual(r.mode, "preset", `${preset} should resolve as a preset`);
  // `current` stays a preset on purpose (Meta's timezone/day-boundary
  // semantics); only `previous` is converted to a concrete window.
  assert.deepStrictEqual(r.current, { date_preset: preset });

  if (NO_PREVIOUS_PRESETS.has(preset)) {
    assert.strictEqual(r.previous, null, `${preset} must have no previous window`);
  } else {
    assert.ok(r.previous?.time_range, `${preset} must resolve a previous window`);
  }
}

// Fixed-length presets: previous window is the same length as current, and
// ends the day immediately before current starts.
for (const [preset, len] of Object.entries(FIXED_LENGTH_PRESETS)) {
  const cur = presetWindow(preset, NOW);
  const prev = at({ datePreset: preset }).previous.time_range;
  assert.strictEqual(spanDays(cur), len, `${preset} current span`);
  assert.strictEqual(spanDays(prev), len, `${preset} previous span must match current`);
  assert.strictEqual(
    dayjs(prev.until).add(1, "day").format("YYYY-MM-DD"),
    cur.since,
    `${preset} previous must end the day before current begins`,
  );
}

// The specific old bug: last_14d must compare against the preceding 14 days,
// NOT last_30d.
const l14 = at({ datePreset: "last_14d" });
assert.strictEqual(spanDays(l14.previous.time_range), 14);

// Calendar presets resolve sensibly against the fixed NOW (2026-07-15).
assert.deepStrictEqual(presetWindow("this_month", NOW), {
  since: "2026-07-01",
  until: "2026-07-15",
});
assert.deepStrictEqual(presetWindow("last_month", NOW), {
  since: "2026-06-01",
  until: "2026-06-30",
});
assert.deepStrictEqual(presetWindow("last_year", NOW), {
  since: "2025-01-01",
  until: "2025-12-31",
});
// July is Q3 -> quarter starts 1 Jul; previous quarter is Apr-Jun.
assert.deepStrictEqual(presetWindow("this_quarter", NOW), {
  since: "2026-07-01",
  until: "2026-07-15",
});
assert.deepStrictEqual(presetWindow("last_quarter", NOW), {
  since: "2026-04-01",
  until: "2026-06-30",
});

// ── custom ranges ──────────────────────────────────────────────────────────
const custom = at({ since: "2026-07-01", until: "2026-07-15" });
assert.strictEqual(custom.mode, "range");
assert.deepStrictEqual(custom.current, {
  time_range: { since: "2026-07-01", until: "2026-07-15" },
});
// 15-day window -> previous is the 15 days immediately before it.
assert.deepStrictEqual(custom.previous.time_range, {
  since: "2026-06-16",
  until: "2026-06-30",
});

// Single-day range.
assert.deepStrictEqual(
  at({ since: "2026-07-10", until: "2026-07-10" }).previous.time_range,
  { since: "2026-07-09", until: "2026-07-09" },
);

// ── cache tokens ───────────────────────────────────────────────────────────
// THE collision this codebase has been bitten by: two different custom ranges
// must never share a cache key.
const tokenA = at({ since: "2026-07-01", until: "2026-07-15" }).token;
const tokenB = at({ since: "2026-06-01", until: "2026-06-15" }).token;
assert.notStrictEqual(tokenA, tokenB, "distinct custom ranges need distinct tokens");
assert.strictEqual(tokenA, at({ since: "2026-07-01", until: "2026-07-15" }).token, "token must be deterministic");
assert.notStrictEqual(at({ datePreset: "last_7d" }).token, at({ datePreset: "last_14d" }).token);
// A preset token and a range token can never collide (different prefixes).
assert.ok(at({ datePreset: "last_7d" }).token.startsWith("p:"));
assert.ok(tokenA.startsWith("r:"));

// ── validation ─────────────────────────────────────────────────────────────
const rejects = (q, why) => {
  assert.throws(
    () => at(q),
    (e) => e.statusCode === 400 && e.code === "INVALID_DATE_RANGE",
    why,
  );
};
rejects({ since: "2026-07-01" }, "since without until");
rejects({ until: "2026-07-01" }, "until without since");
rejects({ since: "07-01-2026", until: "2026-07-15" }, "non-ISO format");
rejects({ since: "2026-07-15", until: "2026-07-01" }, "since after until");
rejects({ since: "2026-07-01", until: "2099-01-01" }, "future until");
rejects({ since: "2000-01-01", until: "2026-07-01" }, "span beyond Meta's 37-month cap");

// Empty query falls back to the documented default.
assert.strictEqual(at({}).datePreset, "last_30d");

// precedingWindow is null-safe (lifetime/maximum path).
assert.strictEqual(precedingWindow(null), null);

console.log(`metaDateRange tests passed (${UI_PRESETS.length} presets verified)`);
