#!/usr/bin/env node
/**
 * Tests for services/autopilot/fieldAvailability.js.
 *
 * THE IMPORTANT TEST IS THE DRIFT ONE. This module is a hand-maintained
 * mirror of what the three audit normalizers emit, and the failure it guards
 * against is silent by construction: the cron's evaluator fails a condition
 * closed on an undefined field, so a rule whose field is missing at its level
 * never matches, never errors, and looks healthy in the UI indefinitely. That
 * shipped once — eight of one account's ten enabled rules were ad-level rules
 * on `cpa` / `purchases`, which `normalizeAd` did not produce.
 *
 * So rather than assert a copy of the list, the drift test PARSES
 * metaAuditService.js and compares the real `return` blocks against this
 * module. If someone adds a metric to a normalizer, or removes one, the test
 * says so.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    console.log(`      ${err.stack || err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

const {
  fieldsForLevel,
  isFieldAvailable,
  unavailableFields,
  FIELDS_BY_LEVEL,
} = require("../../services/autopilot/fieldAvailability");

const AUDIT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "services",
  "metaAuditService.js",
);

/** The keys a normalizer's `return {…}` block actually produces. */
function emittedFields(source, fnName) {
  const start = source.indexOf(`const ${fnName} = `);
  assert.ok(start > -1, `${fnName} not found in metaAuditService.js`);
  const body = source.slice(start);
  const retAt = body.indexOf("return {");
  const endAt = body.indexOf("\n  };", retAt);
  assert.ok(retAt > -1 && endAt > retAt, `${fnName} return block not found`);
  const block = body.slice(retAt, endAt);
  return [...block.matchAll(/^      ([a-z_]+)\s*[,:]/gm)]
    .map((m) => m[1])
    .filter(
      (f) =>
        !f.startsWith("_") &&
        f !== "entity" &&
        !/^(campaign|adset|ad)_(id|name)$/.test(f),
    );
}

// Emitted but deliberately not offered as rule fields. Each needs a reason.
const NOT_RULE_FIELDS = new Set([
  "currency", // display only
  "pacing_date", // a date string, no operator makes sense
  "account_avg_cpa", // context for other rules, not a threshold
  "is_top_performer", // boolean; the catalog has no boolean operators
  "conversions", // exact alias of `purchases`; one name is enough
  "prev_conversions", // ditto
  "audience_size", // emitted at adset level but hardcoded null — a rule on
  // it could never match, which is the very bug this module exists to stop
  "prev_impressions", // carried for the action-log snapshot and alert copy;
  // never offered as a rule field, so neither the validator's NUMERIC_FIELDS
  // nor the form's catalog accepts it. Adding it would mean adding it in all
  // three places at once.
]);

