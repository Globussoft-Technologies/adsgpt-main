const TRENDING = require("../Module/adCopy/trendingModel");

exports.createTrendingTopic = async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic)
      return res
        .status(400)
        .json({ error: "Topic is required", success: false });
    const newTopic = new TRENDING({
      topic,
    });
    await newTopic.save();
    return res.status(201).json({
      message: "Trending topic created successfully",
      success: true,
      data: newTopic,
    });
  } catch (error) {
    console.error("Error creating trending topic:", error);
    return res.status(500).json({ message: error, success: false });
  }
};

exports.getTrendingTopics = async (req, res) => {
  try {
    const trendingTopics = await TRENDING.aggregate([{ $sample: { size: 3 } }]);
    return res.status(200).json({
      data: trendingTopics,
      success: true,
      message: "Fetched trending topics successfully",
    });
  } catch (error) {
    console.error("Error fetching trending topics:", error);
    return res.status(500).json({ message: error, success: false });
  }
};
