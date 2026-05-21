const express = require("express");
const { getScrollData } = require("../controllers/onscrollController");
const { getAdsData, getVectorAdsData, getExploreAds } = require("../controllers/ads.controller")
const router = express.Router();

router.post("/onscroll", getScrollData);
router.post("/get-ads", getAdsData);
router.post("/vector-search", getVectorAdsData);
router.post("/explore-ads", getExploreAds)

module.exports = router;