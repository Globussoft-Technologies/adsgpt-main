const mongoose = require("mongoose");

// Captures the exact request + Meta response for a failed V2 mutation
// (create/update campaign, ad set, or ad) so support can hand the user a
// short reference code, and we can look up the EXACT payload that failed
// without asking the user to describe it. See metaAdLauncherV2.js
// `metaErrorResponse` for the write path.
//
// Not a permanent record — these are debug aids for reproducing a launch
// failure shortly after it happens. TTL-expired after 90 days below.
const metaLaunchTraceSchema = new mongoose.Schema(
  {
    traceId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, index: true },
    adAccountId: { type: String },
    // e.g. "create ad set", "update ad" — matches the `action` string
    // already passed to metaErrorResponse/logMetaError, so log lines and
    // trace records read the same.
    action: { type: String, required: true },
    // The wizard's request body as received — business config (targeting,
    // budget, creative fields), not credentials. Auth travels via
    // middleware/session, never in this body.
    requestBody: { type: mongoose.Schema.Types.Mixed },
    metaError: {
      code: mongoose.Schema.Types.Mixed,
      subcode: mongoose.Schema.Types.Mixed,
      message: String,
      title: String,
      fbtraceId: String,
      data: mongoose.Schema.Types.Mixed,
    },
    // Best-effort full error object dump (same helper used in server logs)
    // for the cases formatMetaError's field-probing misses something.
    rawErrorDump: { type: String },
  },
  { timestamps: true },
);

// Debug aid, not an audit trail — expire automatically so this collection
// doesn't grow unbounded or become a long-term data-retention concern.
metaLaunchTraceSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

module.exports = mongoose.model("MetaLaunchTrace", metaLaunchTraceSchema);
