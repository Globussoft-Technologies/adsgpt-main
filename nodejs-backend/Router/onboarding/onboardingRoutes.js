const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../../controllers/onboarding/onboardingInitController");
const {
  MAX_FILES,
  MAX_FILE_BYTES,
  asMb,
} = require("../../Validations/onboarding/onboardingInit.validation");

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
  // Upstream's own limits — see INPUT_FILE_LIMITS.md, and the note on the
  // constants in the validation module. The 32MiB budget is a TOTAL and is
  // separate from these; the controller checks it once the parts are parsed.
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
});

// multer rejects outside the normal error path — its errors arrive before any
// controller runs, so without this they surface as a generic 500 and the user
// is told "something went wrong" when the truth is "that file is too big".
function handleUploadErrors(req, res, next) {
  upload.any()(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      // Built from the constants rather than written out. The hard-coded
      // version said "max 32 MB" and "max 10" against limits of 32MiB and 25 —
      // two numbers, neither of them true.
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `That file is too large (max ${asMb(MAX_FILE_BYTES)} MB)`
          : error.code === "LIMIT_FILE_COUNT"
            ? `Too many files (max ${MAX_FILES})`
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

// Coachmark tours: which ones this user has seen, and marking one seen. Per
// user on UserProfile, so a tour does not replay on another device.
router.get("/tours", ctrl.getTours);
router.post("/tours/:tourKey/seen", ctrl.markTourSeen);

// Skip from the very first screen, before any session exists. The session
// PATCH below cannot record that (no id to address), so without this the
// first-run redirect would bring the user straight back on the next login.
router.post("/skip", ctrl.skipOnboarding);

// HIDE-MARK — onboarding reset. OFF (user decision 2026-09-29).
//
// A QA tool: it puts the caller's onboarding back to a fresh-signup state so
// the same account can run through it again. It was left UNGATED by decision
// (ONB-024), which is fine on staging and is not something to ship — any
// signed-in user could hand themselves a fresh allowance by posting to it.
//
// The route is what is switched off; `ctrl.resetOnboarding` is untouched, so
// restoring this is one line.
// router.post("/reset", ctrl.resetOnboarding);

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

// Fresh match, replacing the stored list. The workspace calls it on every open
// (media links rotate between runs).
router.post("/sessions/:sessionId/templates/refresh", ctrl.refreshTemplates);

// "More like this" for one reference template — the fixed-anchor search. No
// session in the path because the upstream route needs none: the anchor id is
// the query. Declared before the session routes for readability only; the paths
// cannot collide.
router.get("/templates/:templateId/similar", ctrl.getSimilarTemplates);

// Recreate — an ad built from a chosen reference template. Multipart, because
// the product image is an upload and the route's contract needs it as a URL:
// `handleUploadErrors` turns multer's own rejections into the same 400 shape
// the rest of this router answers with.
router.post(
  "/sessions/:sessionId/templates/:templateId/recreate",
  handleUploadErrors,
  ctrl.recreateFromTemplate
);

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
