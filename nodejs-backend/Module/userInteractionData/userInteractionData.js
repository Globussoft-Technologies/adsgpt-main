const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const chatSchema = new mongoose.Schema({
  chatSessionId: { type: Schema.Types.Mixed, required: true },
  clicks: { type: Schema.Types.Mixed, default: [] },
  hover: { type: Schema.Types.Mixed, default: [] },
  copy: { type: Schema.Types.Mixed, default: [] },
  scroll: { type: Schema.Types.Mixed, default: [] },
  adImageGenerationReview:{ type: Schema.Types.Mixed, default: [] },
  adCopySide: { type: Schema.Types.Mixed, default: () => [] }, 
  adCreativeSide: { type: Schema.Types.Mixed, default: () => [] },
});

const pageLocationSchema = new mongoose.Schema({
  pageRedirectId: { type: String, required: true },
  enterTime: { type: String, required: true },
  path: { type: String, required: true },
  userId: { type: String, required: true },
  timestamp: { type: String, required: true },
});

const sessionSchema = new mongoose.Schema({
  sessionId: { type: Schema.Types.Mixed, required: true },
  pageLocation: { type: pageLocationSchema, default: null },
  chats: { type: [chatSchema], default: [] },
  sessionDate: { type: String, required: true }
});


const userSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  user_name: { type: String, required: true },
  user_email: { type: String, required: true },
  sessions: { type: [sessionSchema], default: [] }
}, { timestamps: true }); 


userSchema.set('versionKey', false);

const UserInteraction = mongoose.model('UserInteraction', userSchema);

module.exports = UserInteraction;

