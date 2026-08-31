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

router.get("/stats", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'Get voice catalog statistics'
  */
  stats(req, res, next);
});

router.get("/languages", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available voice languages'
  */
  languages(req, res, next);
});

router.get("/genders", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available voice genders'
  */
  genders(req, res, next);
});

router.get("/accents", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available voice accents'
  */
  accents(req, res, next);
});

router.get("/ages", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available voice age categories'
  */
  ages(req, res, next);
});

router.get("/voices", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'Get filtered list of AI voices'
  */
  voices(req, res, next);
});

router.get("/search", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'Search voices by query'
  */
  search(req, res, next);
});

// Sarvam catalog (shorter cascade: language → gender → voice)
router.get("/sarvam/languages", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available Sarvam voice languages'
  */
  sarvamLanguages(req, res, next);
});

router.get("/sarvam/genders", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'List available Sarvam voice genders'
  */
  sarvamGenders(req, res, next);
});

router.get("/sarvam/voices", (req, res, next) => {
  /* 
    #swagger.tags = ['Voice Selector']
    #swagger.summary = 'Get Sarvam voice catalog list'
  */
  sarvamVoices(req, res, next);
});

module.exports = router;
