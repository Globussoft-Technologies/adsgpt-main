/**
 * Ad-account status explanations.
 *
 * These exist because the failure they describe is INVISIBLE: pausing a
 * campaign on a disabled ad account returned Meta's bare "Permissions error",
 * which reads as an AdsGPT bug or a login problem. Nothing was wrong with the
 * request — the account had a billing or review hold the user has to clear in
 * Meta. Every check below guards a sentence a user acts on, so a regression
 * here costs a support ticket, not a stack trace.
 */

const assert = require("assert");

const {
  describeAccountStatus,
  looksAccountLevel,
} = require("../../utils/metaAccountStatus");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${label}\n        ${err.message}`);
  }
}

console.log("\naccount status");

check("an active account is usable and needs no explanation", () => {
  const d = describeAccountStatus(1);
  assert.strictEqual(d.usable, true);
  assert.strictEqual(d.reason, null);
});

check("codes arrive as strings on the wire and still resolve", () => {
  assert.strictEqual(describeAccountStatus("2").name, "DISABLED");
  assert.strictEqual(describeAccountStatus("1").usable, true);
});

// The three the user is most likely to hit, and the ones the original bug
// report guessed at ("maybe because of payments").
check("unsettled says to settle the balance", () => {
  const d = describeAccountStatus(3);
  assert.strictEqual(d.usable, false);
  assert.match(d.reason, /unpaid balance/i);
  assert.match(d.reason, /Billing/);
});

check("risk review says to wait, not to fix something", () => {
  const d = describeAccountStatus(7);
  assert.match(d.reason, /reviewing/i);
});

check("grace period warns but stays usable", () => {
  const d = describeAccountStatus(9);
  // Still usable: the account works, it just will not for long. Reporting it
  // as unusable would contradict what the user can plainly see happening.
  assert.strictEqual(d.usable, true);
  assert.match(d.reason, /payment/i);
});

console.log("\ndisable reason");

check("a disabled account names WHY when Meta says", () => {
  const d = describeAccountStatus(2, 3); // RISK_PAYMENT
  assert.match(d.reason, /payment risk/i);
});

check("a policy disable reads differently from a payment one", () => {
  const policy = describeAccountStatus(2, 1).reason;
  const payment = describeAccountStatus(2, 3).reason;
  assert.notStrictEqual(policy, payment);
  assert.match(policy, /policies/i);
});

check("a disabled account with no reason still explains itself", () => {
  const d = describeAccountStatus(2, 0);
  assert.strictEqual(d.usable, false);
  assert.ok(d.reason && d.reason.length > 0);
});

// disable_reason is only meaningful alongside DISABLED. On any other status
// it is stale or zero, and quoting it would contradict the status itself —
// "in grace period ... because it was permanently closed".
check("disable_reason is ignored unless the account is DISABLED", () => {
  const d = describeAccountStatus(9, 7); // grace period + PERMANENT_CLOSE
  assert.ok(!/permanently closed/i.test(d.reason), d.reason);
});

console.log("\nunknown codes");

// Meta adds codes. Claiming an unknown account is fine would hide a real
// block; claiming it is broken would invent one.
check("an unmapped status asserts nothing either way", () => {
  const d = describeAccountStatus(999);
  assert.strictEqual(d.usable, null);
  assert.strictEqual(d.reason, null);
  assert.match(d.label, /999/);
});

check("a missing status doesn't throw", () => {
  assert.doesNotThrow(() => describeAccountStatus(undefined));
  assert.doesNotThrow(() => describeAccountStatus(null, null));
});

console.log("\nis this error about the account?");

// The gate that decides whether to spend one extra GET. A false positive
// costs a single read; a false negative costs the user an unexplained error.
check("Meta's permission codes qualify", () => {
  assert.ok(looksAccountLevel({ code: 200, message: "Permissions error" }));
  assert.ok(looksAccountLevel({ code: 10 }));
  assert.ok(looksAccountLevel({ subcode: 1487390 }));
});

check("the message alone is enough when no code came back", () => {
  assert.ok(looksAccountLevel({ message: "Permissions error" }));
  assert.ok(looksAccountLevel({ message: "The ad account is disabled" }));
});

check("an ordinary validation error does not trigger a lookup", () => {
  assert.ok(!looksAccountLevel({ code: 100, message: "Invalid parameter" }));
  assert.ok(!looksAccountLevel({}));
  assert.ok(!looksAccountLevel(null));
});

console.log(
  failures === 0
    ? "\naccountStatus: all checks passed\n"
    : `\naccountStatus: ${failures} check(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
