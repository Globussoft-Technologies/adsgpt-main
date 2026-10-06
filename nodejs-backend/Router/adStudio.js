const express = require("express");
const adStudioController = require("../controllers/adStudio");
const { verifySecretKey, authenticateJWT } = require("../services/authService");
const studioTemplateController = require("../controllers/adStudio/studioTemplateController");
const {
  validateStudioTemplatesQuery,
  validateGenerateStudioImage,
} = require("../Validations/adStudio/studioTemplates.validator");

const router = express.Router();

router.post("/creative-result-update", verifySecretKey, adStudioController.updateCreativeResult);

// Brand-matched DS templates for the Ad Creative / Ad Video home galleries.
// See services/adStudio/studioTemplates.js.
router.get("/templates", authenticateJWT, validateStudioTemplatesQuery, studioTemplateController.getTemplates);

// "Recreate this ad" from an image template → DS POST /api/v1/images/from-template
// (charged like AdCreative). See services/adStudio/studioImageRender.js.
router.post("/templates/generate", authenticateJWT, validateGenerateStudioImage, studioTemplateController.generate);

// Price shown on the Generate button = what the render will charge.
router.get("/templates/render-price", authenticateJWT, studioTemplateController.renderPrice);

module.exports = router;