const Joi = require('joi');

const getCompetitorAdsQuery = Joi.object({
  platform: Joi.alternatives().try(
    Joi.string().valid('meta', 'google', 'tiktok', 'youtube', 'facebook', 'instagram'),
    Joi.array().items(Joi.string().valid('meta', 'google', 'tiktok', 'youtube', 'facebook', 'instagram'))
  ).optional(),
  category: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(24),
  sort: Joi.string().valid('newest', 'oldest').default('newest'),
});

module.exports = { getCompetitorAdsQuery };
