const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/adFactory/adFactoryBriefController");
const actions = require("../../controllers/adFactory/adFactoryBriefActionsController");
const { authenticateJWT } = require("../../services/authService");
const { requireBasePlan } = require("../../middlewares/requireBasePlan");

// Ad Factory Quick setup — briefs.
//
// Plan gating follows v1's own line, not a new policy: `Router/adFactory.js`
// puts `requireBasePlan` on campaign create/update, i.e. on the paths that
// spend. Here that means GENERATE and ACTIVATE are gated and inference is not.
//
// Inference is deliberately ungated. It is the cheap half of the flow and the
// entire premise of Quick setup is value before commitment — a trial user who
// cannot even see what we'd make for them has no reason to buy. Generation has
// its own credit reserve on top (see controllers/adFactory.js), which is the
// real meter.

// The front door — one URL in, an inferred brief out. 202: inference continues
// in the background; subscribe to `adFactoryBriefReady` or poll GET /:id.
router.post("/", authenticateJWT, ctrl.createBrief);

// The zero-typing path, and the fallback whenever URL inference can't deliver.
router.post("/from-brand/:brandId", authenticateJWT, ctrl.createBriefFromBrand);

// Open a Full control campaign in Quick setup. Idempotent.
router.post("/adopt/:campaignId", authenticateJWT, ctrl.adoptCampaign);

// Actions. Declared before the bare `/:id` handlers so the more specific paths
// win, and kept as POSTs because each one creates or changes something.
router.post("/:id/generate", authenticateJWT, requireBasePlan, actions.generateFromBrief);
router.post("/:id/activate", authenticateJWT, requireBasePlan, actions.activateBrief);
router.get("/:id/timeline", authenticateJWT, actions.getBriefTimeline);

// Static routes before `/:id` so they can't be shadowed.
router.get("/", authenticateJWT, ctrl.listBriefs);
router.get("/:id", authenticateJWT, ctrl.getBrief);
router.patch("/:id", authenticateJWT, ctrl.updateBrief);
router.delete("/:id", authenticateJWT, ctrl.deleteBrief);

module.exports = router;
