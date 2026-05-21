const Joi = require('joi');

// Define Joi schema for DataSchema
const DataSchemaJoi = Joi.object({
  chatId: Joi.string().optional(),
  message: Joi.string().optional(),
  timestamp: Joi.string().optional(),
  responseBy: Joi.string().optional(),
  isFinalResponse: Joi.boolean().optional()
});

// Define Joi schema for ChatRoomSchema
const ChatRoomSchemaJoi = Joi.object({
  roomName: Joi.string().optional(),
  room_Id: Joi.alternatives().try(Joi.string(), Joi.number()).optional(),
  data: Joi.array().items(DataSchemaJoi).optional()
});

// Define Joi schema for UserSchema
const UserSchemaJoi = Joi.object({
  uid: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  username: Joi.string().allow('').optional(),
  chat_room: Joi.array().items(ChatRoomSchemaJoi).optional()
});

async function validateData(data) {
    return UserSchemaJoi.validate(data);
  }

module.exports = validateData