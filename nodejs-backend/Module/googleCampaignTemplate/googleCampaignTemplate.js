/**
 * GoogleCampaignTemplate — saved snapshot of the Google Ads wizard `form` state.
 *
 * Completely separate from Meta's CampaignTemplate model — different Mongo
 * collection, different controller, different routes. Google templates never
 * appear in the Meta picker and vice versa.
 *
 * `payload` is intentionally schema-less — the wizard form shape varies per
 * objective/channel and structural validation happens on apply, not on save.
 */
const mongoose = require("mongoose");

const googleCampaignTemplateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Denormalized from payload for the picker UI.
    objective: { type: String, default: "" },
    conversionLocation: { type: String, default: "" },
    // Derived from conversionLocation at save time — lets the picker filter
    // by ?type=image|video|text without the caller needing to know Google's
    // full channel-type vocabulary (SEARCH/DISPLAY/PERFORMANCE_MAX/etc).
    mediaType: { type: String, enum: ["image", "video", "text"], default: "image" },
    // The wizard `form` snapshot. Mixed because the shape varies per objective.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, versionKey: false },
);

// Newest first when listing.
googleCampaignTemplateSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("GoogleCampaignTemplate", googleCampaignTemplateSchema);
