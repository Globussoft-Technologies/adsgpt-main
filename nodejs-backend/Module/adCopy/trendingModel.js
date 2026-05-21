const mongoose = require('mongoose');

const trendingSchema = new mongoose.Schema({
    topic: {
        type: String,
        required: true,
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const trending = mongoose.model('Trending', trendingSchema);

module.exports = trending;
