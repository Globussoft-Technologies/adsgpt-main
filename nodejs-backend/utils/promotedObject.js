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
 *   - product_set: { productSetId, pixelEventType? } (pixelId is NOT sent
 *     to Meta on this shape — see the case's docblock)
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
      // Meta's App Ads optimisation doc: "Set custom_event_type in the
      // promoted object to the app event you want to optimize when
      // configuring app event optimization." For Leads/APP and similar
      // Conversions-family cells, Meta demands a `custom_event_type` as
      // the "main conversion" (subcode 2446759) — but rejects pixel_id
      // on the same App-shaped promoted_object (subcode 1815229). The
      // resolution: include custom_event_type alone (no pixel_id) when
      // the cell collected a pixelEventType from the user.
      //
      // App Promotion's APP cell (which doesn't pass pixelEventType in
      // params) gets just the app fields — Meta accepts that path
      // because App Promotion isn't "Conversions-family."
      const { applicationId, objectStoreUrl, pixelEventType } = params || {};
      if (!applicationId || !objectStoreUrl) {
        throw new Error(
          "buildPromotedObject('app'): applicationId + objectStoreUrl are both required",
        );
      }
      const obj = {
        application_id: applicationId,
        object_store_url: objectStoreUrl,
      };
      if (pixelEventType) obj.custom_event_type = pixelEventType;
      return obj;
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
      // Sales/CATALOG (Dynamic Product Ads). Real hit (2026-07-07,
      // subcode 1885014 "Promoted Object Invalid — invalid combination of
      // parameters"): the previous shape sent `{ pixel_id, product_set_id }`
      // on the (incorrect, never-verified-live) assumption that Meta pairs
      // the Pixel directly with the product_set here. Meta's own
      // `promoted_object` reference documents exactly two valid
      // combinations for PRODUCT_CATALOG_SALES: `product_set_id` alone, or
      // `product_set_id` + `custom_event_type` — `pixel_id` isn't a valid
      // field on this shape at all. Conversion tracking for DPA comes from
      // the Catalog's own connected pixel (set up in Commerce Manager),
      // not from an ad-set-level `promoted_object.pixel_id`. We still
      // collect `pixelId` from the wizard's Catalog step (it's what
      // populates the pixelEventType picker via getPixelEvents), but never
      // forward it to Meta here.
      const { productSetId, pixelEventType } = params || {};
      if (!productSetId) {
        throw new Error(
          "buildPromotedObject('product_set'): productSetId is required",
        );
      }
      const obj = { product_set_id: productSetId };
      if (pixelEventType) obj.custom_event_type = pixelEventType;
      return obj;
    }

    default:
      throw new Error(`buildPromotedObject: unknown shape "${shape}"`);
  }
}

module.exports = { buildPromotedObject };
