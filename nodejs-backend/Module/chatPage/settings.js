const mongoose = require("mongoose");

const chatSettingsSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
    },
    brand_name: {
      type: String,
    },
    brand_description: {
      type: String,
    },
    no_of_ad_copies: {
      type: Number,
    },
    cta: {
      type: String,
    },
    cta_link: {
      type: String,
    },
    aspect_ratio: {
      type: String,
    },
    style_type: {
      type: String,
    },
    color_palette: {
      type: String,
    },
    pace: {
      type: String,
    },
    num_images: {
      type: Number,
    },
    type: {
      type: String,
      required: true,
    },
    user_id: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const ChatSettings = mongoose.model("ChatSettings", chatSettingsSchema);

module.exports = ChatSettings;
