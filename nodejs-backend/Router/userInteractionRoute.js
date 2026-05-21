const express = require("express"); 

const {updateUserInteraction,getUniquePostOwnersAndBrands,getUserInteractionData,getUserIds} = require("../controllers/interactionData")
const router = express.Router();

router.post("/update",updateUserInteraction )
router.get('/get-postOwner/:userid',getUniquePostOwnersAndBrands)
router.get('/get-user-data/:userid',getUserInteractionData)
router.get('/get-user-id/',getUserIds)
router.get('/ui-view',(req,res)=>{
    res.render('interaction')
})

module.exports = router;