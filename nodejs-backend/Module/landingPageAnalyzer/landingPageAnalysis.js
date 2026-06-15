const mongoose = require("mongoose");

const landingPageAnalysisSchema = new mongoose.Schema(
  {
    // Owner of the analysis. String to match the rest of the codebase
    // (adsFactoryAutoJob, advertiserSearch all use String userId, not ObjectId ref).
    userId: { type: String, required: true },

    // The URL the user pasted in the "Analyze" box (image 1).
    inputUrl: { type: String, required: true, trim: true },

    // Lifecycle. Enum is a contract shared by python (writes) and the frontend
    // (reads/branches), so a typo can't silently break the UI.
    //   pending    → created by POST url, not picked up yet
    //   processing → python is analyzing (live events streaming in)
    //   completed  → POST result has filled `result`
    //   failed     → analysis errored out
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },

    // The full analysis python returns via POST result. Mixed = arbitrary shape,
    // so python can evolve its report (63 criteria, fixes, benchmarks, profile)
    // without forcing schema migrations here. Frontend .select()s what it needs.
    result: { type: mongoose.Schema.Types.Mixed, default: null },

    // The most recent live event (image 5: "Detecting page sections…", progress).
    // Persisted so a frontend reload mid-analysis can render the current step.
    // The socket emits every event; the DB only keeps the latest.
    lastEvent: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true } // createdAt / updatedAt — list sorts newest-first on createdAt
);

module.exports = mongoose.model("LandingPageAnalysis", landingPageAnalysisSchema);
