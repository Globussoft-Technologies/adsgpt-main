const express = require("express");
const router = express.Router();
const pageController = require("../../controllers/adPosting/pageController");
const multer = require("multer");

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

router.get("/:accountId", pageController.getUserPages);

// Create a post on Facebook page
router.post("/", upload.single("image"), pageController.createPost);

module.exports = router;
