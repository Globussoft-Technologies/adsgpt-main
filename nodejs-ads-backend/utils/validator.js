const Joi = require("joi");

// nerPayload validator
exports.nerPayloadValidator = (payload) => {
  const schema = Joi.object()
    .keys({
      uid: Joi.string().required(),
      chatId: Joi.string().empty(""),
      // sessionId: Joi.string().required(),
    })
    .unknown(true);
  return schema.validate(payload);
};
