const express = require("express");
const adStudioController = require("../controllers/adStudio");
const { verifySecretKey } = require("../services/authService");

const router = express.Router();

router.post("/creative-result-update", verifySecretKey, adStudioController.updateCreativeResult);

module.exports = router;