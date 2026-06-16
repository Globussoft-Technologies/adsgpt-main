const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/landingPageAnalyzer/landingPageAnalyzerController");
const {
  authenticateJWT,
  verifySecretKey,
} = require("../../services/authService");

// FE-facing: paste a URL → start a scan. JWT is applied per-route here (not at the
// mount) so the python webhook / live-event routes we add next can stay token-free.
router.post("/analyze", authenticateJWT, ctrl.createAnalysis);

// Python webhook: full report delivered once the scan completes. No JWT — python
// has no token; it's trusted via the sessionId (our _id) it echoes back.
router.post("/result", verifySecretKey, ctrl.saveResult);

// Python webhook: live progress events while the scan runs. Persists lastEvent and
// emits it over the socket to the FE watching this session. No JWT — same trust.
router.post("/event", verifySecretKey, ctrl.saveLiveEvent);
// router.post("/event", ctrl.saveLiveEvent);

// FE-facing: list the user's analyses (lightweight) and fetch one full analysis.
// `/:id` is declared last so it can't shadow the static routes above.
router.get("/", authenticateJWT, ctrl.getAnalyses);
router.get("/:id", authenticateJWT, ctrl.getAnalysisById);
router.delete("/:id", authenticateJWT, ctrl.deleteAnalysis);

module.exports = router;
