const express = require("express");
const multer = require("multer");
const tiktokAdController = require("../../controllers/adPosting/tiktokAdController");
const tiktokAuthController = require("../../controllers/adPosting/tiktokAuthController");
const tiktokCampaignTemplateController = require("../../controllers/tiktokCampaignTemplate.controller");

const router = express.Router();

// ─── Assets ─────────────────────────────────────────────────────────────────
router.get("/pixels", tiktokAdController.getPixels);
router.post("/pixels", tiktokAdController.createPixel);

// ─── Lead Generation ─────────────────────────────────────────────────────────
router.get("/lead-forms", tiktokAdController.getLeadForms);
router.get("/leads", tiktokAdController.getLeads);

// 500MB cap, in-memory — we forward the video bytes straight to TikTok.
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// 10MB cap for image creatives / covers.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── Connection / User ─────────────────────────────────────────────────────
router.get("/check-account", tiktokAdController.checkAccount);
router.get("/users/:id", tiktokAuthController.getCurrentUser);
router.delete("/users/:id", tiktokAuthController.disconnectUser);

// ─── Read / List ────────────────────────────────────────────────────────────
router.get("/get-ad-accounts", tiktokAdController.getAdAccountsList);
router.get("/get-campaigns", tiktokAdController.getCampaigns);
router.get("/get-ad-groups", tiktokAdController.getAdGroups);
router.get("/get-ads", tiktokAdController.getAds);

// ─── Reporting ───────────────────────────────────────────────────────────────
router.get("/get-insights", tiktokAdController.getInsights);
router.get("/get-dashboard-data", tiktokAdController.getDashboardData);

// ─── Wizard config + pickers ─────────────────────────────────────────────────
router.get("/wizard-schema", tiktokAdController.getWizardSchema);
router.get("/get-identities", tiktokAdController.getIdentities);
router.get("/get-regions", tiktokAdController.getRegions);
router.get("/get-interest-categories", tiktokAdController.getInterestCategories);
router.get("/get-video-info", tiktokAdController.getVideoInfo);

// ─── Mutations ───────────────────────────────────────────────────────────────
router.post("/update-status", tiktokAdController.updateStatus);
router.post("/create-campaign", tiktokAdController.createCampaign);
router.post("/create-ad-group", tiktokAdController.createAdGroup);
router.post("/create-ad", tiktokAdController.createAd);
router.post("/update-campaign", tiktokAdController.updateCampaign);
router.post("/update-ad-group", tiktokAdController.updateAdGroup);
router.post("/update-ad", tiktokAdController.updateAd);
router.post("/upload-video", uploadVideo.single("video"), tiktokAdController.uploadVideo);
router.post("/upload-image", uploadImage.single("image"), tiktokAdController.uploadImage);

// Campaign Templates — user-saved snapshots of the wizard `form` state.
router.get("/templates", tiktokCampaignTemplateController.listTemplates);
router.get("/templates/:id", tiktokCampaignTemplateController.getTemplate);
router.post("/templates", tiktokCampaignTemplateController.createTemplate);
router.delete("/templates/:id", tiktokCampaignTemplateController.deleteTemplate);

module.exports = router;
