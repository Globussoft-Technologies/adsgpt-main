/**
 * reconcileBillingCycles.js — run the billing reconciliation on demand.
 *
 * The same job the daily cron runs (services/billingReconciliation.js), exposed
 * as a script so it can be run manually: to catch users up immediately after
 * deploying the fix, or to inspect what the cron would do before enabling it.
 *
 * Run with:
 *   node scripts/reconcileBillingCycles.js                 # dry run (default)
 *   node scripts/reconcileBillingCycles.js --apply         # actually refill
 *
 * Connection:
 *   MONGO_URI wins over MONGO_CONNECTION_STRING from .env, which usually points
 *   at dev. The target database is printed before anything is read or written.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { reconcileBillingCycles } = require("../services/billingReconciliation");

const apply = process.argv.includes("--apply");
const unknown = process.argv
  .slice(2)
  .filter((a) => a !== "--apply");
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  console.error("Usage: node scripts/reconcileBillingCycles.js [--apply]");
  process.exit(1);
}

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_CONNECTION_STRING;
if (!MONGO_URI) {
  console.error(
    "No Mongo connection string. Pass one inline:\n" +
      "  MONGO_URI='mongodb://...' node scripts/reconcileBillingCycles.js",
  );
  process.exit(1);
}

const describeTarget = (uri) => {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(unparseable URI)";
  }
};

(async () => {
  console.log(`\nTarget DB : ${describeTarget(MONGO_URI)}`);
  console.log(`Mode      : ${apply ? "APPLY (will write)" : "dry run"}\n`);

  await mongoose.connect(MONGO_URI);
  const { stats, actions } = await reconcileBillingCycles({ dryRun: !apply });

  console.log("\n─── summary ───");
  console.table(stats);

  if (actions.length) {
    console.log(apply ? "\nrefilled:" : "\nwould refill:");
    console.table(actions);
  } else {
    console.log("\nNo users needed a refill.");
  }

  if (!apply && actions.length) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to refill.");
  }
})()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
