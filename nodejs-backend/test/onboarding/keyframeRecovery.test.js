#!/usr/bin/env node
/**
 * Tests for the keyframe completeness check.
 *
 * A storyboard run reports `succeeded` with frames still failed, and forwarding
 * that paints a permanent hole on a card for a gap one more call usually fills.
 * `inspectFrames` is what decides whether a result is finished; everything else
 * in the recovery — the counter, the backoff, the retry call — hangs off its
 * answer.
 *
 * Pure functions only. The scheduling side talks to Mongo and to upstream.
 *
 * Run:  node test/onboarding/keyframeRecovery.test.js
 */

const assert = require("node:assert/strict");

const { _internals } = require("../../services/onboarding/keyframeRecovery");
const { missingKinds, inspectFrames } = _internals;

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

const frame = (kind, extra = {}) => ({
  id: `img-${kind}`,
  kind,
  status: "ready",
  url: "/creatives/x.webp",
  local_url: "/api/v1/storyboards/images/abc",
  ...extra,
});

const board = (id, images) => ({ id, title: `Concept ${id}`, images });

console.log("\nmissingKinds\n");

test("both frames ready is nothing missing", () => {
  assert.deepEqual(missingKinds(board("a", [frame("first"), frame("last")])), []);
});

test("a failed frame is missing", () => {
  const b = board("a", [frame("first"), frame("last", { status: "failed", error: "IMAGE_OTHER" })]);
  assert.deepEqual(missingKinds(b), ["last"]);
});

test("a frame that was never produced is missing", () => {
  assert.deepEqual(missingKinds(board("a", [frame("first")])), ["last"]);
});

test("no images at all means both are missing", () => {
  assert.deepEqual(missingKinds(board("a", [])), ["first", "last"]);
  assert.deepEqual(missingKinds({ id: "a" }), ["first", "last"]);
});

test("ready with no link is still missing — there is nothing to show", () => {
  // The durable upload did not land and the local copy is gone. Upstream calls
  // this ready; a viewer would see an empty box.
  const b = board("a", [frame("first"), { id: "x", kind: "last", status: "ready" }]);
  assert.deepEqual(missingKinds(b), ["last"]);
});

test("either link alone is enough", () => {
  const onlyDurable = { id: "x", kind: "last", status: "ready", url: "/creatives/x.webp" };
  const onlyLocal = { id: "y", kind: "last", status: "ready", local_url: "/api/v1/…" };
  assert.deepEqual(missingKinds(board("a", [frame("first"), onlyDurable])), []);
  assert.deepEqual(missingKinds(board("a", [frame("first"), onlyLocal])), []);
});

console.log("\ninspectFrames\n");

test("every concept complete", () => {
  const result = {
    storyboards: [
      board("a", [frame("first"), frame("last")]),
      board("b", [frame("first"), frame("last")]),
    ],
  };
  const census = inspectFrames(result);
  assert.equal(census.complete, true);
  assert.equal(census.total, 2);
  assert.deepEqual(census.gaps, []);
});

test("one concept short reports just that concept", () => {
  const result = {
    storyboards: [
      board("a", [frame("first"), frame("last")]),
      board("b", [frame("first"), frame("last", { status: "failed" })]),
    ],
  };
  const census = inspectFrames(result);
  assert.equal(census.complete, false);
  assert.deepEqual(census.gaps, [{ boardId: "b", kinds: ["last"] }]);
});

test("a payload with no storyboards is not an incomplete result", () => {
  // The scripts job, a brand result, an empty terminal. None of these mean
  // "frames failed", and treating them that way would fire a retry for work
  // that has not been attempted.
  assert.equal(inspectFrames({ storyboards: [] }), null);
  assert.equal(inspectFrames({}), null);
  assert.equal(inspectFrames(null), null);
  assert.equal(inspectFrames({ context: { brand_name: "Acme" } }), null);
});

test("concepts with empty images read as entirely missing", () => {
  // This IS what the scripts job's payload looks like — which is exactly why
  // the caller gates on `kind`, not on this answer alone.
  const census = inspectFrames({ storyboards: [board("a", []), board("b", [])] });
  assert.equal(census.complete, false);
  assert.equal(census.gaps.length, 2);
  assert.deepEqual(census.gaps[0].kinds, ["first", "last"]);
});

console.log(`\n${passed} passed\n`);
