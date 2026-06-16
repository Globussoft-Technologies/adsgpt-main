const { sendSuccessResponse, sendBadRequestResponse } = require('../utils/response');
const { searchAdsByKeywords } = require('../utils/competitorSearch');
const logger = require('./Loggers/logs');

/**
 * POST /api/v1/ads/search
 * Search competitor ads by keywords in PAS ElasticSearch.
 */
exports.searchCompetitorAds = async (req, res) => {
  try {
    const {
      keywords = [], competitors = [], platform = 'all',
      page = 1, limit = 10, sortBy = 'date', sortOrder = 'desc',
      categoryId, subCategoryId, categoryIds, subCategoryIds, dateFrom, dateTo,
    } = req.body;

    const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
    const hasCompetitors = Array.isArray(competitors) && competitors.length > 0;
    if (!hasKeywords && !hasCompetitors) {
      return sendBadRequestResponse(res, 'At least one of keywords or competitors is required');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(limit, 10) || 10);

    logger.info(`[searchCompetitorAds] keywords=${keywords.length} competitors=${competitors.length} platform=${platform} page=${pageNum} size=${pageSize}`);

    const { ads, total, hasMore } = await searchAdsByKeywords(
      keywords, competitors, platform, pageNum, pageSize, sortBy, sortOrder,
      { categoryId, subCategoryId, categoryIds, subCategoryIds, dateFrom, dateTo }
    );

    return sendSuccessResponse(res, {
      success: true,
      total,
      hasMore,
      page: pageNum,
      limit: pageSize,
      data: ads,
    });
  } catch (error) {
    logger.error(`[searchCompetitorAds] Error: ${error.message}`);
    return sendBadRequestResponse(res, error.message);
  }
};
