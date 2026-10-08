import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { clearImageRecreateInputs } from '@/store/reducers/image/imageSlice';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  LayoutGrid,
  Proportions,
  LinkIcon,
  Loader2,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import { SiOpenai } from 'react-icons/si';
import axios from 'axios';
import { toast } from 'react-toastify';
import { LifestyleShell } from '../LifestyleShell';
import { TemplatesPanel, TemplatesTrigger, TemplatesResizer } from '../../components/PromptTemplatesPicker';
import { usePromptTemplates } from '../../components/usePromptTemplates';
import { getBrandAvatarColor } from '../../components/AdStudioPrimitives';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import geminiIcon from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceIcon from '@/assets/layouts/profile/seedance_logo_transparent.png';
import chatResponseDark from '@/assets/layouts/adstudio/chat-response-dark.svg';
import brandIqIcon from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import getCookies from '@/utils/getCookies';
import { useAdCreativeConfig } from '@/utils/hooks/useAdCreativeConfig';
import AspectRatioTiles, {
  AnimatedPanel,
  primaryRatio,
  totalImages,
} from '@/components/AdStudio/AdCreativeNew/AspectRatioPicker';
import {
  ALLOWED_IMAGE_ACCEPT,
  IMAGE_TYPE_ERROR,
  isAllowedImageFile,
} from '@/utils/imageValidation';
import { analyzeLogoTransparency, LOGO_BACKGROUND_ERROR } from '@/utils/logoTransparency';
import {
  AUTOFILL_FAILURE_MESSAGE,
  fetchAutofill,
  fetchBrandList,
  getAuthToken,
  getUserId,
} from '../../ai-creatives/apiClient';
import { silentSaveBrandFromAutofill } from '../../ai-creatives/silentBrandSave';

const PROMPT_API = import.meta.env.VITE_PROMPT_API;
const MAX_PROMPT_THUMBS = 5;
const IMAGE_ALREADY_ATTACHED_ERROR = 'This image is already attached.';

const imageItemKey = (item) => {
  if (item?.file) {
    const { name, size, type, lastModified } = item.file;
    return `file:${name}:${size}:${type}:${lastModified}`;
  }
  const preview = String(item?.preview || '').trim();
  return preview ? `url:${preview}` : '';
};

const uniqueImageItems = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = imageItemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Model list, labels, apiIds, aspect ratios, qualities and per-quality credits
// come from the backend `ad_creative` surface via useAdCreativeConfig — no
// longer hardcoded. Icons stay frontend-owned, chosen by model id: OpenAI →
// SiOpenai react-icon, Seedream → Seedance logo, everything else → Gemini.
function ModelIcon({ apiId, icon }) {
  const iconValue = String(icon || '');
  if (/^(data:image\/|https?:\/\/|\/)/i.test(iconValue)) {
    return <img src={iconValue} alt="" className="h-3.5 w-3.5 object-contain" />;
  }
  const id = String(apiId || '');
  if (/gpt-image/i.test(id)) {
    return <SiOpenai size={14} className="text-gray-500 dark:text-white/80" />;
  }
  const src = /seedream/i.test(id) ? seedanceIcon : geminiIcon;
  return <img src={src} alt="" className="h-3.5 w-3.5 object-contain" />;
}

// Aspect-ratio helpers + the picker panel live in the shared AspectRatioTiles
// module (imported above).

// Quality tiers are per-model, from the `ad_creative` surface
// (selectedModel.qualities). Labels below are presentation-only.
const QUALITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', ultra_high: 'Ultra High' };
const qualityLabel = (v) => QUALITY_LABELS[v] || v;

// Quality picker is enabled; the backend reads the sent quality (no longer
// forced to "high" in imageController).
const SHOW_QUALITY_PICKER = true;

// Variant route key → backend `inputs.type`. Mirrors VARIANT_TO_API_TYPE
// in LifestyleAdsFlow — duplicated here to avoid coupling AdSetupStep
// directly to the parent flow file.
const VARIANT_TO_API_TYPE = {
  lifestyle: 'lifestyle',
  'product-shot': 'product_shot',
  'apps-saas': 'apps_saas',
  'brand-awareness': 'brand_awareness',
};

// The backend stores modelDescription as a JSON-encoded string whose values
// are also re-encoded (e.g. `"\"Any\""`). Unwrap defensively.
const unquote = (v) => {
  if (typeof v !== 'string') return v;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'string' ? parsed : v;
  } catch {
    return v;
  }
};


const AGE_OPTIONS = ['18-24', '25-34', '35-44', '45-54', '55+'];
const GENDER_OPTIONS = ['Any', 'Female', 'Male', 'Non-binary'];
const MOOD_OPTIONS = ['Cheerful', 'Confident', 'Calm', 'Energetic', 'Aspirational'];
const WARDROBE_OPTIONS = ['Casual', 'Streetwear', 'Formal', 'Athleisure', 'Evening'];
const ETHNICITY_OPTIONS = ['Any', 'Caucasian', 'Black', 'East Asian', 'South Asian', 'Hispanic', 'Middle Eastern'];
const LANGUAGE_OPTIONS = ['English', 'Spanish', 'French', 'German', 'Hindi', 'Arabic'];

// Variant config — each entry says which primary fields the right column shows.
const VARIANT_CONFIG = {
  lifestyle: {
    title: 'Create your Lifestyle Ads',
    nameField: null,
    descLabel: 'Product description',
    descPlaceholder: 'Enter your Brand Description',
    images: { label: 'Key Visuals for this Generation:', placeholder: 'Upload your Reference Images' },
    logo: null,
  },
  'product-shot': {
    title: 'Create your Product Shots',
    nameField: { label: 'Product Name', placeholder: 'Enter your Product Name', key: 'productName' },
    descLabel: 'Product Description',
    descPlaceholder: 'Enter your Product Description',
    images: { label: 'Product Images:', placeholder: 'Paste image URL' },
    logo: { label: 'Brand Logo:', placeholder: 'Paste logo URL' },
  },
  'apps-saas': {
    title: 'Create your App/Saas ads',
    nameField: { label: 'Product Name', placeholder: 'Enter your Product Name', key: 'productName' },
    descLabel: 'Product Description',
    descPlaceholder: 'Enter your Product Description',
    images: { label: 'Product Images/Screenshots:', placeholder: 'Upload your Product images' },
    logo: { label: 'Brand Logo:', placeholder: 'Paste your Brand logo URL' },
  },
  'brand-awareness': {
    title: 'Brand Awareness Creative',
    nameField: { label: 'Brand Name', placeholder: 'Enter your Brand Name', key: 'brandName' },
    descLabel: 'Brand Description',
    descPlaceholder: 'Enter your Brand Description',
    images: { label: 'Reference Images:', placeholder: 'Upload your Reference Images' },
    logo: { label: 'Brand Logo:', placeholder: 'Paste your Brand logo URL' },
  },
};

