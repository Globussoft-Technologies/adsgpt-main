const express = require("express");
const router = express.Router();
const multer = require("multer");
const adController = require("../../controllers/adPosting/adController");
const adControllerV2 = require("../../controllers/adPosting/adControllerV2");

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Get user's ad accounts
router.get("/accounts/:accountId", adController.getAdAccounts);

// Get campaigns for an ad account

// Create a Facebook Ad — legacy v1 (single link_data shape, doesn't handle
// Lead Gen / App Promotion creatives correctly).
router.post("/create", upload.single("image"), adController.createAd);

// V2 — cell-aware: infers the (objective × destination) from the selected
// Meta campaign/ad set and builds the right object_story_spec shape per
// cell. Supports Traffic, Leads, and App Promotion. JSON only (no multer).
router.post("/v2/create", adControllerV2.createAdV2);

// Get Insights
router.get("/insights", adController.getInsights);

// Get Delivery Estimate
router.post("/delivery-estimate", adController.getDeliveryEstimate);

// Get Posted Ads History
router.get("/history", adController.getPostedAds);

// Get Insights for Posted Ad
router.get("/history/:id/insights", adController.getPostedAdInsights);

// Granular Ad Posting APIs
// --- CRUD Routes ---
router.post("/media", upload.single("image"), adController.uploadMediaAPI);

// Campaigns
router.get("/campaigns", adController.getCampaigns);
router.post("/campaigns", adController.createCampaignAPI);
router.get("/campaigns/:id", adController.getCampaign);
router.post("/campaigns/:id", adController.updateCampaign);
router.delete("/campaigns/:id", adController.deleteCampaign);

// Ad Sets - GET list must come BEFORE :id routes
router.get("/adsets", adController.getAdSets);
router.post("/adsets", adController.createAdSetAPI);
router.get("/adsets/:id", adController.getAdSet);
router.post("/adsets/:id", adController.updateAdSet);
router.delete("/adsets/:id", adController.deleteAdSet);

// Ads
router.post("/ads", adController.createAdAPI);
router.get("/ads/:id", adController.getAd);
router.post("/ads/:id", adController.updateAd);
router.delete("/ads/:id", adController.deleteAd);

// Creatives
router.post("/creatives", adController.createCreativeAPI);
router.get("/creatives", adController.getCreatives);
router.get("/creatives/:id", adController.getCreative);
router.delete("/creatives/:id", adController.deleteCreative);

module.exports = router;
