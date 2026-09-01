/**
 * metaAdAccountName — the human name behind an `act_<id>`.
 *
 * WHY A SEPARATE COLLECTION RATHER THAN A FIELD ON THE USAGE ROW. Usage rows
 * are hourly and expire after 30 days; a name does not change hourly and
 * should not expire with the traffic that happened to mention it. Denormalis-
 * ing it onto every row would also make "which name is current" a question
 * with as many answers as there are hours, and a rollup would have to pick
 * one arbitrarily.
 *
 * WHY IT IS NOT AUTHORITATIVE. Nothing in this codebase stores ad-account
 * names durably — they are fetched from Meta and cached in Redis per
 * connection, keyed in a way that cannot be looked up by account id alone.
 * So this is a best-effort index, populated opportunistically from calls we
 * were making anyway. An account we have never seen named simply shows its
 * id, which is what the page showed before this existed.
 */
const mongoose = require("mongoose");

const metaAdAccountNameSchema = new mongoose.Schema(
  {
    // Digits only, no `act_` prefix — same normalisation as the usage rows,
    // so the two join without a transform.
    adAccountId: { type: String, required: true, unique: true },
    name: { type: String, default: "" },
    // Whoever we last saw it under. Advisory only: an agency account can be
    // reachable by several users, and this records one of them, not all.
    lastSeenUserId: { type: String, default: null },
  },
  { timestamps: true },
);

// Deliberately NO TTL. Names outlive the traffic that revealed them, and an
// expired name would make a historical row unreadable for no benefit.
module.exports = mongoose.model("MetaAdAccountName", metaAdAccountNameSchema);
