const creditConfig = require("../config/creditConfig");
const UserProfile = require("../Module/user/userProfileModel");
const CreditReservation = require("../Module/credit/creditReservationModel");
const { getCreditDeduction, getCreditDeductionByQuality } = require("../config/modelRegistry");

const TOPUP_PLAN_ID = "18";

const FREEZE_MAX_RETRIES = 3;

// ADSGPT-TEXT (ad copy) isn't a generation model — keep its env mapping local
// rather than polluting the registry, which is image/video only.
const SPECIAL_CASES = {
  "ADSGPT-TEXT": { envVar: "ADSGPT_AD_COPY_CREDIT_DEDUCTION", default: 0 },
};

class UnifiedCreditController {
  /**
   * Get the current environment (development/production)
   */
  static getEnvironment() {
    return process.env.MODE === "PROD" ? "production" : "development";
  }

  /**
   * Get total allowed credits for a subscription plan from config
   * (used during initialization / billing refresh only)
   */
  static getAllowedCreditsByPlan(subscriptionTypeKey) {
    const env = this.getEnvironment();
    const config = creditConfig[env];
    return config[subscriptionTypeKey]?.credits || 0;
  }

  /**
   * Get the credit deduction amount for a specific model.
   * Resolves canonical keys AND aliases via the model registry; unknown
   * models return 0 (matches previous default).
   */
  static getModelDeduction(model) {
    if (model && SPECIAL_CASES[model]) {
      const { envVar, default: fallback } = SPECIAL_CASES[model];
      const v = parseFloat(process.env[envVar]);
      return Number.isFinite(v) ? v : fallback;
    }
    return getCreditDeduction(model);
  }

  /**
   * Quality-aware variant of getModelDeduction. NEW + additive — the original
   * above is left untouched. Image models resolve their (model, quality) tier
   * credits via the registry; SPECIAL_CASES and tier-less models behave exactly
   * as getModelDeduction (quality ignored). Unknown/missing quality → "high".
   */
  static getModelDeductionByQuality(model, quality) {
    if (model && SPECIAL_CASES[model]) {
      const { envVar, default: fallback } = SPECIAL_CASES[model];
      const v = parseFloat(process.env[envVar]);
      return Number.isFinite(v) ? v : fallback;
    }
    return getCreditDeductionByQuality(model, quality);
  }

  /**
   * Returns true if the user has an active base subscription plan.
   * A user with only top-up credits (no base plan) returns false — top-up
   * credits are only spendable when a base plan is active.
   */
  static async hasActiveBasePlan(userId) {
    if (!userId) return false;
    const user = await UserProfile.findOne(
      { user_id: userId },
      { subscription_plan_id: 1 }
    );
    return !!user?.subscription_plan_id;
  }

