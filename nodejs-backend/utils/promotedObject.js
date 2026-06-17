/**
 * Builds the `promoted_object` field for a Meta AdSet, keyed by the
 * `promotedObjectShape` defined in `config/wizardSchema.js`.
 *
 * `promoted_object` tells Meta WHAT the AdSet is promoting — an app for
 * App Promotion, nothing for Traffic / Leads in V2's MVP scope. Phase 5
 * (tracking & measurement) will add `pixel` for Website Conversion Leads
 * + Sales-Website. Phase 2c (Sales-Catalogue) will add `product_set`.
 *
 * The shape strings are the contract between this module and
 * `wizardSchema.js` — adding a new shape requires touching both.
 */

/**
 * @param {string|null} shape  one of: null, "page", "app", "pixel",
 *   "product_set". `null` means the field is omitted on the AdSet
 *   payload (no promoted_object sent to Meta — used for cells where
 *   Meta infers from other signals, e.g. Engagement video/post-engagement).
 * @param {object} params     shape-specific inputs:
 *   - page:        { pageId }
 *   - app:         { applicationId, objectStoreUrl }
 *   - pixel:       { pixelId, pixelEventType }
 *   - product_set: { pixelId, productSetId }
 * @returns {object|undefined} the promoted_object payload, or undefined to
 *   signal "omit this field". Callers should `if (po) params.promoted_object
 *   = po;`.
 */
function buildPromotedObject(shape, params) {
  if (shape === null || shape === undefined) return undefined;

  switch (shape) {
    case "page": {
      // V1 set this for every adset regardless of objective. V2 mirrors
      // that for Traffic + Leads cells — Meta accepts it as the "page
      // being promoted" context. The actual IG identity lives on the
      // creative's object_story_spec, not here.
      const { pageId } = params || {};
      if (!pageId) {
        throw new Error("buildPromotedObject('page'): pageId is required");
      }
      return { page_id: pageId };
    }

    case "app": {
      const { applicationId, objectStoreUrl } = params || {};
      if (!applicationId || !objectStoreUrl) {
        throw new Error(
          "buildPromotedObject('app'): applicationId + objectStoreUrl are both required",
        );
      }
      return {
        application_id: applicationId,
        object_store_url: objectStoreUrl,
      };
    }

    case "pixel": {
      // For OFFSITE_CONVERSIONS optimisation: Meta needs to know which
      // pixel + which event counts as a conversion. Used by Leads/Sales
      // Website cells and the Leads Multiple cells.
      const { pixelId, pixelEventType } = params || {};
      if (!pixelId || !pixelEventType) {
        throw new Error(
          "buildPromotedObject('pixel'): pixelId + pixelEventType are both required",
        );
      }
      return {
        pixel_id: pixelId,
        custom_event_type: pixelEventType,
      };
    }

    case "product_set": {
      // Sales/CATALOG (Dynamic Product Ads). Meta pairs the Pixel with a
      // specific Product Set inside a Catalog — the Pixel identifies the
      // visitor/conversion stream and the product_set scopes which items
      // are eligible for display. Both are required by Meta; without
      // product_set_id the creative falls back to whole-catalog display
      // which the user didn't intend.
      const { pixelId, productSetId } = params || {};
      if (!pixelId || !productSetId) {
        throw new Error(
          "buildPromotedObject('product_set'): pixelId + productSetId are both required",
        );
      }
      return {
        pixel_id: pixelId,
        product_set_id: productSetId,
      };
    }

    default:
      throw new Error(`buildPromotedObject: unknown shape "${shape}"`);
  }
}

module.exports = { buildPromotedObject };
