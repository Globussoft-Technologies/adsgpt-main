/**
 * The single source of truth for the ad-account payload cached under
 * `metaAdAccounts:<userId>[:<facebookId>]`.
 *
 * TWO writers populate that key — the dashboard's `/meta-ads/get-ad-accounts`
 * handler and the Autopilot cron's target discovery — and the dashboard,
 * the V2 wizard and plan-usage counting all read whichever one wrote last.
 * They previously each hand-rolled their own field list + mapping, so the
 * cron's narrower payload (no `amount_spent`, no budget floors) silently
 * overwrote the full one for the rest of the 2h TTL: "Spent" went blank in
 * the account picker and the wizard lost Meta's per-currency budget floors.
 *
 * Anything that writes that key MUST go through these two exports so the
 * shape can't drift again. Adding a field here is enough — both writers
 * pick it up.
 */
const { formatBudget } = require("./formatBudget");

// Fields requested from `/me/adaccounts`.
const AD_ACCOUNT_LIST_FIELDS = [
  "id",
  "name",
  "account_status",
  "currency",
  "timezone_name",
  "amount_spent",
  // Meta's per-currency floors (minor currency units). The V2 wizard
  // validates the campaign spending limit + budgets against these before
  // launch — e.g. an INR account's campaign spend-cap minimum is ₹5,000
  // (= 500000 paise).
  "min_campaign_group_spend_cap",
  "min_daily_budget",
];

/** Map one raw Meta ad account into the cached/API shape. */
function formatAdAccountForList(account) {
  return {
    id: String(account.id).replace("act_", ""),
    name: account.name,
    status: account.account_status,
    currency: account.currency,
    timezone: account.timezone_name,
    amountSpent: formatBudget(account.amount_spent, account.currency),
    // Raw minor-unit minimums — the frontend converts to major units for
    // display + validation. 0 when Meta doesn't report a floor.
    minCampaignSpendCap: Number(account.min_campaign_group_spend_cap) || 0,
    minDailyBudget: Number(account.min_daily_budget) || 0,
  };
}

module.exports = { AD_ACCOUNT_LIST_FIELDS, formatAdAccountForList };
