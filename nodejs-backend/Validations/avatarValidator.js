const Joi = require("joi");

const avatarSchema = Joi.object({
  age: Joi.string().required(),
  gender: Joi.string().required(),
  race: Joi.string().required(),
  industry: Joi.string().required(),
  outfit: Joi.string().required(),
  background: Joi.string().required(),
  lighting: Joi.string().required(),
  camera_distance: Joi.string().required(),
  expression: Joi.string().required(),
  aspect_ratio: Joi.string().required(),
  image_size: Joi.string().required(),
  s3_image_path: Joi.string().required(),
});

const bulkAvatarSchema = Joi.array().items(avatarSchema);

module.exports = {
  avatarSchema,
  bulkAvatarSchema,
};
