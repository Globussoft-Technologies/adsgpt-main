const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/adsFactoryAuto/adsFactoryAutoController");
const { authenticateJWT } = require("../../services/authService");

router.get("/cta-options",        authenticateJWT, ctrl.getCtaOptions);
router.get("/jobs/stats",         authenticateJWT, ctrl.getStats);        // overall stats — must be before /:id
router.post("/jobs/summary",      authenticateJWT, ctrl.getJobSummary);   // pre-creation summary card — must be before /:id
router.post("/jobs",              authenticateJWT, ctrl.createJob);
router.get("/jobs",               authenticateJWT, ctrl.getJobs);
router.get("/jobs/:id",           authenticateJWT, ctrl.getJob);
router.patch("/jobs/:id",         authenticateJWT, ctrl.updateJob);
router.delete("/jobs/:id",        authenticateJWT, ctrl.deleteJob);
router.post("/jobs/:id/pause",    authenticateJWT, ctrl.pauseJob);
router.post("/jobs/:id/resume",   authenticateJWT, ctrl.resumeJob);
router.post("/jobs/:id/run-now",  authenticateJWT, ctrl.runNow);
router.get("/jobs/:id/history",   authenticateJWT, ctrl.getRunHistory);
router.get("/jobs/:id/stats",     authenticateJWT, ctrl.getJobStats);     // per-job stats
router.get("/jobs/:id/activity",  authenticateJWT, ctrl.getJobActivity);  // full generation + posting trace

module.exports = router;

