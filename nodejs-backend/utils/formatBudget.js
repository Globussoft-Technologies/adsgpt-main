/**
 * formatBudget — currency formatter. Split out of utils/metaHelpers.js so
 * modules that need only this helper don't transitively pull the Meta SDK.
 */

function formatBudget(amount, currency) {
  const value = amount ? Number(amount) / 100 : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
  }).format(value);
}

module.exports = { formatBudget };
