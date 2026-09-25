const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GeneratedMediaSchema = new Schema({
    userId: { type: String, required: true },
    //  user_name: { type: String, required: true },
    type: {
        type: String,
        enum: ["image", "video"],
        required: true
    },
    model: { type: String, required: true },
    // 'adCreative' = saved from socket (Python sends no tokens for this service)
    // 'adFactory'  = saved from /createUsage (Python sends tokens here)
    // 'adVideo'    = saved from socket for video generation
    source: { type: String, default: "" },
    // What the user's OWN WALLET was charged. Not the whole price of the
    // render — see `allowance_deduction`.
    credit_deduction: { type: Number, default: 0 },
    /* What the ONBOARDING ALLOWANCE paid, in credits.
       ── Why it is a second number ──────────────────────────────────────────
       Onboarding renders can be paid for by two purses at once: a free budget
       that only exists inside onboarding, and the user's real credits. A
       32-credit video made with 31 of budget left costs the user 1 — and the
       admin panel showed exactly that 1, which reads as a cheap render rather
       than as "31 given away, 1 charged".
       So the split is stored rather than inferred. Together these two ARE the
       price: `credit_deduction + allowance_deduction` is what the render cost,
       and each half says who paid it. Zero on every non-onboarding row, which
       is correct: nothing else has an allowance to spend. */
    allowance_deduction: { type: Number, default: 0 },
    // Explicitly given away, rather than merely costing nothing.
    //
    // The two are not the same and the admin panel has to tell them apart: a
    // row with no deduction might be a freebie, or might be a generation whose
    // price has not been worked out yet. Inferring "free" from a zero would
    // label both, and the second label would be a lie.
    //
    // Set today by onboarding: true when NOTHING left the user's wallet, i.e.
    // the allowance covered the render in full. A split render is `false` with
    // a non-zero `allowance_deduction` — partly given away, partly charged.
    free: { type: Boolean, default: false },
    cost: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    aspect_ratio: { type: String, default: "" },
    quality: { type: String, default: "" },
    image: { type: mongoose.Schema.Types.Mixed, default: "" },
    video: { type: mongoose.Schema.Types.Mixed, default: "" },
    // Track if Admin saved/selected this media item as a template
    isSavedAsTemplate: { type: Boolean, default: false, index: true }
}, { timestamps: true });

GeneratedMediaSchema.index({ userId: 1 });
GeneratedMediaSchema.index({ userId: 1, source: 1 }); // for source-based cost queries

module.exports = mongoose.model('generatedMedia', GeneratedMediaSchema);
