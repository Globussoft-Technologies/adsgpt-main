const express = require("express");
const creditsApiController = require("../controllers/creditsApiController");
const { verifySecretKey } = require("../services/authService");

const router = express.Router();

// Python-only endpoints. Same `x-secret-key` header used by /update-result/*
// callbacks. NOT exposed to the frontend — Python's agent service reserves
// credits before a tool call and finalizes after.
router.post("/freeze", verifySecretKey, creditsApiController.freeze);
router.post("/finalize", verifySecretKey, creditsApiController.finalize);

// Read-only registry view so Python can look up per-model credit costs
// without hardcoding env vars on its side.
router.get("/models", verifySecretKey, creditsApiController.getModels);

module.exports = router;
