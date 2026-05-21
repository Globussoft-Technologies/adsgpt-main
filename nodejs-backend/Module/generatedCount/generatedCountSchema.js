const mongoose = require("mongoose");

const GeneratedCountSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
    url: { type: String, required: true },
    model: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("GeneratedCount", GeneratedCountSchema);
