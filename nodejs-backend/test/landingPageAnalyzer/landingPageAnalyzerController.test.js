#!/usr/bin/env node
/**
 * Tests for controllers/landingPageAnalyzer/landingPageAnalyzerController.
 * Pure unit tests — no DB, no HTTP. The Mongoose model, axios, global.io and
 * logger are stubbed; controllers are driven with mock req/res. mongoose is
 * kept real (only ObjectId.isValid / ObjectId() are used — both work offline).
 *
 * Run: node test/landingPageAnalyzer/landingPageAnalyzerController.test.js
 */

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// ── stub side-effect deps before exercising the controller ─────────────────
const Model = require("../../Module/landingPageAnalyzer/landingPageAnalysis");
const axios = require("axios"); // same cached instance the controller patches
const logger = require("../../utils/logger");
logger.info = () => {};
logger.error = () => {};

const ctrl = require("../../controllers/landingPageAnalyzer/landingPageAnalyzerController");

// ── tiny test harness (matches test/autopilot style) ───────────────────────
let pass = 0;
let fail = 0;
const FAILURES = [];
async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label) {
  console.log(`\n${label}`);
}

// ── helpers ────────────────────────────────────────────────────────────────
function spy(impl) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = [];
  return fn;
}
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}
function makeDoc(o = {}) {
  return {
    _id: o._id || new mongoose.Types.ObjectId(),
    userId: o.userId || "GPT-165",
    inputUrl: o.inputUrl || "https://nike.com",
    status: o.status || "pending",
    result: o.result,
    lastEvent: o.lastEvent,
    save: spy(async function save() {
      return this;
    }),
    deleteOne: spy(async function deleteOne() {
      return this;
    }),
  };
}
// chainable query mock: find().select().sort().skip().limit().lean()
function query(result) {
  const q = {};
  q.select = spy(() => q);
  q.sort = spy(() => q);
  q.skip = spy(() => q);
  q.limit = spy(() => q);
  q.lean = spy(async () => result);
  return q;
}
let emitted = [];
function resetIo() {
  emitted = [];
  global.io = {
    to: (room) => ({ emit: (evt, payload) => emitted.push({ room, evt, payload }) }),
  };
}
const oid = () => new mongoose.Types.ObjectId().toString();

