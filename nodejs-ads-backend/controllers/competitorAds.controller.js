const { sendSuccessResponse, sendBadRequestResponse } = require('../utils/response');
const { searchAdsByKeywords } = require('../utils/competitorSearch');
const logger = require('./Loggers/logs');

/**
 * POST /api/v1/ads/search
 * Search competitor ads by keywords in PAS ElasticSearch.
 */
exports.searchCompetitorAds = async (req, res) => {
  try {
    const { keywords = [], competitors = [], platform = 'all', page = 1, limit = 500, sortBy = 'date', sortOrder = 'desc' } = req.body;

    const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
    const hasCompetitors = Array.isArray(competitors) && competitors.length > 0;
    if (!hasKeywords && !hasCompetitors) {
      return sendBadRequestResponse(res, 'At least one of keywords or competitors is required');
    }

    logger.info(`[searchCompetitorAds] Searching keywords: ${keywords.join(', ')}, competitors: ${competitors.join(', ')}, platform: ${platform}`);

    const ads = await searchAdsByKeywords(keywords, competitors, platform, page, limit, sortBy, sortOrder);

    return sendSuccessResponse(res, {
      success: true,
      total: ads.length,
      page,
      limit,
      data: ads,
    });
  } catch (error) {
    logger.error(`[searchCompetitorAds] Error: ${error.message}`);
    return sendBadRequestResponse(res, error.message);
  }
};
