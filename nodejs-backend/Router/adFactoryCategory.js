const express = require("express")
const {getCategories} = require("../controllers/adFactoryCategory")
const { authenticateJWT } = require("../services/authService");



const router = express.Router();

router.get("/list",authenticateJWT, getCategories);

module.exports = router;