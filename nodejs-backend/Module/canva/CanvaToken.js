const mongoose = require("mongoose");

const CanvaTokenSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, unique: true },
    access_token: { type: String, default: null },
    refresh_token: { type: String, default: null },
    expires_in: { type: Number, default: null },
    created: { type: Number, default: null },
    code_verifier: { type: String, default: null },
    canva_user_id: { type: String, default: null },
    connected_at: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CanvaToken", CanvaTokenSchema);
