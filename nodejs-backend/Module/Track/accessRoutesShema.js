const mongoose = require("mongoose");

const RouteSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  routes: [
    {
      date: { type: String, required: true }, // e.g., 'YYYY-MM-DD'
      paths: [
        {
          route: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
          device: {
            screenWidth: { type: Number, required: true },
            deviceType: { type: String, required: false },
            screenHeight: { type: Number, required: true },
            userAgent: { type: String, required: true },
            platform: { type: String, required: true },
            language: { type: String, required: true },
            ip: { type: String, required: true },
            deviceModel: { type: String, required: false }
          }
        }
      ]
    }
  ]
});
RouteSchema.set('versionKey', false);

module.exports = mongoose.model('Access_Routes', RouteSchema);
