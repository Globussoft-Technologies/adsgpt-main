const mongoose = require("mongoose");

const mobileStoreTransactionSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true }, // e.g. "GPT-123"
    amember_user_id: { type: String, required: true },
    platform: { type: String, enum: ["ios", "android"], required: true },
    canonical_transaction_id: { type: String, required: true, unique: true },
    original_transaction_id: { type: String, default: "", index: true },
    app_account_token: { type: String, default: "", index: true },
    subscription_group_identifier: { type: String, default: "" },
    lineage_owner: { type: Boolean, default: undefined },
    trial_consumed: { type: Boolean, default: false },
    processing_transaction_id: { type: String, default: "" },
    processing_expires_at: { type: Date, default: null },

    store_product_id: { type: String, required: true },
    event_type: { type: String, default: "initial_purchase" },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    amember_invoice_id: { type: String, default: "" },
    purchased_at: { type: Date, required: true },
    expires_at: { type: Date, required: true },

    // Future-Proof Raw Payload & Metadata Storage
    raw_payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    processed_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
// Only lineage-owner rows participate. Existing legacy rows have no marker,
// so this index is safe to create before they are reconciled on verification.
mobileStoreTransactionSchema.index(
  { platform: 1, original_transaction_id: 1 },
  { unique: true, partialFilterExpression: { platform: "ios", lineage_owner: true } },
);


module.exports = mongoose.model("MobileStoreTransaction", mobileStoreTransactionSchema);
