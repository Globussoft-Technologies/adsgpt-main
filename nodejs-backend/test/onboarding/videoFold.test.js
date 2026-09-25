#!/usr/bin/env node
/**
 * Tests for the per-board video writes — what makes rendering more than one
 * storyboard concept safe.
 *
 * A person renders concepts one at a time, so each `video.generate` job covers
 * a single board and each callback carries a single clip — while all of them
 * land on the same `videos` section. The section cannot hold one shared array:
 * two clips finishing together would each be written from the same stale
 * snapshot and one would vanish. So each clip goes to its own key, and the list
 * the client reads is derived from those keys.
 *
 * These are the three pure functions that encode that:
 *
 *   videoBoardWrites        one callback  → the `$set` paths it produces
 *   videosResultFromBoards  the keys      → the array the contract describes
 *   deriveVideoStatus       the keys      → the section's one-word summary
 *
 * No DB — the mirror's write path is what talks to Mongo, and this is the part
 * with all the reasoning in it.
 *
 * Run:  node test/onboarding/videoFold.test.js
 */

const assert = require("node:assert/strict");

const {
  videoBoardWrites,
  videosResultFromBoards,
  deriveVideoStatus,
} = require("../../services/onboarding/sessionMirror");

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

/** One callback's worth: a single board's clip. */
const payload = (boardId, { version = 1, status = "ready", error } = {}) => ({
  videos: [
    {
      board_id: boardId,
      title: `Concept ${boardId}`,
      duration_s: 8,
      video: { id: `v-${boardId}-${version}`, board_id: boardId, version, status, error },
    },
  ],
});

/** Applies a set of `$set` paths to a plain boards object, as Mongo would. */
const apply = (boards, writes) => {
  const next = { ...boards };
  for (const [path, value] of Object.entries(writes)) next[path.split(".").pop()] = value;
  return next;
};

const ids = (boards) => videosResultFromBoards(boards).videos.map((v) => v.board_id);

console.log("\nvideoBoardWrites\n");

test("a clip is written to its own board key, not to a shared array", () => {
  const writes = videoBoardWrites(payload("a"), {}, { jobId: "job-a" });
  assert.deepEqual(Object.keys(writes), ["videos.boards.a"]);
  assert.equal(writes["videos.boards.a"].status, "succeeded");
  assert.equal(writes["videos.boards.a"].jobId, "job-a");
});

test("two boards produce two DISJOINT paths — the whole point", () => {
  // The concurrency case: both callbacks read the same empty snapshot, because
  // they arrived in the same instant. Neither write mentions the other's key,
  // so Mongo applies both and nothing is lost.
  const a = videoBoardWrites(payload("a"), {}, { jobId: "job-a" });
  const b = videoBoardWrites(payload("b"), {}, { jobId: "job-b" });
  assert.deepEqual(Object.keys(a), ["videos.boards.a"]);
  assert.deepEqual(Object.keys(b), ["videos.boards.b"]);

  const boards = apply(apply({}, a), b);
  assert.deepEqual(ids(boards).sort(), ["a", "b"]);
});

test("three simultaneous callbacks all survive, in any order", () => {
  const stale = {};
  const writes = ["a", "b", "c"].map((id) =>
    videoBoardWrites(payload(id), stale, { jobId: `job-${id}` })
  );
  for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
    const boards = order.reduce((acc, i) => apply(acc, writes[i]), {});
    assert.deepEqual(ids(boards).sort(), ["a", "b", "c"]);
  }
});

test("a redelivered callback rewrites one key with what is already there", () => {
  const boards = apply({}, videoBoardWrites(payload("a"), {}, { jobId: "job-a" }));
  const again = apply(boards, videoBoardWrites(payload("a"), boards, { jobId: "job-a" }));
  assert.deepEqual(ids(again), ["a"]);
});

test("a higher version wins — the seam regeneration will use", () => {
  const boards = apply({}, videoBoardWrites(payload("a", { version: 1 }), {}, { jobId: "j1" }));
  const next = apply(boards, videoBoardWrites(payload("a", { version: 2 }), boards, { jobId: "j2" }));
  assert.equal(next.a.version, 2);
  assert.equal(videosResultFromBoards(next).videos[0].video.version, 2);
});

test("a LATE lower version cannot overwrite a newer clip", () => {
  const boards = apply({}, videoBoardWrites(payload("a", { version: 2 }), {}, { jobId: "j2" }));
  const writes = videoBoardWrites(payload("a", { version: 1 }), boards, { jobId: "j1" });
  // Refused outright, so the stale write never even reaches Mongo.
  assert.deepEqual(Object.keys(writes), []);
});

