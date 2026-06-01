const express = require("express");
const {
  stats,
  languages,
  genders,
  accents,
  ages,
  voices,
} = require("../controllers/voiceSelectorController");

const router = express.Router();

router.get("/stats", stats);
router.get("/languages", languages);
router.get("/genders", genders);
router.get("/accents", accents);
router.get("/ages", ages);
router.get("/voices", voices);

module.exports = router;
