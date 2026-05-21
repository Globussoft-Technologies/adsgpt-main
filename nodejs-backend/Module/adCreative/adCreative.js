const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ChatSessionSchema = new Schema({
  sessionId: { type: String, required: true },
  adsData: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
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
  
}
);

UserSchema.set('versionKey', false);

module.exports = mongoose.model('adsCreativeChats', UserSchema);