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

router.get("/invitations/:token", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Get workspace invitation details by token'
  */
  controller.info(req, res, next);
});

router.post("/invitations/:token/accept", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Accept workspace invitation'
  */
  controller.acceptInvitation(req, res, next);
});

// Password submissions are additionally capped per mailbox on top of the
// per-IP limiter above, since this is now a credential-stuffing surface.
router.post("/login", workspaceMemberLoginLimiter, (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Login as workspace member'
  */
  controller.loginMember(req, res, next);
});

module.exports = router;
