const express = require("express");

const avatarController = require("../controllers/avatarController");
const router = express.Router();

router.post("/", avatarController.addAvatars);
router.get("/", avatarController.getAllAvatars);
router.get("/:id", avatarController.getAvatarById);
router.put("/:id", avatarController.editAvatarById);
router.delete("/:id", avatarController.deleteAvatarById);

module.exports = router;
