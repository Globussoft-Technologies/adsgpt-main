const express = require("express"); 
const LoginCheck = require("../../controllers/auth/authController");
const { createUser } = require('../../controllers/auth/amemberController');
const router = express.Router();

router.post('/by-login-pass', LoginCheck.getUserDetails)
router.get('/by-login/:username', LoginCheck.getFromAmemberUserDetails)
router.get ('/create-random-user-access', createUser)
module.exports = router;