const Joi = require('joi');

const draftSchema = Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
    network: Joi.string().optional(),
    postOwner: Joi.string().optional(),
    postOwnerImage: Joi.string().optional(),
    postImage: Joi.string().optional(),
    adUrl: Joi.string().allow('').optional(),
    description: Joi.string().allow('').optional(),
    adType: Joi.string().optional()
});

const cardSchema = Joi.object({
    caption: Joi.string().optional(),
    value: Joi.number().optional()
});

const currentContextSchema = Joi.object({
    uid: Joi.string().optional(),
    chatId: Joi.string().optional(),
    currentContext: Joi.string().optional(),
    contextId: Joi.string().optional(),
    errorMessage: Joi.string().optional()
});

const dataSchema = Joi.object({
    adsData: Joi.array().items(draftSchema).optional(),
    lineChart: Joi.any().optional(),
    pieChart: Joi.any().optional(),
    chatBot: Joi.array().items(Joi.any()).optional()
});

const mainSchema = Joi.object({
    uid: Joi.number().required(),
    username: Joi.string().optional(),
    updatedTime: Joi.date().optional(),
    currentContext: currentContextSchema.optional(),
    data: dataSchema.optional()
});



async function validate(data){
    const { error } = mainSchema.validate(data);
    if (error) {
      return error.details.map(detail => detail.message);
    }
    return null;
  };

module.exports = validate