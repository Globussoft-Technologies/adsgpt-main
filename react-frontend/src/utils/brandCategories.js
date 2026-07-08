// The 45 canonical brand/industry categories, derived from the shared
// category taxonomy (src/data/categoryStructure.json). Kept in sync with the
// backend utils/categoryTaxonomy.js — both originate from the same 45 top-level
// categories. Used by the BrandIQ add/edit forms' Category picker and to
// validate a DS/analyze-supplied category before prefilling it.
import categoryStructure from '@/data/categoryStructure.json';

export const BRAND_CATEGORIES = Object.keys(categoryStructure).sort();

export function isValidBrandCategory(name) {
  return typeof name === 'string' && BRAND_CATEGORIES.includes(name);
}
