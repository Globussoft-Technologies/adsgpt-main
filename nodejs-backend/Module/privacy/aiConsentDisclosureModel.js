const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PLATFORMS = ["ios", "android", "web"];
// "1", "1.1" or "1.1.1"
const VERSION_RE = /^\d+(\.\d+){0,2}$/;

// Compares "1.2" vs "1.10.1" numerically, part by part ("1.1" == "1.1.0").
const compareVersions = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

// AI data-sharing disclosure text, one row per (platform, version), published
// from the admin panel. Rows are never edited: new wording = new version. The
// highest version for a platform is current there, so publishing one asks that
// platform's users again.
const AiConsentDisclosureSchema = new Schema(
  {
    platform: { type: String, enum: PLATFORMS, required: true },
    version: { type: String, required: true, match: VERSION_RE },
    text: { type: String, required: true },
    created_by: { type: String, default: "" },
    created_at: { type: Date, default: Date.now },
  },
  { collection: "ai_consent_disclosures", versionKey: false },
);

AiConsentDisclosureSchema.index({ platform: 1, version: 1 }, { unique: true });

// Highest published disclosure for a platform, or null if none yet.
AiConsentDisclosureSchema.statics.findCurrent = async function (platform) {
  const rows = await this.find({ platform }).lean();
  return rows.sort((a, b) => compareVersions(b.version, a.version))[0] || null;
};

const AiConsentDisclosure = mongoose.model(
  "AiConsentDisclosure",
  AiConsentDisclosureSchema,
);

module.exports = AiConsentDisclosure;
module.exports.PLATFORMS = PLATFORMS;
module.exports.VERSION_RE = VERSION_RE;
module.exports.compareVersions = compareVersions;
