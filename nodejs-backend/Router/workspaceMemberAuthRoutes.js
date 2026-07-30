const express = require("express");
const controller = require("../controllers/workspaceMemberAuth.controller");
const {
  workspaceAuthLimiter,
  workspaceLoginEmailLimiter,
} = require("../middlewares/rateLimitMiddleware");

const router = express.Router();

// Every route here is unauthenticated by design, so the per-IP cap applies to
// the whole surface — including the token lookups, which otherwise let a caller
// hammer Mongo for free.
router.use(workspaceAuthLimiter);

router.get("/invitations/:token", controller.info);
router.post("/invitations/:token/accept", controller.acceptInvitation);
// Sends a SendGrid email per call, so this one is additionally capped per
// mailbox on top of the per-IP limiter above.
router.post("/login/request", workspaceLoginEmailLimiter, controller.requestLink);
router.post("/login/consume", controller.consumeLink);

module.exports = router;
