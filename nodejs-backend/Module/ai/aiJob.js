/**
 * AiJob — one row per unit of AI work, for every module.
 *
 * Onboarding, storyboard concepts, storyboard regeneration, keyframe rendering
 * and image generation are the same problem five times: the browser asks for
 * something slow, Python does it, and somebody has to remember what happened.
 * `kind` is the only thing that differs, so they share one collection rather
 * than growing five near-identical ones.
 *
 * Two things write to this document, and they must not fight:
 *
 *   • `controllers/ai/jobWebhookController.js` — Python's callback. The durable
 *     path. Survives a browser closing, a deploy, a dropped socket.
 *   • `services/onboarding/jobStreamBridge.js` — the live SSE hop, which exists
 *     only to make the waiting screen feel immediate.
 *
 * `seq` is what keeps them honest. Every write is conditional on carrying a
 * HIGHER seq than the one stored, so a duplicate delivery is a no-op and a
 * retry that arrives late cannot overwrite newer state with older state. That
 * single rule is why at-least-once delivery is safe here.
 */

const mongoose = require("mongoose");

// Mirrors Python's `JobStatus`. Node never invents one — it copies what it was
// told, so an unfamiliar status upstream surfaces as a validation error rather
// than being silently coerced into something wrong.
const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];

// From the live OpenAPI `Job.kind` enum, plus the two we expect once the
// template flow becomes a job. An unknown kind is rejected rather than stored:
// a typo upstream would otherwise create jobs nothing knows how to display.
const JOB_KINDS = [
  "onboarding.init",
  "storyboard.generate",
  "storyboard.regenerate",
  "storyboard.images.generate",
  "image.generate",
  "template.recommend",
  // Module 4. One job per storyboard concept — the user renders them one at a
  // time — so many of these land on the SAME session section. That is why the
  // mirror folds them by `board_id` instead of replacing, exactly as templates
  // fold by `template_id`.
  "video.generate",
];

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

const aiJobSchema = new mongoose.Schema(
  {
    // Python's id, and the only key both sides agree on. Unique because a
    // second row for the same job would split its history in two.
    jobId: { type: String, required: true, unique: true, index: true },

    kind: { type: String, enum: JOB_KINDS, required: true, index: true },

    // Ours, from the JWT at trigger time. Python never sends this back and
    // could not be trusted with it if it did — it is what makes ownership
    // checks possible on every read.
    userId: { type: String, required: true, index: true },

    sessionId: { type: String, default: "", index: true },

    // Set on jobs Node started automatically after another job succeeded, so
    // the workspace can find "the storyboard job for this session" after a
    // refresh without the browser having stored anything.
    parentJobId: { type: String, default: "", index: true },

    status: { type: String, enum: JOB_STATUSES, default: "queued", index: true },

    // The highest sequence number seen. Every update compares against this, so
    // it is the concurrency control for the whole document, not just a counter.
    seq: { type: Number, default: 0 },

    // Latest progress only. History is deliberately not accumulated: the client
    // renders the current line, and keeping every past one would grow the
    // document for data nothing reads back.
    stage: { type: String, default: "" },
    message: { type: String, default: "" },
    percent: { type: Number, default: 0 },

    // Mixed because the shape depends on `kind` and belongs to Python. Typing
    // it here would mean a migration every time they add a field, in exchange
    // for validating data we do not own.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: "" },

    // The chain guard. Written in the SAME update that marks a job succeeded,
    // so two concurrent deliveries of the terminal webhook cannot both see it
    // unset and both fire. Its presence — not the status — is what proves the
    // follow-on work has already been started.
    chainedAt: { type: Date, default: null },

    idempotencyKey: { type: String, default: "", index: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// "What is running for me right now" — the recovery read after a refresh.
aiJobSchema.index({ userId: 1, status: 1, createdAt: -1 });
// "My history, newest first."
aiJobSchema.index({ userId: 1, kind: 1, createdAt: -1 });

const AiJob = mongoose.model("AiJob", aiJobSchema);

module.exports = AiJob;
module.exports.JOB_STATUSES = JOB_STATUSES;
module.exports.JOB_KINDS = JOB_KINDS;
module.exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
