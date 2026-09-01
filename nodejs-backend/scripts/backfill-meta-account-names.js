#!/usr/bin/env node
/**
 * backfill-meta-account-names — name the ad accounts we have traffic for but
 * have never seen named.
 *
 * WHY THIS IS NEEDED AT ALL. Names are normally learned for free: the account
 * picker returns `{id, name}` for every account and the usage wrapper reads it
 * on the way past. But an account whose traffic never included a listing —
 * someone deep-linking into one account, or rows recorded before the wrapper
 * existed — has usage and no name, and shows on the admin page as "Unnamed
 * account". This fills those in.
 *
 * WHY ONE CALL PER CONNECTION AND NOT ONE PER ACCOUNT. Reading each unknown
 * account individually would spend the very quota this feature exists to
 * measure, and would fail for accounts whose only usage rows are
 * unattributed (there is no user to borrow a token from). Listing
 * `/me/adaccounts` once per Facebook connection names everything that
 * connection can reach, unknown or not, for a single request.
 *
 * SAFE TO RE-RUN. Writes are upserts keyed by account id, and it only reads.
 *
 * Usage:
 *   node scripts/backfill-meta-account-names.js            # only unknown ones
 *   node scripts/backfill-meta-account-names.js --all      # refresh every name
 *   node scripts/backfill-meta-account-names.js --dry-run
 *
 * Needs: MONGO_CONNECTION_STRING and the usual Meta env.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bizSdk = require("facebook-nodejs-business-sdk");

const FBUsers = require("../Module/adPosting/facebookUsers");
const {
  resolveFacebookConnection,
  getFacebookConnectionStatus,
} = require("../utils/metaConnection");
const MetaApiUsage = require("../Module/metaUsage/metaApiUsage");
const MetaAdAccountName = require("../Module/metaUsage/metaAdAccountName");

const DRY_RUN = process.argv.includes("--dry-run");
const REFRESH_ALL = process.argv.includes("--all");

// One page is plenty for any realistic connection, and a bounded request is
// the point of the exercise.
const PAGE_LIMIT = 200;

const strip = (id) => String(id || "").replace(/^act_/, "");

async function main() {
  const uri = process.env.MONGO_CONNECTION_STRING;
  if (!uri) {
    console.error("MONGO_CONNECTION_STRING is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`connected: ${mongoose.connection.name}`);

  // What we have traffic for.
  const seen = (await MetaApiUsage.distinct("adAccountId", {
    adAccountId: { $ne: null },
  })).map(strip);
  const known = new Set(
    (await MetaAdAccountName.find({}).select("adAccountId").lean()).map((n) =>
      strip(n.adAccountId),
    ),
  );
  const wanted = new Set(
    REFRESH_ALL ? seen : seen.filter((id) => !known.has(id)),
  );

  console.log(
    `${seen.length} accounts with traffic, ${known.size} already named, ` +
      `${wanted.size} to resolve${DRY_RUN ? " (dry run)" : ""}`,
  );
  if (wanted.size === 0) {
    await mongoose.disconnect();
    return;
  }

  // `accessToken` on the record is encrypted at rest — reading it directly
  // yields "Cannot parse access token". `resolveFacebookConnection` is the
  // only supported way to get a usable one, and it also applies the
  // expiry checks so a dead connection is skipped rather than retried.
  const connections = await FBUsers.find({})
    .select("facebookId userId name")
    .lean();
  console.log(`walking ${connections.length} Facebook connection(s)\n`);

  const found = new Map(); // accountId -> { name, userId }
  let calls = 0;

  for (const conn of connections) {
    try {
      const resolved = await resolveFacebookConnection({
        userId: conn.userId,
        facebookId: conn.facebookId,
        allowSingleFallback: false,
      });
      if (!getFacebookConnectionStatus(resolved.connection).isUsable) {
        console.log(`  ${conn.name || conn.facebookId}: skipped (token not usable)`);
        continue;
      }
      const api = bizSdk.FacebookAdsApi.init(resolved.accessToken);
      bizSdk.FacebookAdsApi.setDefaultApi(api);
      const me = new bizSdk.User("me");
      calls += 1;
      const accounts = await me.getAdAccounts(["id", "name", "account_id"], {
        limit: PAGE_LIMIT,
      });
      let named = 0;
      for (const a of accounts || []) {
        const raw = a.id || a._data?.id || a.account_id || a._data?.account_id;
        const name = a.name || a._data?.name;
        const id = strip(raw);
        if (!id || !name) continue;
        // Record every name we see, not just wanted ones when refreshing —
        // an account with no traffic yet will have one waiting.
        if (REFRESH_ALL || wanted.has(id)) {
          found.set(id, { name: String(name).trim(), userId: conn.userId });
          named += 1;
        }
      }
      console.log(
        `  ${conn.name || conn.facebookId}: ${accounts?.length || 0} accounts, ${named} matched`,
      );
    } catch (err) {
      // A revoked or expired connection is normal and not worth failing over.
      console.log(
        `  ${conn.name || conn.facebookId}: skipped (${err.message?.slice(0, 80)})`,
      );
    }
  }

  const missing = [...wanted].filter((id) => !found.has(id));

  console.log(
    `\n${calls} Meta call(s) made; resolved ${found.size} name(s), ${missing.length} still unknown`,
  );

  if (!DRY_RUN && found.size > 0) {
    await MetaAdAccountName.bulkWrite(
      [...found.entries()].map(([adAccountId, v]) => ({
        updateOne: {
          filter: { adAccountId },
          update: { $set: { name: v.name, lastSeenUserId: v.userId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    console.log(`wrote ${found.size} name(s)`);
  }

  if (missing.length) {
    // Usually an account that was removed from the business, or one reachable
    // only through a connection that has since been revoked. It will keep
    // showing as "Unnamed account", which is accurate.
    console.log(`unresolved: ${missing.map((id) => `act_${id}`).join(", ")}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
