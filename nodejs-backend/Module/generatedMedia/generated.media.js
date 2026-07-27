const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GeneratedMediaSchema = new Schema({
    userId: { type: String, required: true },
    //  user_name: { type: String, required: true },
    type: {
        type: String,
        enum: ["image", "video"],
        required: true
    },
    model: { type: String, required: true },
    // 'adCreative' = saved from socket (Python sends no tokens for this service)
    // 'adFactory'  = saved from /createUsage (Python sends tokens here)
    // 'adVideo'    = saved from socket for video generation
    source: { type: String, default: "" },
    credit_deduction: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    aspect_ratio: { type: String, default: "" },
    quality: { type: String, default: "" },
    image: { type: mongoose.Schema.Types.Mixed, default: "" },
    video: { type: mongoose.Schema.Types.Mixed, default: "" }
}, { timestamps: true });

GeneratedMediaSchema.index({ userId: 1 });
GeneratedMediaSchema.index({ userId: 1, source: 1 }); // for source-based cost queries

module.exports = mongoose.model('generatedMedia', GeneratedMediaSchema);