  /**
   * Get the full credit status for a user from MongoDB
   * Returns a detailed breakdown of all credit pools
   */
  static async getCreditStatus(userId) {
    const user = await UserProfile.findOne({ user_id: userId });
    if (!user) {
      return {
        total_credits: 0,
        used_credits: 0,
        remaining_credits: 0,
        frozen_credits: 0,
        settled_credits: 0,
        subscription: { total: 0, used: 0, frozen: 0, settled: 0, remaining: 0 },
        rollover: { total: 0, used: 0, frozen: 0, settled: 0, remaining: 0 },
        topup: { total: 0, used: 0, frozen: 0, settled: 0, remaining: 0 },
      };
    }

    // Sum every active reservation's split for this user so we can report
    // how much of `used_*` is currently FROZEN (in-flight generation) vs.
    // SETTLED (truly spent). `used_*` itself already includes the freeze.
    const reservations = await CreditReservation.find(
      { user_id: userId },
      { split: 1, amount: 1 },
    ).lean();

    let frozenRollover = 0;
    let frozenSub = 0;
    let frozenTopup = 0;
    for (const r of reservations) {
      frozenRollover += r.split?.fromRollover || 0;
      frozenSub += r.split?.fromSub || 0;
      frozenTopup += r.split?.fromTopup || 0;
    }
    const frozenTotal = frozenRollover + frozenSub + frozenTopup;

    const remainingSub = Math.max(
      0,
      user.base_subscription_credits - user.used_subscription_credits
    );
    const remainingRollover = Math.max(
      0,
      user.rolledover_credits - user.used_rolledover_credits
    );
    const remainingTopup = Math.max(
      0,
      user.topup_credits_purchased - user.topup_credits_used
    );

    const totalAllowed =
      user.base_subscription_credits +
      user.rolledover_credits +
      user.topup_credits_purchased;
    const totalUsed =
      user.used_subscription_credits +
      user.used_rolledover_credits +
      user.topup_credits_used;
    const totalRemaining = remainingSub + remainingRollover + remainingTopup;

    // settled = used - frozen. That's what's irrecoverably spent right now;
    // the frozen part can still be refunded if generation fails.
    const settledSub = Math.max(0, user.used_subscription_credits - frozenSub);
    const settledRollover = Math.max(
      0,
      user.used_rolledover_credits - frozenRollover,
    );
    const settledTopup = Math.max(0, user.topup_credits_used - frozenTopup);
    const settledTotal = settledSub + settledRollover + settledTopup;

    return {
      total_credits: totalAllowed,
      used_credits: totalUsed,
      remaining_credits: totalRemaining,
      frozen_credits: frozenTotal,
      settled_credits: settledTotal,
      subscription: {
        total: user.base_subscription_credits,
        used: user.used_subscription_credits,
        frozen: frozenSub,
        settled: settledSub,
        remaining: remainingSub,
      },
      rollover: {
        total: user.rolledover_credits,
        used: user.used_rolledover_credits,
        frozen: frozenRollover,
        settled: settledRollover,
        remaining: remainingRollover,
      },
      topup: {
        total: user.topup_credits_purchased,
        used: user.topup_credits_used,
        frozen: frozenTopup,
        settled: settledTopup,
        remaining: remainingTopup,
      },
    };
  }

