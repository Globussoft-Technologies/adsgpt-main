#!/usr/bin/env node
/**
 * Tests for resolvePresetCron in services/adsFactoryAuto/adsFactoryAutoQueue.js.
 *
 * THE BUG
 *
 * `weekly` and `monthly` fell through the switch and returned null. That null
 * became `repeat: { pattern: null }` in BullMQ, so the job was created,
 * reported "active", showed no next run, and never fired.
 *
 * It went unnoticed because v1's schedule form never offered those words — it
 * spells weekly as `custom` with repeatUnit "week". Ad Factory Quick setup
 * does offer them, and `weekly` is its DEFAULT, so every job created through
 * that front door landed on the dead branch.
 *
 * Every pattern here is parsed with cron-parser, the same library the queue
 * uses to compute `nextRunAt` — a pattern that merely looks right but does not
 * parse would reproduce the bug with extra steps.
 *
 * Run:  node test/adsFactoryAuto/presetCron.test.js
 */

const assert = require("node:assert/strict");
const parser = require("cron-parser");

const { resolvePresetCron } = require("../../services/adsFactoryAuto/adsFactoryAutoQueue");

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// A Tuesday, and the 15th — so weekly and monthly anchors are distinguishable
// from any hardcoded fallback.
const TUESDAY_15TH = "2026-09-15";

// ─── ─────────────────────────────────────────────────────────────────────────

group("THE BUG: the two presets that produced no schedule at all", () => {
  test("weekly returns a pattern, not null", () => {
    const cron = resolvePresetCron("weekly", 9, TUESDAY_15TH);
    assert.notEqual(cron, null, "weekly still returns null — jobs will never fire");
    assert.equal(cron, "0 9 * * 2"); // 2 = Tuesday
  });

  test("monthly returns a pattern, not null", () => {
    const cron = resolvePresetCron("monthly", 9, TUESDAY_15TH);
    assert.notEqual(cron, null);
    assert.equal(cron, "0 9 15 * *");
  });

  test("weekly is what Quick setup defaults to — it must work with no start date", () => {
    // briefToJobPayload's DEFAULT_FREQUENCY. If this is null, the default path
    // through the entire feature creates dead jobs.
    const cron = resolvePresetCron("weekly", 9, null);
    assert.notEqual(cron, null);
    assert.equal(parser.parseExpression(cron).next() instanceof Object, true);
  });
});

group("every pattern actually parses and yields a next run", () => {
  const frequencies = ["daily", "weekly", "monthly", "every_weekday", "every_weekend"];

  for (const frequency of frequencies) {
    test(`${frequency} → a parseable cron with a future fire time`, () => {
      const cron = resolvePresetCron(frequency, 14, TUESDAY_15TH);
      assert.ok(cron, `${frequency} produced no pattern`);
      const next = parser.parseExpression(cron, { tz: "Asia/Kolkata" }).next().toDate();
      assert.ok(next.getTime() > Date.now(), `${frequency} has no future run`);
    });
  }
});

group("the chosen hour is honoured", () => {
  for (const hour of [0, 9, 13, 23]) {
    test(`hour ${hour} lands in the pattern`, () => {
      const cron = resolvePresetCron("weekly", hour, TUESDAY_15TH);
      assert.equal(cron.split(" ")[1], String(hour));
    });
  }

  test("a non-numeric hour degrades to midnight rather than corrupting the cron", () => {
    assert.equal(resolvePresetCron("daily", "not-a-number"), "0 0 * * *");
  });
});

group("weekly is anchored on the start date", () => {
  const days = [
    ["2026-09-13", 0], // Sunday
    ["2026-09-14", 1], // Monday
    ["2026-09-15", 2], // Tuesday
    ["2026-09-19", 6], // Saturday
  ];

  for (const [date, dow] of days) {
    test(`${date} → day-of-week ${dow}`, () => {
      assert.equal(resolvePresetCron("weekly", 8, date), `0 8 * * ${dow}`);
    });
  }

  test("matches the shape the custom branch builds for a one-day week", () => {
    // The `custom` path emits `0 ${hour} * * ${dowNums}`. Same shape here means
    // the two cannot drift into scheduling the same intent differently.
    assert.match(resolvePresetCron("weekly", 8, "2026-09-15"), /^0 8 \* \* \d$/);
  });
});

group("monthly never silently skips a month", () => {
  test("the 31st is clamped to 28", () => {
    // Cron does not fire on a day a month lacks — a job anchored to the 31st
    // would skip February, April, June, September and November entirely.
    assert.equal(resolvePresetCron("monthly", 10, "2026-01-31"), "0 10 28 * *");
  });

  test("the 29th and 30th are clamped too", () => {
    assert.equal(resolvePresetCron("monthly", 10, "2026-01-29"), "0 10 28 * *");
    assert.equal(resolvePresetCron("monthly", 10, "2026-01-30"), "0 10 28 * *");
  });

  test("a safe day is left alone", () => {
    assert.equal(resolvePresetCron("monthly", 10, "2026-01-05"), "0 10 5 * *");
  });

  test("a clamped pattern still fires every month of a year", () => {
    const it = parser.parseExpression(resolvePresetCron("monthly", 10, "2026-01-31"), {
      currentDate: new Date("2026-01-01T00:00:00Z"),
      tz: "UTC",
    });
    const months = new Set();
    for (let i = 0; i < 12; i += 1) months.add(it.next().toDate().getUTCMonth());
    assert.equal(months.size, 12, "some months are skipped");
  });
});

group("unknown frequencies stay null so the caller can refuse", () => {
  // resolveScheduleForQueue throws on null rather than handing BullMQ a repeat
  // with nothing to repeat on. Inventing a cadence for an unrecognised word
  // would be worse than the error.
  for (const frequency of ["biweekly", "fortnightly", "", null, undefined, "custom"]) {
    test(`${JSON.stringify(frequency)} → null`, () => {
      assert.equal(resolvePresetCron(frequency, 9, TUESDAY_15TH), null);
    });
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
