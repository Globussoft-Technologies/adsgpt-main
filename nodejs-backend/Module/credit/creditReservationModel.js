const mongoose = require("mongoose");

/**
 * CreditReservation — receipt of a "frozen" credit hold.
 *
 * Flow:
 *   freeze   → create row + atomically increment user.used_* by split
 *   settle   → delete row (the freeze IS the deduction; nothing left to do)
 *   release  → delete row + atomically decrement user.used_* by split
 *
 * `reservation_key` is the dedupe / lookup key. Sockets use chatId, video
 * generation uses the video record id, ad factory uses a campaign-derived
 * key. Anything that's unique-per-request and echoed back by Python works.
 *
 * TTL: 24h. Rows linger beyond that only if a settle/release call was lost.
 * A future cron can sweep stale rows and refund — for now manual recovery.
 */
const creditReservationSchema = new mongoose.Schema(
  {
    reservation_key: { type: String, required: true, unique: true, index: true },
    user_id: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    split: {
      fromRollover: { type: Number, default: 0 },
      fromSub: { type: Number, default: 0 },
      fromTopup: { type: Number, default: 0 },
    },
    // Free-form context for debugging (model, service_type, etc.)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// TTL: auto-delete after 24h. NOTE: this only deletes the receipt — it does NOT
// refund credits. If you need stale holds to auto-refund, run a cron that
// finds receipts older than X and calls releaseCredits before they expire.
creditReservationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("CreditReservation", creditReservationSchema);
