/**
 * repairBillingCycleDrift.js — repair a user whose paid renewal never granted credits.
 *
 * Run with:
 *   node scripts/repairBillingCycleDrift.js --user GPT-2322            # dry run
 *   node scripts/repairBillingCycleDrift.js --user GPT-2322 --apply    # write
 *
 * ─── The bug this repairs ────────────────────────────────────────────────────
 * refreshBillingCycle used to decide "has the cycle rolled over?" purely from
 * its own stored billing_cycle_start, and stamped `now` (the login time) on
 * every refill. Two consequences:
 *
 *   1. The local cycle drifted permanently later than the real billing cycle.
 *   2. A renewal already paid for in aMember was invisible until that drifted
 *      clock caught up — so a paid-up user sat at ~0 credits for days, and any
 *      generations in the gap were charged to the OLD cycle's remainder
 *      instead of the new allocation.
 *
 * The code fix (anchoring to aMember's expire_date - durationDays) stops it
 * recurring and lets affected users self-heal on their next login. This script
 * repairs someone stranded in the gap right now, and — unlike waiting for the
 * self-heal — restores the correct pool attribution for spend that happened
 * after the renewal boundary.
 *
 * ─── How it decides what to write ────────────────────────────────────────────
 * Nothing is hardcoded. It replays the user's generatedMedia deductions through
 * the real drain order (rollover → subscription → topup) twice:
 *
 *   · once WITHOUT the renewal, and asserts the result reproduces the live
 *     document exactly. If it doesn't, the reconstruction is not trustworthy
 *     and the script ABORTS without writing.
 *   · once WITH the renewal firing at the aMember anchor, which yields the
 *     state the user should be in.
 *
 * ─── Safety ──────────────────────────────────────────────────────────────────
 *   · Dry run by default; --apply is required to write.
 *   · Writes a full backup of the document before touching it.
 *   · The update is guarded on the exact pre-state, so it is a no-op if the
 *     user logged in against fixed code meanwhile, and safe to re-run.
 *   · Refuses to run if the user has in-flight credit reservations, since
 *     zeroing used_* under a live freeze would double-refund on release.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const UserProfile = require("../Module/user/userProfileModel");
const CreditReservation = require("../Module/credit/creditReservationModel");
const GeneratedMedia = require("../Module/generatedMedia/generated.media");

const DAY_MS = 24 * 60 * 60 * 1000;
// A genuine renewal moves the anchor by a full billing period, so a day of
// slack can't hide one. Matches CYCLE_ANCHOR_TOLERANCE_MS in the controller.
const ANCHOR_TOLERANCE_MS = DAY_MS;

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { apply: false, user: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--user") args.user = argv[++i];
    else if (argv[i].startsWith("--user=")) args.user = argv[i].slice(7);
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.user) {
  console.error(
    "Usage: node scripts/repairBillingCycleDrift.js --user <GPT-id> [--apply]",
  );
  process.exit(1);
}

// MONGO_URI wins over the .env value on purpose: .env points at dev, and this
// script exists to repair prod. An explicit inline URI must never be silently
// overridden by whatever the checked-out .env happens to hold.
const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_CONNECTION_STRING;
if (!MONGO_URI) {
  console.error(
    "No Mongo connection string. Pass one inline:\n" +
      "  MONGO_URI='mongodb://...' node scripts/repairBillingCycleDrift.js --user <id>\n" +
      "(falls back to MONGO_CONNECTION_STRING from .env, which is usually DEV)",
  );
  process.exit(1);
}

// Always show which database is about to be touched — the difference between
// dev and prod here is the difference between a rehearsal and a live edit.
const describeTarget = (uri) => {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname}`;
  } catch {
    return "(unparseable URI)";
  }
};

// ─── Credit pool mechanics (mirrors UnifiedCreditController) ─────────────────

/** Spend `amount` across the pools in drain order. Returns any unfunded remainder. */
function spend(pools, amount) {
  let left = amount;
  const takeRollover = Math.min(left, pools.rollover - pools.usedRollover);
  left -= takeRollover;
  pools.usedRollover += takeRollover;

  const takeSub = Math.min(left, pools.base - pools.usedBase);
  left -= takeSub;
  pools.usedBase += takeSub;

  const takeTopup = Math.min(left, pools.topup - pools.usedTopup);
  left -= takeTopup;
  pools.usedTopup += takeTopup;

  return left;
}

