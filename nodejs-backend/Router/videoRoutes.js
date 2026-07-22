const express = require("express");
const videoController = require("../controllers/videoController");
const { authenticateJWT, verifySecretKey } = require("../services/authService");
const { requireBasePlan } = require("../middlewares/requireBasePlan");
const multer = require("multer");

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  "/generate",
  authenticateJWT,
  requireBasePlan,
  videoController.generateVideo
);
router.patch(
  "/update-result/:sessionId",
  verifySecretKey,
  videoController.updateVideoResult
);
router.post(
  "/update-prompt-percentage",
  verifySecretKey,
  videoController.updatePromptPercentage
);
router.get("/all", authenticateJWT, videoController.getAllVideos);
router.get(
  "/processing-count",
  authenticateJWT,
  videoController.getProcessingCount
);
router.post(
  "/upload-video",
  verifySecretKey,
  upload.single("video"),
  videoController.uploadVideo
);
router.post(
  "/upload-voice",
  authenticateJWT,
  upload.single("voice"),
  videoController.uploadVoice
);
router.post(
  "/ai-ads/upload/audio",
  verifySecretKey,
  upload.single("audio"),
  videoController.uploadVoice
);
router.post(
  "/generate-image-and-script",
  authenticateJWT,
  requireBasePlan,
  videoController.generateImageAndScript
);
router.post(
  "/generate-avatar-video/:id",
  authenticateJWT,
  requireBasePlan,
  videoController.generateAvatarVideo
);
router.patch(
  "/update-avatar-script",
  verifySecretKey,
  videoController.updateImageAndScript
);
router.post(
  "/regenerate-script",
  authenticateJWT,
  requireBasePlan,
  videoController.regenerateScript
);
router.get("/download-media", videoController.downloadMedia);
router.post(
  "/download-media-zip",
  authenticateJWT,
  videoController.downloadMediaZip
);
router.get("/:id", authenticateJWT, videoController.getVideoById);

// ── AI Ads sub-routes ─────────────────────────────────────────────────────────
// List/fetch: use existing GET /video/all  and  GET /video/:id
// Generate video (step 2): use existing POST /video/generate
//   → send { sessionId, inputs: { type: "ai_ads", scenes: [...], ... } }

// Brand / product intelligence (JWT protected)
router.post(
  "/ai-ads/brand",
  authenticateJWT,
  videoController.getAiAdsBrand
);
router.post(
  "/ai-ads/product",
  authenticateJWT,
  videoController.getAiAdsProduct
);

// Step 1 — scene generation (JWT protected)
router.post(
  "/ai-ads/generate-scene",
  authenticateJWT,
  videoController.generateScene
);
router.post(
  "/ai-ads/regenerate-scene",
  authenticateJWT,
  videoController.regenerateScene
);

// Step 2 — trigger video generation from finalized scenes (JWT protected)
router.post(
  "/ai-ads/generate-video/:sessionId",
  authenticateJWT,
  videoController.generateAiAdsVideo
);

// Recreate — clone an existing AI Ads session into a new doc with status="copy".
// Lets the frontend "Recreate" flow get a fresh _id even when the form is unchanged.
// The copy is hidden from /video/all until /ai-ads/generate-video flips status to "processing".
router.post(
  "/ai-ads/copy/:sessionId",
  authenticateJWT,
  videoController.copyAiAdsVideo
);

// Translate/rewrite Step 1 — preview the new script only (no render). Python
// returns the script via the scene-result callback; the committed video is
// untouched. Frontend listens on socket 'aiAdsTranslateScriptReady'.
router.post(
  "/ai-ads/preview-regenerate-script/:sessionId",
  authenticateJWT,
  videoController.previewRegenerateScript
);

// Voice-only re-render on a completed ad (no Veo). Appends a new results[]
// version; forwards Python's 400 already_in_language verbatim.
router.post(
  "/ai-ads/regenerate-voice/:sessionId",
  authenticateJWT,
  videoController.regenerateAiAdsVoice
);
router.post(
  "/ai-ads/final-merge/:sessionId",
  authenticateJWT,
  videoController.finalMergeAiAdsVoice
);
router.post(
  "/ai-ads/discard-voice-preview/:sessionId",
  authenticateJWT,
  videoController.discardAiAdsVoicePreview
);

// "Keep this one" / revert — move the version pointer to a results[] entry.
router.patch(
  "/ai-ads/select-version/:sessionId",
  authenticateJWT,
  videoController.selectAiAdsVersion
);

// Python callbacks (secret-key protected, NOT JWT)
router.patch(
  "/ai-ads/callback/scene-result/:sessionId",
  verifySecretKey,
  videoController.updateSceneResult
);
router.patch(
  "/ai-ads/callback/video-result/:sessionId",
  verifySecretKey,
  videoController.updateAiAdsVideoResult
);
router.patch(
  "/ai-ads/callback/audio-result/:sessionId",
  verifySecretKey,
  videoController.updateAiAdsAudioResult
);

router.post(
  "/generate-image-and-script-clone",
  authenticateJWT,
  requireBasePlan,
  videoController.generateImageAndScriptClone
);
router.patch(
  "/update-clone-script",
  verifySecretKey,
  videoController.updateImageAndScriptClone
);
router.post(
  "/generate-clone-video/:id",
  authenticateJWT,
  requireBasePlan,
  videoController.generateCloneVideo
);
router.post(
  "/regenerate-script-clone",
  authenticateJWT,
  requireBasePlan,
  videoController.regenerateScriptClone
);
router.post(
  "/regenerate-frame-clone",
  authenticateJWT,
  requireBasePlan,
  videoController.regenerateFrameClone
);
module.exports = router;
