#!/usr/bin/env node
/**
 * Tests for services/adFactory/resultSlots.js.
 *
 * This module exists because of a bug found in a live run, not in review: a
 * Quick setup generate reached Python, Python generated two images and two
 * copies, and every one of them was dropped because
 * `updateGenerationResult` fills result slots POSITIONALLY and there were no
 * slots to fill. The campaign was present and correct; the callback still
 * answered "Campaign not found".
 *
 * So the property under test is narrow and specific: the pushed slots must
 * match the filter the callback uses, `results.<kind>.status: null`, and there
 * must be exactly one per requested item.
 *
 * Run:  node test/adFactory/resultSlots.test.js
 */

const assert = require("node:assert/strict");

const { buildResultSlotUpdate } = require("../../services/adFactory/resultSlots");

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

const svc = (serviceName, quantity, model = "auto") => ({
  serviceName,
  serviceParams: { quantity, model },
  generated: 0,
});

// The exact servicesSelected from the live run that lost its results.
const LIVE = [svc("text", 2), svc("image", 2, "google")];

// ─── ─────────────────────────────────────────────────────────────────────────

group("one slot per requested item", () => {
  const { update, counts } = buildResultSlotUpdate(LIVE);

  test("counts follow servicesSelected", () => {
    assert.deepEqual(counts, { text: 2, image: 2 });
  });

  test("two text slots and two image slots are pushed", () => {
    assert.equal(update.$push["results.text"].$each.length, 2);
    assert.equal(update.$push["results.image"].$each.length, 2);
  });

  test("THE FIX: every slot matches the callback's `status: null` filter", () => {
    // updateGenerationResult queries { "results.text.status": null } and writes
    // through the positional `$`. A slot carrying any status would not match,
    // and the result would be dropped exactly as it was in the live run.
    for (const kind of ["text", "image"]) {
      for (const slot of update.$push[`results.${kind}`].$each) {
        assert.equal(slot.status, undefined, `${kind} slot must have no status`);
        assert.deepEqual(slot, {}, `${kind} slot must be empty`);
      }
    }
  });

  test("both statuses move to in-progress together", () => {
    // The orchestrator skips a tick when either reads in-progress; that is what
    // prevents a second run overlapping one already in flight.
    assert.equal(update.$set["results.status"], "in-progress");
    assert.equal(update.$set.status, "in-progress");
  });
});

group("quantities are respected, not assumed", () => {
  test("asking for 5 images pushes 5 slots", () => {
    const { update } = buildResultSlotUpdate([svc("image", 5)]);
    assert.equal(update.$push["results.image"].$each.length, 5);
  });

  test("a service at qty 0 gets no slots and no key", () => {
    const { update, counts } = buildResultSlotUpdate([svc("text", 0), svc("image", 3)]);
    assert.equal(update.$push["results.text"], undefined);
    assert.equal(update.$push["results.image"].$each.length, 3);
    assert.deepEqual(counts, { image: 3 });
  });

  test("video is supported, since the schema and callback both accept it", () => {
    const { update } = buildResultSlotUpdate([svc("video", 1)]);
    assert.equal(update.$push["results.video"].$each.length, 1);
  });

  test("a fractional quantity floors rather than pushing a broken array", () => {
    const { update } = buildResultSlotUpdate([svc("image", 2.7)]);
    assert.equal(update.$push["results.image"].$each.length, 2);
  });
});

group("nothing requested means no write at all", () => {
  // An empty $push is a Mongo error, and flipping the campaign to in-progress
  // for a run that can never produce anything would block the next real tick.
  for (const [label, input] of [
    ["empty array", []],
    ["all zero", [svc("text", 0), svc("image", 0)]],
    ["undefined", undefined],
    ["not an array", { serviceName: "text" }],
    ["negative", [svc("image", -3)]],
  ]) {
    test(`${label} -> null update`, () => {
      assert.equal(buildResultSlotUpdate(input).update, null);
    });
  }
});

group("purity", () => {
  test("servicesSelected is not mutated", () => {
    const input = JSON.parse(JSON.stringify(LIVE));
    const before = JSON.stringify(input);
    buildResultSlotUpdate(input);
    assert.equal(JSON.stringify(input), before);
  });

  test("handles Mongoose-style subdocuments", () => {
    const docs = LIVE.map((s) => ({ toObject: () => s, ...s }));
    assert.deepEqual(buildResultSlotUpdate(docs).counts, { text: 2, image: 2 });
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of FAILURES) console.log(`\n  ${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
