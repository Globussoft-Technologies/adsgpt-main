const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const advertiserSearchSchema = new Schema({
    advertiserName : { type: String, required: true },
    networks: {
        google: { type: Boolean, default: false },
        youtube: { type: Boolean, default: false },
        instagram: { type: Boolean, default: false },
        facebook: { type: Boolean, default: false },
        pinterest: { type: Boolean, default: false }
    },
    relevantNetworks: {
        google: { type: Boolean, default: null },
        youtube: { type: Boolean, default: null },
        instagram: { type: Boolean, default: null },
        facebook: { type: Boolean, default: null },
        pinterest: { type: Boolean, default: null }
    },
    status : {type : Number , default: 0}
})

module.exports = mongoose.model('advertiserSearch', advertiserSearchSchema);

