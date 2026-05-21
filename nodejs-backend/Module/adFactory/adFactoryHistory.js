const mongoose = require("mongoose");


const CampaignHistorySchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true },
    userId: { type: String, required: true },
    campaignRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true
    },
    previousData: { type: Object, required: true }, 
    version: { type: Number, required: true },      
  },
  { timestamps: true }
);

module.exports = mongoose.model("CampaignHistory", CampaignHistorySchema);