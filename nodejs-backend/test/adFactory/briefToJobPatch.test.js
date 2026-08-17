#!/usr/bin/env node
/**
 * Tests for services/adFactory/briefToJobPatch.js.
 *
 * The bug: `updateBrief` re-materialised the campaign but never touched the
 * AdsFactoryJob, so cadence / pairs-per-run / model edits on a LIVE brief were
 * saved, displayed, and then ignored by the thing actually running.
 *
 * The two properties that matter here are opposites, and both are load-bearing:
 *
 *   1. A real change MUST produce a patch, or the original bug is back.
 *   2. A no-op MUST produce `{}`, or every unrelated field edit reschedules the
 *      queue — `updateJob` rebuilds the cron whenever `schedule` is present, so
 *      a dump-everything mapper would drag `nextRunAt` around while the user
 *      edits their headline.
 *
 * The emitted patch is validated against the LIVE `updateJobSchema`, imported
 * rather than copied, so drift between the two breaks the build.
 *
 * Run:  node test/adFactory/briefToJobPatch.test.js
 */

const assert = require("node:assert/strict");

const { briefToJobPatch } = require("../../services/adFactory/briefToJobPatch");
const { updateJobSchema } = require("../../Validations/adsFactoryAuto/adsFactoryAutoValidation");

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A brief and a job that AGREE. Every test starts from here and changes one
// thing, so any patch produced is unambiguously caused by that change.
const brief = (over = {}) => ({
  delivery: {
    pairsPerCycle: 3,
    frequency: {
      preset: "weekly",
      hour: 9,
      timezone: "Asia/Kolkata",
      startDate: new Date("2026-08-01T00:00:00Z"),
      endDate: null,
    },
    ...(over.delivery || {}),
  },
  generation: { imageModel: "auto", ...(over.generation || {}) },
});

const job = (over = {}) => ({
  pairsPerCycle: 3,
  model: null,
  schedule: {
    frequency: "weekly",
    hour: 9,
    timezone: "Asia/Kolkata",
    startDate: new Date("2026-08-01T00:00:00Z"),
    endDate: null,
    nextRunAt: new Date("2026-08-24T03:30:00Z"),
  },
  ...over,
});

// Merge a partial frequency over the agreed baseline.
const withFreq = (patch) =>
  brief({ delivery: { pairsPerCycle: 3, frequency: { ...brief().delivery.frequency, ...patch } } });

// ─── ─────────────────────────────────────────────────────────────────────────

group("THE BUG: a real edit reaches the job", () => {
  test("changing the hour emits a schedule", () => {
    const { patch, changed } = briefToJobPatch(withFreq({ hour: 18 }), job());
    assert.equal(patch.schedule.hour, 18);
    assert.deepEqual(changed, ["schedule.hour"]);
  });

  test("changing the frequency emits a schedule", () => {
    const { patch, changed } = briefToJobPatch(withFreq({ preset: "daily" }), job());
    assert.equal(patch.schedule.frequency, "daily");
    assert.deepEqual(changed, ["schedule.frequency"]);
  });

  test("changing the timezone emits a schedule", () => {
    const { patch } = briefToJobPatch(withFreq({ timezone: "America/New_York" }), job());
    assert.equal(patch.schedule.timezone, "America/New_York");
  });

  test("changing pairsPerCycle emits it alone — no schedule churn", () => {
    const { patch, changed } = briefToJobPatch(
      brief({ delivery: { pairsPerCycle: 5, frequency: brief().delivery.frequency } }),
      job(),
    );
    assert.deepEqual(patch, { pairsPerCycle: 5 });
    assert.deepEqual(changed, ["pairsPerCycle"]);
  });

  test("changing the image model emits it", () => {
    const { patch } = briefToJobPatch(brief({ generation: { imageModel: "flux" } }), job());
    assert.deepEqual(patch, { model: "flux" });
  });

  test("several edits at once travel together", () => {
    const b = brief({
      delivery: { pairsPerCycle: 7, frequency: { ...brief().delivery.frequency, hour: 6 } },
      generation: { imageModel: "flux" },
    });
    const { patch, changed } = briefToJobPatch(b, job());
    assert.equal(patch.schedule.hour, 6);
    assert.equal(patch.pairsPerCycle, 7);
    assert.equal(patch.model, "flux");
    assert.equal(changed.length, 3);
  });
});

