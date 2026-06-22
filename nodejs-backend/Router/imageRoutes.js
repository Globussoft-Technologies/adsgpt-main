const express = require("express");
const imageController = require("../controllers/imageController");
const { authenticateJWT, verifySecretKey } = require("../services/authService");
const { requireBasePlan } = require("../middlewares/requireBasePlan");

const router = express.Router();

router.post(
    "/generate",
    authenticateJWT,
    requireBasePlan,
    imageController.generateImage
);

router.patch(
    "/update-result/:sessionId",
    verifySecretKey,
    imageController.updateImageResult
);

router.post("/save-edited", authenticateJWT, imageController.saveEditedImage);

router.get("/all", authenticateJWT, imageController.getAllImages);

router.get("/processing-count", authenticateJWT, imageController.getProcessingCount);

router.get("/:imageId", authenticateJWT, imageController.getImageById);

module.exports = router;
