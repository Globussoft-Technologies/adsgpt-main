const mongoose = require('mongoose');

const dataSchema = new mongoose.Schema({
  conversesion: { type: [mongoose.Schema.Types.Mixed], required: false },
}, { _id: false });

const mainSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  sessionId: {type: String, required: false},
  updatedTime: { type: Date, required: false },
  data: { type: dataSchema, required: false }
}, { collection: 'AdCopyDraftData' });

module.exports = mongoose.model('AdCopyDraftData', mainSchema);