const mongoose = require("mongoose");

/**
 * autopilotRun — one row per orchestrator tick, written AS THE TICK PROCEEDS.
 *
 * WHY THIS EXISTS. `autopilotActionLog` records per-entity ACTIONS, which
 * makes it blind to two things that matter operationally:
 *
 *   - A cycle that walks a hundred accounts and matches nothing writes ZERO
 *     rows. From the log, a healthy quiet run and a run that never started are
 *     indistinguishable.
 *   - Account-level failures never reach it at all. They live on the in-memory
 *     `acctSummary.error` and die with the Telegram digest. That is not
 *     hypothetical: on 2026-09-02, run adcc9da5 dropped act_1424735519564081
 *     for a whole hour with "The request was made but no response was
 *     received", and an audit of the action log showed the run as clean.
 *
 * So this is the run's own record: what it set out to do, how far it got, and
 * what happened to each account — including the accounts where nothing
 * happened, which is precisely the information the action log cannot carry.
 *
 * INCREMENTAL BY DESIGN. `status` starts `running` and `accountsDone` climbs
 * as the cycle works, so the admin view can watch a tick in flight rather than
 * learning about it once it is over. A run left in `running` with a stale
 * `heartbeatAt` is itself the signal that a cycle died mid-flight — the case
 * that used to be invisible until someone noticed the next hour was missing
 * too.
 *
 * `durationMs` was already computed and logged at the end of every cycle; it
 * simply had nowhere to live and died with the pm2 log rotation. Persisting it
 * is what turns the capacity numbers in docs/AUTOPILOT_SCALING_PLAN.md §3 from
 * an estimate into a measurement, which is what C3 needs to be sized against.
 */

/**
 * One account's outcome within a run. Deliberately flat and small: a cycle
 * can touch hundreds of accounts and this array is read on every poll of the
 * live view.
 */
const runAccountSchema = new mongoose.Schema(
  {
    adAccountId: { type: String, required: true },
    adAccountName: { type: String },
    ownerUserId: { type: String, required: true },
    ok: { type: Boolean, default: true },
    // Wall clock for THIS account, so a slow account is identifiable without
    // subtracting timestamps across the array.
    durationMs: { type: Number },
    // How many (account, lookback-window) audits this account cost. The unit
    // of Meta spend, and the number §3's capacity table is really about.
    auditCount: { type: Number, default: 0 },
    // Actions that actually landed.
    paused: { type: Number, default: 0 },
    resumed: { type: Number, default: 0 },
    scaled: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    // What a DRY RUN would have done. Kept separate rather than folded into
    // the counters above, because the whole point of a dry run is to answer
    // "what would happen if I turned this on" -- and a rehearsal that reports
    // the same zeroes as an idle cycle answers nothing. `finalDryRun` is
    // resolved per account (a user can force dry-run globally while the cycle
    // runs live), so one run can legitimately contain both.
    wouldPause: { type: Number, default: 0 },
    wouldResume: { type: Number, default: 0 },
    wouldScale: { type: Number, default: 0 },
    // Populated for !ok. Distinguishes the three ways an account can end
    // badly: it threw, it timed out (C2), or it was skipped before starting
    // because the rate limiter said the account was already blocked.
    error: { type: String },
    outcome: {
      type: String,
      enum: ["ok", "failed", "timeout", "rate-limited"],
      default: "ok",
    },
  },
  { _id: false },
);

const autopilotRunSchema = new mongoose.Schema(
  {
    // No field-level `index: true` on either of these. `unique` already builds
    // an index for runId, and startedAt gets two explicit ones at the bottom —
    // adding it here as well makes Mongoose warn about a duplicate index on
    // {startedAt: 1} at every boot, and leaves a redundant index in the
    // collection for Mongo to maintain on every write.
    runId: { type: String, required: true, unique: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    durationMs: { type: Number },

    status: {
      type: String,
      enum: ["running", "complete", "failed", "skipped"],
      required: true,
      index: true,
    },
    // `skipped` runs carry why — today only "lock-held", which is the signal
    // that two schedulers are racing (see the local-dev note in the scaling
    // plan's operational pre-requisites).
    skipReason: { type: String },

    dryRun: { type: Boolean, default: true },
    // Which process claimed this tick. With C1 splitting Autopilot into its
    // own worker there will be more than one candidate, and "who ran this"
    // stops being obvious.
    host: { type: String },
    pid: { type: Number },

    // Planned vs achieved. `totalAccounts` is known once rules are grouped,
    // before any Meta call, so progress is a real fraction rather than a
    // count that only makes sense in hindsight.
    totalAccounts: { type: Number, default: 0 },
    totalUsers: { type: Number, default: 0 },
    totalRules: { type: Number, default: 0 },
    accountsDone: { type: Number, default: 0 },

    // Rollups, filled in at the end. Derivable from `accounts`, stored anyway
    // so the history table can render without unwinding every row.
    accountsOk: { type: Number, default: 0 },
    accountsFailed: { type: Number, default: 0 },
    accountsTimedOut: { type: Number, default: 0 },
    accountsRateLimited: { type: Number, default: 0 },
    totalPaused: { type: Number, default: 0 },
    totalResumed: { type: Number, default: 0 },
    totalScaled: { type: Number, default: 0 },
    totalWouldPause: { type: Number, default: 0 },
    totalWouldResume: { type: Number, default: 0 },
    totalWouldScale: { type: Number, default: 0 },

    accounts: { type: [runAccountSchema], default: [] },

    // Users skipped BEFORE any of their accounts was reached — disabled in
    // settings, no Facebook connection, or no unexpired decryptable token.
    //
    // These were invisible until 2026-09-10, and invisible in the worst way:
    // `totalAccounts` counted the skipped user's accounts, `accountsDone` did
    // not, and no account row was written — so a run that touched 1 of 12
    // accounts reported itself `complete` with zero problems. That is exactly
    // the blindness this collection exists to remove, reproduced one level up.
    usersSkipped: {
      type: [
        {
          _id: false,
          userId: { type: String, required: true },
          reason: { type: String, required: true },
          // How many accounts went untouched with them — the number that
          // reconciles accountsDone against totalAccounts.
          accounts: { type: Number, default: 0 },
        },
      ],
      default: [],
    },

    // Bumped on every account completion. The live view uses staleness here,
    // not `status`, to tell "still working" from "died holding the lock" — a
    // crashed process never gets to write `status: failed`.
    heartbeatAt: { type: Date },

    // Only set when the cycle itself threw, as opposed to an account failing
    // inside it. A run can be `complete` with every account failed.
    error: { type: String },
  },
  { timestamps: true },
);

// Newest-first is the only ordering the history view asks for.
autopilotRunSchema.index({ startedAt: -1 });
// "Is a run in flight?" — answered without scanning history.
autopilotRunSchema.index({ status: 1, startedAt: -1 });

// 30 days, matching metaApiUsage. These rows are for operating the system, not
// for accounting: past a month the action log is the record that matters, and
// an unbounded collection of per-account arrays is a slow leak.
autopilotRunSchema.index(
  { startedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

module.exports = mongoose.model("AutopilotRun", autopilotRunSchema);
