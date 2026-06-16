const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["page_view"],
      required: true,
    },
    // page_view
    page: { type: String, default: null },
    time_spent: { type: Number, default: null }, // seconds

    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const analyticsSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, unique: true },
    user_name: { type: String, default: null },
    user_email: { type: String, default: null },
    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AnalyticsEvent", analyticsSchema);
