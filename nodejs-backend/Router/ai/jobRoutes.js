const express = require("express");
// `Ai`, capital A — that is the directory's real name in git, and therefore on
// the server. Windows and macOS resolve either spelling, so a lowercase `ai`
// here works everywhere a developer looks and fails only on the Linux box.
const ctrl = require("../../controllers/Ai/jobWebhookController");
const { authenticateJWT, verifySecretKey } = require("../../services/authService");

// AI job surface — one set of routes for every module: onboarding, storyboards,
// keyframes, images, templates. `kind` on the job distinguishes them; nothing
// here needs to.
//
// Exported as TWO routers rather than one, because the two halves have
// different callers and different auth, and mounting them separately makes that
// impossible to get wrong by accident:
//
//   webhookRouter → Python. `verifySecretKey` checks `x-secret-key` against
//     RESULT_UPDATE_SECRET — the same shared secret already used by
//     /video/update-result and /ad-studio/creative-result-update, so DS has it
//     and no new scheme is needed. It proves the caller is Python; it says
//     NOTHING about which user a job belongs to. Ownership comes from the
//     stored job, never from the request body.
//
//   jobsRouter → browsers. `authenticateJWT`, every read filtered by the
//     caller's own userId so another user's job 404s.

// ── Python → Node ──────────────────────────────────────────────────────────
// Mounted at /adsgpt/internal/jobs. The /internal segment is not decoration:
// it makes this path obvious in access logs and easy to restrict at the proxy,
// since it is the one route here that no browser should ever reach.
const webhookRouter = express.Router();
webhookRouter.post("/callback", verifySecretKey, ctrl.receive);

// ── Browser → Node ─────────────────────────────────────────────────────────
// Mounted at /adsgpt/jobs. Recovery reads: after a refresh, after a dropped
// socket, or for a client that cannot hold one. `?since=N` answers 204 when
// nothing is newer, so it stays cheap enough to call on a timer.
const jobsRouter = express.Router();
jobsRouter.get("/", authenticateJWT, ctrl.listJobs);
jobsRouter.get("/:jobId", authenticateJWT, ctrl.getJob);

module.exports = { webhookRouter, jobsRouter };
