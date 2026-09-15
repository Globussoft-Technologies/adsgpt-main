const express = require('express');
const router = express.Router();
const GeneratedMediaController = require('../controllers/generatedMedia.controller');
const { authenticateJWT } = require('../services/authService');
router.get(
  "/users-with-generated-media",authenticateJWT,
  GeneratedMediaController.getUsersWithGeneratedMedia
);
router.get(
  "/spending-report",
  authenticateJWT,
  GeneratedMediaController.getSpendingReport
);
// GET API: Fetch ONLY video URLs for media saved as template by Admin (isSavedAsTemplate = true)
router.get(
  "/saved-video-urls",
  authenticateJWT,
  GeneratedMediaController.getSavedVideoUrls
);

// Admin POST: Update isSavedAsTemplate status (set to true when Admin selects a video template)

router.post(
  "/update-template-status/:id",
  authenticateJWT,
  GeneratedMediaController.updateSavedAsTemplate
);

// Slim payload for the campaign-wizard library picker. Must be registered
// BEFORE the catch-all `/:userId` route or Express will route
// `library/:userId` into getMediaByUser instead.
router.get(
  "/library/:userId",
  authenticateJWT,
  GeneratedMediaController.getMediaLibrary,
);
router.get('/:userId', authenticateJWT, GeneratedMediaController.getMediaByUser);


module.exports = router;
