const express = require("express");
const mySpaceController = require("../controllers/mySpaceController");

const router = express.Router();

router.get("/images", mySpaceController.getImages);

module.exports = router;
