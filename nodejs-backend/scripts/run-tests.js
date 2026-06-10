#!/usr/bin/env node
/**
 * Test runner for the plain-Node test suite.
 *
 * Auto-discovers every `*.test.js` under `test/` (recursively) and runs each
 * in its own `node` process. No framework — this matches the assertion-style
 * pattern the individual test files already use (each prints its own PASS/FAIL
 * summary and exits non-zero on failure).
 *
 * Using a discovery runner instead of a hardcoded file list means new test
 * files are picked up automatically — nothing to wire up per file.
 *
 * Run:  npm test   (from nodejs-backend/)
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TEST_DIR = path.join(__dirname, "..", "test");

/** Recursively collect every *.test.js file under dir. */
function findTests(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findTests(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

if (!fs.existsSync(TEST_DIR)) {
  console.error(`No test directory found at ${TEST_DIR}`);
  process.exit(1);
}

const files = findTests(TEST_DIR).sort();
if (files.length === 0) {
  console.error("No *.test.js files found.");
  process.exit(1);
}

const cwd = path.join(__dirname, "..");
const failed = [];

for (const file of files) {
  const rel = path.relative(cwd, file);
  console.log(`\n──────── ${rel} ────────`);
  const res = spawnSync(process.execPath, [file], { stdio: "inherit", cwd });
  if (res.status !== 0) {
    failed.push(rel);
  }
}

console.log("\n════════════════════════════════════════");
console.log(`Test files: ${files.length} total, ${files.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.log("\nFailed files:");
  for (const f of failed) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("All test files passed ✓");
