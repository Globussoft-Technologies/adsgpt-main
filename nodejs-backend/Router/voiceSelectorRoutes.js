const express = require("express");
const {
  stats,
  languages,
  genders,
  accents,
  ages,
  voices,
  search,
} = require("../controllers/voiceSelectorController");

const router = express.Router();

router.get("/stats", stats);
router.get("/languages", languages);
router.get("/genders", genders);
router.get("/accents", accents);
router.get("/ages", ages);
router.get("/voices", voices);
router.get("/search", search);

module.exports = router;
