const mongoose = require("mongoose");

/**
 * managedCampaign — the campaigns a user has claimed a plan slot for.
 *
 * On a capped plan (see config/planLimitsRegistry.js `meta:campaigns`), a
 * user may connect any Meta ad account but only OPERATE on a limited number
 * of campaigns. This collection is that selection: one row per managed
 * campaign, so the count is a cheap `countDocuments` and select/release are
 * single-document writes with no read-modify-write race.
 *
 * Scope is per USER, not per ad account — the limit is a single total across
 * every ad account and every connected Facebook Business, matching how the
 * plan limit is defined.
 *
 * Uncapped plans never read this collection; rows are still written on
 * campaign create (harmlessly) so that downgrading a plan doesn't leave a
 * user with zero managed campaigns and no way to tell which were "theirs".
 */
const managedCampaignSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, required: true },

    // Kept for orphan pruning (scoped per ad account — see
    // services/managedCampaigns.js pruneMissingForAccount) and so the UI can
    // show which account a managed campaign belongs to without a Meta call.
    adAccountId: { type: String, required: true, index: true },
    facebookId: { type: String },

    // "create" = auto-claimed because the user made this campaign in AdsGPT.
    // "select" = explicitly picked from the campaigns table.
    source: {
      type: String,
      enum: ["create", "select"],
      default: "select",
    },
  },
  { timestamps: true },
);

// The uniqueness guarantee the slot count depends on — without it a double
// -click on "Manage" could consume two slots for one campaign.
managedCampaignSchema.index({ userId: 1, campaignId: 1 }, { unique: true });

module.exports = mongoose.model("ManagedCampaign", managedCampaignSchema);