group("THE OTHER HALF: a no-op must not touch the queue", () => {
  test("identical brief and job produce nothing", () => {
    const { patch, changed } = briefToJobPatch(brief(), job());
    assert.deepEqual(patch, {});
    assert.deepEqual(changed, []);
  });

  test("editing a field the job does not own produces nothing", () => {
    // What the Adjust panel does on nearly every keystroke-save.
    const b = brief();
    b.brand = { name: "New name" };
    b.offer = { statedGoal: "Sell more socks" };
    assert.deepEqual(briefToJobPatch(b, job()).patch, {});
  });

  test("a Date round-tripped through JSON is not a change", () => {
    // Dates come back from the API as ISO strings and from Mongo as Dates.
    // Comparing them raw reported a diff on every single PATCH.
    const b = withFreq({ startDate: "2026-08-01T00:00:00.000Z" });
    assert.deepEqual(briefToJobPatch(b, job()).patch, {});
  });

  test("`auto` is never sent as a model", () => {
    // Our own sentinel for "we pick", not a provider the job understands —
    // briefToJobPayload omits it at creation, so the diff must too.
    assert.deepEqual(briefToJobPatch(brief(), job({ model: null })).patch, {});
  });
});

group("a brief cannot clear what it has no control for", () => {
  test("a missing hour keeps the job's", () => {
    const b = withFreq({ hour: undefined });
    assert.deepEqual(briefToJobPatch(b, job({ ...job(), schedule: { ...job().schedule, hour: 17 } })).patch, {});
  });

  test("a missing timezone keeps the job's", () => {
    assert.deepEqual(briefToJobPatch(withFreq({ timezone: "" }), job()).patch, {});
  });

  test("a missing endDate does not clear the job's", () => {
    const j = job();
    j.schedule.endDate = new Date("2026-12-31T00:00:00Z");
    assert.deepEqual(briefToJobPatch(withFreq({ endDate: null }), j).patch, {});
  });

  test("startDate is never moved — it re-anchors the cadence", () => {
    // The job has run since; rewriting the anchor would shift which weekday a
    // weekly schedule lands on.
    const { patch } = briefToJobPatch(withFreq({ hour: 11, startDate: "2026-09-09" }), job());
    assert.equal(patch.schedule.startDate, "2026-08-01");
  });

  test("a brief with no frequency at all falls back to the job's", () => {
    const b = { delivery: { pairsPerCycle: 3 }, generation: {} };
    assert.deepEqual(briefToJobPatch(b, job()).patch, {});
  });
});

group("the emitted patch is valid against the LIVE updateJobSchema", () => {
  const cases = [
    ["hour change", withFreq({ hour: 18 })],
    ["frequency change", withFreq({ preset: "daily" })],
    ["timezone change", withFreq({ timezone: "Europe/Kyiv" })],
    ["end date added", withFreq({ endDate: "2026-12-31" })],
    ["pairs change", brief({ delivery: { pairsPerCycle: 12, frequency: brief().delivery.frequency } })],
    ["model change", brief({ generation: { imageModel: "flux" } })],
  ];

  for (const [label, b] of cases) {
    test(label, () => {
      const { patch } = briefToJobPatch(b, job());
      const { error } = updateJobSchema.validate(patch, { abortEarly: false });
      assert.equal(error, undefined, error && error.message);
    });
  }

  test("Asia/Kolkata survives validation", () => {
    // The zone an Indian browser reports, and the one an ICU-derived enum
    // rejects. This is the regression guard for that.
    const { patch } = briefToJobPatch(
      withFreq({ timezone: "Asia/Kolkata", hour: 7 }),
      job({ ...job(), schedule: { ...job().schedule, timezone: "UTC" } }),
    );
    assert.equal(patch.schedule.timezone, "Asia/Kolkata");
    assert.equal(updateJobSchema.validate(patch).error, undefined);
  });
});

group("hostile and degenerate input", () => {
  test("an unknown frequency preset falls back rather than throwing", () => {
    const { patch } = briefToJobPatch(withFreq({ preset: "hourly" }), job());
    // resolveFrequency maps anything unrecognised to the default, which here
    // happens to equal the job's — so no churn.
    assert.deepEqual(patch, {});
  });

  test("`custom` is never emitted — it needs a block the brief cannot carry", () => {
    const { patch } = briefToJobPatch(withFreq({ preset: "custom" }), job());
    assert.notEqual(patch.schedule?.frequency, "custom");
  });

  test("pairsPerCycle is clamped, not passed through", () => {
    const b = brief({ delivery: { pairsPerCycle: 9999, frequency: brief().delivery.frequency } });
    assert.equal(briefToJobPatch(b, job()).patch.pairsPerCycle, 200);
  });

  test("empty everything does not throw", () => {
    const { patch, changed } = briefToJobPatch({}, {});
    assert.deepEqual(changed, []);
    assert.deepEqual(patch, {});
  });

  test("Mongoose documents are handled", () => {
    const b = brief();
    const doc = { toObject: () => b };
    assert.deepEqual(briefToJobPatch(doc, { toObject: () => job() }).patch, {});
  });

  test("inputs are not mutated", () => {
    const b = withFreq({ hour: 18 });
    const j = job();
    const before = JSON.stringify({ b, j });
    briefToJobPatch(b, j);
    assert.equal(JSON.stringify({ b, j }), before);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
