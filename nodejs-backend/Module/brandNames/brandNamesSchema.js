const mongoose = require('mongoose');

// ── Sub-schemas for competitor ads feature ──────────────────────────────

const competitorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  domain: { type: String, default: null },
  relevanceScore: { type: Number, default: 0 },
  source: { type: String, default: 'gemini' }, // 'gemini' | 'manual'
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const keywordSchema = new mongoose.Schema({
  term: { type: String, required: true },
  category: { type: String, default: 'general' }, // 'brand' | 'product' | 'general' | 'intent'
  volume: { type: String, default: null },         // 'high' | 'medium' | 'low'
  source: { type: String, default: 'gemini' },
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const discoveryJobSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['PENDING', 'READY', 'EMPTY', 'FAILED'],
    default: 'PENDING',
  },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
  keywordVersion: { type: String, default: 'v1' },
}, { _id: false });

// Tracks the lazy category-classification job for a brand (existing brands
// only — new brands get their category from DS and skip this). PENDING guards
// against double-firing; startedAt drives stale detection; categoryVersion
// enables a forced re-classify via a version bump. See utils/categoryTaxonomy.js.
const categoryJobSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['PENDING', 'DONE', 'FAILED'],
    default: null,
  },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
  categoryVersion: { type: String, default: null },
}, { _id: false });

// ── Main brand schema ───────────────────────────────────────────────────

const brandSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Unique brandId
  brandName: { type: String, required: false },
  brandDescription: { type: String, required: false },
  logoUrl: { type: String, required: false }, // S3 URL for logo
  logoUrls: [{ type: String, required: false }],
  iconUrl: { type: String, required: false }, // S3 URL for logo
  imageUrls: [{ type: String, required: false }],
  websiteUrl: { type: String, required: false },
  instagramUrl: { type: String, required: false },
  facebookUrl: { type: String, required: false },
  linkedinUrl: { type: String, required: false },
  region: { type: String, default: null },
  audienceSuggestions: { type: Array, default: null },
  targetAudiences: { type: [String], default: [] },

  // ── Prompt-template category matching ────────────────────────────────
  // One of the 45 names in utils/categoryTaxonomy.js, or null if unknown /
  // not yet classified. Drives which prompt-template category is auto-shown
  // when this brand is selected in AdCreative.
  category: { type: String, default: null },
  categoryJob: { type: categoryJobSchema, default: null },
  // ─────────────────────────────────────────────────────────────────────
  createdAt: { type: Date, default: Date.now },
  campaignIds: {
    type: [mongoose.Types.ObjectId],   // metadata.campaignId from AdFactory
    default: [],
    index: true
  },

  // ── Competitor Ads Feature ───────────────────────────────────────────
  competitors: { type: [competitorSchema], default: [] },
  keywords: { type: [keywordSchema], default: [] },
  discoveryJob: { type: discoveryJobSchema, default: null },
  lastFetchedAt: { type: Date, default: null },
  // ─────────────────────────────────────────────────────────────────────
});

const brandListSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  brands: [brandSchema],
});

brandListSchema.set('versionKey', false);
brandSchema.set('versionKey', false);
const brandNameLists = mongoose.model('BrandsList', brandListSchema);

module.exports = brandNameLists;
