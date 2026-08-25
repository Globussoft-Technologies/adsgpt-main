const logger = require("../utils/logger");
const { getMySpaceImages } = require("../services/mySpace/mySpaceImagesService");

exports.getImages = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const result = await getMySpaceImages({
      userId,
      source: req.query.source,
      skip: req.query.skip,
      limit: req.query.limit,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      type: req.query.type,
      model: req.query.model,
      status: req.query.status,
    });

    return res.status(200).json({
      success: true,
      message: "My Space images fetched successfully",
      ...result,
    });
  } catch (error) {
    logger.error("Get My Space Images Error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Server error",
      error: error.message,
    });
  }
};
