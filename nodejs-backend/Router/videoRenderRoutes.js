const express = require("express"); 

const {videoRender} = require("../controllers/videoRenderController")
const router = express.Router();

router.post("/generate",videoRender )
module.exports = router;