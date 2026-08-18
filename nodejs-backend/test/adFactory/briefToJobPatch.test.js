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
// A LEADS/WEBSITE brief, because the CTA guard resolves against the objective's
// own wizardSchema cell — an invented objective would make that untestable.
const OBJECTIVE = "OUTCOME_LEADS";
const CONVERSION_LOCATION = "WEBSITE";

const brief = (over = {}) => ({
  offer: {
    primaryObjective: OBJECTIVE,
    conversionLocation: CONVERSION_LOCATION,
    cta: { button: "SIGN_UP", url: "https://example.com/offer" },
    ...(over.offer || {}),
  },
  delivery: {
    pairsPerCycle: 3,
    budget: { daily: 800, currency: "INR" },
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
  ...(over.alertEmails !== undefined ? { alertEmails: over.alertEmails } : {}),
});

const job = (over = {}) => ({
  pairsPerCycle: 3,
  model: null,
  alerts: { emailTo: "" },
  schedule: {
    frequency: "weekly",
    hour: 9,
    timezone: "Asia/Kolkata",
    startDate: new Date("2026-08-01T00:00:00Z"),
    endDate: null,
    nextRunAt: new Date("2026-08-24T03:30:00Z"),
  },
  targets: {
    meta: {
      facebookId: "fb-1",
      connectionId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      template: {
        name: "Acme",
        objective: OBJECTIVE,
        conversionLocation: CONVERSION_LOCATION,
        payload: {
          adAccountId: "act_123",
          // The synthesizer expresses the budget as an AD-SET budget, never a
          // root dailyBudget — a bare dailyBudget skips the major→minor
          // conversion and would bill ₹8 instead of ₹800.
          adSetBudget: 800,
          adSetBudgetType: "daily",
          callToAction: "SIGN_UP",
          linkUrl: "https://example.com/offer",
        },
      },
    },
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

group("budget, CTA and link reach the job's meta template", () => {
  const payloadOf = (p) => p.targets?.meta?.template?.payload;

  test("a budget change lands on adSetBudget, not dailyBudget", () => {
    const b = brief({ delivery: { ...brief().delivery, budget: { daily: 1200 } } });
    const { patch, changed } = briefToJobPatch(b, job());
    assert.deepEqual(payloadOf(patch), { adSetBudget: 1200 });
    assert.equal(payloadOf(patch).dailyBudget, undefined);
    assert.deepEqual(changed, ["budget"]);
  });

  test("the connection ids travel with it — updateTargetsSchema needs them", () => {
    const b = brief({ delivery: { ...brief().delivery, budget: { daily: 1200 } } });
    const { patch } = briefToJobPatch(b, job());
    assert.equal(patch.targets.meta.facebookId, "fb-1");
    assert.equal(patch.targets.meta.connectionId, "aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  test("ONLY editable keys are sent — the rest are rejected by name upstream", () => {
    const b = brief({ delivery: { ...brief().delivery, budget: { daily: 1200 } } });
    const sent = Object.keys(payloadOf(briefToJobPatch(b, job()).patch));
    const EDITABLE = ["dailyBudget", "lifetimeBudget", "adSetBudget", "spendCap", "callToAction", "linkUrl"];
    assert.ok(sent.every((k) => EDITABLE.includes(k)), `non-editable key sent: ${sent}`);
  });

  test("a link change lands", () => {
    const b = brief({ offer: { ...brief().offer, cta: { button: "SIGN_UP", url: "https://example.com/new" } } });
    assert.deepEqual(payloadOf(briefToJobPatch(b, job()).patch), {
      linkUrl: "https://example.com/new",
    });
  });

  test("a CTA change lands when the objective's cell allows that button", () => {
    const b = brief({ offer: { ...brief().offer, cta: { button: "LEARN_MORE", url: "https://example.com/offer" } } });
    const { patch, changed } = briefToJobPatch(b, job());
    assert.equal(payloadOf(patch).callToAction, "LEARN_MORE");
    assert.deepEqual(changed, ["cta"]);
  });

  test("a CTA the current objective does NOT allow is dropped, not pushed", () => {
    // A user can change the objective without touching the CTA. Sending a
    // button the cell rejects turns an edit into a Meta failure hours later,
    // inside a cron worker, where nobody sees it.
    const b = brief({
      offer: {
        primaryObjective: "OUTCOME_AWARENESS",
        conversionLocation: "WEBSITE",
        cta: { button: "SIGN_UP", url: "https://example.com/offer" },
      },
    });
    const { changed } = briefToJobPatch(b, job());
    assert.equal(changed.includes("cta"), false);
  });

  test("no template on the job means no targets block", () => {
    const j = job({ targets: { meta: { facebookId: "fb-1", connectionId: "a".repeat(24) } } });
    const b = brief({ delivery: { ...brief().delivery, budget: { daily: 1200 } } });
    assert.equal(briefToJobPatch(b, j).patch.targets, undefined);
  });

  test("an unchanged budget/CTA/link sends no targets at all", () => {
    assert.equal(briefToJobPatch(brief(), job()).patch.targets, undefined);
  });

  test("a zero or missing budget never clears the job's", () => {
    // A 0 budget produces a campaign that silently never delivers.
    for (const daily of [0, null, undefined, NaN]) {
      const b = brief({ delivery: { ...brief().delivery, budget: { daily } } });
      assert.equal(briefToJobPatch(b, job()).patch.targets, undefined, `daily=${daily}`);
    }
  });
});

group("alert emails — the field that never existed", () => {
  test("recipients reach the job as one comma-separated string", () => {
    // briefToJobPayload has read `brief.alertEmails` since it was written and
    // the schema had no such field, so every read returned undefined and no
    // Quick setup job ever had alerts.
    const b = brief({ alertEmails: ["a@x.com", "b@x.com"] });
    const { patch, changed } = briefToJobPatch(b, job());
    assert.deepEqual(patch.alerts, { emailTo: "a@x.com,b@x.com" });
    assert.deepEqual(changed, ["alerts"]);
  });

  test("clearing the list CLEARS the job — unlike endDate", () => {
    // The brief has a control that can express "nobody", so an empty array is
    // an instruction, not an absence.
    const b = brief({ alertEmails: [] });
    const j = job({ alerts: { emailTo: "a@x.com" } });
    assert.deepEqual(briefToJobPatch(b, j).patch.alerts, { emailTo: "" });
  });

  test("no alertEmails key at all touches nothing", () => {
    const j = job({ alerts: { emailTo: "a@x.com" } });
    assert.equal(briefToJobPatch(brief(), j).patch.alerts, undefined);
  });

  test("blank entries are stripped rather than producing empty recipients", () => {
    const b = brief({ alertEmails: ["a@x.com", "  ", ""] });
    assert.deepEqual(briefToJobPatch(b, job()).patch.alerts, { emailTo: "a@x.com" });
  });

  test("an unchanged list produces no patch", () => {
    const b = brief({ alertEmails: ["a@x.com"] });
    const j = job({ alerts: { emailTo: "a@x.com" } });
    assert.equal(briefToJobPatch(b, j).patch.alerts, undefined);
  });
});

group("custom cadence round-trips", () => {
  const customBrief = (custom) =>
    brief({
      delivery: {
        ...brief().delivery,
        frequency: { ...brief().delivery.frequency, preset: "custom", custom },
      },
    });

  test("every 2 weeks on Tue and Thu", () => {
    const { patch } = briefToJobPatch(
      customBrief({ repeatEvery: 2, repeatUnit: "week", repeatOnDays: ["tuesday", "thursday"] }),
      job(),
    );
    assert.deepEqual(patch.schedule.customFrequency, {
      repeatEvery: 2,
      repeatUnit: "week",
      repeatOnDays: ["tuesday", "thursday"],
    });
    assert.equal(updateJobSchema.validate(patch).error, undefined);
  });

  test("changing ONLY the custom block still emits a schedule", () => {
    // The frequency itself is unchanged, so the scheduleDiff is empty — the
    // block has to be enough on its own or a custom edit silently does nothing.
    const j = job();
    j.schedule.frequency = "custom";
    j.schedule.customFrequency = { repeatEvery: 1, repeatUnit: "week", repeatOnDays: ["monday"] };
    const { patch, changed } = briefToJobPatch(
      customBrief({ repeatEvery: 1, repeatUnit: "week", repeatOnDays: ["friday"] }),
      j,
    );
    assert.deepEqual(patch.schedule.customFrequency.repeatOnDays, ["friday"]);
    assert.deepEqual(changed, ["schedule.custom"]);
  });

  test("an identical custom block produces nothing", () => {
    const j = job();
    j.schedule.frequency = "custom";
    j.schedule.customFrequency = { repeatEvery: 2, repeatUnit: "week", repeatOnDays: ["tuesday"] };
    const { patch } = briefToJobPatch(
      customBrief({ repeatEvery: 2, repeatUnit: "week", repeatOnDays: ["tuesday"] }),
      j,
    );
    assert.equal(patch.schedule, undefined);
  });

  test("junk day names are dropped, not handed to the queue", () => {
    // DOW_MAP drops what it doesn't recognise and falls back to Mondays without
    // saying so, which would make the stored cadence and the running one differ.
    const { patch } = briefToJobPatch(
      customBrief({ repeatEvery: 1, repeatUnit: "week", repeatOnDays: ["tuesday", "someday", 7] }),
      job(),
    );
    assert.deepEqual(patch.schedule.customFrequency.repeatOnDays, ["tuesday"]);
  });

  test("repeatEvery is clamped to a year", () => {
    const { patch } = briefToJobPatch(
      customBrief({ repeatEvery: 9999, repeatUnit: "week", repeatOnDays: [] }),
      job(),
    );
    assert.equal(patch.schedule.customFrequency.repeatEvery, 52);
  });

  test("a bad unit falls back to week rather than reaching the queue", () => {
    const { patch } = briefToJobPatch(
      customBrief({ repeatEvery: 1, repeatUnit: "fortnight", repeatOnDays: [] }),
      job(),
    );
    assert.equal(patch.schedule.customFrequency.repeatUnit, "week");
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

  test("`custom` always travels with the block scheduleSchema requires", () => {
    // Sending the word without repeatEvery/repeatUnit/repeatOnDays is a 400.
    const { patch } = briefToJobPatch(withFreq({ preset: "custom" }), job());
    assert.equal(patch.schedule.frequency, "custom");
    assert.deepEqual(patch.schedule.customFrequency, {
      repeatEvery: 1,
      repeatUnit: "week",
      repeatOnDays: [],
    });
    assert.equal(updateJobSchema.validate(patch).error, undefined);
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
