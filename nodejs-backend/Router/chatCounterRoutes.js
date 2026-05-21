const express = require('express');
const router = express.Router();
const { initCount,saveVideo,getVideo } = require('../controllers/Redis/chatCounterController');

/**
 * @api {post} /api/chat-counters Initialize chat counters
 * @apiDescription Sets up ChatCountAdsCopy, ChatCountAdsCreative, and ChatCountDashboard for a new user.
 * @apiBody {String} uid User ID
 * @apiBody {String} subscriptionTypeKey Subscription tier (e.g., "premium")
 * @apiBody {String} subscriptionTypeValue Expiry date (YYYY-MM-DD)
 */
router.post('/chat-init',initCount);
router.post("/video/save", saveVideo);
// Get video (GET request with key)
router.get("/video/:key", getVideo);

module.exports = router;