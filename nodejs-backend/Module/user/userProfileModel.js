const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    // === Identity ===
    user_id: { type: String, required: true, unique: true },
    login: { type: String, required: true },
    name: { type: String, default: "" },
    name_f: { type: String, default: "" },
    name_l: { type: String, default: "" },
    email: { type: String, default: "" },
    created_from: { type: String, default: "GPT" },

    // === aMember Subscription ===
    amember_user_id: { type: String, default: "" },
    subscriptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    subscription_plan_id: { type: String, default: "" },
    subscription_plan_name: { type: String, default: "" },
    subscription_expiry: { type: Date, default: null },
    // Remembers the last active base plan so that if the plan disappears
    // from aMember (admin deletion / lapse) and the user later resubscribes
    // to the same plan, leftover credits can be rolled over.
    previous_plan_id: { type: String, default: "" },

    // === Credit Tracking (replaces Redis) ===
    base_subscription_credits: { type: Number, default: 0 },
    used_subscription_credits: { type: Number, default: 0 },
    rolledover_credits: { type: Number, default: 0 },
    used_rolledover_credits: { type: Number, default: 0 },
    topup_credits_purchased: { type: Number, default: 0 },
    topup_credits_used: { type: Number, default: 0 },

    // === Billing Cycle ===
    billing_cycle_start: { type: Date, default: null },
    last_credit_reset_date: { type: Date, default: null },

    // === Plan Snapshot (pulled from aMember on login) ===
    // Snapshot of the active base plan's meta so that downstream credit math
    // (renewal, refill, rollover) doesn't need to hit aMember again.
    plan_snapshot: {
      credits: { type: Number, default: 0 },
      durationDays: { type: Number, default: 30 },
      planName: { type: String, default: "" },
      // "amember" | "config" | "fallback"
      source: { type: String, default: "" },
      fetched_at: { type: Date, default: null },
    },

    // === Metadata ===
    plan_metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    // === Soft delete ===
    // Set when a user self-deletes. The aMember account is hard-deleted, but we
    // keep this document (and all related data) for audit/history. Because the
    // aMember delete revokes access, login is blocked without needing a guard.
    is_deleted: { type: Boolean, default: false },
    deleted_at: { type: Date, default: null },
    delete_reason: { type: String, default: "" },

    // === Mobile & Social Auth Fields ===
    firebase_uid: { type: String, default: "" },
    loginProviders: [{ type: String }], // e.g. ["general", "google", "apple"]
    last_login_at: { type: Date, default: null },
    platform: { type: String, default: "" },
  },
  { timestamps: true },
);

// Virtual: remaining subscription credits
userProfileSchema.virtual("remaining_subscription_credits").get(function () {
  return Math.max(
    0,
    this.base_subscription_credits - this.used_subscription_credits,
  );
});

// Virtual: remaining rollover credits
userProfileSchema.virtual("remaining_rolledover_credits").get(function () {
  return Math.max(0, this.rolledover_credits - this.used_rolledover_credits);
});

// Virtual: remaining top-up credits
userProfileSchema.virtual("remaining_topup_credits").get(function () {
  return Math.max(0, this.topup_credits_purchased - this.topup_credits_used);
});

// Virtual: total available credits across all pools
userProfileSchema.virtual("total_available_credits").get(function () {
  return (
    this.remaining_subscription_credits +
    this.remaining_rolledover_credits +
    this.remaining_topup_credits
  );
});

// Ensure virtuals are included in JSON/Object output
userProfileSchema.set("toJSON", { virtuals: true });
userProfileSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("UserProfile", userProfileSchema);
