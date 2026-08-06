const mongoose = require("mongoose");

// Per-subscription-plan limits. One document per aMember product id.
//
// Values are keyed by the limit keys declared in config/planLimitsRegistry.js
// rather than named columns, so adding a limit (a TikTok cap, workspace
// seats, a generation quota) is a registry entry with NO schema change here.
// A key absent from the map means unlimited — the default until an admin
// sets a number on the Plans page.
const planLimitSchema = new mongoose.Schema(
  {
    planId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Denormalized for readability in the DB / admin tooling — the admin UI
    // always resolves the live label from aMember, this is not read back.
    planName: {
      type: String,
    },
    // { "meta:campaigns": 10, "meta:ad_accounts": 3, ... }. Registry keys are
    // validated dot-free (see KEY_PATTERN there) precisely so they're safe as
    // Mongo field names and in dotted `$set` update paths.
    limits: {
      type: Map,
      of: Number,
      default: undefined,
    },

    // ─── DEPRECATED — read-only legacy columns ──────────────────────────────
    // The original shipped shape, before limits became a keyed map. Still
    // READ (via resolvePlanLimitValues' fallback) so caps configured before
    // that change keep applying; never written any more, and lazily $unset
    // once the same limit is saved under its registry key. Delete these once
    // no PlanLimit document carries them.
    maxAdAccounts: {
      type: Number,
      min: 0,
    },
    maxCampaigns: {
      type: Number,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("PlanLimit", planLimitSchema);
