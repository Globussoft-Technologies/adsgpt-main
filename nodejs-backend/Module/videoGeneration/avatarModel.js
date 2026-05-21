const mongoose = require("mongoose");

const avatarSchema = new mongoose.Schema(
  {
    age: {
      type: String,
      required: true,
    },
    gender: {
      type: String,
      required: true,
    },
    race: {
      type: String,
      required: true,
    },
    industry: {
      type: String,
      required: true,
    },
    outfit: {
      type: String,
      required: true,
    },
    background: {
      type: String,
      required: true,
    },
    lighting: {
      type: String,
      required: true,
    },
    camera_distance: {
      type: String,
      required: true,
    },
    expression: {
      type: String,
      required: true,
    },
    aspect_ratio: {
      type: String,
      required: true,
    },
    image_size: {
      type: String,
      required: true,
    },
    s3_image_path: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Avatar", avatarSchema);
