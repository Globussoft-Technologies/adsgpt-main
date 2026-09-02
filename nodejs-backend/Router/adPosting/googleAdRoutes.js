const express = require("express");
const multer = require("multer");
const googleAuthController = require("../../controllers/adPosting/googleAuthController");
const googleAdController = require("../../controllers/adPosting/googleAdController");
const googleCampaignTemplateController = require("../../controllers/googleCampaignTemplate.controller");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── User & Authentication ───────────────────────────────────────────────────
router.get("/users/:id", googleAuthController.getCurrentUser);
router.delete("/users/:id", googleAuthController.disconnectUser);


// ─── Main Google Ads API's (Account Hierarchy) ──────────────────────────────
router.get("/get-ad-accounts", googleAdController.getAdAccountsList);
router.get("/get-campaigns", googleAdController.getCampaignsByCustomer);
router.get("/get-ad-groups", googleAdController.getAdGroupsByCampaignId);
router.get("/get-campaign-ads", googleAdController.getAdsByCampaignId);
router.get("/get-ad-group-ads", googleAdController.getAdsByAdGroupId);


// ─── CTA Options ────────────────────────────────────────────────────────────────
router.get("/cta-options", googleAdController.getCtaOptions);
router.get("/wizard-schema", googleAdController.getWizardSchema);
router.get("/resolve-ad", googleAdController.resolveAdForEdit);

// ─── Campaigns create ──────────────────────────────────────────────────────────
router.post("/create-campaign", googleAdController.createCampaignAPI);
router.patch("/update-campaign", googleAdController.updateCampaignAPI);
router.delete("/delete-campaign", googleAdController.deleteCampaignAPI);


// ─── Ad Groups create ──────────────────────────────────────────────────────────
router.post("/create-ad-group", googleAdController.createAdGroupAPI);
router.patch("/update-ad-group", googleAdController.updateAdGroupAPI);
router.delete("/delete-ad-group", googleAdController.deleteAdGroupAPI);
router.post("/asset-group-asset", googleAdController.addAssetToAssetGroupAPI);
router.delete("/asset-group-asset", googleAdController.removeAssetFromAssetGroupAPI);
router.post("/remove-asset-group-asset", googleAdController.removeAssetFromAssetGroupAPI);
router.post("/asset-group-asset/remove", googleAdController.removeAssetFromAssetGroupAPI);
router.post("/sync-asset-group-assets", googleAdController.syncAssetGroupAssetsAPI);


// ─── Ads Posting ────────────────────────────────────────────────
router.post("/upload-image", upload.single("image"), googleAdController.uploadMediaAPI);
// Video upload — returns { youtubeVideoId, youtubeUrl }. Heavier limit than image:
// 500 MB cap to support full-length ad videos uploaded to YouTube.
router.post(
  "/upload-video",
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }).single("video"),
  googleAdController.uploadVideoAPI,
);
router.post("/ads", googleAdController.createAdAPI);
router.patch("/ads", googleAdController.updateAdAPI);
router.get("/ads/:id", googleAdController.getAd);
router.delete("/ads/:id", googleAdController.deleteAdAPI);


// ─── Campaign Templates ────────────────────────────────────────────────────────
// Campaign Templates — Google only. Uses GoogleCampaignTemplate model + controller.
// Meta has its own separate model, controller, and routes.
router.get("/templates",        googleCampaignTemplateController.listTemplates);
router.get("/templates/:id",    googleCampaignTemplateController.getTemplate);
router.post("/templates",       googleCampaignTemplateController.createTemplate);
router.delete("/templates/:id", googleCampaignTemplateController.deleteTemplate);


// ─── Analytics, Insights & Audit ──────────────────────────────────────────────
router.get("/get-dashboard-data", googleAdController.getDashboardData);
router.get("/get-analytics-data", googleAdController.getAnalyticsData);
router.get("/get-insights", googleAdController.getInsights);
router.get("/audit", googleAdController.runAudit);
router.get("/check-account", googleAdController.checkGoogleAdsAccount);
router.patch("/update-status", googleAdController.updateStatus);



module.exports = router;
