#!/usr/bin/env node
/**
 * Tests for services/adFactory/runSlices.js.
 *
 * Anchored on a real campaign: three runs producing 5, 3 and 1 ads, whose
 * snapshots hold cumulative counts 5 and 8 against a campaign now holding 9.
 * Reading those snapshot lengths as batch sizes reported 5, 8 and 9 — counts
 * that only ever grow, which is what "you are merging all and storing" looked
 * like from the outside.
 *
 * Run:  node test/adFactory/runSlices.test.js
 */

const assert = require("node:assert/strict");

const { sliceRuns } = require("../../services/adFactory/runSlices");

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

const img = (n) => ({ status: 200, data: `/img/${n}.webp` });
const txt = (n) => ({ status: 200, data: { meta: { headline: `H${n}`, primary_text: `B${n}` } } });
const pending = () => ({});
const failed = () => ({ status: 500, error: "nope" });

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

// The live campaign: 9 delivered images, snapshots at 5 and 8.
const LIVE_RESULTS = { image: seq(9, img), text: seq(9, txt) };
const LIVE_SNAPS = [
  { version: 1, createdAt: "2026-08-17T11:23:00Z", previousData: { results: { image: seq(5, img) } } },
  { version: 2, createdAt: "2026-08-17T11:26:00Z", previousData: { results: { image: seq(8, img) } } },
];

// ─── ─────────────────────────────────────────────────────────────────────────

group("THE BUG: snapshot lengths are boundaries, not batch sizes", () => {
  const { runs, currentFrom } = sliceRuns(LIVE_RESULTS, LIVE_SNAPS);

  test("per-run counts are deltas — 5, 3 — not the cumulative 5, 8", () => {
    assert.deepEqual(runs.map((r) => r.adCount), [5, 3]);
  });

  test("the current run starts where the last snapshot ended", () => {
    assert.equal(currentFrom, 8);
    // 9 delivered total, so the live batch is 1 — matching the campaign.
    assert.equal(LIVE_RESULTS.image.length - currentFrom, 1);
  });

  test("no ad appears in two runs", () => {
    const all = runs.flatMap((r) => r.images.map((i) => i.data));
    assert.equal(new Set(all).size, all.length);
  });

  test("runs carry their own images, in order", () => {
    assert.deepEqual(runs[0].images.map((i) => i.data), seq(5, img).map((i) => i.data));
    assert.deepEqual(runs[1].images.map((i) => i.data), ["/img/6.webp", "/img/7.webp", "/img/8.webp"]);
  });

  test("copy is sliced on the same boundaries as images", () => {
    assert.equal(runs[1].texts.length, runs[1].images.length);
    assert.equal(runs[1].texts[0].data.meta.headline, "H6");
  });

  test("version and timestamp are carried through", () => {
    assert.equal(runs[0].version, 1);
    assert.equal(runs[1].at, "2026-08-17T11:26:00Z");
  });
});

group("the oldest bucket is honest about what it is", () => {
  test("it is flagged partial — history began after the first generate", () => {
    const { runs } = sliceRuns(LIVE_RESULTS, LIVE_SNAPS);
    assert.equal(runs[0].partial, true);
    assert.equal(runs[1].partial, false);
  });
});

group("only delivered results count toward a boundary", () => {
  test("pending and failed slots do not shift batches", () => {
    const results = {
      image: [img(1), pending(), img(2), failed(), img(3)],
      text: [txt(1), pending(), txt(2), failed(), txt(3)],
    };
    const snaps = [{ version: 1, previousData: { results: { image: [img(1), pending(), img(2)] } } }];
    const { runs, currentFrom } = sliceRuns(results, snaps);
    // Two delivered before the snapshot, one after.
    assert.equal(runs[0].adCount, 2);
    assert.equal(currentFrom, 2);
  });
});

group("degenerate inputs never produce a negative or overlapping slice", () => {
  test("no snapshots — everything is the current run", () => {
    const { runs, currentFrom } = sliceRuns(LIVE_RESULTS, []);
    assert.deepEqual(runs, []);
    assert.equal(currentFrom, 0);
  });

  test("a snapshot LONGER than the campaign is clamped", () => {
    // Results can shrink: a Full control edit wipes `creatives`, and pruning
    // results is a plausible future change.
    const { runs, currentFrom } = sliceRuns(
      { image: seq(3, img), text: seq(3, txt) },
      [{ version: 1, previousData: { results: { image: seq(9, img) } } }],
    );
    assert.equal(runs[0].adCount, 3);
    assert.equal(currentFrom, 3);
  });

  test("a snapshot SHORTER than its predecessor cannot go backwards", () => {
    const { runs } = sliceRuns(LIVE_RESULTS, [
      { version: 1, previousData: { results: { image: seq(6, img) } } },
      { version: 2, previousData: { results: { image: seq(2, img) } } },
    ]);
    assert.equal(runs[0].adCount, 6);
    assert.equal(runs[1].adCount, 0);
    assert.ok(runs.every((r) => r.adCount >= 0));
  });

  test("empty campaign, empty everything", () => {
    const { runs, currentFrom } = sliceRuns({}, []);
    assert.deepEqual(runs, []);
    assert.equal(currentFrom, 0);
  });

  test("junk snapshots are tolerated", () => {
    const { runs } = sliceRuns(LIVE_RESULTS, [{}, { previousData: null }]);
    assert.equal(runs.length, 2);
    assert.ok(runs.every((r) => r.adCount === 0));
  });
});

group("purity", () => {
  test("inputs are not mutated", () => {
    const before = JSON.stringify({ LIVE_RESULTS, LIVE_SNAPS });
    sliceRuns(LIVE_RESULTS, LIVE_SNAPS);
    assert.equal(JSON.stringify({ LIVE_RESULTS, LIVE_SNAPS }), before);
  });

  test("handles Mongoose-style documents", () => {
    const snaps = LIVE_SNAPS.map((s) => ({ toObject: () => s, ...s }));
    assert.deepEqual(sliceRuns(LIVE_RESULTS, snaps).runs.map((r) => r.adCount), [5, 3]);
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
