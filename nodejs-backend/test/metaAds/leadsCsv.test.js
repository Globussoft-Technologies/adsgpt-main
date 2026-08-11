#!/usr/bin/env node
/**
 * Captured-lead CSV + pagination tests. Run with:
 *
 *   node test/metaAds/leadsCsv.test.js
 *
 * Mirrors the project's plain-Node assertion style. Exits non-zero on
 * failure. Requires utils/metaLeads.js directly — never the controller —
 * so nothing here opens Redis / the Business SDK / a DB connection.
 */

const assert = require("node:assert/strict");

const {
  csvCell,
  leadsToCsv,
  normalizeLead,
  leadFieldNames,
  fetchAllLeadsForForm,
  MAX_LEAD_PAGES,
} = require("../../utils/metaLeads");

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
// Lead-form answers are submitted by anyone on the public internet. Quoting a
// cell does NOT stop Excel / Sheets treating a leading =, +, -, @, tab or CR
// as a formula once the quoting is parsed away (CWE-1236) — the advertiser
// downloading their own leads is the victim. Every trigger character must be
// neutralised with a leading apostrophe. Do not "simplify" this away.
async function run() {
  console.log("csvCell — formula injection");

  await test("neutralises a DDE command payload", () => {
    assert.equal(csvCell("=cmd|'/c calc'!A1"), `"'=cmd|'/c calc'!A1"`);
  });

  for (const [label, ch] of [
    ["equals", "="],
    ["plus", "+"],
    ["minus", "-"],
    ["at", "@"],
    ["tab", "\t"],
    ["carriage return", "\r"],
  ]) {
    await test(`neutralises a leading ${label}`, () => {
      const out = csvCell(`${ch}HYPERLINK("http://evil","x")`);
      assert.equal(
        out[1],
        "'",
        `expected an apostrophe guard directly inside the opening quote, got ${JSON.stringify(out.slice(0, 4))}`,
      );
      assert.equal(out[2], ch, "original first character must be preserved");
    });
  }

  await test("leaves a benign value untouched", () => {
    assert.equal(csvCell("Jane Doe"), `"Jane Doe"`);
  });

  await test("does not guard a trigger character mid-string", () => {
    assert.equal(csvCell("a=b"), `"a=b"`);
  });

  console.log("csvCell — existing escaping still holds");

  await test("doubles embedded quotes", () => {
    assert.equal(csvCell('say "hi"'), `"say ""hi"""`);
  });

  await test("preserves commas and newlines inside the quoted cell", () => {
    assert.equal(csvCell("a,b\nc"), `"a,b\nc"`);
  });

  await test("renders null / undefined as an empty cell", () => {
    assert.equal(csvCell(null), `""`);
    assert.equal(csvCell(undefined), `""`);
  });

  console.log("leadsToCsv");

  const sampleLeads = [
    normalizeLead({
      id: "L1",
      created_time: "2026-08-01T10:00:00+0000",
      field_data: [
        { name: "full_name", values: ["José Ávila"] },
        { name: "phone_number", values: ["+15551234567"] },
      ],
      campaign_name: "Summer Push",
      is_organic: false,
    }),
  ];

  await test("starts with a UTF-8 BOM so Excel reads non-ASCII correctly", () => {
    assert.ok(
      leadsToCsv(sampleLeads).startsWith("﻿"),
      "CSV must be BOM-prefixed",
    );
  });

  await test("guards a phone number that starts with +", () => {
    // "+15551234567" is the single most common real-world trigger in lead
    // data — an unguarded one is evaluated as an arithmetic expression.
    assert.ok(leadsToCsv(sampleLeads).includes(`"'+15551234567"`));
  });

  await test("keeps non-ASCII answer text intact", () => {
    assert.ok(leadsToCsv(sampleLeads).includes("José Ávila"));
  });

  await test("header carries prettified question names", () => {
    const header = leadsToCsv(sampleLeads).split("\r\n")[0];
    assert.ok(header.includes(`"Full Name"`), header);
    assert.ok(header.includes(`"Phone Number"`), header);
  });

  await test("leadFieldNames unions fields across differing lead shapes", () => {
    const names = leadFieldNames([
      { fields: { a: "1", b: "2" } },
      { fields: { b: "3", c: "4" } },
    ]);
    assert.deepEqual(names, ["a", "b", "c"]);
  });

  console.log("fetchAllLeadsForForm — truncation reporting");

  // Stub standing in for a Page-scoped FacebookAdsApi. `total` leads are
  // served 200 at a time, mirroring the real cursor pagination.
  const stubApi = (total, pageSize = 200) => {
    let served = 0;
    return {
      calls: 0,
      call(_method, _path, _params) {
        this.calls++;
        const batch = [];
        for (let i = 0; i < pageSize && served < total; i++, served++) {
          batch.push({ id: `L${served}`, field_data: [] });
        }
        const more = served < total;
        return Promise.resolve({
          data: batch,
          paging: more
            ? { next: "https://graph.facebook.com/next", cursors: { after: `c${served}` } }
            : {},
        });
      },
    };
  };

  await test("reports truncated:false when the form fits under the cap", async () => {
    const { leads, truncated } = await fetchAllLeadsForForm(stubApi(450), "F1", 5000);
    assert.equal(leads.length, 450);
    assert.equal(truncated, false);
  });

  await test("reports truncated:true and caps the array when leads remain", async () => {
    const { leads, truncated } = await fetchAllLeadsForForm(stubApi(1200), "F1", 400);
    assert.equal(leads.length, 400);
    assert.equal(truncated, true);
  });

  await test("landing exactly on the cap with no next page is NOT truncated", async () => {
    // Regression guard: the naive `out.length >= maxLeads` check reported a
    // clean, complete fetch as truncated and would have shown a false
    // "some leads are missing" banner.
    const { leads, truncated } = await fetchAllLeadsForForm(stubApi(400), "F1", 400);
    assert.equal(leads.length, 400);
    assert.equal(truncated, false);
  });

  await test("reports truncated:true when the page ceiling is hit", async () => {
    // Far more leads than MAX_LEAD_PAGES * pageSize can reach, with the cap
    // set high enough that the page ceiling is what stops us.
    const api = stubApi(MAX_LEAD_PAGES * 200 + 5000, 200);
    const { truncated } = await fetchAllLeadsForForm(api, "F1", 10 ** 9);
    assert.equal(api.calls, MAX_LEAD_PAGES, "should stop at the page ceiling");
    assert.equal(truncated, true);
  });

  await test("handles an empty form without claiming truncation", async () => {
    const { leads, truncated } = await fetchAllLeadsForForm(stubApi(0), "F1", 5000);
    assert.deepEqual(leads, []);
    assert.equal(truncated, false);
  });

  if (process.exitCode) {
    console.error("\nleadsCsv: FAILED");
  } else {
    console.log(`\nleadsCsv: ${passed} passed`);
  }
}

run();
