const express = require("express"); 
const advertiserSearchControll = require("../controllers/advertiserSearchController")
const router = express.Router();

router.get('/get-advertiser-name/:network', advertiserSearchControll.getAdvertiserName).post("/save-advertiser/",advertiserSearchControll.saveAdvertiserName ).patch("/update-advertiser/",advertiserSearchControll.updateAdvertiserRelevancy ).post("/check-status/",advertiserSearchControll.checkAdvertiserStatus ).get('/reset-advertiser/:advertiserName',advertiserSearchControll.resetAdvertiserStatus)
module.exports = router;