(async () => {
  const source = fs.readFileSync(AUDIT_PATH, "utf8");

  group("drift against the real normalizers", () => {
    for (const [level, fnName] of [
      ["campaign", "normalizeCampaign"],
      ["adset", "normalizeAdset"],
      ["ad", "normalizeAd"],
    ]) {
      test(`${level}: every listed field is actually emitted`, () => {
        const emitted = new Set(emittedFields(source, fnName));
        const claimed = fieldsForLevel(level);
        const phantom = claimed.filter((f) => !emitted.has(f));
        assert.deepEqual(
          phantom,
          [],
          `${level} claims fields ${fnName} does not emit — rules using them would never fire`,
        );
      });

      test(`${level}: every emitted metric is listed (or excluded on purpose)`, () => {
        const emitted = emittedFields(source, fnName);
        const claimed = new Set(fieldsForLevel(level));
        const unlisted = emitted.filter(
          (f) => !claimed.has(f) && !NOT_RULE_FIELDS.has(f),
        );
        assert.deepEqual(
          unlisted,
          [],
          `${fnName} emits fields this module does not list — either add them here or to NOT_RULE_FIELDS with a reason`,
        );
      });
    }
  });

  group("the regression that caused this", () => {
    test("ad level measures cpa and purchases", () => {
      // Eight of GPT-435's ten enabled rules were ad-level rules on these two
      // fields, sitting at zero fires because normalizeAd never emitted them.
      assert.equal(isFieldAvailable("cpa", "ad"), true);
      assert.equal(isFieldAvailable("purchases", "ad"), true);
      assert.equal(isFieldAvailable("roas", "ad"), true);
      assert.equal(isFieldAvailable("clicks", "ad"), true);
    });

    test("adset level measures the rate metrics it was missing", () => {
      for (const f of ["ctr", "cpc", "cpm", "roas", "impressions"]) {
        assert.equal(isFieldAvailable(f, "adset"), true, `adset should have ${f}`);
      }
    });
  });

  group("genuinely level-specific fields stay level-specific", () => {
    test("budget_pacing is campaign-only — ads have no budget", () => {
      assert.equal(isFieldAvailable("budget_pacing", "campaign"), true);
      assert.equal(isFieldAvailable("budget_pacing", "adset"), false);
      assert.equal(isFieldAvailable("budget_pacing", "ad"), false);
    });

    test("learning_status is adset-only — it is an adset property", () => {
      assert.equal(isFieldAvailable("learning_status", "adset"), true);
      assert.equal(isFieldAvailable("learning_status", "ad"), false);
      assert.equal(isFieldAvailable("learning_status", "campaign"), false);
    });

    test("creative fields are ad-only", () => {
      for (const f of ["review_status", "relevance_score", "ad_spend_share"]) {
        assert.equal(isFieldAvailable(f, "ad"), true, `ad should have ${f}`);
        assert.equal(isFieldAvailable(f, "campaign"), false);
      }
    });

    test("audience_size is offered nowhere", () => {
      // normalizeAdset hardcodes it to null, so a rule on it can never match.
      for (const level of ["campaign", "adset", "ad"]) {
        assert.equal(isFieldAvailable("audience_size", level), false);
      }
    });
  });

  group("unavailableFields", () => {
    const conds = (...fields) => ({ rules: fields.map((f) => ({ field: f })) });

    test("names the offending fields", () => {
      assert.deepEqual(
        unavailableFields(conds("spend", "budget_pacing"), "ad"),
        ["budget_pacing"],
      );
    });

    test("returns nothing for a valid rule", () => {
      assert.deepEqual(unavailableFields(conds("spend", "cpa"), "ad"), []);
    });

    test("dedupes repeated fields", () => {
      assert.deepEqual(
        unavailableFields(conds("budget_pacing", "budget_pacing"), "ad"),
        ["budget_pacing"],
      );
    });

    test("tolerates malformed input rather than throwing", () => {
      assert.deepEqual(unavailableFields(null, "ad"), []);
      assert.deepEqual(unavailableFields({}, "ad"), []);
      assert.deepEqual(unavailableFields(conds(), "ad"), []);
      assert.deepEqual(unavailableFields({ rules: [null, {}] }, "ad"), []);
    });

    test("an unknown level allows everything", () => {
      // A guard against unusable rules, not an authorisation check — refusing
      // every field for a level added later would be worse than allowing it.
      assert.deepEqual(unavailableFields(conds("anything"), "future"), []);
      assert.deepEqual(fieldsForLevel("future"), []);
    });
  });

  group("shape", () => {
    test("all three levels are covered", () => {
      assert.deepEqual(Object.keys(FIELDS_BY_LEVEL).sort(), [
        "ad",
        "adset",
        "campaign",
      ]);
    });

    test("spend and status exist at every level", () => {
      for (const level of ["campaign", "adset", "ad"]) {
        assert.equal(isFieldAvailable("spend", level), true);
        assert.equal(isFieldAvailable("status", level), true);
      }
    });
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of FAILURES) {
      console.log(`\n FAIL: ${f.name}`);
      console.log(f.err.stack || f.err.message);
    }
    process.exit(1);
  }
})();
