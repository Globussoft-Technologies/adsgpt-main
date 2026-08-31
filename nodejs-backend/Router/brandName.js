const express = require("express");
const {getBrandNames,getBrandsList,updateBrandsList,createBrands,totalCount,deleteBrand,searchBrandsByName,removeBrandLogo} = require("../controllers/brandNamesList")
const { getAudienceSuggestions } = require("../controllers/audienceSuggestionsController");
const { getCompetitorAds, refreshCompetitorAds } = require("../controllers/competitorDiscoveryController");
const { ensureCategoryHandler } = require("../controllers/brandCategoryClassifier");
const { authenticateJWT } = require("../services/authService");
const router = express.Router();


router.get("/get-names", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Get list of brand names'
  */
  getBrandNames(req, res, next);
});

router.get("/get-lists", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Fetch detailed list of brands'
  */
  getBrandsList(req, res, next);
});

router.patch("/update-lists", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Update brand details'
  */
  updateBrandsList(req, res, next);
});

router.post("/create-lists", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Create a new brand'
  */
  createBrands(req, res, next);
});

router.get("/total-count", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Get total count of user brands'
  */
  totalCount(req, res, next);
});

router.delete("/delete-lists", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Delete a brand'
  */
  deleteBrand(req, res, next);
});

router.get("/search-brand", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Search brands by name'
  */
  searchBrandsByName(req, res, next);
});

router.post("/remove-brand-logo", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Remove logo from a brand'
  */
  removeBrandLogo(req, res, next);
});

router.post("/audience-suggestions", (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Get target audience suggestions for brand'
  */
  getAudienceSuggestions(req, res, next);
});

// ── Competitor Ads routes ───────────────────────────────────────────────
router.get("/:brandId/competitor-ads", authenticateJWT, (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Fetch competitor ads for a brand'
  */
  getCompetitorAds(req, res, next);
});

router.post("/:brandId/competitor-ads/refresh", authenticateJWT, (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Refresh competitor ads for a brand'
  */
  refreshCompetitorAds(req, res, next);
});

// ── Prompt-template category (lazy classify, on-select) ──────────────────
router.post("/:brandId/ensure-category", authenticateJWT, (req, res, next) => {
  /* 
    #swagger.tags = ['BrandIQ']
    #swagger.summary = 'Ensure prompt-template category classification for brand'
  */
  ensureCategoryHandler(req, res, next);
});

module.exports = router;
