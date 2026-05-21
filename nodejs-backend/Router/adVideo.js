const express = require("express"); 
const adVideoForwardController = require("../controllers/adVideo")
const router = express.Router();

router.get('/advideo-history-title/:uid' , adVideoForwardController.getAdvideoChatsByResponder)
router.delete('/advideo-history-delete/:uid', adVideoForwardController.deleteAdvideoByUid);
router.delete('/advideo-session-history-delete/:uid/:sessionId', adVideoForwardController.deleteAdvideoChatByUidAndSessionId);
router.get('/advideo-history/:uid/:sessionId' , adVideoForwardController.getAdvideoMessagesBySession);
router.post("/advideo-history-save", adVideoForwardController.createAdvideoChat);
router.get('/analyze-url', adVideoForwardController.analyzeUrl);

module.exports = router;