const GOOGLE_CTA_LABELS = {
  LEARN_MORE: 'Learn more',
  GET_QUOTE: 'Get quote',
  APPLY_NOW: 'Apply now',
  SIGN_UP: 'Sign up',
  CONTACT_US: 'Contact us',
  SUBSCRIBE: 'Subscribe',
  DOWNLOAD: 'Download',
  BOOK_NOW: 'Book now',
  SHOP_NOW: 'Shop now',
  BUY_NOW: 'Buy now',
  DONATE_NOW: 'Donate now',
  ORDER_NOW: 'Order now',
  PLAY_NOW: 'Play now',
  SEE_MORE: 'See more',
  START_NOW: 'Start now',
  VISIT_SITE: 'Visit site',
  WATCH_NOW: 'Watch now',
};

const BIDDING_LABELS = {
  MANUAL_CPC: 'Manual CPC',
  MANUAL_CPM: 'Manual CPM',
  MANUAL_CPV: 'Manual CPV',
  TARGET_CPA: 'Target CPA',
  TARGET_ROAS: 'Target ROAS',
  MAXIMIZE_CONVERSIONS: 'Maximize conversions',
  MAXIMIZE_CONVERSION_VALUE: 'Maximize conversion value',
  TARGET_SPEND: 'Maximize clicks',
  TARGET_IMPRESSION_SHARE: 'Target impression share',
  ENHANCED_CPC: 'Enhanced CPC',
  COMMISSION: 'Commission',
};

export const adCopyText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.text != null) return String(value.text);
  return '';
};

export const labelGoogleCTA = (value) => {
  if (!value) return null;
  const key = String(value).toUpperCase().replace(/ /g, '_');
  return GOOGLE_CTA_LABELS[key] || value;
};

export const labelGoogleBidding = (value) => {
  if (!value) return null;
  const key = String(value).toUpperCase();
  return BIDDING_LABELS[key] || String(value).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
};

export const labelGoogleBilling = (value) => value || null;

export const parseGoogleDate = (d) => {
  if (!d) return null;
  const s = String(d);
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export const formatGoogleDateDisplay = (d) => {
  const dt = parseGoogleDate(d);
  return dt ? dt.toLocaleDateString() : '—';
};

export const parseBudgetINR = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
  return Number.isNaN(n) ? null : n;
};

export const hasBudget = (v) => v != null && v !== '' && v !== '0' && v !== 0;

import { getGoogleWizardSchema } from '@/apis/googleAds/googleAdsApi';

// Module-level schema cache — fetched once, reused across opens
let _schemaCache = null;
let _schemaPromise = null;

export function fetchSchemaOnce() {
  if (_schemaCache) return Promise.resolve(_schemaCache);
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = getGoogleWizardSchema()
    .then((r) => {
      _schemaCache = r?.schema || null;
      return _schemaCache;
    })
    .catch((e) => {
      _schemaPromise = null;
      throw e;
    });
  return _schemaPromise;
}

export function getSchemaCache() {
  return _schemaCache;
}
