const Joi = require('joi');

const supportedPlatforms = [
  'youtube',
  'facebook',
  'instagram',
  'linkedin',
  'gdn',
  'pinterest',
  'reddit',
];
const platformList = Joi.string().custom((value, helpers) => {
  const platforms = value
    .split(',')
    .map((platform) => platform.trim().toLowerCase())
    .filter(Boolean);

  if (
    platforms.length === 0 ||
    platforms.length > supportedPlatforms.length ||
    platforms.some((platform) => !supportedPlatforms.includes(platform))
  ) {
    return helpers.message({ custom: '"platform" contains an unsupported platform' });
  }

  return [...new Set(platforms)].join(',');
}, 'comma-separated platform validation');

const getCompetitorAdsQuery = Joi.object({
  platform: Joi.alternatives().try(
    platformList,
    Joi.array().items(
      Joi.string().valid(...supportedPlatforms)
    ).max(supportedPlatforms.length)
  ).optional(),
  category: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  categoryId: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  subCategoryId: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(24),
  sort: Joi.string().valid('newest', 'oldest').default('newest'),
  search: Joi.string().trim().max(120).allow('').optional(),
  searchType: Joi.string().valid('competitor', 'keyword').default('competitor'),
});

const searchCompetitorAdsQuery = getCompetitorAdsQuery.keys({
  search: Joi.string().trim().min(1).max(120).required(),
});

const validateCompetitorAdsQuery = (req, res, next) => {
  const { error, value } = getCompetitorAdsQuery.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid competitor ads filters',
      details: error.details.map((detail) => detail.message),
    });
  }

  req.query = value;
  return next();
};

const validateCompetitorAdsSearchQuery = (req, res, next) => {
  const { error, value } = searchCompetitorAdsQuery.validate(req.query, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return res.status(400).json({
      message: 'Invalid competitor ads search',
      details: error.details.map((detail) => detail.message),
    });
  }

  req.query = value;
  return next();
};

module.exports = {
  getCompetitorAdsQuery,
  searchCompetitorAdsQuery,
  validateCompetitorAdsQuery,
  validateCompetitorAdsSearchQuery,
};
