const express = require("express");
const controller = require("../../controllers/auth/amemberSsoController");

const router = express.Router();

router.get("/callback", controller.callback);
router.get("/session", controller.session);
router.post("/logout", controller.logout);

module.exports = router;
