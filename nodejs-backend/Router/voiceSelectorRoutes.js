const express = require("express");
const {
  stats,
  languages,
  genders,
  accents,
  ages,
  voices,
  search,
  sarvamLanguages,
  sarvamGenders,
  sarvamVoices,
} = require("../controllers/voiceSelectorController");

const router = express.Router();

router.get("/stats", stats);
router.get("/languages", languages);
router.get("/genders", genders);
router.get("/accents", accents);
router.get("/ages", ages);
router.get("/voices", voices);
router.get("/search", search);

// Sarvam catalog (shorter cascade: language → gender → voice)
router.get("/sarvam/languages", sarvamLanguages);
router.get("/sarvam/genders", sarvamGenders);
router.get("/sarvam/voices", sarvamVoices);

module.exports = router;
