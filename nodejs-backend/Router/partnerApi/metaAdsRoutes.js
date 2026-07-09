const express = require("express");
const router = express.Router();
const { requirePartnerApiKey } = require("../../middlewares/partnerApiKey");
const {
  requireMetaSystemUserToken,
} = require("../../middlewares/metaSystemUserToken");
const partnerMetaAdsController = require("../../controllers/partnerApi/metaAdsController");

// Two credentials, two different jobs:
// - x-api-key: who is calling us (issued by admin, see partnerApiKey.controller.js)
// - x-meta-system-user-token: what we call Meta with, on the partner's behalf
router.use(requirePartnerApiKey);
router.use(requireMetaSystemUserToken);

router.get("/ad-accounts", partnerMetaAdsController.getAdAccounts);
router.get("/campaigns", partnerMetaAdsController.getCampaigns);
router.get("/campaigns/spend", partnerMetaAdsController.getCampaignSpend);

module.exports = router;
