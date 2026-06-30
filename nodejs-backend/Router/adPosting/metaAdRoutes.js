const express = require("express");
const router = express.Router();
const multer = require("multer");
const metaAdController = require("../../controllers/adPosting/metaAdLauncher");
const metaAdControllerV2 = require("../../controllers/adPosting/metaAdLauncherV2");
const campaignTemplateController = require("../../controllers/campaignTemplate.controller");
const autopilotRoutes = require("../autopilot/autopilotRoutes");
const adCopyGenerator = require("../../controllers/adPosting/adCopyGeneratorController")

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
// Geocode a selected place → coordinates (OpenStreetMap Nominatim) so the
// wizard can auto-pin a chosen city/region on the map. Meta's search API
// doesn't return coordinates; radius still goes to Meta via cities[].radius.
router.get("/geocode", metaAdController.geocodeLocation);
// Reverse-geocode for the map-pin picker — verifies a lat/lng falls on
// land (Meta's UI rejects ocean pins; we mirror that to avoid silent
// zero-delivery campaigns).
router.get("/reverse-geocode", metaAdController.reverseGeocodeLocation);

// Detailed Targeting — Meta UI parity picker (Demographics / Interests /
// Behaviours). All four endpoints proxy + cache Meta's `/search` and
// `/targetingbrowse` surfaces with appropriate TTLs.
router.get("/detailed-targeting/search", metaAdController.searchDetailedTargeting);
router.get("/detailed-targeting/browse", metaAdController.browseDetailedTargeting);
// POST for suggestions + reach-estimate — body carries a targeting_list /
// targeting_spec too rich for a query string.
router.post("/detailed-targeting/suggestions", metaAdController.suggestDetailedTargeting);
router.post("/detailed-targeting/reach-estimate", metaAdController.reachEstimateForTargeting);
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
// Sales/CATALOG — Catalog + Product Set pickers for Dynamic Product Ads.
// `get-catalogs` lists catalogs the ad account can advertise from
// (owned + client relationships, deduped). `get-product-sets` lists the
// product sets within a chosen catalog.
router.get("/get-catalogs", metaAdController.getCatalogs);
router.get("/get-product-sets", metaAdController.getProductSets);
// Ad Preview pane media resolver — fetches full-res image / playable
// video source for one ad on demand. Bulk list endpoints return
// `thumbnail_url` only (low-res) and `object_story_spec.video_data`
// (no playable URL), so the preview pane was rendering blurry images
// and dead video players until this lazy resolver was added.
router.get("/get-ad-preview-media", metaAdController.getAdPreviewMedia);

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
// Edit an existing campaign (name / budget / spend cap) — management flow.
router.patch("/v2/update-campaign", metaAdControllerV2.updateCampaignV2);
// Edit an existing ad set (name / budget / bid cap / targeting / schedule).
router.patch("/v2/update-adset", metaAdControllerV2.updateAdSetV2);
// Full editable shape (reverse-mapped targeting) for the Edit ad set flow.
router.get("/v2/resolve-adset", metaAdControllerV2.resolveAdSetForEdit);
// Edit an existing ad (name + creative copy/CTA/link — rebuilds the creative).
router.patch("/v2/update-ad", metaAdControllerV2.updateAdV2);
// Editable shape (creative copy + media tokens) for the Edit ad flow.
router.get("/v2/resolve-ad", metaAdControllerV2.resolveAdForEdit);

// Campaign Templates — user-saved snapshots of the wizard `form` state, so an
// agency can stamp out new campaigns from a known-good setup (budget / account
// / name editable on apply). See campaignTemplate.controller.js.
router.get("/v2/templates", campaignTemplateController.listTemplates);
router.get("/v2/templates/:id", campaignTemplateController.getTemplate);
router.post("/v2/templates", campaignTemplateController.createTemplate);
router.delete("/v2/templates/:id", campaignTemplateController.deleteTemplate);
// Resolve the wizard cell for an existing ad set — powers the "Add Ad"
// flow + gating Add/Edit for legacy-objective campaigns.
router.get("/v2/resolve-cell", metaAdControllerV2.resolveCellForAdSet);
// Fresh campaign settings for the "Add Ad Set" flow (bid strategy / CBO /
// special categories) — the campaign list is cached, this isn't.
router.get("/v2/resolve-campaign", metaAdControllerV2.resolveCampaignForAdd);
// AI ad-copy helper for the wizard's Ad step. Takes a free-text brief,
// returns { primary_text, headline, description, call_to_action } generated
// by Gemini. Synchronous (no socket/stream). Credits charged on success via
// the freeze→settle path. Inherits authenticateJWT from the /meta-ads mount.
router.post("/generate-ad-copy", adCopyGenerator.generateAdCopy);

// Autopilot — owns ALL audit + fix flows (continuous rule cron + on-demand
// LLM audit). Mounted at /meta-ads/autopilot/* and inherits authenticateJWT
// from the parent /meta-ads mount in MainRouter.
router.use("/autopilot", autopilotRoutes);

module.exports = router;
