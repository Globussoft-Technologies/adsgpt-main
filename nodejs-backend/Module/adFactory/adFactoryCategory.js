const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    subcategories: {
      type: [String],
      default: [],
      trim: true
    }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

// Prevent model overwrite in watch / hot-reload environments
module.exports =
  mongoose.models.Category ||
  mongoose.model("Category", CategorySchema);
