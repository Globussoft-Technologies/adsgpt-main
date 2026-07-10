const express = require("express");
const router = express.Router();
const metaChatController = require("../../controllers/adPosting/metaChatController");

// Mounted at /meta-ads/chat/* (see Router/adPosting/metaAdRoutes.js) and
// inherits authenticateJWT from the parent /meta-ads mount in MainRouter.

router.post("/stream", metaChatController.streamChat);
router.post("/confirm", metaChatController.confirmAction);
router.get("/history/:sessionId", metaChatController.getHistory);
router.get("/sessions", metaChatController.listSessions);

module.exports = router;
