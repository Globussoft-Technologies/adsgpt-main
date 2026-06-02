const mongoose = require("mongoose");

const postedAdSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FBUsers",
      required: true,
    },
    facebookAdId: {
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
    adSetId: {
      type: String,
      required: true,
    },
    creativeId: {
      type: String,
      required: true,
    },
    pageId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      default: "PAUSED",
    },
    content: {
      headline: String,
      message: String,
      linkUrl: String,
      callToAction: String,
      imageUrl: String, // Or hash
    },
    metaData: {
      campaignName: String,
      campaignObjective: String,
      dailyBudget: Number,
      campaignId: String,
      adSetId: String,
    },
    adFactoryCampaignId: {
      type: String,
      default: null
    },
    adFactoryCreativeId: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PostedAd", postedAdSchema);
