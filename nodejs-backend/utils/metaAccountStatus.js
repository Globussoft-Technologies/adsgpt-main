/**
 * metaAccountStatus — turn Meta's numeric ad-account codes into a sentence a
 * user can act on.
 *
 * WHY THIS EXISTS: pausing a campaign on a disabled ad account fails with
 * Meta's terse `"Permissions error"` and nothing else. The dashboard then
 * showed "Failed to update status / Permissions error", which reads as an
 * AdsGPT bug or a login problem. The real cause is almost always the ad
 * account itself — unsettled billing, a risk review, a policy disable — and
 * the user has to fix it in Meta, not here. Saying so is the difference
 * between a support ticket and a two-minute fix.
 *
 * Enum values captured from Meta's AdAccount reference 2026-09-09. Both
 * fields are NUMBERS on the wire, and both have gaps in their ranges, so
 * unknown codes must degrade to a readable fallback rather than `undefined`.
 *
 * Pure module: no SDK, no DB. The controller does the fetching.
 */

// account_status
const ACCOUNT_STATUS = {
  1: { name: "ACTIVE", usable: true, label: "Active" },
  2: {
    name: "DISABLED",
    usable: false,
    label: "Disabled",
    hint: "Meta has disabled this ad account. Open it in Meta Ads Manager to see the reason and request a review.",
  },
  3: {
    name: "UNSETTLED",
    usable: false,
    label: "Unsettled",
    hint: "This ad account has an unpaid balance. Settle it in Meta Ads Manager under Billing, then try again.",
  },
  7: {
    name: "PENDING_RISK_REVIEW",
    usable: false,
    label: "Pending risk review",
    hint: "Meta is reviewing this ad account. Changes are blocked until the review finishes — this usually takes up to 24 hours.",
  },
  8: {
    name: "PENDING_SETTLEMENT",
    usable: false,
    label: "Pending settlement",
    hint: "Meta is settling a payment on this ad account. Changes are blocked until it clears.",
  },
  9: {
    name: "IN_GRACE_PERIOD",
    usable: true,
    label: "In grace period",
    hint: "This ad account has a payment issue and is in its grace period. Update the payment method in Meta Ads Manager before it's disabled.",
  },
  100: {
    name: "PENDING_CLOSURE",
    usable: false,
    label: "Pending closure",
    hint: "This ad account is scheduled to close and can no longer be changed.",
  },
  101: {
    name: "CLOSED",
    usable: false,
    label: "Closed",
    hint: "This ad account is closed. Use a different ad account.",
  },
  201: { name: "ANY_ACTIVE", usable: true, label: "Active" },
  202: {
    name: "ANY_CLOSED",
    usable: false,
    label: "Closed",
    hint: "This ad account is closed. Use a different ad account.",
  },
};

// disable_reason — only meaningful when account_status is DISABLED. It says
// WHY, which is what decides whether the user can fix it themselves (payment)
// or has to appeal (policy).
const DISABLE_REASON = {
  0: null, // NONE — not disabled for a specific reason
  1: "it broke Meta's advertising policies",
  2: "it's under intellectual-property review",
  3: "of a payment risk flag",
  4: "Meta shut it down as an unverified account",
  5: "it's under ad-review",
  6: "the business is under integrity review",
  7: "it was permanently closed",
  8: "it's an unused reseller account",
  9: "it went unused",
  10: "it's an umbrella account",
  11: "the Business Manager broke Meta's policies",
  12: "it was found to be misrepresented",
  13: "of a legal-entity change",
  14: "it's under conversation-thread review",
  15: "the account was compromised",
};

/**
 * describeAccountStatus — `{usable, label, reason}` for an ad account.
 *
 * @param {number|string} accountStatus  Meta's `account_status`
 * @param {number|string} [disableReason] Meta's `disable_reason`
 */
function describeAccountStatus(accountStatus, disableReason) {
  const code = Number(accountStatus);
  const entry = ACCOUNT_STATUS[code];
  if (!entry) {
    // A code Meta added after this map was written. Don't claim the account
    // is fine and don't claim it's broken — say what we actually know.
    return {
      code,
      name: null,
      usable: null,
      label: `Status ${accountStatus}`,
      reason: null,
    };
  }

  let reason = entry.hint || null;
  const why = DISABLE_REASON[Number(disableReason)];
  // Only DISABLED carries a meaningful disable_reason; on other statuses the
  // field is stale or zero and would contradict the status hint.
  if (entry.name === "DISABLED" && why) {
    reason = `Meta disabled this ad account because ${why}. Open it in Meta Ads Manager to see the details and request a review.`;
  }

  return {
    code,
    name: entry.name,
    usable: entry.usable,
    label: entry.label,
    reason,
  };
}

/**
 * looksAccountLevel — is this Meta error plausibly about the ad account
 * rather than the thing the user clicked?
 *
 * Used to decide whether it's worth spending one extra API call to read the
 * account's status before answering. Deliberately broad: the cost of a false
 * positive is a single GET, and the cost of a false negative is the user
 * seeing "Permissions error" with no explanation.
 */
function looksAccountLevel(metaError) {
  const m = metaError || {};
  const code = Number(m.code);
  // 10 and the 200-series are Meta's permission codes; 1487390 is the
  // explicit "ad account is disabled" subcode.
  if (code === 10 || (code >= 200 && code < 300)) return true;
  if (Number(m.subcode) === 1487390) return true;
  return /permission|disabled|not allowed|unsettled|billing/i.test(
    String(m.message || ""),
  );
}

module.exports = {
  ACCOUNT_STATUS,
  DISABLE_REASON,
  describeAccountStatus,
  looksAccountLevel,
};