export function AdSetupStep({
  brandInfo,
  title,
  variant = 'lifestyle',
  onClose,
  onBack,
  onConfirm,
  errorMessage,
  onDismissError,
}) {
  const cfg = VARIANT_CONFIG[variant] ?? VARIANT_CONFIG.lifestyle;
  const isLifestyle = variant === 'lifestyle';

  const [instructions, setInstructions] = useState('');
  const [nameValue, setNameValue] = useState(brandInfo.brandName ?? '');
  const [productDescription, setProductDescription] = useState(brandInfo.brandDescription ?? '');

  // ── Brand voice picker (inline replacement for the removed BrandInfoStep) ──
  // brandSource captures which path the user took so we can rebuild the
  // brandInfo payload at submit time without re-fetching anything.
  //   { kind: 'none' } | { kind: 'list', item } | { kind: 'autofill', data, websiteUrl }
  const [brandSource, setBrandSource] = useState({ kind: 'none' });
  // Brand name + first target audience drive {brand} / {target_audience}
  // token substitution in the Templates picker. Recomputed on every render
  // so live-resolve picks up brand changes automatically.
  const brandNameForTemplates =
    brandSource.kind === 'list'
      ? brandSource.item?.name || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.brandInfo?.brandName || ''
        : '';
  const targetAudienceForTemplates =
    brandSource.kind === 'list'
      ? brandSource.item?.targetAudiences?.[0] || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.objectives?.targetAudience?.[0] || ''
        : '';
  // Category drives the auto-matched template category. A saved brand carries
  // it (get-lists); an autofill brand carries DS's category inline. brandId is
  // only known for saved brands — used to lazy-classify old brands with none.
  const brandCategoryForTemplates =
    brandSource.kind === 'list'
      ? brandSource.item?.category || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.brandInfo?.category || ''
        : '';
  // Exclude the synthetic 'recreate' id — not a saved brand, so the hook must
  // not lazy-classify it (avoids the stuck "finding category" loader). Recreate
  // resolves its category via the name-match instead.
  const brandIdForTemplates =
    brandSource.kind === 'list' &&
    brandSource.item?.id &&
    brandSource.item.id !== 'recreate'
      ? brandSource.item.id
      : '';

  // Captured at mount: true when this form was opened via Recreate for this
  // variant — keeps the templates picker collapsed by default in that flow.
  const recreateSessionInputs = useSelector((s) => s.image.recreateInputs);
  const headerSelectedBrand = useSelector((s) => s.brandIQTabs.selectedCompetitorBrand);
  const headerBrands = useSelector((s) => s.brandIQTabs.myBrands);
  const headerBrand = Array.isArray(headerBrands)
    ? headerBrands.find((brand) => brand.id === headerSelectedBrand?.id)
    : null;
  const isRecreateSessionRef = useRef(
    Boolean(
      recreateSessionInputs &&
        recreateSessionInputs.type === (VARIANT_TO_API_TYPE[variant] || 'lifestyle'),
    ),
  );

  const templates = usePromptTemplates({
    type: VARIANT_TO_API_TYPE[variant] || 'lifestyle',
    brandName: brandNameForTemplates,
    targetAudience: targetAudienceForTemplates,
    brandCategory: brandCategoryForTemplates,
    brandId: brandIdForTemplates,
    // On Recreate, land with the picker collapsed.
    autoOpen: !isRecreateSessionRef.current,
    currentValue: instructions,
    onSelect: (text) => {
      setInstructions(text);
      // clearError is defined further down the component; closure handles it.
      if (text) clearError('instructions');
    },
    // Manual edit of a {brand}/{target_audience} token deselects the brand
    // chip so the UI matches the new source of truth (the typed values).
    onClearBrand: () => setBrandSource({ kind: 'none' }),
  });
  const [bvWebsiteUrl, setBvWebsiteUrl] = useState('');
  // Brand-image chip pool — populated when the user picks a brand or
  // autofills a website. Chips render below the brand-voice section.
  // Picking is an explicit user gesture (single click → added to `images`,
  // which feeds the prompt-thumb row); double click previews.
  const [brandImagePool, setBrandImagePool] = useState([]);
  // Selected chip URLs — kept separate from `images` so they only feed the
  // prompt-thumb row + payload, not the upload field's thumbnail list.
  // Mirrors AiCreativesCustom.brandImagesPicked.
  const [brandImagesPicked, setBrandImagesPicked] = useState([]);
  // All brand logos from the active source (display only). Single-select
  // via brandLogoPicked — never auto-selected. Mirrors AiCreativesCustom.
  const [brandLogoOptions, setBrandLogoOptions] = useState([]);
  const [brandLogoPicked, setBrandLogoPicked] = useState('');
  const [showBrandIqPicker, setShowBrandIqPicker] = useState(false);
  const [brandList, setBrandList] = useState([]);
  const [brandListState, setBrandListState] = useState('idle'); // idle|loading|loaded|error
  const [brandListError, setBrandListError] = useState('');
  const [autofillState, setAutofillState] = useState('idle'); // idle|loading|ok|error
  const [autofillError, setAutofillError] = useState('');
  const brandListAbortRef = useRef(null);
  const autofillAbortRef = useRef(null);
  const brandIqWrapperRef = useRef(null);

  // Close the BrandIQ picker on outside click.
  useEffect(() => {
    if (!showBrandIqPicker) return undefined;
    const onMouseDown = (e) => {
      if (brandIqWrapperRef.current && !brandIqWrapperRef.current.contains(e.target)) {
        setShowBrandIqPicker(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showBrandIqPicker]);

  // Cleanup any in-flight brand-voice requests on unmount.
  useEffect(() => {
    return () => {
      brandListAbortRef.current?.abort();
      autofillAbortRef.current?.abort();
    };
  }, []);

  const fillFromBrand = ({ name, description, logoUrls, imageUrls }) => {
    setNameValue(name ?? '');
    setProductDescription(description ?? '');
    // Brand logos become picker chips — none auto-selected. User picks
    // via `brandLogoPicked` (separate from the upload field's logoFiles
    // so it doesn't appear as a default-selected thumbnail).
    const logos = (Array.isArray(logoUrls) ? logoUrls : []).filter(Boolean);
    setBrandLogoOptions(logos);
    setBrandLogoPicked('');
    setLogoFiles([]);
    setLogoUrl('');
    // Brand images become picker chips — user explicitly clicks to add
    // them to the payload via `brandImagesPicked` (which flows into the
    // prompt-thumb row + submit body but NOT into the upload field).
    const pool = (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean);
    setBrandImagePool(pool);
    // Drop prior chip selections so a brand switch doesn't keep assets
    // from the previous brand in the payload.
    setBrandImagesPicked([]);
  };

  // Header selection drives Brand Voice and every related field in-place.
  // No route state is changed, so the update is smooth and does not flicker.
  useEffect(() => {
    if (!headerBrand?.id) return;
    setBrandSource({ kind: 'list', item: headerBrand });
    fillFromBrand({
      name: headerBrand.name,
      description: headerBrand.description,
      logoUrls: headerBrand.logoUrls,
      imageUrls: headerBrand.imageUrl,
    });
    setAutofillState('idle');
    setAutofillError('');
  }, [headerBrand?.id]);

  const refreshBrandList = useCallback(async () => {
    brandListAbortRef.current?.abort();
    const controller = new AbortController();
    brandListAbortRef.current = controller;
    setBrandListState('loading');
    setBrandListError('');
    try {
      const items = await fetchBrandList(
        getUserId(),
        getAuthToken(),
        controller.signal,
      );
      if (brandListAbortRef.current !== controller) return;
      setBrandList(items);
      setBrandListState('loaded');
    } catch (err) {
      if (err.name === 'AbortError' || brandListAbortRef.current !== controller) return;
      setBrandListError(err.message || 'Failed to load brands');
      setBrandListState('error');
    }
  }, []);

  useEffect(() => {
    const onBrandsUpdated = (event) => {
      const updatedUserId = event.detail?.userId;
      if (updatedUserId && String(updatedUserId) !== String(getUserId())) return;
      void refreshBrandList();
    };
    window.addEventListener('brandiq:brands-updated', onBrandsUpdated);
    return () => window.removeEventListener('brandiq:brands-updated', onBrandsUpdated);
  }, [refreshBrandList]);

  const handleBrandIqOpen = async () => {
    setShowBrandIqPicker((open) => !open);
    if (brandList.length > 0 || brandListState === 'loading') return;
    await refreshBrandList();
  };

  const handleBrandIqSelect = (item) => {
    const itemId = item.id || item._id;
    const sourceId =
      brandSource.kind === 'list'
        ? brandSource.item.id || brandSource.item._id
        : null;
    // Clicking the already-selected brand toggles it off and resets every
    // field the brand source had filled in.
    if (sourceId && itemId && sourceId === itemId) {
      setBrandSource({ kind: 'none' });
      fillFromBrand({ name: '', description: '', logoUrls: [], imageUrls: [] });
      setShowBrandIqPicker(false);
      setAutofillState('idle');
      setAutofillError('');
      return;
    }
    setBrandSource({ kind: 'list', item });
    fillFromBrand({
      name: item.name,
      description: item.description,
      logoUrls: Array.isArray(item.logoUrls) ? item.logoUrls : [],
      imageUrls: Array.isArray(item.imageUrl) ? item.imageUrl : [],
    });
    setShowBrandIqPicker(false);
    setAutofillState('idle');
    setAutofillError('');
  };

  const handleAutofill = async () => {
    const raw = bvWebsiteUrl.trim();
    if (!raw) return;
    const url = `https://${raw.replace(/^\s*https?:\/\//i, '')}`;
    autofillAbortRef.current?.abort();
    autofillAbortRef.current = new AbortController();
    setAutofillState('loading');
    setAutofillError('');
    try {
      const data = await fetchAutofill(url, autofillAbortRef.current.signal);
      setBrandSource({ kind: 'autofill', data, websiteUrl: url });
      silentSaveBrandFromAutofill({
        userId: getUserId(),
        userName: userData?.user_name,
        websiteUrl: url,
        autofillData: data,
      });
      const bi = data.brandInfo || {};
      // Autofill can return very large pools — cap both logos and images
      // at 10 so the chip rows stay manageable.
      const scrapedImages = Array.isArray(bi.brandImages)
        ? bi.brandImages.slice(0, 10)
        : [];
      const scrapedLogos = Array.isArray(bi.brandLogo)
        ? bi.brandLogo.slice(0, 10)
        : bi.brandLogo
          ? [bi.brandLogo]
          : [];
      fillFromBrand({
        name: bi.brandName,
        description: bi.brandDescription,
        logoUrls: scrapedLogos,
        imageUrls: scrapedImages,
      });
      setAutofillState('ok');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAutofillError(err.message || AUTOFILL_FAILURE_MESSAGE);
      setAutofillState('error');
    }
  };

  // ── Recreate-from-history prefill ─────────────────────────────────────
  // When the user clicks "Recreate" on an image card in MySpace, the inputs
  // are stashed on state.image.recreateInputs and they're routed here. We
  // hydrate the form fields once on mount (only if the stored type matches
  // this variant) and then clear the redux entry so a remount doesn't
  // re-apply the prefill.
  const dispatch = useDispatch();
  const recreateInputs = useSelector((s) => s.image.recreateInputs);
  const userData = useSelector((s) => s.socket?.userData);
  useEffect(() => {
    if (!recreateInputs) return;
    const expectedType = VARIANT_TO_API_TYPE[variant];
    if (recreateInputs.type !== expectedType) return;

    const inp = recreateInputs;
    // Backend stores the user's prompt as `prompt` on inputs; older records
    // may still carry `userPrompt`, so honour both.
    setInstructions(inp.prompt || inp.userPrompt || '');
    if (cfg.nameField) {
      // brand_awareness uses brandName; product_shot / apps_saas use productName.
      const v = cfg.nameField.key === 'brandName' ? inp.brandName : inp.productName;
      setNameValue(v || '');
    }
    setProductDescription(inp.productDescription || inp.brandDescription || '');

    if (variant === 'lifestyle' && inp.modelDescription) {
      try {
        const md =
          typeof inp.modelDescription === 'string'
            ? JSON.parse(inp.modelDescription)
            : inp.modelDescription;
        if (md.age != null) setAge(unquote(md.age) || '');
        if (md.gender != null) setGender(unquote(md.gender) || 'Any');
        if (md.language != null) setLanguage(unquote(md.language) || 'English');
        if (md.ethnicity != null) setEthnicity(unquote(md.ethnicity) || 'Any');
        if (md.mood != null) setMood(unquote(md.mood) || '');
        if (md.wardrobe != null) setWardrobe(unquote(md.wardrobe) || '');
      } catch {
        /* malformed JSON — leave demographics at defaults */
      }
    }

    if (inp.model && configModels.some((m) => m.apiId === inp.model)) {
      setModel(inp.model);
    }

    if (inp.quality && QUALITY_LABELS[inp.quality]) {
      setQuality(inp.quality);
    }

    // Aspect ratio. Prefer the structured aspectRatioPerImage if present;
    // otherwise fall back to the flat aspectRatio + numberOfImages pair. The
    // reconcile effect merges these into the selected model's ratio set.
    if (Array.isArray(inp.aspectRatioPerImage) && inp.aspectRatioPerImage.length > 0) {
      const counts = {};
      for (const { aspectRatio, numberOfImages } of inp.aspectRatioPerImage) {
        if (aspectRatio) counts[aspectRatio] = Number(numberOfImages) || 0;
      }
      setRatioCounts(counts);
    } else if (inp.aspectRatio) {
      setRatioCounts({ [inp.aspectRatio]: Number(inp.numberOfImages) || 1 });
    }

    const toItem = (u) => ({ file: null, preview: u });
    // Items that came from the scraped brand pool are rendered as
    // selected chips below the field — exclude them from the upload
    // thumbnail row so the same image isn't shown twice.
    const brandSet = new Set(
      (Array.isArray(inp.brandImages) ? inp.brandImages : []).filter(Boolean),
    );
    if (variant === 'lifestyle') {
      const visuals = Array.isArray(inp.keyVisualImages) ? inp.keyVisualImages : [];
      setImages(uniqueImageItems(visuals.filter((u) => u && !brandSet.has(u)).map(toItem)));
      const refs = Array.isArray(inp.modelReferenceImages) ? inp.modelReferenceImages : [];
      setModelRefImages(uniqueImageItems(refs.filter(Boolean).map(toItem)));
    } else if (variant === 'apps-saas') {
      // apps_saas may store either productScreenshots or productImages.
      const screenshots = Array.isArray(inp.productScreenshots) ? inp.productScreenshots : [];
      const productImgs = Array.isArray(inp.productImages) ? inp.productImages : [];
      const pool = screenshots.length > 0 ? screenshots : productImgs;
      setImages(pool.filter((u) => u && !brandSet.has(u)).map(toItem));
    } else {
      const productImgs = Array.isArray(inp.productImages) ? inp.productImages : [];
      setImages(productImgs.filter((u) => u && !brandSet.has(u)).map(toItem));
    }

    // Surface the previous run's logo as a single-option chip and mark it
    // as picked so it ships in the payload — without auto-populating the
    // upload field's thumbnail row (matches the new chip-picker behaviour).
    if (inp.brandLogo) {
      setBrandLogoOptions([inp.brandLogo]);
      setBrandLogoPicked(inp.brandLogo);
    }

    // Surface the brand image pool from the previous run as chips, and
    // mark the previously-used ones as picked so they show ticked + flow
    // into the prompt-thumb row + payload. They live in brandImagesPicked
    // (not `images`) so they don't appear as thumbnails in the upload field.
    if (Array.isArray(inp.brandImages) && inp.brandImages.length > 0) {
      const pool = inp.brandImages.filter(Boolean);
      setBrandImagePool(pool);
      const previouslyUsed = new Set();
      const ref = (xs) =>
        Array.isArray(xs) ? xs.filter(Boolean).forEach((u) => previouslyUsed.add(u)) : null;
      ref(inp.keyVisualImages);
      ref(inp.productImages);
      ref(inp.productScreenshots);
      ref(inp.referenceImages);
      setBrandImagesPicked(pool.filter((u) => previouslyUsed.has(u)));
    }

    // Mirror brand info into the brand-voice chip so resolveBrandInfoFromSource
    // picks them up at submit time.
    if (inp.brandName || inp.brandDescription || inp.brandLogo) {
      setBrandSource({
        kind: 'list',
        item: {
          id: 'recreate',
          name: inp.brandName || '',
          description: inp.brandDescription || '',
          logoUrls: inp.brandLogo ? [inp.brandLogo] : [],
          imageUrl: Array.isArray(inp.brandImages) ? inp.brandImages : [],
          category: inp.category || '',
        },
      });

      // Recreate rebuilds a transient brand with no category. If the stored
      // inputs didn't carry one, look it up from the user's saved brands
      // (get-lists returns each brand's category) by matching the name — a
      // pure frontend lookup, no extra classification — so the templates
      // picker auto-matches the right category.
      if (!inp.category && inp.brandName) {
        const wanted = inp.brandName.trim().toLowerCase();
        fetchBrandList(getUserId(), getAuthToken())
          .then((items) => {
            const match = (items || []).find(
              (b) => (b?.name || '').trim().toLowerCase() === wanted,
            );
            if (!match?.category) return;
            setBrandSource((prev) =>
              prev.kind === 'list' && prev.item?.id === 'recreate'
                ? { ...prev, item: { ...prev.item, category: match.category } }
                : prev,
            );
          })
          .catch(() => {});
      }
    }

    dispatch(clearImageRecreateInputs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolves the active brand-voice source into the brandInfo shape the
  // parent (LifestyleAdsFlow) hands to buildFormInputs. When nothing was
  // picked, fall back to whatever the user typed manually in the form.
  const resolveBrandInfoFromSource = () => {
    if (brandSource.kind === 'list') {
      const item = brandSource.item;
      return {
        brandName: item.name || nameValue.trim(),
        brandDescription: item.description || productDescription.trim(),
        brandLogoUrl: item.logoUrls?.[0] || logoUrl.trim(),
        brandImages: Array.isArray(item.imageUrl) ? item.imageUrl.filter(Boolean) : [],
        brandColors: [],
      };
    }
    if (brandSource.kind === 'autofill') {
      const bi = brandSource.data?.brandInfo || {};
      return {
        brandName: bi.brandName || nameValue.trim(),
        brandDescription: bi.brandDescription || productDescription.trim(),
        brandLogoUrl:
          (Array.isArray(bi.brandLogo) ? bi.brandLogo[0] : bi.brandLogo) || logoUrl.trim(),
        brandImages: Array.isArray(bi.brandImages) ? bi.brandImages.filter(Boolean) : [],
        brandColors: bi.brandGuidelines?.colorPalette ?? [],
      };
    }
    return {
      brandName: nameValue.trim(),
      brandDescription: productDescription.trim(),
      brandLogoUrl: logoUrl.trim(),
      brandImages: [],
      brandColors: [],
    };
  };

  // Lifestyle-only state — modelDescription as an object is assembled from
  // the dropdowns below at submit time (no free-text textarea any more).
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Any');
  const [mood, setMood] = useState('');
  const [wardrobe, setWardrobe] = useState('');
  const [ethnicity, setEthnicity] = useState('Any');
  const [language, setLanguage] = useState('English');
  const [modelRefUrl, setModelRefUrl] = useState('');
  // All upload-aware state stores items as { file: File | null, preview: string }.
  // The parent uploads `file !== null` items to S3 at submit time.
  const [modelRefImages, setModelRefImages] = useState([]);

  // Shared upload state
  const [imageUrl, setImageUrl] = useState('');
  const [images, setImages] = useState(() =>
    (Array.isArray(brandInfo.brandImages) ? brandInfo.brandImages : [])
      .filter(Boolean)
      .map((u) => ({ file: null, preview: u }))
  );
  const [logoUrl, setLogoUrl] = useState(brandInfo.brandLogoUrl ?? '');
  const [logoFiles, setLogoFiles] = useState([]);

  const [model, setModel] = useState('');
  const [quality, setQuality] = useState('high');
  const [ratioCounts, setRatioCounts] = useState({});

  // Model list + per-model aspect ratios / qualities / credits from the backend
  // `ad_creative` surface (shared cache, fallback baked in).
  const { models: configModels } = useAdCreativeConfig();
  const selectedModel = configModels.find((m) => m.apiId === model);
  // The database catalog owns the initial model. State keeps the canonical
  // ID for the request while the picker displays the configured label.
  useEffect(() => {
    if (!model && configModels.length > 0) setModel(configModels[0].apiId);
  }, [configModels, model]);
  // Per-image credits for the selected model + quality (falls back to the
  // model's default/high tier, then 7).
  const creditsPerImage =
    selectedModel?.creditsByQuality?.[quality] ?? selectedModel?.creditsPerImage ?? 7;

  // Reconcile per-ratio counts whenever the selected model changes — models
  // support different aspect-ratio sets. Keep counts for ratios the new model
  // still offers, drop the rest, and default to a single 1:1 (or first ratio)
  // if nothing is selected so the payload stays valid.
  useEffect(() => {
    const ratios = selectedModel?.aspectRatios;
    if (!ratios || ratios.length === 0) return;
    setRatioCounts((prev) => {
      const next = {};
      for (const r of ratios) next[r] = prev[r] || 0;
      if (totalImages(next) === 0) {
        next[ratios.includes('1:1') ? '1:1' : ratios[0]] = 1;
      }
      return next;
    });
  }, [selectedModel]);

  // Keep the selected quality valid for the current model — tiers differ per
  // model (only Nano Banana 2 offers "ultra_high").
  useEffect(() => {
    const qualities = selectedModel?.qualities;
    if (!qualities || qualities.length === 0 || qualities.includes(quality)) return;
    setQuality(qualities.includes('high') ? 'high' : qualities[0]);
  }, [selectedModel, quality]);
  const [errors, setErrors] = useState({});
  const clearError = (field) => setErrors((p) => (p[field] ? { ...p, [field]: '' } : p));

  // Improve-prompt (Gemini) state — same wand button + behaviour we shipped
  // for AI Creatives. Replaces the instructions textarea content with the
  // model's suggested rewrite.
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);
  const handleImprovePrompt = async () => {
    const trimmed = instructions.trim();
    if (!trimmed || isSuggestingPrompt) return;
    setIsSuggestingPrompt(true);
    try {
      const res = await axios.post(
        PROMPT_API,
        { user_id: getUserId(), prompt: trimmed, type: 'image' },
        { headers: { Authorization: `Bearer ${getCookies()}` } },
      );
      const suggestion = res?.data?.suggested_prompt;
      if (suggestion) setInstructions(suggestion);
    } catch (err) {
      toast.error(
        err?.response?.data?.message || 'Prompt must contain at least 3 words',
      );
    } finally {
      setIsSuggestingPrompt(false);
    }
  };

  // Lightbox preview state for thumbnail clicks.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxImage, setLightboxImage] = useState('');
  const openPreview = (items, idx) => {
    const urls = items.map((it) => it.preview).filter(Boolean);
    if (urls.length === 0) return;
    setLightboxImages(urls);
    setLightboxImage(urls[idx] ?? urls[0]);
    setLightboxOpen(true);
  };

  const total = totalImages(ratioCounts);

  // Prompt-box thumb composition + the 5-image cap that applies to every
  // variant. Lifestyle counts (key visuals + model references) toward the
  // same 5 total; the other variants only count `images`. Brand logo is
  // intentionally excluded from the prompt-box preview.
  // Dedupe by preview URL — a brand-pool URL that's already represented in
  // `images`/`modelRefImages` (common on recreate, where keyVisualImages
  // overlap brandImages) would otherwise render twice.
  const promptThumbs = (() => {
    const seen = new Set();
    const out = [];
    const push = (kind, preview) => {
      if (!preview || seen.has(preview)) return;
      seen.add(preview);
      out.push({ kind, preview });
    };
    if (isLifestyle) {
      modelRefImages.forEach((it) => push('modelRef', it.preview));
      push('modelRefUrl', modelRefUrl.trim());
    }
    images.forEach((it) => push('image', it.preview));
    push('imageUrl', imageUrl.trim());
    brandImagesPicked.forEach((u) => push('brand-pool', u));
    return out;
  })();
  const remainingPromptSlots = Math.max(0, MAX_PROMPT_THUMBS - promptThumbs.length);

  // Wrappers around setImages / setModelRefImages that respect the cap and
  // surface a toast-style error when the user tries to overshoot.
  const addUniqueImages = (items, setItems) => {
    const existingKeys = new Set(
      [
        ...modelRefImages,
        ...images,
        ...brandImagesPicked.map((preview) => ({ file: null, preview })),
        ...(modelRefUrl.trim() ? [{ file: null, preview: modelRefUrl.trim() }] : []),
        ...(imageUrl.trim() ? [{ file: null, preview: imageUrl.trim() }] : []),
      ]
        .map(imageItemKey)
        .filter(Boolean),
    );
    let foundDuplicate = false;
    const uniqueIncoming = [];

    for (const item of items) {
      const key = imageItemKey(item);
      if (!key || existingKeys.has(key)) {
        foundDuplicate = true;
        continue;
      }
      existingKeys.add(key);
      uniqueIncoming.push(item);
    }

    if (remainingPromptSlots <= 0) {
      setErrors((p) => ({
        ...p,
        images: foundDuplicate
          ? IMAGE_ALREADY_ATTACHED_ERROR
          : `You can attach up to ${MAX_PROMPT_THUMBS} images.`,
      }));
      return;
    }

    const accepted = uniqueIncoming.slice(0, remainingPromptSlots);
    if (accepted.length > 0) setItems((previous) => [...previous, ...accepted]);

    if (foundDuplicate) {
      setErrors((p) => ({ ...p, images: IMAGE_ALREADY_ATTACHED_ERROR }));
    } else if (uniqueIncoming.length > remainingPromptSlots) {
      setErrors((p) => ({
        ...p,
        images: `You can attach up to ${MAX_PROMPT_THUMBS} images.`,
      }));
    } else if (accepted.length > 0) {
      clearError('images');
    }
  };
  const addImages = (items) => addUniqueImages(items, setImages);
  const addModelRefImages = (items) => addUniqueImages(items, setModelRefImages);

  // Generate is disabled until every required (*) field is non-empty AND
  // at least one image is requested via the aspect-ratio picker. Only the
  // starred fields are mandatory — image uploads are optional per the
  // form spec (product/reference images, brand logo all unstarred).
  //   - Lifestyle              : Instructions* + Product description*
  //   - Product Shot / App-Saas: Instructions* + Product Name*
  //   - Brand Awareness        : Instructions* + Brand Name*
  const canGenerate =
    total > 0 &&
    instructions.trim().length > 0 &&
    (!cfg.nameField || nameValue.trim().length > 0) &&
    (!isLifestyle || productDescription.trim().length > 0);

  const handleGenerate = () => {
    const e = {};
    if (!instructions.trim()) e.instructions = 'Instructions are required';
    if (cfg.nameField && !nameValue.trim()) {
      e.name = `${cfg.nameField.label} is required`;
    }
    if (isLifestyle && !productDescription.trim()) {
      e.productDescription = 'Product description is required';
    }

    const pendingReferenceItems = [
      ...modelRefImages,
      ...images,
      ...brandImagesPicked.map((preview) => ({ file: null, preview })),
      ...(modelRefUrl.trim() ? [{ file: null, preview: modelRefUrl.trim() }] : []),
      ...(imageUrl.trim() ? [{ file: null, preview: imageUrl.trim() }] : []),
    ];
    const pendingReferenceKeys = pendingReferenceItems.map(imageItemKey).filter(Boolean);
    if (new Set(pendingReferenceKeys).size < pendingReferenceKeys.length) {
      e.images = IMAGE_ALREADY_ATTACHED_ERROR;
    } else if (pendingReferenceKeys.length > MAX_PROMPT_THUMBS) {
      e.images = `You can attach up to ${MAX_PROMPT_THUMBS} images.`;
    }

    if (Object.keys(e).length > 0 || total === 0) {
      setErrors(e);
      return;
    }
    setErrors({});

    // Items are { file?, preview }. The pasted URL field gets folded in as
    // a final unaffiliated entry so the parent treats it like any other
    // already-hosted item at submit time.
    let allImages = [...images];
    if (imageUrl.trim()) allImages.push({ file: null, preview: imageUrl.trim() });
    // Fold chip-picked brand images into the payload too. They live in their
    // own state so they don't appear as thumbnails in the upload field, but
    // they must still ship as references at submit time.
    for (const u of brandImagesPicked) {
      if (u && !allImages.some((it) => it.preview === u)) {
        allImages.push({ file: null, preview: u });
      }
    }

    let refImages = [...modelRefImages];
    if (modelRefUrl.trim()) refImages.push({ file: null, preview: modelRefUrl.trim() });

    // Final defensive normalization: no duplicate references and never more
    // than five combined Lifestyle references, even if stale recreated state
    // predates the UI guards above.
    refImages = uniqueImageItems(refImages).slice(0, MAX_PROMPT_THUMBS);
    const refKeys = new Set(refImages.map(imageItemKey));
    allImages = uniqueImageItems(allImages)
      .filter((item) => !refKeys.has(imageItemKey(item)))
      .slice(0, isLifestyle ? MAX_PROMPT_THUMBS - refImages.length : MAX_PROMPT_THUMBS);

    // Brand logo precedence: uploaded file > typed URL > chip-picked URL
    // > legacy brandInfo prop. Returns a single { file?, preview } object.
    const finalLogo =
      logoFiles[0] ||
      (logoUrl.trim() ? { file: null, preview: logoUrl.trim() } : null) ||
      (brandLogoPicked ? { file: null, preview: brandLogoPicked } : null) ||
      (brandInfo.brandLogoUrl ? { file: null, preview: brandInfo.brandLogoUrl } : null);

    onConfirm?.({
      instructions: instructions.trim(),
      ...(cfg.nameField ? { [cfg.nameField.key]: nameValue.trim() } : {}),
      productDescription: productDescription.trim(),
      ...(isLifestyle
        ? {
            demographics: { age, gender, mood, wardrobe, ethnicity, language },
            modelReferenceImages: refImages,
            keyVisuals: allImages,
          }
        : {
            productImages: allImages,
            referenceImages: allImages,
            brandLogo: finalLogo,
          }),
      model,
      quality,
      variations: total,
      aspectRatio: primaryRatio(ratioCounts),
      ratioCounts,
      // BrandInfoStep was removed — ship brandInfo inline so the parent
      // doesn't have to reach back into state for it.
      brandInfo: resolveBrandInfoFromSource(),
    });
  };

  return (
    <LifestyleShell title={title} onClose={onClose}>
      <div className="adcreative-setup-modal relative w-full max-w-[1043px] max-h-[calc(100svh-40px)] overflow-y-auto rounded-[24px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-surface)] p-[22px_26px] border border-[var(--ws-border)] dark:border-[var(--adcreative-dark-border)] shadow-[var(--ws-shadow-md)] dark:shadow-[0_30px_70px_-30px_rgba(0,0,0,0.55)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative h-[30px] flex items-center justify-center mb-[18px]">
          {(onBack || onClose) && (
            <button
              type="button"
              onClick={onBack ?? onClose}
              aria-label="Back"
              className="absolute -left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-[10px] text-[#4A4758] hover:text-black dark:text-white/70 dark:hover:text-white transition-colors"
            >
              <ArrowLeft size={24} strokeWidth={2} />
            </button>
          )}
          <h3 className="text-[17px] font-bold tracking-[-0.01em] text-[#1F1D29] dark:text-white">{cfg.title}</h3>
        </div>

        {errorMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] text-red-700 ring-1 ring-red-500/30 dark:text-red-200">
            <AlertCircle size={14} />
            {errorMessage}
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="ml-auto text-red-600 hover:text-red-800 dark:text-red-200/80 dark:hover:text-white"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,455fr)_minmax(0,443fr)] gap-[22px] items-stretch">
          {/* Left — Instructions textarea + model + ratio pills */}
          <div className="flex flex-1 min-w-0 flex-col h-full">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white">
                {/* Instructions<span>*</span> */}
                Prompt<span className="text-[#3b82f6] font-semibold ml-0.5">*</span>
              </p>
              <TemplatesTrigger controller={templates} />
            </div>
            <TemplatesPanel controller={templates} />
            {/* Drag handle to repartition height between the templates picker
                and the prompt box (only present while the panel is open). */}
            <TemplatesResizer controller={templates} />
            <div
              className={`adcreative-prompt-card relative flex flex-1 flex-col rounded-[16px] border bg-[var(--ws-surface-control)] dark:bg-[var(--adcreative-dark-control)] min-h-[140px] transition-colors ${
                errors.instructions
                  ? 'border-red-500 ring-1 ring-red-500/30'
                  : 'border-[var(--ws-border)] focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:border-white/10'
              }`}
            >
              <textarea
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  clearError('instructions');
                }}
                placeholder="How would you like your creatives....."
                style={{ backgroundColor: 'transparent' }}
                className="flex-1 min-h-[60px] resize-none border-0 !bg-transparent bg-transparent px-[18px] pt-4 pb-2 text-[14px] leading-[1.6] text-[#1F1D29] placeholder:text-[#85829A] outline-none dark:text-white dark:placeholder:text-gray-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />
              {/* Prompt-box preview row — selected images (key visuals +
                  model refs for Lifestyle; product/reference images
                  otherwise). Capped at 5. Brand logo is intentionally
                  excluded. Each thumb has an X that removes the matching
                  item from its source list. */}
              {promptThumbs.length > 0 && (
                <div className="flex flex-wrap items-end justify-end gap-2 px-3 pb-2">
                  {promptThumbs.map((t, i) => (
                    <div
                      key={`prompt-thumb-${t.kind}-${i}-${t.preview}`}
                      className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-black/10 sm:h-24 sm:w-16 dark:ring-white/10"
                    >
                      <img
                        src={t.preview}
                        alt={`${t.kind} ${i + 1}`}
                        onClick={() => openPreview(promptThumbs, i)}
                        className="h-full w-full cursor-pointer object-cover"
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0F0F0F]/80 via-[#0F0F0F]/20 to-transparent"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${t.kind}`}
                        onClick={() => {
                          if (t.kind === 'modelRef') {
                            setModelRefImages((prev) =>
                              prev.filter((it) => it.preview !== t.preview),
                            );
                          } else if (t.kind === 'modelRefUrl') {
                            setModelRefUrl('');
                          } else if (t.kind === 'imageUrl') {
                            setImageUrl('');
                          } else if (t.kind === 'brand-pool') {
                            // Mirrors deselection of the chip below.
                            setBrandImagesPicked((prev) =>
                              prev.filter((u) => u !== t.preview),
                            );
                          } else {
                            setImages((prev) =>
                              prev.filter((it) => it.preview !== t.preview),
                            );
                          }
                          clearError('images');
                        }}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-transform hover:scale-105"
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5 p-[8px_10px] bg-[var(--ws-surface-header)] border-t border-[var(--ws-border)] rounded-b-[16px] dark:bg-transparent dark:border-[var(--adcreative-dark-field-border)]">
                <button
                  type="button"
                  onClick={handleImprovePrompt}
                  disabled={!instructions.trim() || isSuggestingPrompt}
                  title="Enhance prompt"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#ECEEFD] hover:bg-[#C9CEF8] text-[#5867EB] transition-colors disabled:opacity-40 mr-auto dark:bg-indigo-950/60 dark:text-indigo-300"
                >
                  {isSuggestingPrompt ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                </button>
                <div className="flex items-center gap-1.5">
                  {/* HIDE-MARK — Quality picker hidden. Unhide: flip SHOW_QUALITY_PICKER to true. */}
                  {SHOW_QUALITY_PICKER && (
                    <QualityPickerPill value={quality} onChange={setQuality} model={model} />
                  )}
                  <ModelPickerPill value={model} onChange={setModel} />
                  <RatioPickerPill counts={ratioCounts} onChange={setRatioCounts} model={model} quality={quality} />
                </div>
              </div>
            </div>
            {errors.instructions && (
              <p className="mt-1.5 text-[12px] text-red-400" role="alert">
                {errors.instructions}
              </p>
            )}
          </div>

          {/* Right — variant fields + Generate. Matches AiCreativesCustom's
              structure: column flows naturally, outer modal's overflow-y-auto
              handles scroll. No flex-1/overflow-y-auto here so the grid row
              doesn't pin to this column's height. */}
          <div className="min-w-0 grid grid-cols-2 gap-x-[14px] gap-y-4 content-start">
            {/* 1. Brand Voice */}
            <div className="col-span-2">
              <span className="text-[13px] font-semibold text-[#1F1D29] dark:text-white block mb-[7px]">Attach your Brand Voice</span>
              <div
              className="adcreative-field-white flex items-center gap-1.5 h-[44px] p-1 bg-[var(--ws-surface-control)] border border-[var(--ws-border)] rounded-[12px] focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)] transition-all">
                <div ref={brandIqWrapperRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={handleBrandIqOpen}
                    aria-expanded={showBrandIqPicker}
                    className={`flex h-[34px] max-w-[190px] items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] font-medium text-[#1F1D29] shadow-[var(--ws-shadow-sm)] transition-[background-color,border-color,box-shadow] outline-none focus-visible:border-[#5867EB] focus-visible:ring-[3px] focus-visible:ring-[#5867EB]/16 dark:text-white dark:shadow-none dark:focus-visible:border-white/30 dark:focus-visible:ring-white/15 ${
                      showBrandIqPicker
                        ? 'border-[#5867EB] bg-[#ECEDEF] ring-[3px] ring-[#5867EB]/16 dark:border-white/25 dark:bg-white/15 dark:ring-white/10'
                        : 'border-[#D6D8DC] bg-[#ECEDEF] hover:border-[var(--ws-border-strong)] hover:bg-[#E3E5E8] dark:border-white/10 dark:bg-white/10 dark:hover:border-white/20 dark:hover:bg-white/15'
                    }`}
                  >
                    {brandSource.kind === 'list' && (brandSource.item.logoUrls?.[0] || brandSource.item.logoUrl || brandSource.item.logo) ? (
                      <img
                        src={brandSource.item.logoUrls?.[0] || brandSource.item.logoUrl || brandSource.item.logo}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-[4px] object-cover"
                      />
                    ) : brandSource.kind === 'autofill' && brandSource.data?.brandInfo?.brandLogo?.[0] ? (
                      <img
                        src={brandSource.data.brandInfo.brandLogo[0]}
                        alt=""
                        className="h-4 w-4 shrink-0 rounded-[4px] object-cover"
                      />
                    ) : (
                      <img src={brandIqIcon} alt="" className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">
                      {brandSource.kind === 'list'
                        ? brandSource.item.name
                        : brandSource.kind === 'autofill'
                          ? brandSource.data?.brandInfo?.brandName || 'Brand IQ'
                          : 'Brand IQ'}
                    </span>
                    <ChevronDown size={13} className={`transition-transform ${showBrandIqPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {showBrandIqPicker && (
                    <div className="absolute top-[calc(100%+6px)] left-0 z-40 w-[360px] p-1.5 rounded-[14px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-popup)] shadow-[var(--ws-shadow-md)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.55)] border border-[var(--ws-border)] dark:border-[var(--adcreative-dark-border)]">
                      <div className="grid grid-cols-2 gap-0.5 max-h-[260px] overflow-y-auto">
                        {brandListState === 'loading' && (
                          <div className="col-span-2 flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                            <Loader2 size={12} className="animate-spin" /> Loading brands…
                          </div>
                        )}
                        {brandListState === 'loaded' && brandList.map((item) => {
                          const itemId = item.id || item._id;
                          const selected = brandSource.kind === 'list' && (brandSource.item.id || brandSource.item._id) === itemId;
                          const brandLogoSrc =
                            item.logoUrls?.[0] ||
                            item.logoUrl ||
                            item.iconUrl ||
                            item.brandLogoUrl ||
                            item.logo ||
                            (Array.isArray(item.brandLogo) ? item.brandLogo[0] : item.brandLogo) ||
                            (Array.isArray(item.imageUrl) ? item.imageUrl[0] : item.imageUrl);

                          return (
                            <button
                              key={itemId}
                              type="button"
                              onClick={() => handleBrandIqSelect(item)}
                              className={`flex items-center gap-2 p-[6px_8px] rounded-[9px] text-[12.5px] text-left transition-colors min-w-0 ${
                                selected
                                  ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                                  : 'text-[#1F1D29] hover:bg-[var(--ws-surface-hover)] dark:text-white dark:hover:bg-white/10'
                              }`}
                            >
                              {brandLogoSrc ? (
                                <img
                                  src={brandLogoSrc}
                                  alt=""
                                  className="h-[22px] w-[22px] shrink-0 rounded-[6px] object-cover bg-white border border-black/10 dark:border-white/10"
                                />
                              ) : (
                                <span
                                  className={`h-[22px] w-[22px] shrink-0 rounded-[6px] ${getBrandAvatarColor(item.name)} text-white text-[9.5px] font-bold flex items-center justify-center`}
                                >
                                  {item.name ? item.name.slice(0, 2).toUpperCase() : 'B'}
                                </span>
                              )}
                              <span className="truncate">{item.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-[var(--ws-border)] mt-1 pt-1 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => {
                            setBrandSource({ kind: 'none' });
                            fillFromBrand({ name: '', description: '', logoUrls: [], imageUrls: [] });
                            setShowBrandIqPicker(false);
                          }}
                          className="w-full flex items-center gap-2 p-[6px_8px] rounded-[9px] text-[12.5px] text-[#85829A] hover:bg-[var(--ws-surface-hover)] dark:text-gray-400 dark:hover:bg-white/10"
                        >
                          <X size={14} /> No brand voice
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-[#85829A] px-0.5">or</span>
                <input
                  type="text"
                  value={bvWebsiteUrl}
                  onChange={(e) => {
                    setBvWebsiteUrl(e.target.value);
                    if (autofillState === 'error' || autofillState === 'ok') {
                      setAutofillState('idle');
                      setAutofillError('');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAutofill();
                    }
                  }}
                  placeholder="Enter your website URL..."
                  className="flex-1 min-w-0 border-0 bg-transparent px-1 text-[13px] text-[#1F1D29] placeholder:text-[#85829A] outline-none dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleAutofill}
                  disabled={!bvWebsiteUrl.trim() || autofillState === 'loading'}
                  className="h-[34px] px-[14px] rounded-[8px] bg-[#1F1D29] hover:bg-black text-white text-[12px] font-semibold transition-opacity disabled:bg-[#C9C7D4] disabled:cursor-default dark:disabled:border dark:disabled:border-white/10 dark:disabled:bg-[#34343B] dark:disabled:text-[#8F8D99]"
                >
                  {autofillState === 'loading' ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                </button>
              </div>

              {autofillState === 'error' && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                  <AlertCircle size={12} /> {autofillError}
                </p>
              )}
            </div>

            {/* 2. Product Name */}
            {cfg.nameField && (
              <div className="col-span-2">
                <FieldLabel required>{cfg.nameField.label}</FieldLabel>
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => {
                    setNameValue(e.target.value);
                    clearError('name');
                  }}
                  placeholder={cfg.nameField.placeholder}
                  aria-invalid={Boolean(errors.name) || undefined}
                  className={`adcreative-white-input h-[42px] w-full rounded-[10px] border !bg-[var(--ws-surface-control)] px-[14px] text-[14px] text-[#1F1D29] placeholder:text-[#85829A] outline-none transition-all dark:border-[var(--adcreative-dark-border)] dark:!bg-[var(--adcreative-dark-control)] dark:text-white ${
                    errors.name
                      ? 'border-red-500 ring-1 ring-red-500/30'
                      : 'border-[var(--ws-border)] focus:border-[#5867EB] focus:ring-[3px] focus:ring-[#5867EB]/16'
                  }`}
                />
                <FieldError message={errors.name} />
              </div>
            )}

            {/* 3. Product Description */}
            <div className="col-span-2">
              <FieldLabel required={isLifestyle}>{cfg.descLabel}</FieldLabel>
              <textarea
                value={productDescription}
                onChange={(e) => {
                  setProductDescription(e.target.value);
                  clearError('productDescription');
                }}
                placeholder={cfg.descPlaceholder}
                aria-invalid={Boolean(errors.productDescription) || undefined}
                className={`adcreative-white-input h-[78px] w-full resize-none rounded-[12px] border bg-[var(--ws-surface-control)] p-[10px_14px] text-[14px] leading-[1.5] text-[#1F1D29] placeholder:text-[#85829A] outline-none transition-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-[var(--adcreative-dark-border)] dark:bg-[var(--adcreative-dark-control)] dark:text-white ${
                  errors.productDescription
                    ? 'border-red-500 ring-1 ring-red-500/30'
                    : 'border-[var(--ws-border)] focus:border-[#5867EB] focus:ring-[3px] focus:ring-[#5867EB]/16'
                }`}
              />
              <FieldError message={errors.productDescription} />
            </div>

              {isLifestyle && (
                <div className="col-span-2 space-y-2.5">
                  <FieldLabel>Model Description</FieldLabel>
                  <div className="rounded-[16px] bg-[var(--ws-surface-control)] border border-[var(--ws-border)] p-3.5 dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)]">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
                      <PillDropdown
                        label="Age"
                        value={age}
                        onChange={setAge}
                        options={AGE_OPTIONS}
                      />
                      <PillDropdown
                        label="Language"
                        value={language}
                        onChange={setLanguage}
                        options={LANGUAGE_OPTIONS}
                      />
                      <PillDropdown
                        label="Gender"
                        value={gender}
                        onChange={setGender}
                        options={GENDER_OPTIONS}
                      />
                      <PillDropdown
                        label="Ethnicity"
                        value={ethnicity}
                        onChange={setEthnicity}
                        options={ETHNICITY_OPTIONS}
                      />
                      <PillDropdown
                        label="Mood"
                        value={mood}
                        onChange={setMood}
                        options={MOOD_OPTIONS}
                      />
                      <PillDropdown
                        label="Wardrobe"
                        value={wardrobe}
                        onChange={setWardrobe}
                        options={WARDROBE_OPTIONS}
                      />
                    </div>
                    <div className="mt-3.5 pt-3 border-t border-[var(--ws-border)] dark:border-white/10">
                      <FileUploadField
                        label="Model Reference Images (If any):"
                        placeholder="Upload your model Image or URL"
                        url={modelRefUrl}
                        onUrlChange={setModelRefUrl}
                        files={modelRefImages}
                        onAddFiles={(items) => addModelRefImages(items)}
                        onRemoveFile={(i) => {
                          setModelRefImages((p) => p.filter((_, idx) => idx !== i));
                          clearError('images');
                        }}
                        onPreview={(i) => openPreview(modelRefImages, i)}
                        onInvalidType={() =>
                          setErrors((p) => ({ ...p, images: IMAGE_TYPE_ERROR }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className={cfg.logo ? "col-span-1" : "col-span-2"}>
                <FileUploadField
                  label={cfg.images.label}
                  placeholder={cfg.images.placeholder}
                  url={imageUrl}
                  onUrlChange={(v) => {
                    setImageUrl(v);
                    if (v.trim()) clearError('images');
                  }}
                  files={images}
                  onAddFiles={(items) => addImages(items)}
                  onRemoveFile={(i) => {
                    setImages((p) => p.filter((_, idx) => idx !== i));
                    clearError('images');
                  }}
                  onPreview={(i) => openPreview(images, i)}
                  onInvalidType={() =>
                    setErrors((p) => ({ ...p, images: IMAGE_TYPE_ERROR }))
                  }
                />
                <FieldError message={errors.images} prominent />
                {/* Brand-image chips. Surface scraped/BrandIQ images
                    directly below the field they feed (Key Visuals /
                    Reference Images / Product Images). Single click
                    toggles inclusion in `images`; double-click previews. */}
                {brandImagePool.length > 0 && (
                  <BrandImageChipRow
                    options={brandImagePool}
                    isSelected={(u) => brandImagesPicked.includes(u)}
                    onPick={(u) => {
                      setBrandImagesPicked((prev) => {
                        if (prev.includes(u)) {
                          clearError('images');
                          return prev.filter((x) => x !== u);
                        }
                        const key = imageItemKey({ file: null, preview: u });
                        const isDuplicate = [...modelRefImages, ...images]
                          .some((item) => imageItemKey(item) === key)
                          || imageItemKey({ file: null, preview: modelRefUrl.trim() }) === key
                          || imageItemKey({ file: null, preview: imageUrl.trim() }) === key;
                        if (isDuplicate) {
                          setErrors((e) => ({ ...e, images: IMAGE_ALREADY_ATTACHED_ERROR }));
                          return prev;
                        }
                        if (remainingPromptSlots <= 0) {
                          setErrors((e) => ({
                            ...e,
                            images: `You can attach up to ${MAX_PROMPT_THUMBS} images.`,
                          }));
                          return prev;
                        }
                        clearError('images');
                        return [...prev, u];
                      });
                    }}
                    onDoubleClick={(u) => {
                      setLightboxImages(brandImagePool);
                      setLightboxImage(u);
                      setLightboxOpen(true);
                    }}
                  />
                )}
              </div>

              {cfg.logo && (
                <div className="col-span-1">
                  <FileUploadField
                    label={cfg.logo.label}
                    placeholder={cfg.logo.placeholder}
                    url={logoUrl}
                    onUrlChange={(v) => {
                      setLogoUrl(v);
                      if (v.trim()) clearError('logo');
                    }}
                    files={logoFiles}
                    onAddFiles={async (items) => {
                      const [logo] = items;
                      if (!logo) return;

                      const check = await analyzeLogoTransparency(logo.file || logo.preview);
                      if (!check.transparent) {
                        if (logo.file && logo.preview?.startsWith('blob:')) {
                          URL.revokeObjectURL(logo.preview);
                        }
                        setErrors((p) => ({ ...p, logo: LOGO_BACKGROUND_ERROR }));
                        return;
                      }

                      setLogoFiles([logo]);
                      clearError('logo');
                    }}
                    onRemoveFile={(i) => setLogoFiles((p) => p.filter((_, idx) => idx !== i))}
                    onPreview={(i) => openPreview(logoFiles, i)}
                    onInvalidType={() =>
                      setErrors((p) => ({ ...p, logo: IMAGE_TYPE_ERROR }))
                    }
                    multiple={false}
                  />
                  <FieldError message={errors.logo} />
                  {/* Scraped/BrandIQ logos as picker chips — none auto-
                      selected. Single click picks (single-select); double
                      click previews. Selection lives in brandLogoPicked
                      (separate from the upload field). */}
                  {brandLogoOptions.length > 0 && (
                    <BrandImageChipRow
                      options={brandLogoOptions}
                      isSelected={(u) => u === brandLogoPicked}
                      onPick={(u) => {
                        // Picking here clears any uploaded file — submit
                        // precedence is file > typed URL > picked.
                        setLogoFiles([]);
                        setBrandLogoPicked((cur) => (cur === u ? '' : u));
                      }}
                      onDoubleClick={(u) => {
                        setLightboxImages(brandLogoOptions);
                        setLightboxImage(u);
                        setLightboxOpen(true);
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

        <div className="flex justify-end items-center gap-[10px] mt-[18px] pt-[14px] border-t border-[var(--ws-border)] dark:border-white/10">
          {total > 0 && (
            <span className="text-[12px] text-[#85829A] font-medium border border-[var(--ws-border)] bg-[var(--ws-surface-control)] rounded-full px-[9px] py-[3px] dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)] dark:text-gray-300">
              ~{total * creditsPerImage} credits
            </span>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="h-[42px] px-[26px] rounded-[11px] bg-[#5867EB] hover:bg-[#4755D9] text-white font-semibold text-[14px] shadow-[0_8px_18px_-8px_rgba(88,103,235,0.6)] transition-all disabled:bg-[#B9C0F5] disabled:shadow-none disabled:cursor-default dark:disabled:border dark:disabled:border-white/10 dark:disabled:bg-[#353442] dark:disabled:text-[#9692AB]"
          >
            Generate
          </button>
        </div>
        {lightboxOpen && (
          <ShowLightBox
            images={lightboxImages}
            lightboxImage={lightboxImage}
            closeLightbox={() => setLightboxOpen(false)}
          />
        )}
      </div>
    </LifestyleShell>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function PillDropdown({ label, value, onChange, options = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const display = value || options[0] || 'Select';

  return (
    <div ref={ref} className="relative flex items-center justify-between gap-1.5 min-w-0">
      <span className="text-[12px] text-[#85829A] dark:text-gray-400 font-medium shrink-0">{label}</span>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`${label}: ${display}`}
          aria-expanded={open}
          className={`inline-flex h-[30px] items-center justify-between gap-1.5 whitespace-nowrap rounded-[8px] border px-2 text-[12px] font-medium text-[#1F1D29] shadow-[var(--ws-shadow-sm)] transition-[background-color,border-color,box-shadow] outline-none focus-visible:border-[#5867EB] focus-visible:ring-[3px] focus-visible:ring-[#5867EB]/16 dark:bg-white/10 dark:text-white dark:shadow-none dark:focus-visible:border-white/30 dark:focus-visible:ring-white/15 ${
            open
              ? 'border-[#5867EB] bg-[#ECEDEF] ring-[3px] ring-[#5867EB]/16 dark:border-white/25 dark:bg-white/15 dark:ring-white/10'
              : 'border-[var(--ws-border)] bg-[#ECEDEF] hover:border-[var(--ws-border-strong)] hover:bg-[#E3E5E8] dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/15'
          }`}
        >
          <span className="max-w-[75px] truncate">{display}</span>
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-[calc(100%+4px)] right-0 z-40 min-w-[130px] max-h-[180px] overflow-y-auto rounded-[12px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-popup)] shadow-[var(--ws-shadow-md)] dark:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.5)] border border-[var(--ws-border)] dark:border-[var(--adcreative-dark-border)] p-1">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left ${
                  opt === value
                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                    : 'text-gray-700 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'
                }`}
              >
                <span>{opt}</span>
                {opt === value && <Check size={12} className="text-[#5867EB] dark:text-[#8D99FF]" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <span className="block text-[13px] font-semibold text-[#1F1D29] dark:text-white mb-[7px]">
      {children}
      {required && <span className="text-[#5867EB] ml-0.5">*</span>}
    </span>
  );
}

function FieldError({ message, prominent = false }) {
  if (!message) return null;
  if (prominent) {
    return (
      <div
        className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-3 text-[13px] font-medium leading-5 text-red-700 shadow-sm dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-200"
        role="alert"
        aria-live="assertive"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
        <span>{message}</span>
      </div>
    );
  }
  return (
    <p className="mt-1.5 text-[12px] text-red-400" role="alert">
      {message}
    </p>
  );
}

function LabeledInput({ label, required, value, onChange, placeholder, error, className = "col-span-1" }) {
  return (
    <div className={className}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        className={`adcreative-white-input h-[42px] w-full rounded-[10px] border bg-[var(--ws-surface-control)] px-[14px] text-[14px] text-[#1F1D29] placeholder:text-[#85829A] outline-none transition-all dark:border-[var(--adcreative-dark-border)] dark:bg-[var(--adcreative-dark-control)] dark:text-white ${
          error
            ? 'border-red-500 ring-1 ring-red-500/30'
            : 'border-[var(--ws-border)] focus:border-[#5867EB] focus:ring-[3px] focus:ring-[#5867EB]/16'
        }`}
      />
      <FieldError message={error} />
    </div>
  );
}

function LabeledTextarea({ label, required, value, onChange, placeholder, error }) {
  return (
    <div className="col-span-2">
      <FieldLabel required={required}>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        className={`adcreative-white-input h-[78px] w-full resize-none rounded-[12px] border bg-[var(--ws-surface-control)] p-[10px_14px] text-[14px] leading-[1.5] text-[#1F1D29] placeholder:text-[#85829A] outline-none transition-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:bg-[var(--adcreative-dark-control)] dark:text-white ${
          error
            ? 'border-red-500 ring-1 ring-red-500/30'
            : 'border-[var(--ws-border)] focus:border-[#5867EB] focus:ring-[3px] focus:ring-[#5867EB]/16 dark:border-white/10'
        }`}
      />
      <FieldError message={error} />
    </div>
  );
}

function FileUploadField({
  label,
  placeholder,
  url,
  onUrlChange,
  files,
  onAddFiles,
  onRemoveFile,
  onPreview,
  onInvalidType,
  multiple = true,
  hidePreview = false,
  className,
}) {
  const inputRef = useRef(null);
  const [isDrag, setIsDrag] = useState(false);

  const acceptFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    const valid = arr.filter(isAllowedImageFile);
    const rejected = arr.length - valid.length;
    if (valid.length > 0) {
      onAddFiles(valid.map((f) => ({ file: f, preview: URL.createObjectURL(f) })));
    }
    if (rejected > 0) onInvalidType?.();
  };

  return (
    <div className={className}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onPaste={(e) => {
          const dtFiles = e.clipboardData?.files;
          if (dtFiles && dtFiles.length > 0) {
            e.preventDefault();
            acceptFiles(dtFiles);
            return;
          }
          const text = e.clipboardData?.getData('text');
          if (text && /^https?:\/\//i.test(text.trim())) {
            e.preventDefault();
            onAddFiles([{ file: null, preview: text.trim() }]);
            onUrlChange('');
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDrag(true);
        }}
        onDragLeave={() => setIsDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDrag(false);
          const dtFiles = e.dataTransfer?.files;
          if (dtFiles && dtFiles.length > 0) {
            acceptFiles(dtFiles);
            return;
          }
          const dragged = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
          const trimmed = dragged.trim();
          if (trimmed && /^https?:\/\//i.test(trimmed)) {
            onAddFiles([{ file: null, preview: trimmed }]);
            onUrlChange('');
          }
        }}
        className={`adcreative-field-white flex items-center gap-1.5 h-[42px] pl-3 pr-1 bg-[var(--ws-surface-control)] border rounded-[10px] transition-all ${
          isDrag
            ? 'border-solid border-[#5867EB] ring-[3px] ring-[#5867EB]/16'
            : 'border-dashed border-[var(--ws-border)] focus-within:border-solid focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16'
        } dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)]`}
      >
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 border-0 bg-transparent text-[13px] text-[#1F1D29] placeholder:text-[#85829A] outline-none dark:text-white"
        />
        <LinkIcon size={14} className="text-[#85829A] shrink-0" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Upload image"
          className="h-[34px] w-[34px] shrink-0 rounded-[8px] bg-[#ECEEFD] hover:bg-[#C9CEF8] text-[#5867EB] flex items-center justify-center transition-colors dark:bg-indigo-950/60 dark:text-indigo-300"
        >
          <UploadCloud size={16} strokeWidth={2} />
        </button>
      </div>

      {!hidePreview && (files.length > 0 || url?.trim()) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((it, i) => (
            <div
              key={`${it.preview}-${i}`}
              className="group relative h-[34px] w-[34px] shrink-0 rounded-[8px] border border-[#3AD0C8] bg-white transition-transform hover:-translate-y-0.5"
            >
              <button
                type="button"
                onDoubleClick={() => onPreview?.(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPreview?.(i);
                  }
                }}
                aria-label={`Preview uploaded image ${i + 1}`}
                title="Double-click to preview"
                className="block h-full w-full cursor-pointer rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5867EB] focus-visible:ring-offset-1"
              >
                <img
                  src={it.preview}
                  alt=""
                  className="pointer-events-none h-full w-full rounded-[7px] object-cover"
                />
              </button>
              <span className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-[#3AD0C8] text-[10px] text-white shadow-sm transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                <Check size={10} strokeWidth={3} />
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(i);
                }}
                aria-label={`Remove uploaded image ${i + 1}`}
                className="absolute -top-1.5 -right-1.5 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow transition-opacity hover:bg-red-600 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandImageChipRow({ options, isSelected, onPick, onDoubleClick }) {
  const clickTimers = useRef({});
  return (
    <div className="mt-2">
      <p className="text-[10.5px] font-medium text-[#85829A] mb-[5px]">
        From your brand · double-click to preview
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((url, i) => {
          const selected = isSelected?.(url);
          const handleSingle = () => {
            clearTimeout(clickTimers.current[url]);
            clickTimers.current[url] = setTimeout(() => {
              onPick?.(url);
              delete clickTimers.current[url];
            }, 220);
          };
          const handleDouble = () => {
            clearTimeout(clickTimers.current[url]);
            delete clickTimers.current[url];
            onDoubleClick?.(url);
          };
          return (
            <div
              key={`bp-${i}-${url}`}
              onClick={handleSingle}
              onDoubleClick={handleDouble}
              title={selected ? 'Click to remove · double-click to preview' : 'Click to select · double-click to preview'}
              className={`relative h-[34px] w-[34px] shrink-0 rounded-[8px] border bg-white cursor-pointer transition-transform hover:-translate-y-0.5 ${
                selected ? 'border-[#3AD0C8]' : 'border-[var(--ws-border)]'
              }`}
            >
              <img src={url} alt="" className="h-full w-full rounded-[7px] object-cover" />
              {selected && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#3AD0C8] text-white border-2 border-white text-[10px]">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QualityPickerPill({ value, onChange, model }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { models } = useAdCreativeConfig();
  const qualities = models.find((m) => m.apiId === model)?.qualities || [];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Aspect quantity dropdown is portalled to <body>, outside this ref.
      if (e.target?.closest?.('[data-aspect-quantity-menu]')) return;
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeLabel = qualityLabel(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] bg-[var(--ws-surface-header)] hover:bg-[var(--ws-surface-hover)] text-[#4A4758] hover:text-[#1F1D29] text-[12px] font-medium whitespace-nowrap transition-colors dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15 dark:hover:text-white"
      >
        {activeLabel}
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[140px] overflow-hidden rounded-[18px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-popup)] shadow-2xl ring-1 ring-[var(--ws-border)] dark:ring-[var(--adcreative-dark-border)]">
          {qualities.map((q) => {
            const selected = q === value;
            return (
              <button
                key={q}
                type="button"
                onClick={() => {
                  onChange(q);
                  setOpen(false);
                }}
                className={`flex w-full items-center px-3 py-2.5 text-left text-[13px] transition-colors ${
                  selected
                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                    : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                }`}
              >
                <span className="flex-1">{qualityLabel(q)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModelPickerPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { models } = useAdCreativeConfig();
  const selectedModel = models.find((m) => m.apiId === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Aspect quantity dropdown is portalled to <body>, outside this ref.
      if (e.target?.closest?.('[data-aspect-quantity-menu]')) return;
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] bg-[var(--ws-surface-header)] hover:bg-[var(--ws-surface-hover)] text-[#4A4758] hover:text-[#1F1D29] text-[12px] font-medium whitespace-nowrap transition-colors dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15 dark:hover:text-white"
      >
        <span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center">
          <ModelIcon apiId={value} icon={selectedModel?.icon} />
        </span>
        {selectedModel?.label || value}
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[180px] overflow-hidden rounded-[18px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-popup)] shadow-2xl ring-1 ring-[var(--ws-border)] dark:ring-[var(--adcreative-dark-border)]">
          {models.map((opt) => {
            const selected = opt.apiId === value;
            return (
              <button
                key={opt.apiId}
                type="button"
                onClick={() => {
                  onChange(opt.apiId);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                  selected
                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                    : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                  <ModelIcon apiId={opt.apiId} icon={opt.icon} />
                </span>
                <span className="flex-1">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RatioPickerPill({ counts, onChange, model, quality }) {
  // Shared ad_creative config cache — multiple components calling the hook
  // still cost one network request per session.
  const { models } = useAdCreativeConfig();
  const selectedModel = models.find((m) => m.apiId === model);
  const creditsPerImage =
    selectedModel?.creditsByQuality?.[quality] ?? selectedModel?.creditsPerImage ?? 7;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const total = totalImages(counts);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      // Aspect quantity dropdown is portalled to <body>, outside this ref.
      if (e.target?.closest?.('[data-aspect-quantity-menu]')) return;
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[9px] bg-[var(--ws-surface-header)] hover:bg-[var(--ws-surface-hover)] text-[#4A4758] hover:text-[#1F1D29] text-[12px] font-medium whitespace-nowrap transition-colors dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15 dark:hover:text-white"
      >
        <Proportions size={16} strokeWidth={1.8} className="text-gray-600 dark:text-white/70" />
        <span className="h-3 w-px bg-black/20 dark:bg-white/20" />
        <LayoutGrid size={11} strokeWidth={1.8} className="text-gray-500 dark:text-white/50" />
        <span className="text-xs font-medium">
          {total} Image{total !== 1 ? 's' : ''}
        </span>
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      <AnimatedPanel
        open={open}
        className="absolute right-0 bottom-full z-30 mb-2 w-[300px] rounded-[20px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-popup)] p-4 shadow-2xl ring-1 ring-[var(--ws-border)] dark:ring-[var(--adcreative-dark-border)]"
      >
        <AspectRatioTiles
          counts={counts}
          onChange={onChange}
          ratios={selectedModel?.aspectRatios || []}
          creditsPerImage={creditsPerImage}
        />
      </AnimatedPanel>
    </div>
  );
}
