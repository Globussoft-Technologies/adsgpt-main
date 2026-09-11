const mongoose = require("mongoose");

const surfaceConfigurationSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    aspectRatios: { type: [String], default: undefined },
    // Most surfaces offer a fixed set of lengths (durations). Clone Your Ad
    // instead accepts any whole number of seconds between two bounds, so it
    // sets durationRange and leaves durations empty. A surface uses one or the
    // other - storing a range as [4, 30] would read as "4s or 30s" to every
    // consumer that renders a picker from durations.
    durations: { type: [Number], default: undefined },
    durationRange: {
      type: new mongoose.Schema(
        { min: { type: Number, min: 1 }, max: { type: Number, min: 1 } },
        { _id: false },
      ),
      default: undefined,
    },
    qualities: { type: [String], default: undefined },
    capabilities: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false, minimize: false },
);

const qualityTierSchema = new mongoose.Schema(
  {
    quality: { type: String, required: true, trim: true },
    credits: { type: Number, min: 0 },
    pricing: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false, minimize: false },
);

const aiModelConfigurationSchema = new mongoose.Schema(
  {
    canonicalKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    displayName: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["image", "video", "text", "vision", "audio", "internal"],
      index: true,
    },
    aliases: { type: [String], default: [] },
    enabled: { type: Boolean, default: true, index: true },
    archived: { type: Boolean, default: false, index: true },
    isPremium: { type: Boolean, default: false },
    blockedPlanIds: { type: [String], default: undefined },
    sortOrder: { type: Number, default: 0 },
    icon: { type: String, default: null },
    description: { type: String, default: "" },
    adminNotes: { type: String, default: "" },

    // Effective values are stored here so runtime charging does not depend
    // on environment variables after the seed/migration is complete.
    credits: { type: Number, min: 0 },
    pricing: { type: mongoose.Schema.Types.Mixed },
    qualityTiers: { type: [qualityTierSchema], default: undefined },
    extraCharges: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    aggregationCreditDefault: { type: Number, min: 0 },

    capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
    surfaces: {
      type: Map,
      of: surfaceConfigurationSchema,
      default: undefined,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false },
);

aiModelConfigurationSchema.index({ type: 1, enabled: 1, archived: 1, sortOrder: 1 });

module.exports =
  mongoose.models.AIModelConfiguration ||
  mongoose.model("AIModelConfiguration", aiModelConfigurationSchema);
