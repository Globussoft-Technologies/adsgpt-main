import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { EMPTY_BRAND_IQ_RESPONSE } from './brandIqClient';
// Single-step flow: website / loading / brand-info screens are skipped — the
// AdSetupStep now collects brand voice inline. The components and their
// handlers below are intentionally commented out (not deleted) so we can
// restore the multi-step flow if product asks for it.
// import { fetchBrandIq } from './brandIqClient';
// import { WebsiteStep } from './steps/WebsiteStep';
// import { BrandInfoStep } from './steps/BrandInfoStep';
import { LoadingStep } from './steps/LoadingStep';
import { AdSetupStep } from './steps/AdSetupStep';
import { LifestyleResultsStep } from './steps/LifestyleResultsStep';
import { generateImageAction } from '@/store/actions/image/imageActions';
import { resetCurrent } from '@/store/reducers/image/imageSlice';
import { buildImageInputs } from '@/store/actions/image/buildImageInputs';
import { uploadToS3 } from '@/utils/imageUpload';
import { getUserId } from '../ai-creatives/apiClient';
// import { setFields as setBrandFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Walk a list of { file?, preview } items, push any uploads to S3 and
// substitute the hosted URL. URL pastes / brand-sourced items pass through.
async function resolveItems(items, userId) {
  if (!Array.isArray(items)) return [];
  const out = await Promise.all(
    items.map(async (it) => {
      if (it?.file) {
        const path = await uploadToS3(it.file, userId, true);
        return path ? `${S3_BASE_URL}${path}` : null;
      }
      return it?.preview || null;
    })
  );
  return out.filter(Boolean);
}

// Single-logo equivalent of resolveItems.
async function resolveLogo(item, userId) {
  if (!item) return '';
  if (item.file) {
    const path = await uploadToS3(item.file, userId, true);
    return path ? `${S3_BASE_URL}${path}` : '';
  }
  return item.preview || '';
}

const VARIANT_DEFAULT = 'lifestyle';

// AdCreativeNewLayout uses dashed route keys; the backend type field uses
// underscores. Map at dispatch time so the rest of the flow stays generic.
const VARIANT_TO_API_TYPE = {
  lifestyle: 'lifestyle',
  'product-shot': 'product_shot',
  'apps-saas': 'apps_saas',
  'brand-awareness': 'brand_awareness',
};

// Maps the UI model label to the backend model id at dispatch time so the
// picker text stays untouched. Mirrors the table in AiCreativesCustom.
const MODEL_TO_API = {
  'Nano Banana 2': 'gemini-3.1-flash-image-preview',
  'Nano Banana Pro': 'gemini-3-pro-image-preview',
  'OpenAI 1.5': 'gpt-image-1.5',
  'OpenAI 2.0': 'gpt-image-2',
  'Seedream 5.0 lite': 'seedream-5.0-lite',
};

