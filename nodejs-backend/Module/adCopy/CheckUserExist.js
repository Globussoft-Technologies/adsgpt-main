const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const UserSchema = new Schema({
    userId: { type: String, required: true, unique: true },
    name: String,
    onboardingCompleted: { type: Boolean, default: false },
  });


module.exports = mongoose.model('checkUserExist', UserSchema);