// ===========================================================================
async function main() {
  // ── createAnalysis ───────────────────────────────────────────────────────
  group("createAnalysis");

  await test("400 when url missing — no DB/python touched", async () => {
    Model.findOne = spy();
    axios.post = spy();
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(Model.findOne.calls.length, 0);
    assert.equal(axios.post.calls.length, 0);
  });

  await test("in-flight doc (processing) → returns same doc, NO python call", async () => {
    const doc = makeDoc({ status: "processing" });
    Model.findOne = spy(async () => doc);
    Model.create = spy();
    axios.post = spy();
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.sessionId, doc._id.toString());
    assert.equal(res.body.data.status, "processing");
    assert.equal(axios.post.calls.length, 0, "python must not be called");
    assert.equal(Model.create.calls.length, 0, "no new doc");
  });

  await test("new url → creates doc, normalizes url, calls python, sets processing", async () => {
    const newDoc = makeDoc({ status: undefined });
    Model.findOne = spy(async () => null);
    Model.create = spy(async () => newDoc);
    axios.post = spy(async () => ({ data: { success: true } }));
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(Model.create.calls[0][0].inputUrl, "https://nike.com", "url normalized");
    assert.equal(axios.post.calls[0][1].sessionId, newDoc._id.toString());
    assert.equal(newDoc.status, "processing");
    assert.equal(newDoc.save.calls.length, 1);
    assert.equal(res.statusCode, 200);
  });

  await test("existing completed doc → reused, old result cleared, re-scanned", async () => {
    const doc = makeDoc({ status: "completed", result: { url: "old" }, lastEvent: { progress: 50 } });
    Model.findOne = spy(async () => doc);
    Model.create = spy();
    axios.post = spy(async () => ({ data: { success: true } }));
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(Model.create.calls.length, 0, "must not create a 2nd doc");
    assert.equal(axios.post.calls[0][1].sessionId, doc._id.toString(), "same _id re-scanned");
    assert.equal(doc.result, null, "old result cleared for the fresh run");
    assert.equal(doc.lastEvent, null, "old lastEvent cleared");
    assert.equal(doc.status, "processing");
    assert.equal(res.statusCode, 200);
  });

  await test("forceRefresh sends X-Force-Refresh header to python", async () => {
    Model.findOne = spy(async () => null);
    Model.create = spy(async () => makeDoc());
    axios.post = spy(async () => ({ data: { success: true } }));
    const res = makeRes();
    await ctrl.createAnalysis(
      { user: { user_id: "GPT-165" }, body: { url: "nike.com", forceRefresh: true } },
      res,
    );
    assert.equal(axios.post.calls[0][2].headers["X-Force-Refresh"], "true");

    // ...and omits it on a normal (non-relaunch) scan.
    Model.create = spy(async () => makeDoc());
    axios.post = spy(async () => ({ data: { success: true } }));
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, makeRes());
    assert.equal(axios.post.calls[0][2].headers["X-Force-Refresh"], undefined);
  });

  await test("python success:false on NEW doc → deletes it, 502", async () => {
    const newDoc = makeDoc();
    Model.findOne = spy(async () => null);
    Model.create = spy(async () => newDoc);
    axios.post = spy(async () => ({ data: { success: false, message: "nope" } }));
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(newDoc.deleteOne.calls.length, 1, "new doc deleted");
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "nope");
  });

  await test("python success:false on EXISTING doc → NOT deleted, 502", async () => {
    const doc = makeDoc({ status: "completed" });
    Model.findOne = spy(async () => doc);
    Model.create = spy();
    axios.post = spy(async () => ({ data: { success: false } }));
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(doc.deleteOne.calls.length, 0, "existing doc preserved");
    assert.equal(res.statusCode, 502);
  });

  await test("python throws on NEW doc → catch deletes it, 500", async () => {
    const newDoc = makeDoc();
    Model.findOne = spy(async () => null);
    Model.create = spy(async () => newDoc);
    axios.post = spy(async () => {
      throw new Error("network down");
    });
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(newDoc.deleteOne.calls.length, 1);
    assert.equal(res.statusCode, 500);
  });

  await test("python throws on EXISTING doc → NOT deleted, 500", async () => {
    const doc = makeDoc({ status: "failed" });
    Model.findOne = spy(async () => doc);
    Model.create = spy();
    axios.post = spy(async () => {
      throw new Error("network down");
    });
    const res = makeRes();
    await ctrl.createAnalysis({ user: { user_id: "GPT-165" }, body: { url: "nike.com" } }, res);
    assert.equal(doc.deleteOne.calls.length, 0);
    assert.equal(res.statusCode, 500);
  });

  // ── saveResult ───────────────────────────────────────────────────────────
  group("saveResult");

  await test("400 on missing / invalid sessionId", async () => {
    let res = makeRes();
    await ctrl.saveResult({ body: { success: true } }, res);
    assert.equal(res.statusCode, 400);
    res = makeRes();
    await ctrl.saveResult({ body: { sessionId: "not-an-id", success: true } }, res);
    assert.equal(res.statusCode, 400);
  });

  await test("404 when no doc for sessionId", async () => {
    Model.findById = spy(async () => null);
    const res = makeRes();
    await ctrl.saveResult({ body: { sessionId: oid(), success: true } }, res);
    assert.equal(res.statusCode, 404);
  });

  await test("stores report minus sessionId, status completed, emits to userId room", async () => {
    const doc = makeDoc({ userId: "GPT-165" });
    Model.findById = spy(async () => doc);
    resetIo();
    const sessionId = doc._id.toString();
    const res = makeRes();
    await ctrl.saveResult(
      { body: { sessionId, success: true, url: "https://nike.com", overall: { score: 43 } } },
      res
    );
    assert.equal(doc.result.sessionId, undefined, "sessionId not stored in result");
    assert.equal(doc.result.url, "https://nike.com");
    assert.equal(doc.result.overall.score, 43);
    assert.equal(doc.status, "completed");
    assert.equal(doc.save.calls.length, 1);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].room, "GPT-165");
    assert.equal(emitted[0].evt, "landingPageAnalysisEvent");
    assert.equal(emitted[0].payload.type, "result");
    assert.equal(emitted[0].payload.sessionId, sessionId);
    assert.equal(res.statusCode, 200);
  });

  await test("success:false payload → doc deleted, FE still notified", async () => {
    const doc = makeDoc({ userId: "GPT-165" });
    Model.findById = spy(async () => doc);
    resetIo();
    const sessionId = doc._id.toString();
    const res = makeRes();
    await ctrl.saveResult({ body: { sessionId, success: false } }, res);
    assert.equal(doc.deleteOne.calls.length, 1, "failed doc deleted");
    assert.equal(doc.save.calls.length, 0, "not stored");
    assert.equal(emitted[0].room, "GPT-165");
    assert.equal(emitted[0].payload.type, "result");
    assert.equal(res.statusCode, 200);
  });

  await test("success:true but non-empty error → doc deleted", async () => {
    const doc = makeDoc({ userId: "GPT-165" });
    Model.findById = spy(async () => doc);
    resetIo();
    const res = makeRes();
    await ctrl.saveResult(
      { body: { sessionId: doc._id.toString(), success: true, error: "We could reach this page" } },
      res
    );
    assert.equal(doc.deleteOne.calls.length, 1, "errored doc deleted");
    assert.equal(doc.save.calls.length, 0);
    assert.equal(res.statusCode, 200);
  });

  // ── saveLiveEvent ────────────────────────────────────────────────────────
  group("saveLiveEvent");

  await test("400 on missing / invalid sessionId", async () => {
    const res = makeRes();
    await ctrl.saveLiveEvent({ body: { success: true } }, res);
    assert.equal(res.statusCode, 400);
  });

  await test("404 when no doc for sessionId", async () => {
    Model.findByIdAndUpdate = spy(async () => null);
    const res = makeRes();
    await ctrl.saveLiveEvent({ body: { sessionId: oid(), progress: 1 } }, res);
    assert.equal(res.statusCode, 404);
  });

  await test("persists lastEvent minus sessionId and emits to userId room", async () => {
    const doc = makeDoc({ userId: "GPT-165" });
    const sessionId = doc._id.toString();
    Model.findByIdAndUpdate = spy(async () => doc);
    resetIo();
    const res = makeRes();
    await ctrl.saveLiveEvent(
      { body: { sessionId, success: true, stage: "detecting", progress: 35 } },
      res
    );
    const [id, update, opts] = Model.findByIdAndUpdate.calls[0];
    assert.equal(id, sessionId);
    assert.equal(update.lastEvent.sessionId, undefined, "sessionId excluded from lastEvent");
    assert.equal(update.lastEvent.progress, 35);
    assert.equal(update.lastEvent.stage, "detecting");
    assert.equal(opts.new, true);
    assert.equal(emitted[0].room, "GPT-165");
    assert.equal(emitted[0].payload.type, "event");
    assert.equal(emitted[0].payload.lastEvent.progress, 35);
    assert.equal(res.statusCode, 200);
  });

  // ── getAnalyses ──────────────────────────────────────────────────────────
  group("getAnalyses");

  await test("default page: projection, newest-first, skip 0 / limit 12, total + hasMore", async () => {
    const docs = [{ _id: "a" }, { _id: "b" }];
    const q = query(docs);
    Model.find = spy(() => q);
    Model.countDocuments = spy(async () => 30);
    const res = makeRes();
    await ctrl.getAnalyses({ user: { user_id: "GPT-165" }, query: {} }, res);
    assert.deepEqual(Model.find.calls[0][0], { userId: "GPT-165" });
    assert.equal(
      q.select.calls[0][0],
      "inputUrl status createdAt updatedAt result.screenshot_url result.overall",
    );
    assert.deepEqual(q.sort.calls[0][0], { createdAt: -1 });
    assert.equal(q.skip.calls[0][0], 0);
    assert.equal(q.limit.calls[0][0], 12);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, docs);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.total, 30);
    assert.equal(res.body.hasMore, true, "2 of 30 returned → more pages");
  });

  await test("page 3 / limit 10 → skip 20, hasMore false at the end", async () => {
    const docs = [{ _id: "x" }];
    const q = query(docs);
    Model.find = spy(() => q);
    Model.countDocuments = spy(async () => 21);
    const res = makeRes();
    await ctrl.getAnalyses({ user: { user_id: "GPT-165" }, query: { page: "3", limit: "10" } }, res);
    assert.equal(q.skip.calls[0][0], 20);
    assert.equal(q.limit.calls[0][0], 10);
    assert.equal(res.body.hasMore, false, "20 + 1 = 21 = total → no more");
  });

  // ── getAnalysisById ──────────────────────────────────────────────────────
  group("getAnalysisById");

  await test("400 on invalid id", async () => {
    const res = makeRes();
    await ctrl.getAnalysisById({ user: { user_id: "GPT-165" }, params: { id: "bad" } }, res);
    assert.equal(res.statusCode, 400);
  });

  await test("404 when not found / not owned", async () => {
    Model.findOne = spy(() => ({ lean: async () => null }));
    const res = makeRes();
    await ctrl.getAnalysisById({ user: { user_id: "GPT-165" }, params: { id: oid() } }, res);
    assert.equal(res.statusCode, 404);
  });

  await test("200 returns full doc, query scoped to { _id, userId }", async () => {
    const id = oid();
    const doc = { _id: id, result: { url: "x" }, lastEvent: { progress: 1 } };
    Model.findOne = spy(() => ({ lean: async () => doc }));
    const res = makeRes();
    await ctrl.getAnalysisById({ user: { user_id: "GPT-165" }, params: { id } }, res);
    assert.deepEqual(Model.findOne.calls[0][0], { _id: id, userId: "GPT-165" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, doc);
  });

  // ── summary ────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const { name, err } of FAILURES) {
      console.log(`  - ${name}: ${err.stack || err.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
