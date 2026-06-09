const express = require("express");
const { getScrollData } = require("../controllers/onscrollController");
const { getAdsData, getVectorAdsData, getExploreAds } = require("../controllers/ads.controller");
const { searchCompetitorAds } = require("../controllers/competitorAds.controller");
const router = express.Router();

router.post("/onscroll", getScrollData);
router.post("/get-ads", getAdsData);
router.post("/vector-search", getVectorAdsData);
router.post("/explore-ads", getExploreAds);
router.post("/search", searchCompetitorAds);


module.exports = router;