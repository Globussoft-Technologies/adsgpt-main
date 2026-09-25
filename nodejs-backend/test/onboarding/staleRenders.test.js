// staleRenders — a render upstream never finished, and never said so.
//
// What this pins, because both are easy to get wrong in a sweeper that fires
// on a timer against live data:
//
//   THE CAPS ARE PER KIND. An image is dead after two minutes and a video is
//   still healthy at that age. One shared cap either cancels images that were
//   working or leaves them spinning for ten minutes.
//
//   A SWEEP RELEASES THE MONEY. Failing the board without settling it would
//   leave the hold open — the exact state the sweeper exists to clear.
//
//   AND IT NEVER RACES A REAL CALLBACK. The write is guarded on the status it
//   read, so a result that lands mid-sweep wins.
//
// No Mongo: the session model and the billing service are stubbed through
// `require.cache`, because what is under test is the decision, not the driver.
//
// Run: node test/onboarding/staleRenders.test.js

const assert = require("node:assert/strict");

// ── Stubs, installed BEFORE staleRenders is required ────────────────────────
const sessionPath = require.resolve("../../Module/onboarding/onboardingSession");
const billingPath = require.resolve("../../services/onboarding/renderBilling");

let sessions = [];
const writes = [];
const settles = [];

require.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: {
    find: () => ({ select: () => ({ lean: async () => sessions }) }),
    updateOne: async (filter, update) => {
      writes.push({ filter, update });
      return { matchedCount: 1 };
    },
  },
};

require.cache[billingPath] = {
  id: billingPath,
  filename: billingPath,
  loaded: true,
  exports: {
    settleBoard: async (args) => {
      settles.push(args);
      return true;
    },
  },
};

const { sweepStaleRenders, _internals } = require("../../services/onboarding/staleRenders");

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000);

function reset(boards, section = "recreates") {
  sessions = [{ sessionId: "s1", userId: "u1", [section]: { boards } }];
  writes.length = 0;
  settles.length = 0;
}

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("  PASS " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL " + name + "\n    " + err.message);
  }
};

(async () => {
  console.log("staleRenders - renders upstream never finished\n");

  await test("caps: image 2 min, video 10 min", () => {
    assert.equal(_internals.IMAGE_MAX_MS, 2 * 60 * 1000);
    assert.equal(_internals.VIDEO_MAX_MS, 10 * 60 * 1000);
    assert.equal(_internals.capFor({ billing: { kind: "image" } }), _internals.IMAGE_MAX_MS);
    assert.equal(_internals.capFor({ billing: { kind: "video" } }), _internals.VIDEO_MAX_MS);
    // A storyboard clip carries no `kind` at all and must be treated as video —
    // the image cap would kill it a minute into a healthy render.
    assert.equal(_internals.capFor({ billing: {} }), _internals.VIDEO_MAX_MS);
    assert.equal(_internals.capFor(undefined), _internals.VIDEO_MAX_MS);
  });

  await test("an image running 5 minutes is failed and released", async () => {
    reset({
      b1: {
        status: "running",
        updatedAt: minutesAgo(5),
        billing: { kind: "image", renderId: "r1", amount: 1, allowanceSpent: 0 },
      },
    });
    const out = await sweepStaleRenders();
    assert.equal(out.failed, 1);
    assert.equal(writes[0].update.$set["recreates.boards.b1.status"], "failed");
    assert.equal(settles.length, 1, "the hold must be released");
    assert.equal(settles[0].entry.status, "failed");

    // The section summary is brought back in step, or it says "running" for
    // ever — and this sweeper's own pre-filter reads it, so those sessions
    // would be re-scanned every tick for the life of the deployment.
    const summary = writes.find((w) => "recreates.status" in (w.update.$set || {}));
    assert.ok(summary, "the section status must be rewritten");
    assert.notEqual(summary.update.$set["recreates.status"], "running");
  });

  await test("a VIDEO at the same age is left alone", async () => {
    reset({
      b1: {
        status: "running",
        updatedAt: minutesAgo(5),
        billing: { kind: "video", renderId: "r1", amount: 32 },
      },
    });
    const out = await sweepStaleRenders();
    assert.equal(out.scanned, 1);
    assert.equal(out.failed, 0, "five minutes is a healthy video render");
    assert.equal(writes.length, 0, "a sweep that changes nothing must write nothing");
    assert.equal(settles.length, 0);
  });

  await test("a video past ten minutes is failed", async () => {
    reset({
      b1: { status: "running", updatedAt: minutesAgo(11), billing: { kind: "video" } },
    });
    assert.equal((await sweepStaleRenders()).failed, 1);
  });

  await test("a board that already finished is never touched", async () => {
    reset({
      b1: { status: "succeeded", updatedAt: minutesAgo(90), billing: { kind: "image" } },
      b2: { status: "failed", updatedAt: minutesAgo(90), billing: { kind: "video" } },
    });
    const out = await sweepStaleRenders();
    assert.equal(out.scanned, 0);
    assert.equal(out.failed, 0);
  });

  await test("the write is guarded on `running`, so a real callback wins", async () => {
    reset({
      b1: { status: "running", updatedAt: minutesAgo(30), billing: { kind: "video" } },
    });
    await sweepStaleRenders();
    assert.equal(
      writes[0].filter["recreates.boards.b1.status"],
      "running",
      "without this guard a sweep would overwrite a result that landed mid-sweep",
    );
  });

  await test("a board with no timestamp is left alone rather than guessed at", async () => {
    reset({ b1: { status: "running", billing: { kind: "image" } } });
    const out = await sweepStaleRenders();
    assert.equal(out.scanned, 1);
    assert.equal(out.failed, 0);
  });

  await test("storyboard videos are swept too, not only recreates", async () => {
    reset({ b1: { status: "running", updatedAt: minutesAgo(20), billing: {} } }, "videos");
    const out = await sweepStaleRenders();
    assert.equal(out.failed, 1);
    assert.equal(writes[0].update.$set["videos.boards.b1.status"], "failed");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
