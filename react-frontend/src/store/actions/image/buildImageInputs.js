// Variant → request body mapper for POST /image/generate.
//
// The image generation API is a single endpoint with a discriminated body
// shape (one shape per `type`). Centralising every variant's payload here
// keeps the components clean — they just hand the mapper their form state
// and forget the wire format.
//
// Currently implemented:
//   - ai_ads
//   - lifestyle
//   - product_shot
//   - apps_saas
//   - brand_awareness
//
// IMPORTANT: field names below match the backend contract verbatim.
// Do not "fix" the casing — `Model`, `ReferenceImages`, `userPrompt`,
// `aspectRatioPerImage` are the exact keys the API expects.

// ── helpers ─────────────────────────────────────────────────────────────

// Convert the form's aspectCounts object into the API's array shape.
//   { '1:1': 2, '9:16': 1, '16:9': 0 }
//     ⇒ [{ aspectRatio: '1:1', numberOfImages: 2 }, { aspectRatio: '9:16', numberOfImages: 1 }]
// Zero-count entries are dropped so we never send 0-image requests.
function aspectCountsToArray(counts) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .map(([aspectRatio, numberOfImages]) => ({
      aspectRatio,
      numberOfImages: Number(numberOfImages),
    }));
}

// ── main entry point ─────────────────────────────────────────────────────

/**
 * Build the POST /image/generate request body for a given variant.
 *
 * @param {'ai_ads' | 'lifestyle' | 'product_shot' | 'apps_saas' | 'brand_awareness'} variant
 * @param {object} form  Variant-specific form state. See per-branch comments.
 * @returns {object}     The full request body (no outer `inputs` wrapper).
 */
export function buildImageInputs(variant, form) {
  switch (variant) {
    // ── AI Ads ────────────────────────────────────────────────────────
    //
    // Expected `form` shape:
    //   {
    //     // brand
    //     brandName, brandDescription, brandLogo, brandImages, brandColors,
    //     // user inputs
    //     userPrompt, referenceImages, competitorReferenceImage,
    //     aspectCounts: { '1:1': 2, ... },
    //     model,
    //   }
    case 'ai_ads':
      return {
        type: 'ai_ads',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          ReferenceImages: Array.isArray(form.referenceImages) ? form.referenceImages : [],
          competitorReferenceImage: form.competitorReferenceImage || '',
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };

    // ── Lifestyle ─────────────────────────────────────────────────────
    //
    // Expected `form` shape:
    //   {
    //     // brand
    //     brandName, brandDescription, brandLogo, brandImages, brandColors,
    //     // user inputs
    //     userPrompt, productDescription,
    //     modelDescriptionFields: {
    //       age, gender, language, ethnicity, mood, wardrobe,
    //       modelReferenceImages: [...]
    //     },
    //     keyVisuals: [...],
    //     aspectCounts: { '1:1': 1, '9:16': 1, ... },
    //     model,
    //   }
    case 'lifestyle': {
      const md = form.modelDescriptionFields || {};
      return {
        type: 'lifestyle',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          productDescription: (form.productDescription || '').trim(),
          modelDescription: {
            age: md.age || '',
            gender: md.gender || '',
            language: md.language || '',
            ethnicity: md.ethnicity || '',
            mood: md.mood || '',
            wardrobe: md.wardrobe || '',
            modelReferenceImages: Array.isArray(md.modelReferenceImages)
              ? md.modelReferenceImages
              : [],
          },
          keyVisuals: Array.isArray(form.keyVisuals) ? form.keyVisuals : [],
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };
    }

    // ── Product Shot ──────────────────────────────────────────────────
    //
    // Expected `form` shape:
    //   {
    //     // brand
    //     brandName, brandDescription, brandLogo, brandImages, brandColors,
    //     // user inputs
    //     userPrompt, productName, productDescription,
    //     productImages: [...],
    //     aspectCounts: { '1:1': 1, ... },
    //     model,
    //   }
    case 'product_shot':
      return {
        type: 'product_shot',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          productName: (form.productName || '').trim(),
          productDescription: (form.productDescription || '').trim(),
          productImages: Array.isArray(form.productImages) ? form.productImages : [],
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };

    // ── Apps / SaaS ───────────────────────────────────────────────────
    //
    // Same payload shape as product_shot — productImages typically holds
    // app screenshots / device mockups instead of product photos.
    case 'apps_saas':
      return {
        type: 'apps_saas',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          productName: (form.productName || '').trim(),
          productDescription: (form.productDescription || '').trim(),
          productImages: Array.isArray(form.productImages) ? form.productImages : [],
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };

    // ── Brand Awareness ───────────────────────────────────────────────
    //
    // Same payload shape as product_shot / apps_saas. Identity-first ads
    // typically leave productName / productDescription / productImages
    // empty and rely on brand colors + the prompt for direction.
    case 'brand_awareness':
      return {
        type: 'brand_awareness',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          productName: (form.productName || '').trim(),
          productDescription: (form.productDescription || '').trim(),
          productImages: Array.isArray(form.productImages) ? form.productImages : [],
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };

    // ── Recreate Ads ──────────────────────────────────────────────────
    //
    // Used by the AdLibrary RecreateAdModal — the source ad's image goes
    // into `competitorReferenceImage`. Form shape:
    //   {
    //     // brand
    //     brandName, brandDescription, brandLogo, brandImages, brandColors,
    //     // user inputs
    //     userPrompt, referenceImages, competitorReferenceImage,
    //     aspectCounts: { '1:1': 1, ... },
    //     model,
    //   }
    case 'recreate_ads':
      return {
        type: 'recreate_ads',
        brandInfo: {
          brandName: form.brandName || '',
          brandDescription: form.brandDescription || '',
          brandLogo: form.brandLogo || '',
          brandImages: Array.isArray(form.brandImages) ? form.brandImages : [],
          brandColors: Array.isArray(form.brandColors) ? form.brandColors : [],
        },
        userInputs: {
          userPrompt: (form.userPrompt || '').trim(),
          ReferenceImages: Array.isArray(form.referenceImages) ? form.referenceImages : [],
          competitorReferenceImage: form.competitorReferenceImage || '',
          aspectRatioPerImage: aspectCountsToArray(form.aspectCounts),
          Model: form.model || 'gemini-3.1-flash-image-preview',
          quality: form.quality || 'high',
        },
      };

    default:
      throw new Error(`buildImageInputs: unknown variant "${variant}"`);
  }
}
