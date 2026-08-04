require("dotenv").config();
const { fetchExploreAds } = require("../../services/adsSearch/elasticsearch");
const { sendBadRequestResponse } = require("../../utils/adsSearch/response");
const logger = require("../../utils/logger");

exports.getExploreAds = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const {
      from,
      size,
      networks,
      popularity,
      type,
      user_id,
      platform,
      competitor,
      searchType,
    } = req.body;
    const data = await fetchExploreAds(
      from,
      size,
      networks,
      popularity,
      type,
      token,
      user_id,
      platform,
      competitor,
      searchType,
    );
    const hasNotRelevantMessage = (arr) =>
      Array.isArray(arr) && arr.some((item) => item?.message?.includes("This is not relevant"));

    return res.status(200).json({
      message: hasNotRelevantMessage(data) ? "This is not relevant" : "Success",
      status: data?.status || 0,
      ads: hasNotRelevantMessage(data) ? [] : data,
    });
  } catch (error) {
    logger.error(error);
    return sendBadRequestResponse(res, error);
  }
};
