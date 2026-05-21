const express = require("express");
const router = express.Router();
const multer = require("multer");
const metaAdController = require("../../controllers/adPosting/metaAdLauncher");
const metaAdControllerV2 = require("../../controllers/adPosting/metaAdLauncherV2");
const autopilotRoutes = require("../autopilot/autopilotRoutes");

// 10MB cap, in-memory only — we forward bytes straight to Meta.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get("/get-ad-accounts", metaAdController.getAdAccountsList);
router.get("/get-dashboard-data", metaAdController.getDashboardData);
router.get("/get-analytics-data", metaAdController.getAnalyticsData);
router.get("/get-campaigns", metaAdController.getCapaignsByAdAccount);
router.get("/get-ad-sets", metaAdController.getAdSetsByCampaignId);
router.get("/get-campaign-ads", metaAdController.getAdsByCampaignId);
router.get("/get-ad-set-ads", metaAdController.getAdsByAdSetId);
router.get("/get-insights", metaAdController.getInsights);
router.get("/audit", metaAdController.runAudit);
router.patch("/update-status", metaAdController.updateStatus);

// Wizard V2 schema — drives the config-driven CreateCampaignWizardV2.jsx
// renderer. Static data + the FEATURE_WIZARD_V2 flag state. No FB token
// required.
router.get("/wizard-schema", metaAdController.getWizardSchema);

router.get("/get-pages", metaAdController.getPages);
router.get("/get-saved-audiences", metaAdController.getSavedAudiences);
// Geo-location typeahead — drives the V2 wizard's Location Targeting
// picker (countries / cities with radius / regions / free-trade groups).
router.get("/search-geo", metaAdController.searchGeoLocations);
// Feeds the App Promotion app picker in the V2 wizard. Returns the
// user's promotable apps with iOS / Play store URLs normalised so the
// frontend can filter by store and pre-fill objectStoreUrl.
router.get("/get-promotable-apps", metaAdController.getPromotableApps);
// Lead Forms — feeds the Leads/Instant-Form picker + builder in V2.
router.get("/get-lead-forms", metaAdController.getLeadForms);
router.post("/create-lead-form", metaAdController.createLeadForm);
// Captured lead submissions — the dashboard's Leads tab. `get-form-leads`
// returns JSON for the table; `export-form-leads` streams a CSV download.
// Both need the `leads_retrieval` OAuth scope on the connected account.
router.get("/get-form-leads", metaAdController.getFormLeads);
router.get("/export-form-leads", metaAdController.exportFormLeads);
// Pixels (datasets) on the ad account + events per pixel — feeds the
// V2 wizard's Pixel + Event picker for Leads (Website / Multiple cells)
// and future Sales+Pixel cells.
router.get("/get-pixels", metaAdController.getPixels);
router.get("/get-pixel-events", metaAdController.getPixelEvents);
router.post("/create-pixel", metaAdController.createPixel);

// V1 creation flow — campaign → adset → image → ad. Each step is its own
// endpoint so the wizard can recover from a failure mid-flow without redoing
// completed steps. Still in use by V1 for the un-migrated objectives.
router.post("/create-campaign", metaAdController.createCampaign);
router.post("/create-adset", metaAdController.createAdSet);
router.post("/upload-image", upload.single("image"), metaAdController.uploadAdImage);
// Video creative upload — returns { videoId }. Heavier limit than image:
// 100 MB cap is the practical sweet spot for Meta's API ingestion.
router.post(
  "/upload-video",
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }).single("video"),
  metaAdController.uploadAdVideo,
);
router.post("/create-ad", metaAdController.createAd);
router.delete("/delete-campaign", metaAdController.deleteCampaign);

// V2 wizard creation flow — config-driven from `config/wizardSchema.js`.
// Only ships the 3 migrated objectives (Traffic / Leads / App Promotion);
// other objectives flow through the V1 endpoints above until they migrate.
// upload-image is shared with V1 (image upload semantics are objective-agnostic).
router.post("/v2/create-campaign", metaAdControllerV2.createCampaignV2);
router.post("/v2/create-adset", metaAdControllerV2.createAdSetV2);
router.post("/v2/create-ad", metaAdControllerV2.createAdV2);

// Autopilot — owns ALL audit + fix flows (continuous rule cron + on-demand
// LLM audit). Mounted at /meta-ads/autopilot/* and inherits authenticateJWT
// from the parent /meta-ads mount in MainRouter.
router.use("/autopilot", autopilotRoutes);

module.exports = router;
