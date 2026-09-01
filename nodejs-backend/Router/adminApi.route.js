const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middlewares/adminAuth");
const adminAuth = require("../controllers/admin/adminAuth.controller");
const adminDashboard = require("../controllers/admin/adminDashboard.controller");
const partnerApiKeys = require("../controllers/admin/partnerApiKey.controller");
const tokenUsageDashboard = require("../controllers/admin/tokenUsageDashboard.controller");
const metaUsageDashboard = require("../controllers/admin/metaUsageDashboard.controller");
const planLimits = require("../controllers/admin/planLimits.controller");
const modelConfiguration = require("../controllers/admin/modelConfiguration.controller");
const multer = require("multer");

const modelIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    callback(null, allowed.includes(file.mimetype));
  },
});

router.post("/login", (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Admin authentication login'
  */
  adminAuth.login(req, res, next);
});

router.get("/me", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get current authenticated admin profile'
  */
  adminAuth.me(req, res, next);
});

router.get("/overview", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get admin dashboard overview statistics'
  */
  adminDashboard.overview(req, res, next);
});

router.get("/users/filter-options", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get user filter options for admin dashboard'
  */
  adminDashboard.usersFilterOptions(req, res, next);
});

router.get("/users", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'List all registered users (paginated and filtered)'
  */
  adminDashboard.usersList(req, res, next);
});

router.get("/users/:userId", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get user profile details by ID'
  */
  adminDashboard.userDetail(req, res, next);
});

// Look up a failed Meta launch by its reference code (see wizard error
// banner) — returns the exact request body + full Meta error for reproduction.
router.get("/meta-launch-trace/:traceId", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Trace a failed Meta launch by reference code'
  */
  adminDashboard.getMetaLaunchTrace(req, res, next);
});

// Partner API key issuance for the /partner-api/v1/meta-ads surface.
router.post("/partner-api-keys", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Issue a new partner API key'
  */
  partnerApiKeys.createKey(req, res, next);
});

router.get("/partner-api-keys", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'List issued partner API keys'
  */
  partnerApiKeys.listKeys(req, res, next);
});

router.patch("/partner-api-keys/:id/revoke", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Revoke a partner API key'
  */
  partnerApiKeys.revokeKey(req, res, next);
});

router.get("/token-usage/overview", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get AI token usage overview dashboard'
  */
  tokenUsageDashboard.overview(req, res, next);
});

router.get("/token-usage/users/:userId", requireAdmin, (req, res, next) => {
  /*
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get AI token usage detail for a specific user'
  */
  tokenUsageDashboard.userDetail(req, res, next);
});

// Meta API usage — how much of Meta's shared per-app quota each account
// consumes, and the utilisation percentages Meta reports back. Distinct from
// token-usage above: that one meters what WE spend on models, this one meters
// what we spend against a third party's ceiling.
router.get("/meta-usage/overview", requireAdmin, (req, res, next) => {
  /*
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get Meta API usage overview (calls and rate-limit meters)'
  */
  metaUsageDashboard.overview(req, res, next);
});

router.get("/meta-usage/filter-options", requireAdmin, (req, res, next) => {
  /*
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get filter dropdown options for Meta API usage'
  */
  metaUsageDashboard.filterOptions(req, res, next);
});

router.get("/meta-usage/users/:userId", requireAdmin, (req, res, next) => {
  /*
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get Meta API usage detail for a specific user'
  */
  metaUsageDashboard.userDetail(req, res, next);
});

// Per-plan caps on managed ad accounts / campaigns (Meta Ads). See
// utils/planLimits.js + utils/planUsage.js for where these are enforced.
router.get("/plans", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'List per-plan account and campaign limits'
  */
  planLimits.listPlans(req, res, next);
});

router.patch("/plans/:planId", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Upsert plan limit configuration'
  */
  planLimits.upsertPlanLimit(req, res, next);
});

// Database-backed AI model configuration.
router.get("/models", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'List all database-backed AI model configurations'
  */
  modelConfiguration.listModels(req, res, next);
});

router.get("/models/:canonicalKey", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Get AI model configuration by canonical key'
  */
  modelConfiguration.getModel(req, res, next);
});

router.post("/models", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Create a new AI model entry in catalog'
  */
  modelConfiguration.createModel(req, res, next);
});

router.patch("/models/:canonicalKey", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Update AI model configuration details'
  */
  modelConfiguration.updateModel(req, res, next);
});

router.patch("/models/:canonicalKey/status/:status", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Set AI model status (active/inactive)'
  */
  modelConfiguration.setStatus(req, res, next);
});

router.patch("/models/:canonicalKey/surfaces", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Update AI model surface availability'
  */
  modelConfiguration.updateSurfaces(req, res, next);
});

router.patch("/models/:canonicalKey/unarchive", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Unarchive an archived AI model'
  */
  modelConfiguration.unarchiveModel(req, res, next);
});

router.post("/models/:canonicalKey/icon", requireAdmin, modelIconUpload.single("icon"), (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Upload icon for an AI model'
  */
  modelConfiguration.uploadIcon(req, res, next);
});

router.delete("/models/:canonicalKey/icon", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Remove icon from an AI model'
  */
  modelConfiguration.removeIcon(req, res, next);
});

router.delete("/models/:canonicalKey", requireAdmin, (req, res, next) => {
  /* 
    #swagger.tags = ['Admin']
    #swagger.summary = 'Archive an AI model entry'
  */
  modelConfiguration.archiveModel(req, res, next);
});

module.exports = router;
