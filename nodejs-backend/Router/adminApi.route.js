const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middlewares/adminAuth");
const adminAuth = require("../controllers/admin/adminAuth.controller");
const adminDashboard = require("../controllers/admin/adminDashboard.controller");
const partnerApiKeys = require("../controllers/admin/partnerApiKey.controller");

router.post("/login", adminAuth.login);
router.get("/me", requireAdmin, adminAuth.me);

router.get("/overview", requireAdmin, adminDashboard.overview);
router.get("/users", requireAdmin, adminDashboard.usersList);
router.get("/users/:userId", requireAdmin, adminDashboard.userDetail);
// Look up a failed Meta launch by its reference code (see wizard error
// banner) — returns the exact request body + full Meta error for reproduction.
router.get("/meta-launch-trace/:traceId", requireAdmin, adminDashboard.getMetaLaunchTrace);

// Partner API key issuance for the /partner-api/v1/meta-ads surface.
router.post("/partner-api-keys", requireAdmin, partnerApiKeys.createKey);
router.get("/partner-api-keys", requireAdmin, partnerApiKeys.listKeys);
router.patch("/partner-api-keys/:id/revoke", requireAdmin, partnerApiKeys.revokeKey);

module.exports = router;
