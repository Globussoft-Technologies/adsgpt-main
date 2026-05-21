const express = require("express");
const router = express.Router();
const autopilotController = require("../../controllers/autopilot/autopilotController");
const llmAuditController = require("../../controllers/autopilot/llmAuditController");
const userRuleController = require("../../controllers/autopilot/autopilotUserRuleController");

// Mounted at /meta-ads/autopilot (see Router/adPosting/metaAdRoutes.js).
// authenticateJWT is applied at the /meta-ads mount in MainRouter.

// ─── Continuous rule-based audit + actions (cron + on-demand) ───
router.post("/run", autopilotController.runNow);
router.post("/run-cycle", autopilotController.runCycle);
router.post("/audit/run", autopilotController.runAudit); // on-demand 37-rule audit
router.post("/rename-by-hook", autopilotController.renameByHook);
router.post("/rotate", autopilotController.rotate);
router.post("/test-slack", autopilotController.testSlack);
router.post("/test-email", autopilotController.testEmail);
router.post("/test-telegram", autopilotController.testTelegram);
router.get("/log", autopilotController.listLog);
router.get("/log/:runId", autopilotController.getRunDetail);
router.get("/summary", autopilotController.getSummary);
router.get("/settings", autopilotController.getSettings);
router.patch("/settings", autopilotController.updateSettings);
router.get("/config", autopilotController.getConfig);
router.get("/audit-rules", autopilotController.getAuditRules);

// ─── User-defined rules (Autopilot v4) ───
// Form-based rules attached to specific campaigns. The cron evaluates
// only attached (rule × entity) pairs each tick — replaces the previous
// "37 fixed rules iterate every selected ad-account" model.
router.get("/rules", userRuleController.list);
router.post("/rules", userRuleController.create);
router.patch("/rules/:id", userRuleController.update);
router.delete("/rules/:id", userRuleController.remove);
router.post("/rules/:id/test", userRuleController.test);
// Curated templates — clone-to-customise starting points.
router.get("/rule-templates", userRuleController.templates);

router.get("/rotation-queue", autopilotController.getRotationQueue);
router.post(
  "/approve-generated/:draftId",
  autopilotController.approveGenerated,
);

// ─── On-demand LLM audit + apply/dismiss/undo ───
router.post("/llm-audit", llmAuditController.runLLMAudit);
router.get("/llm-audit/audits", llmAuditController.listAudits);
router.get("/llm-audit/findings/:auditId", llmAuditController.getFindings);
router.post(
  "/llm-audit/apply-fix/:findingId",
  llmAuditController.applyFix,
);
router.post(
  "/llm-audit/dismiss/:findingId",
  llmAuditController.dismissFinding,
);
router.post("/llm-audit/undo/:findingId", llmAuditController.undoFix);
router.get("/llm-audit/fix-log", llmAuditController.getFixLog);

module.exports = router;
