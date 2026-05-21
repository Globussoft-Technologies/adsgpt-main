const mongoose = require("mongoose");

const googlePostedAdSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    googleAdId: {
      type: String,
      required: true,
      unique: true,
    },
    adAccountId: {
      type: String,
      required: true,
    },
    campaignId: {
      type: String,
      required: true,
    },
    adGroupId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      default: "PAUSED",
    },
    content: {
      headline: String,
      description: String,
      finalUrl: String,
      imageUrl: String,
      videoUrl: String,
      callToAction: String,
      adType: { type: String, default: "SEARCH" },
    },
    metaData: {
      campaignName: String,
      campaignObjective: String,
      dailyBudgetMicros: Number,
      campaignId: String,
      adGroupId: String,
      assetGroupId: String,
    },
    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    apiResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    adFactoryCampaignId: {
      type: String,
      default: null,
    },
    adFactoryCreativeId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GooglePostedAd", googlePostedAdSchema);
