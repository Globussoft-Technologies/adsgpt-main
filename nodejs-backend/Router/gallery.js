const express = require("express")

const router = express.Router();

const { getGalleryImages,  getChatForImage } = require("../controllers/gallery");


router.get("/", getGalleryImages);
router.post("/getchatforimage", getChatForImage)

module.exports = router;