const available = (p) =>
  Math.max(0, p.base - p.usedBase) +
  Math.max(0, p.rollover - p.usedRollover) +
  Math.max(0, p.topup - p.usedTopup);

const fmt = (p) =>
  `base ${p.usedBase}/${p.base}, rollover ${p.usedRollover}/${p.rollover}` +
  (p.topup ? `, topup ${p.usedTopup}/${p.topup}` : "") +
  `  → available ${available(p)}`;

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nTarget DB   : ${describeTarget(MONGO_URI)}`);
  console.log(`Mode        : ${args.apply ? "APPLY (will write)" : "dry run"}`);
  await mongoose.connect(MONGO_URI);

  const user = await UserProfile.findOne({ user_id: args.user }).lean();
  if (!user) throw new Error(`No profile found for ${args.user}`);

  console.log(`User        : ${user.user_id} (${user.login} / ${user.email})`);
  console.log(
    `Plan        : ${user.subscription_plan_id} ${user.subscription_plan_name}`,
  );

  const durationDays = user.plan_snapshot?.durationDays;
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw new Error("plan_snapshot.durationDays missing — cannot derive anchor");
  }
  if (!user.subscription_expiry) {
    throw new Error("subscription_expiry missing — cannot derive anchor");
  }
  if (!user.billing_cycle_start) {
    throw new Error("billing_cycle_start missing — nothing to repair");
  }

  // aMember is authoritative for when a cycle begins.
  const anchor = new Date(
    new Date(user.subscription_expiry).getTime() - durationDays * DAY_MS,
  );
  const storedStart = new Date(user.billing_cycle_start);

  console.log(`Expiry      : ${user.subscription_expiry.toISOString()}`);
  console.log(
    `Cycle start : stored ${storedStart.toISOString()} | aMember anchor ${anchor.toISOString()}`,
  );
  console.log(
    `Drift       : ${((anchor - storedStart) / DAY_MS).toFixed(2)} days\n`,
  );

  if (anchor.getTime() - storedStart.getTime() <= ANCHOR_TOLERANCE_MS) {
    console.log(
      "No drift — aMember has not started a cycle beyond the stored one. Nothing to do.",
    );
    return;
  }

  // A live freeze means used_* includes credits that will be decremented again
  // on release. Rewriting used_* underneath that double-refunds.
  const heldReservations = await CreditReservation.countDocuments({
    user_id: user.user_id,
  });
  if (heldReservations > 0) {
    throw new Error(
      `${heldReservations} in-flight credit reservation(s) — refusing to rewrite ` +
        `used_* while credits are frozen. Retry once they settle or are released.`,
    );
  }

  // ─── Replay ────────────────────────────────────────────────────────────────
  // base/rollover/topup totals are set at cycle start and untouched since; only
  // the used_* counters have moved. So they are the correct starting pools.
  const startPools = () => ({
    base: user.base_subscription_credits || 0,
    usedBase: 0,
    rollover: user.rolledover_credits || 0,
    usedRollover: 0,
    topup: user.topup_credits_purchased || 0,
    usedTopup: 0,
  });

  const deductions = await GeneratedMedia.find({
    userId: user.user_id,
    createdAt: { $gte: storedStart },
  })
    .sort({ createdAt: 1 })
    .lean();

  const before = deductions.filter((d) => new Date(d.createdAt) < anchor);
  const after = deductions.filter((d) => new Date(d.createdAt) >= anchor);
  const total = (rows) =>
    rows.reduce((s, d) => s + (d.credit_deduction || 0), 0);

  console.log(
    `Deductions since stored cycle start: ${deductions.length} rows, ${total(deductions)} credits`,
  );
  console.log(
    `  before anchor : ${before.length} rows, ${total(before)} credits`,
  );
  console.log(
    `  on/after      : ${after.length} rows, ${total(after)} credits\n`,
  );

  // 1. Replay WITHOUT the renewal — must reproduce the live document.
  const actual = startPools();
  for (const d of deductions) spend(actual, d.credit_deduction || 0);

  const live = {
    ...startPools(),
    usedBase: user.used_subscription_credits || 0,
    usedRollover: user.used_rolledover_credits || 0,
    usedTopup: user.topup_credits_used || 0,
  };

  console.log(`replay (no renewal) : ${fmt(actual)}`);
  console.log(`live document       : ${fmt(live)}`);

  const reproduces =
    actual.usedBase === live.usedBase &&
    actual.usedRollover === live.usedRollover &&
    actual.usedTopup === live.usedTopup;

  if (!reproduces) {
    throw new Error(
      "ABORT — replaying the generation history does NOT reproduce the live " +
        "document. Something else moved these counters (manual edit, a source " +
        "of spend outside generatedMedia, a lost reservation). The corrected " +
        "state cannot be trusted; investigate by hand.",
    );
  }
  console.log("  ✓ reconstruction validated against live state\n");

  // 2. Replay WITH the renewal firing at the anchor.
  const corrected = startPools();
  for (const d of before) spend(corrected, d.credit_deduction || 0);

  // Same carry-forward rules as refreshBillingCycle: leftover BASE only, and
  // nothing at all for yearly plans or the 7-day trial.
  const isYearly = durationDays >= 365;
  const isShortTrial = durationDays === 7;
  const leftoverBase = Math.max(0, corrected.base - corrected.usedBase);
  const carryForward = isYearly || isShortTrial ? 0 : leftoverBase;
  const newBase = Number.isFinite(user.plan_snapshot?.credits)
    ? user.plan_snapshot.credits
    : user.base_subscription_credits;

  console.log(
    `at renewal: leftover base ${leftoverBase} → carry forward ${carryForward}` +
      (isYearly ? " (yearly plan — no rollover)" : "") +
      (isShortTrial ? " (trial plan — no rollover)" : "") +
      `; stale rollover ${Math.max(0, corrected.rollover - corrected.usedRollover)} forfeited`,
  );

  const post = {
    base: newBase,
    usedBase: 0,
    rollover: carryForward,
    usedRollover: 0,
    // Renewal does not reset the top-up pool.
    topup: corrected.topup,
    usedTopup: corrected.usedTopup,
  };
  let unfunded = 0;
  for (const d of after) unfunded += spend(post, d.credit_deduction || 0);
  if (unfunded > 0) {
    console.warn(
      `  ! ${unfunded} credits of post-renewal spend exceed the new allocation`,
    );
  }

  console.log(`\ncorrected state     : ${fmt(post)}`);
  console.log(`current state       : ${fmt(live)}`);
  console.log(
    `\nCREDITS OWED        : ${available(post) - available(live)}\n`,
  );

  const update = {
    base_subscription_credits: post.base,
    used_subscription_credits: post.usedBase,
    rolledover_credits: post.rollover,
    used_rolledover_credits: post.usedRollover,
    billing_cycle_start: anchor,
    last_credit_reset_date: anchor,
  };

  if (!args.apply) {
    console.log("DRY RUN — nothing written. Would $set:");
    console.log(JSON.stringify(update, null, 2));
    console.log("\nRe-run with --apply to write.");
    return;
  }

  // ─── Apply ─────────────────────────────────────────────────────────────────
  const backupPath = path.join(
    process.cwd(),
    `backup-${user.user_id}-${Date.now()}.json`,
  );
  fs.writeFileSync(backupPath, JSON.stringify(user, null, 2));
  console.log(`backup written → ${backupPath}`);

  // Guarded on the exact pre-state: a no-op if anything moved meanwhile.
  const result = await UserProfile.findOneAndUpdate(
    {
      user_id: user.user_id,
      billing_cycle_start: storedStart,
      used_subscription_credits: live.usedBase,
      used_rolledover_credits: live.usedRollover,
    },
    { $set: update },
    { new: true },
  ).lean();

  if (!result) {
    console.log(
      "NO-OP — the document is no longer in the state that was analysed " +
        "(the user logged in against fixed code, or another process wrote). " +
        "Nothing was changed. Re-run the dry run to re-assess.",
    );
    return;
  }

  console.log(
    `\nAPPLIED. ${result.user_id} now: ` +
      `base ${result.used_subscription_credits}/${result.base_subscription_credits}, ` +
      `rollover ${result.used_rolledover_credits}/${result.rolledover_credits}, ` +
      `cycle start ${result.billing_cycle_start.toISOString()}`,
  );
})()
  .catch((err) => {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