test("a failed clip is recorded as failed, with its reason", () => {
  const writes = videoBoardWrites(
    payload("a", { status: "failed", error: "generate the keyframes and retry" }),
    {},
    { jobId: "j1" }
  );
  assert.equal(writes["videos.boards.a"].status, "failed");
  assert.match(writes["videos.boards.a"].error, /keyframes/);
});

test("one board failing leaves another board's clip alone", () => {
  let boards = apply({}, videoBoardWrites(payload("a"), {}, { jobId: "j1" }));
  boards = apply(boards, videoBoardWrites(payload("b", { status: "failed" }), boards, { jobId: "j2" }));
  assert.equal(boards.a.status, "succeeded");
  assert.equal(boards.b.status, "failed");
});

test("a payload with no clips produces no writes", () => {
  assert.deepEqual(videoBoardWrites(null, {}, {}), {});
  assert.deepEqual(videoBoardWrites({}, {}, {}), {});
  assert.deepEqual(videoBoardWrites({ videos: [] }, {}, {}), {});
});

test("a clip with no board_id is skipped — nothing could address it", () => {
  assert.deepEqual(videoBoardWrites({ videos: [{ video: { status: "ready" } }] }, {}, {}), {});
});

console.log("\nvideosResultFromBoards\n");

test("order is by arrival, so tiles do not reshuffle as clips land", () => {
  const boards = {
    c: { status: "succeeded", updatedAt: new Date(3000), video: { board_id: "c" } },
    a: { status: "succeeded", updatedAt: new Date(1000), video: { board_id: "a" } },
    b: { status: "succeeded", updatedAt: new Date(2000), video: { board_id: "b" } },
  };
  assert.deepEqual(ids(boards), ["a", "b", "c"]);
});

test("a board that is still rendering contributes no clip", () => {
  const boards = {
    a: { status: "succeeded", updatedAt: new Date(1), video: { board_id: "a" } },
    b: { status: "running", updatedAt: new Date(2) },
  };
  assert.deepEqual(ids(boards), ["a"]);
});

test("no boards at all is an empty list, not a crash", () => {
  assert.deepEqual(videosResultFromBoards(undefined), { videos: [] });
  assert.deepEqual(videosResultFromBoards({}), { videos: [] });
});

// The bug this pins: a RECREATE is filed under `recreate:<templateId>` while DS
// mints its own uuid per render and puts that in the clip. The clip therefore
// went out addressed by an id that appears nowhere in `boards`, the client could
// not pair the two, and read the missing clip as "no playable link yet" — which
// pinned a finished render at `running` for ever, with its URL in the database
// the whole time.
test("a clip is addressed by the key it is filed under, not by DS's render id", () => {
  const boards = {
    "recreate:tpl-1": {
      status: "succeeded",
      updatedAt: new Date(1),
      video: {
        board_id: "dd5b750c-a-uuid-DS-minted",
        video: { status: "ready", url: "https://cdn/1.mp4", board_id: "dd5b750c-a-uuid-DS-minted" },
      },
    },
  };
  assert.deepEqual(ids(boards), ["recreate:tpl-1"]);
});

test("stamping the key leaves DS's own record of its render alone", () => {
  const boards = {
    "recreate:tpl-1": {
      status: "succeeded",
      updatedAt: new Date(1),
      video: { board_id: "ds-uuid", video: { status: "ready", board_id: "ds-uuid" } },
    },
  };
  // Only the ADDRESS is rewritten — the clip inside still says what DS said.
  assert.equal(videosResultFromBoards(boards).videos[0].video.board_id, "ds-uuid");
});

test("a storyboard is unaffected — its key already IS upstream's board_id", () => {
  const boards = {
    a: { status: "succeeded", updatedAt: new Date(1), video: { board_id: "a", duration_s: 8 } },
  };
  assert.deepEqual(videosResultFromBoards(boards).videos, [{ board_id: "a", duration_s: 8 }]);
});

console.log("\nderiveVideoStatus\n");

test("nothing started is idle", () => {
  assert.equal(deriveVideoStatus({}), "idle");
});

test("anything in flight keeps the whole section running", () => {
  // The lie this exists to prevent: board A finishing while B still renders
  // must NOT read as the module being done.
  assert.equal(deriveVideoStatus({ a: { status: "succeeded" }, b: { status: "running" } }), "running");
});

test("one clip is enough to call it succeeded", () => {
  assert.equal(deriveVideoStatus({ a: { status: "succeeded" }, b: { status: "failed" } }), "succeeded");
});

test("failed only when every board failed", () => {
  assert.equal(deriveVideoStatus({ a: { status: "failed" }, b: { status: "failed" } }), "failed");
});

console.log(`\n${passed} passed\n`);
