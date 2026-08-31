const express = require("express");
const router = express.Router();
const multer = require("multer");
const metaChatController = require("../../controllers/adPosting/metaChatController");

// Mounted at /meta-ads/chat/* (see Router/adPosting/metaAdRoutes.js) and
// inherits authenticateJWT from the parent /meta-ads mount in MainRouter.

// In-memory only; 100 MB cap covers video. Streamed straight to app storage
// (S3) by the controller — never to Meta directly (the model does the Meta-side
// upload via the MCP tools).
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Wrap multer so its errors (notably LIMIT_FILE_SIZE for an oversized upload)
// return the same clean 400 JSON as the controller's own validation, instead
// of falling through to the generic Express error handler (HTML / 500).
const uploadMediaSingle = (req, res, next) => {
  uploadMedia.single("file")(req, res, (err) => {
    if (err) {
      const detail =
        err.code === "LIMIT_FILE_SIZE"
          ? "File too large. Max 100 MB."
          : "Upload failed while reading the file.";
      return res.status(400).json({ error: detail });
    }
    next();
  });
};

router.post("/stream", (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'Stream AI chat responses for Meta Ads assistant'
  */
  metaChatController.streamChat(req, res, next);
});

router.post("/confirm", (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'Confirm AI assistant proposed action'
  */
  metaChatController.confirmAction(req, res, next);
});

// Resume a turn paused on the in-chat media picker (pick_creative_media).
router.post("/media-pick", (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'Select media in AI chat assistant'
  */
  metaChatController.pickMedia(req, res, next);
});

// Store a user-uploaded creative file, returning its public URL for the picker.
router.post("/media/upload", uploadMediaSingle, (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'Upload creative media in AI chat assistant'
  */
  metaChatController.uploadCreativeMedia(req, res, next);
});

router.get("/history/:sessionId", (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'Get AI chat history by session ID'
  */
  metaChatController.getHistory(req, res, next);
});

router.get("/sessions", (req, res, next) => {
  /* 
    #swagger.tags = ['Meta Ads Launcher']
    #swagger.summary = 'List AI chat sessions'
  */
  metaChatController.listSessions(req, res, next);
});

module.exports = router;
