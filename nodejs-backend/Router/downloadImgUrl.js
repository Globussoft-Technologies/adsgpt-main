const express = require("express"); 
const {downloadImgUrl, convertUrl} = require("../controllers/downloadImgUrl")
const router = express.Router();


router.get("/preview",downloadImgUrl );
router.get("/convert", convertUrl)


module.exports = router;