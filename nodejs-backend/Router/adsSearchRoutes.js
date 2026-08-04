const express = require("express");
const { getExploreAds } = require("../controllers/adsSearch/ads.controller");

const router = express.Router();

router.post("/explore-ads", getExploreAds);

module.exports = router;
