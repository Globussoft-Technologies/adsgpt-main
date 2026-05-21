const express = require("express"); 
const  {updateUserDetails,createUserDetails,getUserDetails,getAllUsers,getProducts, getUsersStats}= require("../../controllers/auth/amemberController")
const router = express.Router();

router.post('/update-user-details', updateUserDetails)
router.post('/create-user-details',createUserDetails)
router.get('/get-all-users',getAllUsers)
router.get('/get-user-details/:id',getUserDetails)
router.get('/get-product-details',getProducts)
router.get('/get-users-stats',getUsersStats)


module.exports = router;