  /**
   * Check if user has enough credits before processing a request
   */
  static async checkCredits(userId, requiredCredits) {
    try {
      const user = await UserProfile.findOne({ user_id: userId });

      if (!user) {
        return {
          isAllowed: false,
          currentUsage: 0,
          totalAllowed: 0,
          remainingCredits: 0,
          required: requiredCredits,
          message: "User profile not found.",
        };
      }

      // Top-up credits cannot be used without an active base subscription.
      // User can still login, but generation is blocked until they subscribe.
      if (!user?.subscription_plan_id) {
        return {
          isAllowed: false,
          currentUsage: 0,
          totalAllowed: 0,
          remainingCredits: 0,
          required: requiredCredits,
          message:
            "An active subscription plan is required to generate content.",
        };
      }

      const status = await this.getCreditStatus(userId);

      if (status.remaining_credits < requiredCredits) {
        return {
          isAllowed: false,
          currentUsage: status.used_credits,
          totalAllowed: status.total_credits,
          remainingCredits: status.remaining_credits,
          required: requiredCredits,
          message: "Insufficient credits",
        };
      }

      return {
        isAllowed: true,
        currentUsage: status.used_credits,
        totalAllowed: status.total_credits,
        remainingCredits: status.remaining_credits,
      };
    } catch (error) {
      console.error("Error checking unified credits:", error);
      return { isAllowed: false, message: "Error checking credits" };
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Credit freezing (atomic reserve-then-settle)
  // ───────────────────────────────────────────────────────────────────────
  //
  //   freezeCredits  → CAS-deducts used_* and writes a CreditReservation row
  //   settleCredits  → deletes the row (the freeze IS the deduction)
  //   releaseCredits → deletes the row AND refunds used_* by the exact split
  //
  // The receipt (CreditReservation) lets the request and response handlers
  // live in different functions / processes without needing Python to echo
  // a reservation id back. Lookup is by `reservationKey`, which the caller
  // controls (sockets use chatId, video uses the video record id, etc.).

  /**
   * Compute the (rollover, subscription, top-up) split for a desired amount
   * given a user's current balance. Pure function; no DB writes.
   */
  static _computeSplit(user, amount) {
    const availR = Math.max(
      0,
      (user.rolledover_credits || 0) - (user.used_rolledover_credits || 0),
    );
    const availS = Math.max(
      0,
      (user.base_subscription_credits || 0) -
        (user.used_subscription_credits || 0),
    );
    const availT = Math.max(
      0,
      (user.topup_credits_purchased || 0) - (user.topup_credits_used || 0),
    );

    let r = amount;
    const fromRollover = Math.min(r, availR);
    r -= fromRollover;
    const fromSub = Math.min(r, availS);
    r -= fromSub;
    const fromTopup = Math.min(r, availT);
    r -= fromTopup;

    return {
      split: { fromRollover, fromSub, fromTopup },
      shortfall: r,
      totalAvailable: availR + availS + availT,
    };
  }

  /**
   * Freeze (atomically pre-deduct) credits and write a CreditReservation
   * receipt keyed by `reservationKey`.
   *
   * Returns:
   *   { ok: true, split, idempotent? }
   *   { ok: false, reason: "NO_USER" | "NO_BASE_PLAN" | "INSUFFICIENT" | "CONTENDED" | ..., remaining? }
   *
   * Idempotency: if a reservation with this key already exists, returns
   * its split with `idempotent: true` (and DOES NOT double-charge).
   */
  static async freezeCredits({ userId, reservationKey, amount, meta = {} }) {
    if (!userId) return { ok: false, reason: "NO_USER" };
    if (!reservationKey) return { ok: false, reason: "MISSING_KEY" };
    if (!amount || amount <= 0) {
      console.log(
        `[credits] freeze NOOP key=${reservationKey} user=${userId} amount=${amount} (zero or negative)`,
      );
      return {
        ok: true,
        split: { fromRollover: 0, fromSub: 0, fromTopup: 0 },
        frozen: 0,
      };
    }

    // Idempotency check — same reservationKey should never freeze twice.
    const existing = await CreditReservation.findOne({
      reservation_key: reservationKey,
    });
    if (existing) {
      console.warn(
        `[credits] freeze IDEMPOTENT key=${reservationKey} user=${userId} ` +
          `existing_amount=${existing.amount} (this freeze call is a duplicate — ` +
          `caller logic should investigate)`,
      );
      return {
        ok: true,
        split: existing.split,
        frozen: existing.amount,
        idempotent: true,
      };
    }

    // CAS loop. Mongo serializes per-document updates, so the filter pinning
    // used_* to the values we just read rejects any concurrent freeze that
    // got there first. We retry up to FREEZE_MAX_RETRIES times.
    for (let attempt = 0; attempt < FREEZE_MAX_RETRIES; attempt++) {
      const user = await UserProfile.findOne({ user_id: userId });
      if (!user) return { ok: false, reason: "NO_USER" };
      if (!user.subscription_plan_id) {
        return { ok: false, reason: "NO_BASE_PLAN" };
      }

      const { split, shortfall, totalAvailable } = this._computeSplit(
        user,
        amount,
      );
      if (shortfall > 0) {
        console.warn(
          `[credits] freeze INSUFFICIENT key=${reservationKey} user=${userId} ` +
            `required=${amount} available=${totalAvailable} short=${shortfall}`,
        );
        return {
          ok: false,
          reason: "INSUFFICIENT",
          required: amount,
          remaining: totalAvailable,
        };
      }

      const inc = {};
      if (split.fromRollover > 0)
        inc.used_rolledover_credits = split.fromRollover;
      if (split.fromSub > 0) inc.used_subscription_credits = split.fromSub;
      if (split.fromTopup > 0) inc.topup_credits_used = split.fromTopup;

      // CAS guard: filter requires used_* fields to match what we just read.
      // If anyone else modified them between findOne and findOneAndUpdate,
      // result is null and we retry.
      const cas = await UserProfile.findOneAndUpdate(
        {
          user_id: userId,
          subscription_plan_id: { $ne: "" },
          used_rolledover_credits: user.used_rolledover_credits || 0,
          used_subscription_credits: user.used_subscription_credits || 0,
          topup_credits_used: user.topup_credits_used || 0,
        },
        Object.keys(inc).length > 0 ? { $inc: inc } : {},
        { new: true },
      );

      if (!cas) {
        console.log(
          `[credits] freeze CAS-miss key=${reservationKey} user=${userId} attempt=${attempt + 1}`,
        );
        continue; // concurrent modification — retry
      }

      // Persist the receipt so settle/release can find this hold later.
      try {
        await CreditReservation.create({
          reservation_key: reservationKey,
          user_id: userId,
          amount,
          split,
          meta,
        });
        console.log(
          `[credits] freeze OK key=${reservationKey} user=${userId} amount=${amount} ` +
            `split=R${split.fromRollover}/S${split.fromSub}/T${split.fromTopup} ` +
            `meta=${JSON.stringify(meta)}`,
        );
      } catch (err) {
        // Receipt-write failed (e.g. duplicate-key race on the unique index).
        // If a row already exists, treat as idempotent success — and refund
        // the just-frozen credits to avoid double-charging the same key.
        const dup = err && err.code === 11000;
        await this._refundSplitToUser(userId, split);
        if (dup) {
          const winner = await CreditReservation.findOne({
            reservation_key: reservationKey,
          });
          if (winner) {
            return {
              ok: true,
              split: winner.split,
              frozen: winner.amount,
              idempotent: true,
            };
          }
        }
        console.error(
          "freezeCredits: receipt write failed, refunded hold:",
          err,
        );
        return { ok: false, reason: "RECEIPT_WRITE_FAILED" };
      }

      return { ok: true, split, frozen: amount };
    }

    return { ok: false, reason: "CONTENDED" };
  }

  /**
   * Settle a frozen reservation — success path. The freeze already debited
   * `used_*`, so this just deletes the receipt.
   */
  static async settleCredits(reservationKey) {
    if (!reservationKey) return { ok: false, reason: "MISSING_KEY" };
    const deleted = await CreditReservation.findOneAndDelete({
      reservation_key: reservationKey,
    });
    if (deleted) {
      console.log(
        `[credits] settle OK key=${reservationKey} user=${deleted.user_id} amount=${deleted.amount}`,
      );
    } else {
      console.warn(`[credits] settle NO_RECEIPT key=${reservationKey}`);
    }
    return { ok: !!deleted };
  }

  /**
   * Release a frozen reservation — failure path. Deletes the receipt AND
   * refunds the exact split that was held.
   *
   * Order: delete-then-refund. If the process crashes after delete and
   * before refund, credits stay held (recoverable manually). The opposite
   * order would risk double-refunds on retry.
   */
  static async releaseCredits(reservationKey) {
    if (!reservationKey) return { ok: false, reason: "MISSING_KEY" };
    const receipt = await CreditReservation.findOneAndDelete({
      reservation_key: reservationKey,
    });
    if (!receipt) {
      console.warn(`[credits] release NO_RECEIPT key=${reservationKey}`);
      return { ok: false, reason: "NO_RECEIPT" };
    }

    await this._refundSplitToUser(receipt.user_id, receipt.split);
    console.log(
      `[credits] release OK key=${reservationKey} user=${receipt.user_id} ` +
        `refunded=${receipt.amount} ` +
        `split=R${receipt.split.fromRollover}/S${receipt.split.fromSub}/T${receipt.split.fromTopup}`,
    );
    return { ok: true, refunded: receipt.amount, split: receipt.split };
  }

  /**
   * Settle part of a reservation, refund the rest. Use this when a batch
   * partially fails (e.g. 4 of 6 images came back successful — keep the
   * charge for 4, refund the other 2).
   *
   *   actualUsedAmount  the credits to keep charged. Must be ≤ receipt.amount.
   *
   * Refund is applied in reverse of the deduction priority (top-up → sub →
   * rollover) so we unwind whichever bucket was tapped most recently first.
   * Receipt is deleted at the end (success path completes the reservation).
   */
  static async releasePartial(reservationKey, actualUsedAmount) {
    if (!reservationKey) return { ok: false, reason: "MISSING_KEY" };
    const receipt = await CreditReservation.findOneAndDelete({
      reservation_key: reservationKey,
    });
    if (!receipt) {
      console.warn(
        `[credits] releasePartial NO_RECEIPT key=${reservationKey} actualUsed=${actualUsedAmount} ` +
          `(receipt was already settled/released — likely duplicate callback)`,
      );
      return { ok: false, reason: "NO_RECEIPT" };
    }

    const used = Math.max(0, Math.min(actualUsedAmount, receipt.amount));
    const refund = receipt.amount - used;
    if (refund <= 0) {
      console.log(
        `[credits] releasePartial OK key=${reservationKey} user=${receipt.user_id} ` +
          `charged=${used} refund=0 (full hold consumed)`,
      );
      return { ok: true, refunded: 0, charged: used };
    }

    // Apportion refund across the receipt's split, reverse priority.
    let left = refund;
    const fromTopup = Math.min(left, receipt.split.fromTopup);
    left -= fromTopup;
    const fromSub = Math.min(left, receipt.split.fromSub);
    left -= fromSub;
    const fromRollover = Math.min(left, receipt.split.fromRollover);

    await this._refundSplitToUser(receipt.user_id, {
      fromTopup,
      fromSub,
      fromRollover,
    });
    console.log(
      `[credits] releasePartial OK key=${reservationKey} user=${receipt.user_id} ` +
        `charged=${used} refund=${refund} ` +
        `refundSplit=T${fromTopup}/S${fromSub}/R${fromRollover}`,
    );
    return {
      ok: true,
      refunded: refund,
      charged: used,
      refundSplit: { fromTopup, fromSub, fromRollover },
    };
  }

  /**
   * Find the oldest reservation matching a meta filter and settle it
   * (releasePartial with `actualUsedAmount`).
   *
   * Used by paths where the response handler can't carry the reservation key
   * directly (e.g. AI Ads scene regen — Python responds with sessionId +
   * scene results but no reservation key). The caller scopes the lookup via
   * `metaFilter` (e.g. `{ "meta.regenSessionId": sessionId }`).
   *
   * Returns the underlying releasePartial result, or { ok: false,
   * reason: "NO_RECEIPT" } if no matching reservation exists.
   */
  static async settleByMeta(metaFilter, actualUsedAmount) {
    const receipt = await CreditReservation.findOne(metaFilter).sort({
      createdAt: 1,
    });
    if (!receipt) return { ok: false, reason: "NO_RECEIPT" };
    return this.releasePartial(receipt.reservation_key, actualUsedAmount);
  }

  /**
   * Release ALL reservations matching a meta filter (full refund of each).
   * Use for full-failure paths where the lookup key isn't carried back.
   */
  static async releaseByMeta(metaFilter) {
    const receipts = await CreditReservation.find(metaFilter)
      .select("reservation_key")
      .lean();
    let released = 0;
    for (const r of receipts) {
      const out = await this.releaseCredits(r.reservation_key);
      if (out.ok) released += 1;
    }
    return { released };
  }

  /**
   * Sweep stale (orphaned) reservations and refund them.
   *
   * Use case: a generation request reached Python but the response handler
   * never fired (Python crash, network partition, container restart, etc.).
   * Without this, those credits stay frozen until the 24h TTL deletes the
   * receipt — and TTL does NOT refund.
   *
   * Default age threshold is 60 minutes — well past the longest legit
   * generation (~10 min). Configurable per call.
   *
   * Returns { swept, refunded } counts. Safe to run concurrently; each
   * receipt is removed atomically by releaseCredits.
   */
  static async sweepStaleReservations({ maxAgeMs = 60 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const stale = await CreditReservation.find({
      createdAt: { $lt: cutoff },
    })
      .select("reservation_key user_id amount")
      .lean();

    let refunded = 0;
    for (const row of stale) {
      try {
        const result = await this.releaseCredits(row.reservation_key);
        if (result.ok) {
          refunded += 1;
          console.warn(
            `[credit-sweep] released orphan reservation ${row.reservation_key} ` +
              `(user=${row.user_id}, amount=${row.amount})`,
          );
        }
      } catch (err) {
        console.error(
          `[credit-sweep] failed to release ${row.reservation_key}:`,
          err.message,
        );
      }
    }

    return { swept: stale.length, refunded };
  }

  /** Internal: undo a held split on a user. Safe to call with all-zero split. */
  static async _refundSplitToUser(userId, split) {
    if (!split) return;
    const inc = {};
    if (split.fromRollover > 0)
      inc.used_rolledover_credits = -split.fromRollover;
    if (split.fromSub > 0) inc.used_subscription_credits = -split.fromSub;
    if (split.fromTopup > 0) inc.topup_credits_used = -split.fromTopup;
    if (Object.keys(inc).length === 0) return;
    await UserProfile.updateOne({ user_id: userId }, { $inc: inc });
  }

  /**
   * Deduct credits after a successful operation.
   * Priority: rollover → subscription → top-up
   * (drain carried-over credits first so they don't pile up, then current
   * month's base allocation, and finally the lifetime top-up stash)
   *
   * NOTE: Prefer freezeCredits + settleCredits for new code — it's race-safe.
   * deductCredits is kept for legacy paths not yet migrated.
   */
  static async deductCredits(userId, amount, details = {}) {
    // Loud log: every legacy deduct after the freeze rollout is suspect. The
    // freeze pattern means deductCredits should NOT be hit on the success path
    // of any migrated endpoint — only as the NO_RECEIPT fallback, and that
    // itself is the smoking gun for duplicate-callback double-charges.
    console.warn(
      `[credits] LEGACY deductCredits user=${userId} amount=${amount} ` +
        `details=${JSON.stringify(details)} ` +
        `— if a freeze receipt should have settled this, you have a leak`,
    );
    try {
      if (amount <= 0) return;

      const user = await UserProfile.findOne({ user_id: userId });
      if (!user) {
        console.error(`User ${userId} not found for credit deduction`);
        return;
      }

      let remaining = amount;

      // 1. Deduct from rollover credits first
      const availableRollover = Math.max(
        0,
        user.rolledover_credits - user.used_rolledover_credits
      );
      const fromRollover = Math.min(remaining, availableRollover);
      remaining -= fromRollover;

      // 2. Deduct from subscription credits
      const availableSub = Math.max(
        0,
        user.base_subscription_credits - user.used_subscription_credits
      );
      const fromSub = Math.min(remaining, availableSub);
      remaining -= fromSub;

      // 3. Deduct from top-up credits
      const availableTopup = Math.max(
        0,
        user.topup_credits_purchased - user.topup_credits_used
      );
      const fromTopup = Math.min(remaining, availableTopup);
      remaining -= fromTopup;

      // Apply the deductions atomically
      const updateFields = {};
      if (fromSub > 0) updateFields.used_subscription_credits = fromSub;
      if (fromRollover > 0) updateFields.used_rolledover_credits = fromRollover;
      if (fromTopup > 0) updateFields.topup_credits_used = fromTopup;

      if (Object.keys(updateFields).length > 0) {
        await UserProfile.findOneAndUpdate(
          { user_id: userId },
          { $inc: updateFields },
          { new: true }
        );
      }

      return await this.getCreditStatus(userId);
    } catch (error) {
      console.error("Error deducting unified credits:", error);
    }
  }

  /**
   * Refresh billing cycle on login — handles credit rollover.
   * Reads plan duration and credit allocation from the user's plan_snapshot
   * (populated by syncUserProfile from aMember on each login). Falls back to
   * creditConfig only if snapshot is missing (legacy users).
   */
  static async refreshBillingCycle(userId, subscriptionPlanId) {
    try {
      const user = await UserProfile.findOne({ user_id: userId });
      if (!user || !user.billing_cycle_start) return user;

      const now = new Date();
      const cycleStart = new Date(user.billing_cycle_start);

      const planId = subscriptionPlanId || user.subscription_plan_id;
      const snapshot = user.plan_snapshot || {};
      const env = this.getEnvironment();
      const configEntry = creditConfig[env]?.[planId];

      const durationDays =
        Number.isFinite(snapshot.durationDays) && snapshot.durationDays > 0
          ? snapshot.durationDays
          : configEntry?.durationDays || 30;

      // Check if the billing cycle has elapsed
      const elapsedMs = now.getTime() - cycleStart.getTime();
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

      if (elapsedDays < durationDays) return user; // Cycle still active

      // Rule: Rollover only applies to same-plan recurring (monthly) renewals — not yearly plans.
      // Only the current cycle's leftover BASE carries forward. Any unused
      // rollover from the prior cycle is forfeited so credits can't compound
      // across multiple cycles of light usage.
      // No rollover for yearly plans (paid up-front, no churn-protection
      // value) OR for the 7-day trial (free trials shouldn't accumulate
      // leftover credits across cycles, defeats the trial limit).
      const isYearlyPlan = durationDays >= 365;
      const isShortTrial = durationDays === 7;
      const totalCarryForward =
        isYearlyPlan || isShortTrial
          ? 0
          : Math.max(
              0,
              user.base_subscription_credits - user.used_subscription_credits,
            );

      const newBaseCredits = Number.isFinite(snapshot.credits)
        ? snapshot.credits
        : this.getAllowedCreditsByPlan(planId);

      const updatedUser = await UserProfile.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            base_subscription_credits: newBaseCredits,
            used_subscription_credits: 0,
            rolledover_credits: totalCarryForward,
            used_rolledover_credits: 0,
            billing_cycle_start: now,
            last_credit_reset_date: now,
          },
        },
        { new: true }
      );

      console.log(
        `Billing cycle refreshed for user ${userId} (plan ${planId}, ${durationDays}d): ` +
          (isYearlyPlan
            ? `yearly plan — no rollover, new allocation: ${newBaseCredits}`
            : isShortTrial
              ? `short-trial plan — no rollover, new allocation: ${newBaseCredits}`
              : `carried forward ${totalCarryForward} credits, new allocation: ${newBaseCredits}`),
      );

      return updatedUser;
    } catch (error) {
      console.error("Error refreshing billing cycle:", error);
    }
  }

