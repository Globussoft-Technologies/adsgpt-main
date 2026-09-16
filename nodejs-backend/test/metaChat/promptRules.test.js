/**
 * Prompt rules written in response to real chat failures.
 *
 * Each block below exists because Ads Chat did the wrong thing against a live ad
 * account, not because someone thought it might. Prompt text is easy to reword
 * away by accident, so these assert the RULE still exists — deliberately loose
 * about phrasing, strict about the rule surviving.
 *
 * Reproduced 2026-09-15 on act_1262110972306470 with the prompt:
 *   "create a traffic campaign called sri lanaka campaign and set cbo of 100 per
 *    day / create ad set and target sri lanka in it / make both active"
 */
const assert = require("assert");

process.env.META_MCP_SERVER_URL = process.env.META_MCP_SERVER_URL || "http://stub/mcp";
const { getProfile } = require("../../services/metaChat/mcpMode");
const { systemInstruction } = require("../../services/metaChat/geminiMcpBridge");

const flat = (currency) =>
  systemInstruction("act_1", currency, {}, getProfile("u1")).replace(/\s+/g, " ");
const inr = flat("INR");

// ── bid strategy ────────────────────────────────────────────────────────────
// The model set LOWEST_COST_WITH_BID_CAP on a campaign nobody asked to cap, then
// omitted bid_amount on the ad set. Meta rejected it three times with subcode
// 1815857 and the campaign was left with no ad set.
assert.ok(/LOWEST_COST_WITHOUT_CAP/.test(inr), "the prompt must name the automatic-bidding value");
assert.ok(
  /LOWEST_COST_WITH_BID_CAP/.test(inr) && /COST_CAP/.test(inr),
  "the prompt must name the cap strategies it is warning about",
);
assert.ok(
  /1815857/.test(inr),
  "naming the subcode lets the model connect Meta's rejection to the cause",
);
assert.ok(
  /every ad set under that campaign must then carry a bid_amount/i.test(inr),
  "the prompt must state the obligation a cap strategy creates",
);
assert.ok(
  /only set a bid strategy when the user asked for one/i.test(inr),
  "the prompt must say not to pick a cap nobody requested",
);

// ── where the budget lives: CBO vs ABO ──────────────────────────────────────
// Meta enforces this in both directions and the model has no way to guess it:
// an ad set carrying its own budget inside a CBO campaign is rejected, and so is
// an ad set with no budget under a campaign that has none ("No budget specified
// for this ad set, and the parent campaign does not use CBO" — seen live).
assert.ok(
  inr.includes('"CBO"') && inr.includes('"ABO"'),
  "the prompt must name both budget modes — the model is asked to tell them apart",
);
assert.ok(
  /(read the campaign first|already know which it is)/i.test(inr),
  "the prompt must say how to find out which mode a campaign is in",
);
assert.ok(
  /campaign HAS daily_budget or lifetime_budget . the ad set must carry NEITHER/i.test(inr),
  "the CBO branch must be stated: no budget on the ad set",
);
assert.ok(
  /campaign has NEITHER . the ad set MUST carry daily_budget or lifetime_budget/i.test(inr),
  "the ABO branch must be stated: the ad set carries the budget",
);
assert.ok(
  /ask for one instead of inventing a figure/i.test(inr),
  "an unstated ABO budget must be asked for, never guessed — this one spends money",
);
assert.ok(
  /move the budget to the other level/i.test(inr),
  "the recovery must be to move the budget, not to retry the same call",
);
// Currency-general: the examples follow the account, they are not rupees.
{
  const jpy = flat("JPY");
  assert.ok(
    /a campaign with .{0,12}100.{0,4} a day/i.test(jpy),
    "the budget-placement examples must render in the account's own currency",
  );
}

// ── money echoed back out ───────────────────────────────────────────────────
// Told to set ₹100/day, the model passed 10000 (correct, minor units) and then
// reported it back as "a daily budget of ₹10,000".
assert.ok(
  /divide by the same factor/i.test(inr),
  "the prompt must require converting minor units back for display",
);
assert.ok(
  /₹100\.00, not ₹10,000\.00/.test(inr),
  "a worked example showing both the right and the wrong rendering",
);

// ── every money example follows the ACCOUNT's currency ──────────────────────
// The prompt used to hardcode rupees ("in this INR account", "₹50", "multiply by
// 100"), which is wrong for most of the user base — and for a 0-decimal currency
// it is not merely cosmetic: a hardcoded x100 overstates every JPY budget 100x.
{
  const usd = flat("USD");
  assert.ok(!/₹|INR|rupee|paise/i.test(usd), "no rupees in a USD account's prompt");
  assert.ok(/\$50\.00 → 5000/.test(usd), "USD keeps the 2-decimal x100 rule, in dollars");

  // 0-decimal: the amount is passed through unchanged.
  const jpy = flat("JPY");
  assert.ok(!/₹|INR/i.test(jpy), "no rupees in a JPY account's prompt");
  assert.ok(
    /JPY has no minor unit, so pass the amount unchanged/.test(jpy),
    "a 0-decimal currency must NOT be told to multiply",
  );
  assert.ok(!/multiply by 100/.test(jpy), "x100 must not appear for JPY");
  assert.ok(
    /daily_budget 100 in this account has a budget of ¥100/.test(jpy),
    "the echo-out example follows the same factor",
  );

  // 3-decimal: the factor is 1000, not 100.
  const kwd = flat("KWD");
  assert.ok(/multiply by 1000/.test(kwd), "KWD has three decimals — the factor is 1000");
  assert.ok(!/multiply by 100\b/.test(kwd), "a flat x100 would be 10x wrong for KWD");

  // Unknown currency: neutral wording, never a guessed symbol.
  const none = flat(undefined)
    .split("# Rich display blocks")[0]
    // The rule "NEVER display a \"$\" sign" legitimately contains one.
    .replace(/NEVER display a "\$" sign/g, "");
  assert.ok(!/₹|\$|¥|€/.test(none), "no currency symbol is invented when none is known");
  assert.ok(
    /multiply by 100 for a 2-decimal currency, or pass it unchanged for a 0-decimal one/.test(none),
    "with no currency known, both cases are explained rather than one assumed",
  );
}

// ── retries ─────────────────────────────────────────────────────────────────
// Official mode masks Meta validation errors as
// {"error_category":"INTERNAL","error_message":"An internal error occurred.
//  Please try again later.","is_retryable":true}
// The model retried the identical call six times and then advised waiting.
assert.ok(/Retry at most ONCE/i.test(inr), "the prompt must cap retries");
assert.ok(
  /only with changed arguments/i.test(inr),
  "an identical retry cannot produce a different result — the prompt must say so",
);
assert.ok(
  /internal error/i.test(inr) && /try again later/i.test(inr),
  "the prompt must warn that a validation failure is often reported as a transient one",
);

// ── the write-side rule these sit beside must survive ───────────────────────
// Over-correcting the money rules would break budgets, which Meta genuinely does
// take in minor units.
assert.ok(
  /multiply by 100 \(₹50\.00 → 5000\)/.test(inr),
  "the minor-unit conversion INTO write tools must still be instructed",
);

console.log("metaChat promptRules tests passed");