// Translates a *resolved* AdSetup payload (where every image array has been
// replaced with hosted-URL strings) plus brandInfo into the variant-specific
// `form` shape that buildImageInputs expects.
function buildFormInputs(apiType, resolved, brandInfo, apiModel) {
  const brand = {
    brandName: brandInfo.brandName || '',
    brandDescription: brandInfo.brandDescription || '',
    brandLogo: resolved.brandLogo || brandInfo.brandLogoUrl || '',
    brandImages: Array.isArray(brandInfo.brandImages) ? brandInfo.brandImages : [],
    brandColors: Array.isArray(brandInfo.brandColors) ? brandInfo.brandColors : [],
  };

  if (apiType === 'lifestyle') {
    return {
      ...brand,
      userPrompt: resolved.instructions,
      productDescription: resolved.productDescription,
      modelDescriptionFields: {
        age: resolved.demographics?.age,
        gender: resolved.demographics?.gender,
        language: resolved.demographics?.language,
        ethnicity: resolved.demographics?.ethnicity,
        mood: resolved.demographics?.mood,
        wardrobe: resolved.demographics?.wardrobe,
        modelReferenceImages: resolved.modelReferenceImages || [],
      },
      keyVisuals: resolved.keyVisuals || [],
      aspectCounts: resolved.ratioCounts,
      model: apiModel,
      quality: resolved.quality,
    };
  }

  // product_shot, apps_saas, and brand_awareness all share the same payload
  // shape — the backend routes on the type discriminator. Brand awareness
  // typically ships with empty product fields (identity-first creative).
  if (
    apiType === 'product_shot' ||
    apiType === 'apps_saas' ||
    apiType === 'brand_awareness'
  ) {
    return {
      ...brand,
      userPrompt: resolved.instructions,
      productName: resolved.productName,
      productDescription: resolved.productDescription,
      productImages: resolved.productImages || [],
      aspectCounts: resolved.ratioCounts,
      model: apiModel,
      quality: resolved.quality,
    };
  }

  // Unknown variant — pass through whatever's available so the error surfaces
  // from the builder rather than from a missing-field crash here.
  return {
    ...brand,
    ...resolved,
    aspectCounts: resolved.ratioCounts,
    model: apiModel,
    quality: resolved.quality,
  };
}

// Pull a usable URL out of a backend result record regardless of which key
// the worker decided to use.
const pickImageUrl = (r) =>
  r?.generatedImageUrl ?? r?.url ?? r?.s3Url ?? r?.imageUrl ?? r?.s3_url ?? '';

