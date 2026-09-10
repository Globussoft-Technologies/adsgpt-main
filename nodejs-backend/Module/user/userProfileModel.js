const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    // === Identity ===
    user_id: { type: String, required: true, unique: true },
    login: { type: String, required: true },
    name: { type: String, default: "" },
    name_f: { type: String, default: "" },
    name_l: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
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

    // === Onboarding (entry / exit / free render) ===
    //
    // ── The enrolment gate ──────────────────────────────────────────────
    //
    // Presence of this field is what says "this account is allowed to be
    // offered onboarding at all". It exists to separate accounts created
    // AFTER the feature shipped from the ones that predate it, without a
    // backfill.
    //
    // `default: Date.now` means every profile created from here on gets it
    // automatically — profiles are only ever made with `UserProfile.create()`
    // (authController, mobileController), and Mongoose applies defaults there.
    // Documents written before this field existed simply do not have it, and
    // that ABSENCE is the signal: no offer bar, no first-run redirect, no free
    // render. They were never promised any of it.
    //
    // Read with `$exists` / a falsy check on a `.lean()` result, never through
    // a hydrated document — Mongoose fills defaults in on hydration, which
    // would make every old profile look enrolled.
    //
    // NOTE: if a profile ever starts being created by an upsert instead, that
    // upsert MUST pass `setDefaultsOnInsert: true`, or the new user silently
    // never sees onboarding.
    onboarding_offer_enrolled_at: { type: Date, default: Date.now },

    //
    // These live here rather than on OnboardingSession because they are facts
    // about the USER, not about any one run: "has this person already had their
    // free render", "have they finished onboarding at all". A user can hold
    // several sessions, and asking "is the free render spent" must not mean
    // scanning them.
    //
    // `onboarding_free_render_used_at` is the claim flag AND the lock: the
    // claim is a findOneAndUpdate matching it against null, so exactly one
    // caller can ever win it, however many tabs press Generate at once. It is
    // set back to null when the render it paid for never happened (upstream
    // rejected the job, or the job failed) — a user whose free render died to
    // someone else's 500 has received nothing.
    onboarding_free_render_used_at: { type: Date, default: null },
    // Which session spent it. Diagnostics, and it lets the un-claim verify it
    // is releasing the claim it thinks it is.
    onboarding_free_render_session_id: { type: String, default: "" },
    // Reached the end of onboarding at least once. Retires the banner for good.
    onboarding_completed_at: { type: Date, default: null },
    // Left early. Deliberately NOT the same as completed: a skipper who never
    // spent the free render still sees the banner, and it takes them back into
    // the session they left rather than a new one.
    onboarding_skipped_at: { type: Date, default: null },

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
