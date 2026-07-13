const express = require("express");
const {
  createCampaign,
  getCampaignByUserId,
  updateCampaign,
  updateGenerationResult,
  getCampaignByUserCampaignId,
  uploadImageFromUrl,
  deleteCampaign,
  getCampaignHistoryByUserCampaignId,
  deleteCreativeByCreativeId,
  updateCreativeByCreativeId,
  getAdFactoryGeneratedCountsByUserId,
  getAdFactoryImagesByUserId,
  downLoadZipImages,
  saveEditedAdImage,
  syncUserAdImages
} = require("../controllers/adFactory");
const { authenticateJWT, verifySecretKey } = require("../services/authService");
const { requireBasePlan } = require("../middlewares/requireBasePlan");
const router = express.Router();


const verifyUploadSecretKey = require("../services/verifyUploadSecretKey")


const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage });



router.post("/create", authenticateJWT, requireBasePlan, createCampaign);
router.get("/get/:userId", authenticateJWT, getCampaignByUserId);
router.get("/get/:userId/:campaignId", authenticateJWT, getCampaignByUserCampaignId);
router.get("/generated-count/:userId", authenticateJWT, getAdFactoryGeneratedCountsByUserId);
router.get("/images/:userId", authenticateJWT, getAdFactoryImagesByUserId);
router.get("/get-history/:userId/:campaignId", authenticateJWT, getCampaignHistoryByUserCampaignId);
router.put("/update", authenticateJWT, requireBasePlan, updateCampaign);
router.put("/creatives/:campaignId/:creativeId", authenticateJWT,updateCreativeByCreativeId);
router.delete("/creatives/:campaignId/:creativeId", authenticateJWT, deleteCreativeByCreativeId)
router.put("/result-update", verifySecretKey, updateGenerationResult);
router.post("/upload-image-url", verifyUploadSecretKey, upload.single("file"), uploadImageFromUrl)
router.post("/custom-images", authenticateJWT, syncUserAdImages)
router.post("/save-edited-image", authenticateJWT, saveEditedAdImage);
router.delete("/delete/:userId/:campaignId", authenticateJWT, deleteCampaign);
router.post("/images-zip-download",authenticateJWT,downLoadZipImages);



module.exports = router;