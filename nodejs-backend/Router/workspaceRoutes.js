const express = require("express");
const controller = require("../controllers/workspace.controller");

const router = express.Router();

router.get("/", controller.list);
router.post("/invitations", controller.invite);
router.delete("/invitations/:invitationId", controller.revoke);
router.patch("/members/:membershipId", controller.update);
router.delete("/members/:membershipId", controller.remove);
router.post("/:workspaceId/switch", controller.switchSession);

module.exports = router;
