const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DataSchema = new Schema({
  chatId: { type: String, required: false },
  message: { type: String, required: false },
  timestamp: { type: String, required: false },
  responseBy: { type: String, required: false },
  isFinalResponse: { type: Boolean, required: false },
  chatAdsData: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  }
}, { _id: false });

const ChatSessionSchema = new Schema({
  sessionId: { type: String, required: true },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  lastUpdateTime: { type: Date, required: false } // Track the last update time of the session
}, { _id: false });

// User Schema
const UserSchema = new Schema({
  uid: { type: String, required: true, unique: true },
  username: { type: String, required: false },
  currentPlan: { type: String, required: true }, // Add currentPlan to hold the user's subscription plan
  chat_sessions: [ChatSessionSchema]
});

module.exports = mongoose.model('Chats', UserSchema);

