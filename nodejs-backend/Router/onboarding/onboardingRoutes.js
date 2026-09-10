const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/onboarding/onboardingInitController");

// Onboarding module 1 — brand setup.
//
// Every route here is authenticated (mounted behind `authenticateJWT` in
// MainRouter) and none of them are plan-gated or credit-charged. That follows
// the line Ad Factory already draws: inference is the cheap half and the whole
// premise is value before commitment. Charging happens in module 4, at video
// generation, which is where the real cost is.

// Memory storage, matching every other upload route in this backend. The files
// are forwarded straight to the onboarding service and never retained, so
// writing them to disk first would only add a cleanup problem.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // Per-file. The contract's 32MiB budget is a TOTAL, checked in the
    // controller — this stops one absurd file before it is ever buffered.
    fileSize: 32 * 1024 * 1024,
    // A logo, a couple of product shots and a brand deck is the real use case.
    files: 10,
  },
});

// multer rejects outside the normal error path — its errors arrive before any
// controller runs, so without this they surface as a generic 500 and the user
// is told "something went wrong" when the truth is "that file is too big".
function handleUploadErrors(req, res, next) {
  upload.any()(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "That file is too large (max 32 MB)"
          : error.code === "LIMIT_FILE_COUNT"
            ? "Too many files (max 10)"
            : "We couldn't read that upload";
      return res.status(400).json({ error: message });
    }
    return next(error);
  });
}

// The front door. Accepts JSON or multipart; `upload.any()` passes a JSON body
// through untouched, so one handler covers both of the contract's request forms
// and the client never has to tell us which it is sending.
router.post("/init", handleUploadErrors, ctrl.init);

// Static routes before the parameterised ones so they can't be shadowed.
router.get("/sessions", ctrl.listSessions);

// The one call app boot makes: is the free render still available, is
// onboarding finished with, and is there a session to drop the user back into.
// Replaces the localStorage guesswork the banner and the resume used to do.
router.get("/eligibility", ctrl.getEligibility);

// One session, every module section — what the workspace renders from.
router.get("/sessions/:sessionId", ctrl.getSession);

// How this run ended: `{ exit: "completed" }` retires the free-render banner,
// `{ exit: "skipped" }` keeps it up and keeps this session as the resume
// target. Neither ever forces the user back through onboarding.
router.patch("/sessions/:sessionId", ctrl.exitSession);

// The next page of template recommendations. Upstream returns five per call and
// takes a `skip`, so "load more" is the same trigger with the cursor moved on;
// the page arrives by webhook and is folded into the stored list.
router.post("/sessions/:sessionId/templates", ctrl.loadMoreTemplates);

// Module 4 — render one storyboard concept into a clip. One board per call:
// the user renders concepts individually, and a batch job could not report
// progress per tile. See services/onboarding/videoClient.js.
router.post("/sessions/:sessionId/videos", ctrl.generateVideo);

// The blurred placeholder GIF shown while that render runs. Deliberately its
// own route rather than part of the response above: it is optional, it expires
// in ten minutes, and it must never be able to delay a render.
router.post("/sessions/:sessionId/loader", ctrl.buildLoader);

// The live progress channel — declared before the bare `/jobs/:jobId` so the
// more specific path wins.
router.get("/jobs/:jobId/events", ctrl.streamJobEvents);

// The poll fallback: refresh recovery, and clients that can't hold a stream.
router.get("/jobs/:jobId", ctrl.getJob);

// The persisted brand context. The source of truth once a job has finished.
router.get("/context/:sessionId", ctrl.getContext);

module.exports = router;
