const express = require("express"); 
//const ChatForwordControll = require("../Controller/Chats")
const faqController = require("../controllers/faq")
const router = express.Router();

router.post('/postdata', faqController.createFAQ);
router.get('/getdata/', faqController.getFAQs);
router.patch('/data/:id', faqController.updateFAQ);
router.delete('/data/:id', faqController.deleteFAQ);
module.exports = router;