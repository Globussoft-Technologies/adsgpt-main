const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  uid: { type: Number, required: true },
  username: { type: String, required: false },
  chatId: { type: String, required: false },
  message: { type: String, required: false },
  timestamp: { type: String, required: false },
  responseBy: { type: String, required: false },
  isFinalResponse: { type: Boolean, required: false }
}, { _id: false });

const dataSchema = new mongoose.Schema({
  adsData: { type: [mongoose.Schema.Types.Mixed], required: false },
  lineChart: { type: mongoose.Schema.Types.Mixed, required: false },
  pieChart: { type: mongoose.Schema.Types.Mixed, required: false },
  chatBot: { type: [chatSchema], required: false }
}, { _id: false });

const currentContext = new mongoose.Schema({
  uid: { type: String, required: false },
  chatId: { type: String, required: false },
  currentContext: { type: Array, required: false },
  contextId: { type: String, required: false },
  errorMessage: { type: String, required: false }
}, { _id: false });

const mainSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  username: { type: String, required: false },
  sessionId: {type: String, required: false},
  updatedTime: { type: Date, required: false },
  currentContext: { type: currentContext, required: false },
  analyticsMidDescription: {type: String, required: false},
  AdvertiserTags:{type: [mongoose.Schema.Types.Mixed],required: false },
  data: { type: dataSchema, required: false }
}, { collection: 'drafts' });

module.exports = mongoose.model('DraftData', mainSchema);
