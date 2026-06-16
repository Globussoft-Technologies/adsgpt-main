const express = require("express");
const { trackEvent, getUserSummary } = require("../controllers/analyticsController");
const { authenticateJWT } = require("../services/authService");

const router = express.Router();

router.post("/event", authenticateJWT, trackEvent);
router.get("/summary/:user_id", getUserSummary);

module.exports = router;
