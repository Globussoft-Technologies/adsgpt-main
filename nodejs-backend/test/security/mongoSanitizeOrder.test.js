#!/usr/bin/env node
/**
 * NoSQL operator-injection guard. Run with:
 *
 *   node test/security/mongoSanitizeOrder.test.js
 *
 * Mirrors the project's plain-Node assertion style. Exits non-zero on failure.
 * Boots a throwaway Express app on an ephemeral port — never index.js — so
 * nothing here opens Mongo / Redis / the Business SDK.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const bodyParser = require("body-parser");
const mongoSanitize = require("express-mongo-sanitize");

let passed = 0;
const test = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => {
          passed++;
          console.log(`  ✓ ${name}`);
        },
        (err) => {
          console.error(`  ✗ ${name}\n    ${err.message}`);
          process.exitCode = 1;
        },
      );
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
  return Promise.resolve();
};

// ── The security invariant ─────────────────────────────────────────────────
// express-mongo-sanitize only walks request properties that are ALREADY
// populated when it runs:
//
//   ['body','params','headers','query'].forEach(k => { if (req[k]) … })
//
// Express populates req.query and req.params itself before any user
// middleware, so those are sanitised wherever the call is mounted. req.body
// does NOT exist until a body parser has run. Mounting mongoSanitize() above
// express.json() therefore silently protects query strings while leaving every
// JSON body unfiltered, and a payload like {"userId":{"$ne":null}} reaches
// Mongo as a live operator — turning findOne({ user_id: userId }) into
// "return the first user in the collection".
//
// This is an ordering bug with no runtime error and no failing request, so
// only a test keeps it fixed. Do not "tidy" the middleware block by grouping
// mongoSanitize() with the other hardening middleware at the top.

/** Spin up an app, POST a body, resolve with what the handler actually saw. */
async function postBody(mountMiddleware, payload) {
  const app = express();
  mountMiddleware(app);

  let seen;
  app.post("/probe", (req, res) => {
    seen = req.body;
    res.json({ ok: true });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const { port } = server.address();
    await fetch(`http://127.0.0.1:${port}/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return seen;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The real ordering, as mounted in index.js. */
const correctOrder = (app) => {
  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(mongoSanitize());
};

/** The ordering this test exists to prevent a return to. */
const brokenOrder = (app) => {
  app.use(mongoSanitize());
  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(express.json());
};

async function run() {
  console.log("mongoSanitize — request body operator stripping");

  await test("strips a top-level $ne operator from a JSON body", async () => {
    const seen = await postBody(correctOrder, { userId: { $ne: null } });
    assert.deepEqual(seen, { userId: {} }, "the $ne key survived sanitisation");
  });

  await test("strips operators nested inside a body object", async () => {
    const seen = await postBody(correctOrder, {
      filter: { email: { $gt: "" }, role: "admin" },
    });
    assert.deepEqual(seen, { filter: { email: {}, role: "admin" } });
  });

  await test("strips operators inside an array of body objects", async () => {
    const seen = await postBody(correctOrder, {
      ids: [{ $ne: null }, { id: "real" }],
    });
    assert.deepEqual(seen, { ids: [{}, { id: "real" }] });
  });

  await test("leaves a legitimate body untouched", async () => {
    const payload = { userId: "u_123", limit: 10, brand: { name: "Acme" } };
    const seen = await postBody(correctOrder, payload);
    assert.deepEqual(seen, payload, "sanitisation altered a benign body");
  });

  console.log("\nmongoSanitize — the ordering itself");

  await test("the broken order really does let $ne through (regression proof)", async () => {
    const seen = await postBody(brokenOrder, { userId: { $ne: null } });
    assert.deepEqual(
      seen,
      { userId: { $ne: null } },
      "expected the pre-body-parser mount to be ineffective — if this now passes, " +
        "express-mongo-sanitize changed behaviour and this suite needs revisiting",
    );
  });

  await test("index.js mounts mongoSanitize below every body parser", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
    const lines = src.split("\n");

    const lineOf = (needle) => {
      const i = lines.findIndex((l) => !l.trim().startsWith("//") && l.includes(needle));
      assert.notEqual(i, -1, `could not find \`${needle}\` in index.js`);
      return i;
    };

    const sanitizeLine = lineOf("App.use(mongoSanitize())");
    const parserLines = [
      "App.use(bodyParser.json(",
      "App.use(bodyParser.urlencoded(",
      "App.use(express.json())",
      "App.use(express.urlencoded(",
    ].map(lineOf);

    for (const [idx, parserLine] of parserLines.entries()) {
      assert.ok(
        sanitizeLine > parserLine,
        `mongoSanitize() is mounted at index.js:${sanitizeLine + 1}, above the body ` +
          `parser at index.js:${parserLine + 1} (#${idx + 1}). req.body will not be ` +
          `sanitised. Move App.use(mongoSanitize()) below all four parsers.`,
      );
    }
  });

  console.log(`\n${passed} passed`);
  if (process.exitCode) console.error("FAILED");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
