const express = require("express");
const controller = require("../controllers/workspaceMemberAuth.controller");
const {
  workspaceAuthLimiter,
  workspaceMemberLoginLimiter,
} = require("../middlewares/rateLimitMiddleware");

const router = express.Router();

// Every route here is unauthenticated by design, so the per-IP cap applies to
// the whole surface — including the token lookups, which otherwise let a caller
// hammer Mongo for free.
router.use(workspaceAuthLimiter);

router.get("/invitations/:token", controller.info);
router.post("/invitations/:token/accept", controller.acceptInvitation);
// Password submissions are additionally capped per mailbox on top of the
// per-IP limiter above, since this is now a credential-stuffing surface.
router.post("/login", workspaceMemberLoginLimiter, controller.loginMember);

module.exports = router;
