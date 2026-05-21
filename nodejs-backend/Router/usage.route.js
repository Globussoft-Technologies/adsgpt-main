const express = require("express"); 

const {createUsage,getUserGenerationStats,getModelCreditDeduction} = require("../controllers/usage.controller")
const {authenticateJWT} = require("../services/authService")

const verifyUploadSecretKey = require("../services/verifyUploadSecretKey")
const router = express.Router();

router.post('/createUsage',verifyUploadSecretKey, createUsage);
router.get("/generation-stats/:userId",authenticateJWT,getUserGenerationStats)
router.get("/model-credit-value", authenticateJWT,getModelCreditDeduction)

module.exports = router;