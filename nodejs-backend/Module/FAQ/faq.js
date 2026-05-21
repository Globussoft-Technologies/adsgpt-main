const { number } = require('joi');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const faqSchema = new Schema({
    faqId: {
        type: Number,
        required: true,
        unique: true
      },
  question: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { versionKey: '__v' },{_id: false});

faqSchema.pre('save', function (next) {
  if (this.isNew) {
    this.createdAt = Date.now();
  }
  this.updatedAt = Date.now();
  next();
});

faqSchema.pre('updateOne', function (next) {
  this.set({ updatedAt: Date.now() });
  next();
});

faqSchema.post('save', function (error, doc, next) {
  if (error.name === 'VersionError') {
    next(new Error('Conflict error: Document was modified by another process.'));
  } else {
    next(error);
  }
});

const FAQ = mongoose.model('FAQ', faqSchema);

module.exports = FAQ;
