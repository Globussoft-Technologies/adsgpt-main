const express = require("express"); 
const multer = require("multer");
const adCreativeForwardController = require("../controllers/adCreative")
const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get('/adcreative-history-title/:uid' , adCreativeForwardController.getAdCreativeChatsByResponder)
router.delete('/adcreative-history-delete/:uid', adCreativeForwardController.deleteAdsCreativeByUid);
router.delete('/adcreative-session-history-delete/:uid/:sessionId', adCreativeForwardController.deleteAdCreativeChatByUidAndSessionId);
router.get('/adcreative-history/:uid/:sessionId' , adCreativeForwardController.getAdCreativeMessagesBySession);
router.post("/adcreative-history-save", adCreativeForwardController.createAdCreativeChat);
router.patch("/adcreative-history-update", adCreativeForwardController.updateAdCreativeChatMessage);
router.post("/save-image", adCreativeForwardController.saveImage)
router.post("/save-edit-image", adCreativeForwardController.saveEditedImage)
router.get("/user-creatives/:id", adCreativeForwardController.getUserCreatives)
router.post("/creative-details", adCreativeForwardController.creativeDetails)
router.delete('/user-creatives', adCreativeForwardController.deleteCreative)
router.get('/get-creativechat-message/:uid', adCreativeForwardController.getChatsMessageById)
router.post("/upload-image", upload.single("file"), adCreativeForwardController.uploadImageFromFormData)
router.post("/upload-logo", upload.single("file"), adCreativeForwardController.uploadLogoFromSideBarData)
router.post("/upload-video", upload.single("file"), adCreativeForwardController.uploadVideoFromData)

module.exports = router;