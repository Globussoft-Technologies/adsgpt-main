const mongoose = require("mongoose");

const adCreativeImagesSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      required: true,
    },
    image_url: {
      type: String,
      required: true,
    },
    // user_id: {
    //   type: String,
    //   required: true,
    // },
    type: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const AdCreativeImages = mongoose.model("AdCreativeImages", adCreativeImagesSchema);

module.exports = AdCreativeImages;
