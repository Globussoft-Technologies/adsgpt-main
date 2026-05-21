const express = require("express"); 
//const ChatForwordControll = require("../Controller/Chats")
const draftForwardControll = require("../controllers/draftRedis")
const router = express.Router();

//router.get("/",ChatForwordControll.getChats)

router.post('/', draftForwardControll.createDraft)
router.get('/:uid', draftForwardControll.getDraftData)
router.delete('/delete-draft/:uid',draftForwardControll.deleteDraft)

module.exports = router;