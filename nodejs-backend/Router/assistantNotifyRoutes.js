const express = require("express");
const assistantNotifyController = require("../controllers/assistantNotifyController");
const { verifySecretKey } = require("../services/authService");

const router = express.Router();

// Python-only endpoint. Same `x-secret-key` header as /credits/*. NOT exposed
// to the frontend — the agent calls this when a chat turn finishes after its
// browser disconnected, so the user still learns the result is ready.
router.post("/assistant-turn", verifySecretKey, assistantNotifyController.assistantTurnComplete);

module.exports = router;