export function LifestyleAdsFlow({ title, variant = VARIANT_DEFAULT, onClose, onComplete }) {
  const dispatch = useDispatch();
  const imageState = useSelector((s) => s.image.current);

  // Single-step flow: bypass website/loading/brand-info and land straight on
  // the ad-setup screen. AdSetupStep now owns the brand-voice picker, so we
  // seed `data` with an empty BrandIQ response and an empty brandInfo.
  const [state, setState] = useState({
    step: 'ad-setup',
    websiteUrl: '',
    data: EMPTY_BRAND_IQ_RESPONSE,
    brandInfo: {},
  });
  const autofillAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      autofillAbortRef.current?.abort();
      dispatch(resetCurrent());
    };
  }, [dispatch]);

  // Hand off to the parent (AdCreativeNewLayout) the moment the backend
  // acknowledges submission — it plays the genie animation and routes to
  // MySpace > Images. Fires once per submission cycle.
  const completeFiredRef = useRef(false);
  useEffect(() => {
    const handedOff =
      imageState.status === 'pending' || imageState.status === 'completed';
    if (state.step === 'submitted' && handedOff && !completeFiredRef.current) {
      completeFiredRef.current = true;
      onComplete?.();
    }
    if (imageState.status === 'idle' || imageState.status === 'submitting') {
      completeFiredRef.current = false;
    }
  }, [state.step, imageState.status, onComplete]);

  /* ── Multi-step handlers (commented out, retained for restore) ────────────
  const handleWebsiteSubmit = async (websiteUrl) => {
    autofillAbortRef.current?.abort();
    autofillAbortRef.current = new AbortController();
    setState({ step: 'loading', websiteUrl });

    try {
      const data = await fetchBrandIq(websiteUrl, autofillAbortRef.current.signal);
      // Sync redux brand_name to the fresh autofill BEFORE BrandInfoStep
      // mounts. BrandInfoStep treats redux.brand_name as the sole signal
      // for whether to seed local fields, so it must be set ahead of mount.
      dispatch(setBrandFields({ brand_name: data?.brandInfo?.brandName || '' }));
      setState({ step: 'brand-info', websiteUrl, data });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState({
        step: 'error',
        websiteUrl,
        message: err.message,
      });
    }
  };

  const handleEditWebsite = () => {
    autofillAbortRef.current?.abort();
    setState({ step: 'website' });
  };

  const handleAddManually = () => {
    autofillAbortRef.current?.abort();
    const websiteUrl = state.step === 'error' || state.step === 'loading' ? state.websiteUrl : '';
    // Skip / manual path: wipe every redux field that BrandInfoStep watches
    // — brand_name AND selectedBrand. If selectedBrand still has an id from
    // a previous BrandIQ pick, the brand-info step's `selectedBrand?.id`
    // effect would immediately re-fill the form from that stale record.
    dispatch(
      setBrandFields({
        brand_name: '',
        selectedBrand: {},
        brand_description: '',
        brand_logo: '',
      }),
    );
    setState({
      step: 'brand-info',
      websiteUrl,
      data: EMPTY_BRAND_IQ_RESPONSE,
    });
  };

  const handleBrandInfoConfirm = (brandInfo) => {
    if (state.step !== 'brand-info') return;
    setState({
      step: 'ad-setup',
      websiteUrl: state.websiteUrl,
      data: state.data,
      brandInfo,
    });
  };
  ─────────────────────────────────────────────────────────────────────── */

  const handleAdSetupConfirm = async (adSetup) => {
    if (state.step !== 'ad-setup') return;
    // BrandInfoStep is bypassed — AdSetupStep now ships brandInfo inline via
    // the brand-voice picker. Fall back to whatever's on `state` for safety.
    const brandInfo = adSetup.brandInfo || state.brandInfo || {};
    const { websiteUrl, data } = state;

    // Clear any prior session, then move into the submitted step where the
    // generating / results / failure UI is driven entirely by image.current.
    dispatch(resetCurrent());
    setState({ step: 'submitted', websiteUrl, data, brandInfo, adSetup });

    // Push every locally-uploaded file to S3 first so the request body only
    // contains hosted URLs. Items with file=null (URL paste / brand-sourced)
    // pass through unchanged. The loader screen is the upload indicator —
    // we deliberately don't show a toast.
    let resolved;
    try {
      const uid = getUserId();
      const [modelRefUrls, keyVisualUrls, productUrls, logoUrl] = await Promise.all([
        resolveItems(adSetup.modelReferenceImages, uid),
        resolveItems(adSetup.keyVisuals, uid),
        resolveItems(adSetup.productImages, uid),
        resolveLogo(adSetup.brandLogo, uid),
      ]);
      resolved = {
        ...adSetup,
        modelReferenceImages: modelRefUrls,
        keyVisuals: keyVisualUrls,
        productImages: productUrls,
        brandLogo: logoUrl,
      };
    } catch (err) {
      toast.error(err?.message || 'Image upload failed');
      setState({ step: 'ad-setup', websiteUrl, data, brandInfo });
      return;
    }

    const apiModel = MODEL_TO_API[adSetup.model] || adSetup.model;
    const apiType = VARIANT_TO_API_TYPE[variant] || 'lifestyle';
    const body = buildImageInputs(apiType, buildFormInputs(apiType, resolved, brandInfo, apiModel));

    try {
      await dispatch(generateImageAction(body));
      // status / result are now reflected in imageState.
    } catch {
      // submitFailed already dispatched by the thunk → imageState.error is set.
    }
  };

  const handleResultsBack = () => {
    dispatch(resetCurrent());
    setState({
      step: 'ad-setup',
      websiteUrl: state.websiteUrl,
      data: state.data,
      brandInfo: state.brandInfo,
    });
  };

  // Submitted step: render generating / results / failure based on the slice.
  if (state.step === 'submitted') {
    if (
      imageState.status === 'idle' ||
      imageState.status === 'submitting' ||
      imageState.status === 'pending' ||
      // When a parent owns the handoff (genie → MySpace), keep the loader on
      // screen during 'completed' too — the parent will navigate away shortly
      // and there's no point flashing the inline results step.
      (onComplete && imageState.status === 'completed')
    ) {
      return (
        <LoadingStep
          title={title}
          label="Generating your ads…"
          onCancel={() => {
            dispatch(resetCurrent());
            setState({
              step: 'ad-setup',
              websiteUrl: state.websiteUrl,
              data: state.data,
              brandInfo: state.brandInfo,
            });
          }}
        />
      );
    }
    if (imageState.status === 'completed') {
      const images = (imageState.result?.results || [])
        .map((r) => ({ url: pickImageUrl(r), prompt: r?.prompt ?? '' }))
        .filter((img) => img.url);

      // Fallback for a single-image response that only populates `url`.
      if (images.length === 0 && imageState.result?.url) {
        images.push({ url: imageState.result.url, prompt: '' });
      }

      if (images.length > 0) {
        return (
          <LifestyleResultsStep
            title={title}
            images={images}
            taskId={imageState.sessionId}
            aspectRatio={state.adSetup.aspectRatio}
            onBack={handleResultsBack}
            onClose={onClose}
          />
        );
      }
      // Completed but empty — drop back to ad-setup with a message.
    }
  }

  switch (state.step) {
    /* ── Skipped screens — preserved for restore ──────────────────────────
    case 'website':
      return (
        <WebsiteStep
          title={title}
          onSubmit={handleWebsiteSubmit}
          onSkip={handleAddManually}
          onClose={onClose}
        />
      );
    case 'loading':
      return <LoadingStep websiteUrl={state.websiteUrl} onCancel={handleEditWebsite} />;
    case 'brand-info':
      return (
        <BrandInfoStep
          data={state.data}
          title={title}
          onBack={handleEditWebsite}
          onClose={onClose}
          onConfirm={handleBrandInfoConfirm}
          onSkip={() => handleBrandInfoConfirm(synthesizeBrandInfoFromAutofill(state.data))}
        />
      );
    ──────────────────────────────────────────────────────────────────── */
    case 'ad-setup':
    case 'submitted': {
      // Submitted but failed / empty results → render ad-setup with the error.
      const failureMessage =
        state.step === 'submitted'
          ? imageState.status === 'failed'
            ? imageState.error || 'Generation failed.'
            : imageState.status === 'completed'
              ? 'No images returned.'
              : null
          : null;
      return (
        <AdSetupStep
          data={state.data}
          brandInfo={state.brandInfo}
          websiteUrl={state.websiteUrl}
          title={title}
          variant={variant}
          onClose={onClose}
          // No `onBack` — AdSetupStep is the only step now. Passing undefined
          // hides the back arrow inside the step.
          onConfirm={handleAdSetupConfirm}
          onSkip={onClose}
          errorMessage={failureMessage}
          onDismissError={() => {
            dispatch(resetCurrent());
            setState({
              step: 'ad-setup',
              websiteUrl: state.websiteUrl,
              data: state.data,
              brandInfo: state.brandInfo,
            });
          }}
        />
      );
    }
    /* ── 'error' screen retired with the website step ────────────────────
    case 'error':
      return (
        <WebsiteStep
          title={title}
          initialUrl={state.websiteUrl}
          errorMessage={state.message}
          onSubmit={handleWebsiteSubmit}
          onAddManually={handleAddManually}
          onClose={onClose}
        />
      );
    ───────────────────────────────────────────────────────────────────── */
    default:
      return null;
  }
}

/* ── Retained for restore — used by the BrandInfoStep skip path ──────────
function synthesizeBrandInfoFromAutofill(data) {
  return {
    brandName: data.brandInfo.brandName,
    brandDescription: data.brandInfo.brandDescription,
    promotionalInfo: '',
    brandLogoUrl: data.brandInfo.brandLogo[0] ?? '',
    brandColors: data.brandInfo.brandGuidelines.colorPalette.slice(0, 6),
    brandImages: data.brandInfo.brandImages.slice(0, 1),
    selectedPlatforms: ['facebook', 'instagram'],
  };
}
─────────────────────────────────────────────────────────────────────── */
