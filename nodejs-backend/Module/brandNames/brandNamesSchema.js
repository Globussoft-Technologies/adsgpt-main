const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Unique brandId
  brandName: { type: String, required: false },
  brandDescription: { type: String, required: false },
  logoUrl: { type: String, required: false }, // S3 URL for logo
  logoUrls: [{ type: String, required: false }],
  iconUrl: { type: String, required: false }, // S3 URL for logo
  // imageUrl: { type: String, required: false }, // S3 URL for product image
  imageUrls: [{ type: String, required: false }],
  websiteUrl: { type: String, required: false },
  instagramUrl: { type: String, required: false },
  facebookUrl: { type: String, required: false },
  linkedinUrl: { type: String, required: false },
  region: { type: String, default: null },
  audienceSuggestions: { type: Array, default: null },
  targetAudiences: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  campaignIds: {
    type: [mongoose.Types.ObjectId],   // metadata.campaignId from AdFactory
    default: [],
    index: true
  },
});

const brandListSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  brands: [brandSchema],
});

brandListSchema.set('versionKey', false);
brandSchema.set('versionKey', false);
const brandNameLists = mongoose.model('BrandsList', brandListSchema);

module.exports = brandNameLists;