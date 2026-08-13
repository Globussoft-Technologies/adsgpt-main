const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middlewares/adminAuth");
const adminAuth = require("../controllers/admin/adminAuth.controller");
const adminDashboard = require("../controllers/admin/adminDashboard.controller");
const partnerApiKeys = require("../controllers/admin/partnerApiKey.controller");
const tokenUsageDashboard = require("../controllers/admin/tokenUsageDashboard.controller");
const planLimits = require("../controllers/admin/planLimits.controller");
const modelConfiguration = require("../controllers/admin/modelConfiguration.controller");

router.post("/login", adminAuth.login);
router.get("/me", requireAdmin, adminAuth.me);

router.get("/overview", requireAdmin, adminDashboard.overview);
router.get("/users/filter-options", requireAdmin, adminDashboard.usersFilterOptions);
router.get("/users", requireAdmin, adminDashboard.usersList);
router.get("/users/:userId", requireAdmin, adminDashboard.userDetail);
// Look up a failed Meta launch by its reference code (see wizard error
// banner) — returns the exact request body + full Meta error for reproduction.
router.get("/meta-launch-trace/:traceId", requireAdmin, adminDashboard.getMetaLaunchTrace);

// Partner API key issuance for the /partner-api/v1/meta-ads surface.
router.post("/partner-api-keys", requireAdmin, partnerApiKeys.createKey);
router.get("/partner-api-keys", requireAdmin, partnerApiKeys.listKeys);
router.patch("/partner-api-keys/:id/revoke", requireAdmin, partnerApiKeys.revokeKey);

router.get("/token-usage/overview", requireAdmin, tokenUsageDashboard.overview);
router.get("/token-usage/users/:userId", requireAdmin, tokenUsageDashboard.userDetail);

// Per-plan caps on managed ad accounts / campaigns (Meta Ads). See
// utils/planLimits.js + utils/planUsage.js for where these are enforced.
router.get("/plans", requireAdmin, planLimits.listPlans);
router.patch("/plans/:planId", requireAdmin, planLimits.upsertPlanLimit);

// Database-backed AI model configuration.
router.get("/models", requireAdmin, modelConfiguration.listModels);
router.get("/models/:canonicalKey", requireAdmin, modelConfiguration.getModel);
router.post("/models", requireAdmin, modelConfiguration.createModel);
router.patch("/models/:canonicalKey", requireAdmin, modelConfiguration.updateModel);
router.patch("/models/:canonicalKey/status/:status", requireAdmin, modelConfiguration.setStatus);
router.patch("/models/:canonicalKey/surfaces", requireAdmin, modelConfiguration.updateSurfaces);
router.delete("/models/:canonicalKey", requireAdmin, modelConfiguration.archiveModel);

module.exports = router;
