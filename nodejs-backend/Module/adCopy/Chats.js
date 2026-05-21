const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatSessionSchema = new Schema({
  sessionId: { type: String, required: true },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  lastUpdateTime: { type: Date, required: false } // Track the last update time of the session
},
{ _id: false });

const UserSchema = new Schema({
    user_id: { type: String, required: true, unique: true },
//   username: { type: String, required: false },
  chat_sessions: [ChatSessionSchema]
}); // Single field index
UserSchema.index({ 'chat_sessions.sessionId': 1 }); // Nested field index
UserSchema.index({ user_id: 1, 'chat_sessions.sessionId': 1 }); // Compound index
module.exports = mongoose.model('adsCopyChats', UserSchema);

