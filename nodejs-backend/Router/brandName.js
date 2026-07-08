const express = require("express");
const {getBrandNames,getBrandsList,updateBrandsList,createBrands,totalCount,deleteBrand,searchBrandsByName,removeBrandLogo} = require("../controllers/brandNamesList")
const { getAudienceSuggestions } = require("../controllers/audienceSuggestionsController");
const { getCompetitorAds, refreshCompetitorAds } = require("../controllers/competitorDiscoveryController");
const { ensureCategoryHandler } = require("../controllers/brandCategoryClassifier");
const { authenticateJWT } = require("../services/authService");
const router = express.Router();


router.get("/get-names",getBrandNames );
router.get("/get-lists",getBrandsList);
router.patch("/update-lists",updateBrandsList);
router.post("/create-lists",createBrands);
router.get("/total-count",totalCount)
router.delete("/delete-lists",deleteBrand)
router.get("/search-brand",searchBrandsByName)
router.post("/remove-brand-logo",removeBrandLogo)
router.post("/audience-suggestions",getAudienceSuggestions)

// ── Competitor Ads routes ───────────────────────────────────────────────
router.get("/:brandId/competitor-ads", authenticateJWT, getCompetitorAds);
router.post("/:brandId/competitor-ads/refresh", authenticateJWT, refreshCompetitorAds);

// ── Prompt-template category (lazy classify, on-select) ──────────────────
router.post("/:brandId/ensure-category", authenticateJWT, ensureCategoryHandler);

module.exports = router;
