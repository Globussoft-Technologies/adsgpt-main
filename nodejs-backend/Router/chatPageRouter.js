const express = require("express");
const {
  createSettings,
  getAllSettings,
  getSettings,
  updateSettings,
  deleteSettings,
} = require("../controllers/chatPage");
const router = express.Router();

router.route("/user/:user_id").get(getAllSettings);
router.route("/").post(createSettings);
router
  .route("/:id")
  .get(getSettings)
  .put(updateSettings)
  .delete(deleteSettings);

module.exports = router;
