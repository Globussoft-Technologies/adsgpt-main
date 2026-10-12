#!/usr/bin/env node
/**
 * Tests for which onboarding jobs earn a push notification.
 *
 * The interesting half of this is the SILENCE. A push is the one thing in the
 * product that can interrupt someone who is not looking at it, so the cases
 * worth pinning are the ones that must never fire: progress ticks, the four
 * kinds that happen while the user is already watching the screen, and above
 * all `storyboard.images.generate` — the keyframe recovery job, which would
 * buzz a pocket about a repair the user never knew was needed.
 *
 * Pure function; no FCM, no DB.
 *
 * Run:  node test/onboarding/onboardingPush.test.js
 */

const assert = require("node:assert/strict");

const { pushForJob } = require("../../services/onboarding/onboardingPush");

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

const job = (over = {}) => ({
  kind: "video.generate",
  status: "succeeded",
  sessionId: "sess-1",
  jobId: "job-1",
  ...over,
});

console.log("\npushForJob — what fires\n");

test("a finished storyboard clip pushes", () => {
  const p = pushForJob(job());
  assert.equal(p.title, "Video ready 🎬");
  assert.match(p.body, /ready/i);
});

test("a finished recreate video pushes", () => {
  assert.equal(pushForJob(job({ kind: "video.from_template" })).title, "Video ready 🎬");
});

test("a finished recreate image pushes, with its own wording", () => {
  const p = pushForJob(job({ kind: "image.from_template" }));
  assert.equal(p.title, "Image ready 🎨");
});

test("the payload carries what the app needs to deep-link", () => {
  const p = pushForJob(job({ jobId: "j-9", sessionId: "s-9" }));
  assert.deepEqual(p.data, {
    // `onboarding`, not `video` — Ad Studio's pushes point at a library row
    // and an onboarding render does not have one yet.
    type: "onboarding",
    kind: "video.generate",
    status: "succeeded",
    session_id: "s-9",
    job_id: "j-9",
  });
});

console.log("\npushForJob — failures\n");

test("a failed render pushes, and does not sound alarming", () => {
  const p = pushForJob(job({ status: "failed" }));
  assert.equal(p.title, "Video didn’t render");
  assert.match(p.body, /try again/i);
  assert.equal(p.data.status, "failed");
});

test("a failed recreate image says image, not video", () => {
  const p = pushForJob(job({ kind: "image.from_template", status: "failed" }));
  assert.equal(p.title, "Image didn’t render");
});

console.log("\npushForJob — what stays silent\n");

test("the keyframe RECOVERY job never pushes", () => {
  // The one that would be worst: the user never knew a frame failed, and this
  // job exists to quietly put it right.
  assert.equal(pushForJob(job({ kind: "storyboard.images.generate" })), null);
  assert.equal(
    pushForJob(job({ kind: "storyboard.images.generate", status: "failed" })),
    null,
  );
});

test("the kinds the user is already watching stay silent", () => {
  for (const kind of ["onboarding.init", "template.recommend", "storyboard.generate"]) {
    assert.equal(pushForJob(job({ kind })), null, `${kind} must not push`);
  }
});

test("a non-terminal status never pushes", () => {
  // The guard that stops a render buzzing a pocket a dozen times.
  for (const status of ["queued", "running", "", undefined]) {
    assert.equal(pushForJob(job({ status })), null, `status ${status} must not push`);
  }
});

test("no session means no push", () => {
  // Every pushable kind is session-scoped, so an absent session means this is
  // not the job we think it is — and there would be nothing to deep-link to.
  assert.equal(pushForJob(job({ sessionId: "" })), null);
  assert.equal(pushForJob(job({ sessionId: undefined })), null);
});

test("an unknown or missing kind is silent, not a crash", () => {
  assert.equal(pushForJob(job({ kind: "something.new" })), null);
  assert.equal(pushForJob(job({ kind: undefined })), null);
  assert.equal(pushForJob({}), null);
  assert.equal(pushForJob(), null);
});

console.log(`\n${passed} passed\n`);