  /**
   * Add top-up credits to a user's account
   */
  static async addTopUpCredits(userId, amount) {
    try {
      const updatedUser = await UserProfile.findOneAndUpdate(
        { user_id: userId },
        { $inc: { topup_credits_purchased: amount } },
        { new: true }
      );
      return updatedUser;
    } catch (error) {
      console.error("Error adding top-up credits:", error);
    }
  }

  /**
   * Initialize credit fields for a user based on their subscription plan.
   * Prefers the snapshot already on the user doc (populated by syncUserProfile
   * from aMember); falls back to creditConfig.
   */
  static async initializeCredits(userId, subscriptionPlanId) {
    try {
      const user = await UserProfile.findOne({ user_id: userId });
      const snapshot = user?.plan_snapshot || {};
      const env = this.getEnvironment();
      const configEntry = creditConfig[env]?.[subscriptionPlanId];

      const baseCredits = Number.isFinite(snapshot.credits)
        ? snapshot.credits
        : this.getAllowedCreditsByPlan(subscriptionPlanId);
      const planName =
        snapshot.planName || configEntry?.name || "Unknown Plan";

      const updatedUser = await UserProfile.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            subscription_plan_id: String(subscriptionPlanId),
            subscription_plan_name: planName,
            base_subscription_credits: baseCredits,
            used_subscription_credits: 0,
            rolledover_credits: 0,
            used_rolledover_credits: 0,
            billing_cycle_start: new Date(),
            last_credit_reset_date: new Date(),
          },
        },
        { new: true }
      );

      console.log(
        `Credits initialized for user ${userId}: ${baseCredits} monthly credits (plan: ${planName})`
      );
      return updatedUser;
    } catch (error) {
      console.error("Error initializing credits:", error);
    }
  }
}

module.exports = UnifiedCreditController;
