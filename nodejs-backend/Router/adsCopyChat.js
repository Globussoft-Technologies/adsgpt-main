const express = require("express"); 
const adCopyForwardControll = require("../controllers/adCopy")
const router = express.Router();


// router.post("/create-chat/",adCopyForwardControll.createAdsCopyChat )
router.get('/chat-title/:uid' , adCopyForwardControll.getadsCopyChatsByResponder)
router.get('/chat-history/:uid/:sessionId' , adCopyForwardControll.getAdsCopyMessagesBySession)
router.delete('/chat-history-delete/:uid', adCopyForwardControll.deleteAdCopyByUid)
router.delete('/session-history-delete/:uid/:sessionId', adCopyForwardControll.deleteAdCopyChatByUidAndSessionId)
router.post("/chat-history-save", adCopyForwardControll.createAdsCopyChatHistory)
router.post("/check-user/:userId", adCopyForwardControll.checkUserExists)
router.get('/get-copychat-message/:uid', adCopyForwardControll.getChatsMessageById)

module.exports = router;