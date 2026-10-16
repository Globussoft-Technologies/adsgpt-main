const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PLATFORMS = ["ios", "android", "web"];
// "1", "1.1" or "1.1.1"
const VERSION_RE = /^\d+(\.\d+){0,2}$/;

// AI data-sharing disclosure, one row per (platform, version), published from
// the admin panel. Rows are never edited: new wording = new version.
const AiConsentDisclosureSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    version: { type: String, required: true, match: VERSION_RE },
    // Plain-text form, kept for app builds that lay the text out themselves.
    text: { type: String, required: true },
    // Structured form. Older rows only have text.
    content: {
      type: {
        _id: false,
        title: String,
        intro: [String],
        sections: [{ _id: false, heading: String, paragraphs: [String] }],
      },
      default: undefined,
    },
    // The version users see now. At most one row per platform is true.
    is_current: { type: Boolean, default: false },
    // false = small wording change: users who agreed earlier stay agreed.
    ask_again: { type: Boolean, default: true },
    created_by: { type: String, default: "" },
    created_at: { type: Date, default: Date.now },
  },
  { collection: "ai_consent_disclosures", versionKey: false },
);

AiConsentDisclosureSchema.index({ platform: 1, version: 1 }, { unique: true });

module.exports = mongoose.model("AiConsentDisclosure", AiConsentDisclosureSchema);
module.exports.PLATFORMS = PLATFORMS;
module.exports.VERSION_RE = VERSION_RE;
