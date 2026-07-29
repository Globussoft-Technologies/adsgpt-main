const express = require("express");
const router = express.Router();
const userController = require("../../controllers/adPosting/userController");

router.get("/:id/accounts", userController.listFacebookAccounts);
router.get("/:id", userController.getCurrentUser);
router.delete("/:id/:facebookId", userController.disconnectUser);
router.delete("/:id", userController.disconnectUser);

module.exports = router;
