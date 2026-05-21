const mongoose = require("mongoose");

const UsageItemSchema = new mongoose.Schema(
  {
    serviceName: {
      type: String,
      required: true,
      trim: true,
    },

    model: {
      type: String,
      required: true,
      trim: true,
    },

    total_tokens: {
      type: Number,
      required: true,
      min: 0,
    },

    input_tokens: {
      type: Number,
      required: true,
      min: 0,
    },

    output_tokens: {
      type: Number,
      required: true,
      min: 0,
    },

    input_tokens_details: {
      text_tokens: {
        type: Number,
        default: 0,
        min: 0,
      },
      image_tokens: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // Single image URL per POST hit (Python sends one request per image)
    image_url: {
      type: String,
      default: "",
    },

    createdAt: {
      type: Date,
      default: Date.now, // only timestamp stored
      immutable: true,  
    },
  },
  {
    _id: false,
    timestamps: false, 
  }
);

const UsageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    usages: [UsageItemSchema],
  },
  {
    timestamps: true, 
     versionKey: false,
  }
);

module.exports = mongoose.model("Usage", UsageSchema);
