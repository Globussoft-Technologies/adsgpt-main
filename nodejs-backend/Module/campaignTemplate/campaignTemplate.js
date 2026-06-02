/**
 * CampaignTemplate — saved snapshot of the Meta Ads V2 wizard's `form` state.
 *
 * Lets an agency stamp out new campaigns from a known-good setup: targeting,
 * budget, copy, CTA, optimization etc. all carry over; at use time the user
 * can edit anything (campaign name, ad account, budget, creative) before
 * launching. Stored per-user.
 *
 * `payload` is the wizard's form object verbatim (transient File handles
 * stripped client-side). Schema-less on purpose — the wizard's form shape
 * evolves with cells, and forcing a rigid schema here would require migrating
 * every saved template whenever a new field is added. The frontend reads it
 * back via `formOverrides` (the same plumbing edit flows use).
 *
 * Objective + conversionLocation are denormalized for fast list display
 * + filtering in the picker without having to crack open the payload.
 */
const mongoose = require("mongoose");

const campaignTemplateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Denormalized from payload for the picker UI.
    objective: { type: String, default: "" },
    conversionLocation: { type: String, default: "" },
    // The wizard `form` snapshot. Mixed because the shape varies per cell.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

// Newest first when listing.
campaignTemplateSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CampaignTemplate", campaignTemplateSchema);
