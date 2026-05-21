const creditConfig = require("../config/creditConfig");
const UserProfile = require("../Module/user/userProfileModel");
const { getCreditDeduction } = require("../config/modelRegistry");

const TOPUP_PLAN_ID = "18";

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
        subscription: { total: 0, used: 0, remaining: 0 },
        rollover: { total: 0, used: 0, remaining: 0 },
        topup: { total: 0, used: 0, remaining: 0 },
      };
    }

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

    return {
      total_credits: totalAllowed,
      used_credits: totalUsed,
      remaining_credits: totalRemaining,
      subscription: {
        total: user.base_subscription_credits,
        used: user.used_subscription_credits,
        remaining: remainingSub,
      },
      rollover: {
        total: user.rolledover_credits,
        used: user.used_rolledover_credits,
        remaining: remainingRollover,
      },
      topup: {
        total: user.topup_credits_purchased,
        used: user.topup_credits_used,
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

  /**
   * Deduct credits after a successful operation.
   * Priority: rollover → subscription → top-up
   * (drain carried-over credits first so they don't pile up, then current
   * month's base allocation, and finally the lifetime top-up stash)
   */
  static async deductCredits(userId, amount, details = {}) {
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
      const isYearlyPlan = durationDays >= 365;
      const totalCarryForward = isYearlyPlan
        ? 0
        : Math.max(
            0,
            user.base_subscription_credits - user.used_subscription_credits
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
            : `carried forward ${totalCarryForward} credits, new allocation: ${newBaseCredits}`)
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
