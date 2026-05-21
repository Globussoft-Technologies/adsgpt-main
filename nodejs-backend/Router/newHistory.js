const express = require("express");
const {
  createHistory,
  getHistoryBySessionId,
  getSidebarTitles,
  updateAdCopyConversationMessage,
  deleteImage,
  updateAdCreativeConversationMessage,
  updateCreativeFields,
  updateAdVideoConversationMessage,
  deleteHistoryBySessionId
} = require("../controllers/newHistory");
const router = express.Router();

router.route("/").post(createHistory);
router.route("/get-titles").post(getSidebarTitles);
router.route("/update-adcopy-data").post(updateAdCopyConversationMessage);
router
  .route("/update-adcreative-data")
  .post(updateAdCreativeConversationMessage);
router.route("/update-creative-fields").post(updateCreativeFields);
router.delete("/delete-image", deleteImage);
router.route("/:sessionId").get(getHistoryBySessionId).delete(deleteHistoryBySessionId)
router
  .route("/update-advideo-data")
  .post(updateAdVideoConversationMessage);
module.exports = router;
