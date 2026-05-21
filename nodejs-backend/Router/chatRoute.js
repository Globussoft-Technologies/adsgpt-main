const express = require("express"); 
//const ChatForwordControll = require("../Controller/Chats")
const draftForwardControll = require("../controllers/Chats")
const router = express.Router();

//router.get("/",ChatForwordControll.getChats)

router.get('/get-chat/:uid', draftForwardControll.getChatById).post("/create-chat/",draftForwardControll.createChat )
router.get('/chat-title/:uid' , draftForwardControll.getChatsByResponder)
router.get('/chat-history/:uid/:sessionId' , draftForwardControll.getMessagesBySession)
router.get('/chat-history-delete/:uid', draftForwardControll.deleteByUid)
router.get('/session-history-delete', draftForwardControll.deleteChatByUidAndSessionId);
router.post("/chat-history-save", draftForwardControll.createChatHistory)
router.get('/get-chat-message/:uid', draftForwardControll.getChatsMessageById)
module.exports = router;