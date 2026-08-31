const express = require("express");
const controller = require("../controllers/workspace.controller");

const router = express.Router();

router.get("/", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'List all workspaces for current user'
  */
  controller.list(req, res, next);
});

router.post("/invitations", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Invite a member to the workspace'
  */
  controller.invite(req, res, next);
});

router.delete("/invitations/:invitationId", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Revoke a pending workspace invitation'
  */
  controller.revoke(req, res, next);
});

router.patch("/members/:membershipId", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Update workspace member role'
  */
  controller.update(req, res, next);
});

router.delete("/members/:membershipId", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Remove a member from the workspace'
  */
  controller.remove(req, res, next);
});

router.post("/:workspaceId/switch", (req, res, next) => {
  /* 
    #swagger.tags = ['Workspaces']
    #swagger.summary = 'Switch active workspace session'
  */
  controller.switchSession(req, res, next);
});

module.exports = router;
