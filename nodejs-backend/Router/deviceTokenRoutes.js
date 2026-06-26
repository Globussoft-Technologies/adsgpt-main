const express = require("express");
const router = express.Router();
const DeviceTokenController = require("../controllers/deviceToken.controller");

// Mounted under /device-tokens with authenticateJWT applied at the mount point
// (see MainRouter.js), so req.user is always populated here.
router.post("/", DeviceTokenController.registerDeviceToken);
router.delete("/", DeviceTokenController.unregisterDeviceToken);

module.exports = router;
