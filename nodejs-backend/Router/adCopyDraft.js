const express = require("express"); 
const draftForwardControll = require("../controllers/AdsCopyDraftRedis")
const router = express.Router();

router.post('/', draftForwardControll.createDraft)
router.get('/:uid', draftForwardControll.getDraftData)
router.delete('/delete-draft/:uid',draftForwardControll.deleteDraft)

module.exports = router;