const express = require("express");
const multer = require("multer");
const googleAuthController = require("../../controllers/adPosting/googleAuthController");
const googleAdController = require("../../controllers/adPosting/googleAdController");

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


// ─── Ads Posting ────────────────────────────────────────────────
router.post("/upload-image", upload.single("image"), googleAdController.uploadMediaAPI);
router.post("/ads", googleAdController.createAdAPI);
router.patch("/ads", googleAdController.updateAdAPI);
router.get("/ads/:id", googleAdController.getAd);
router.delete("/ads/:id", googleAdController.deleteAdAPI);


// ─── Analytics, Insights & Audit ──────────────────────────────────────────────
router.get("/get-dashboard-data", googleAdController.getDashboardData);
router.get("/get-analytics-data", googleAdController.getAnalyticsData);
router.get("/get-insights", googleAdController.getInsights);
router.get("/audit", googleAdController.runAudit);
router.get("/check-account", googleAdController.checkGoogleAdsAccount);
router.patch("/update-status", googleAdController.updateStatus);



module.exports = router;
