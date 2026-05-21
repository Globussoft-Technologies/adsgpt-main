const express = require("express"); 
const scrollAds = require("../controllers/scrollAds")
const router = express.Router();

 router.get('/', scrollAds.getAdsData)

module.exports = router;