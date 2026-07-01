/**
 * TiktokCampaignTemplate — saved snapshot of the TikTok Ads Manager wizard's
 * `form` state. Lets a user stamp out new TikTok campaigns from a known-good
 * setup: objective, targeting, budget, copy, CTA etc. carry over; at use time
 * the user can edit anything before launching. Stored per-user.
 *
 * `payload` is schema-less on purpose — the wizard form shape evolves, and
 * forcing a rigid schema would require migrating every saved template whenever
 * a new field is added. The frontend reads it back at apply time and the
 * wizard's own per-step validator runs before launch.
 *
 * `objective` is denormalized from payload for fast list display in the picker
 * without unpacking the full payload.
 */
const mongoose = require("mongoose");

const tiktokCampaignTemplateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Denormalized from payload for the picker UI.
    objective: { type: String, default: "" },
    conversionLocation: { type: String, default: "" },
    // The wizard `form` snapshot. Mixed because the shape varies per objective.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

// Newest first when listing.
tiktokCampaignTemplateSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "TiktokCampaignTemplate",
  tiktokCampaignTemplateSchema,
);
