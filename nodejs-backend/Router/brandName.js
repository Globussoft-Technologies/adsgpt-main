const express = require("express");
const {getBrandNames,getBrandsList,updateBrandsList,createBrands,totalCount,deleteBrand,searchBrandsByName,removeBrandLogo} = require("../controllers/brandNamesList")
const { getAudienceSuggestions } = require("../controllers/audienceSuggestionsController");
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


module.exports = router;