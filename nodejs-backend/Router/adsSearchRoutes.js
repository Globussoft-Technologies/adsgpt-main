const express = require("express");
const { getExploreAds } = require("../controllers/adsSearch/ads.controller");
const { searchCompetitorAds } = require("../controllers/adsSearch/competitorAds.controller");

const router = express.Router();

router.post("/explore-ads", getExploreAds);
router.post("/search", searchCompetitorAds);

module.exports = router;
