const express = require("express"); 
const { createTrendingTopic, getTrendingTopics } = require("../controllers/trending");
const router = express.Router();

router.route("/").get(getTrendingTopics).post(createTrendingTopic);

module.exports = router;