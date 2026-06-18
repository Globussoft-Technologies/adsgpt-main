import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { clearImageRecreateInputs } from '@/store/reducers/image/imageSlice';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  LayoutGrid,
  LinkIcon,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react';
import { SiOpenai } from 'react-icons/si';
import axios from 'axios';
import { toast } from 'react-toastify';
import { LifestyleShell } from '../LifestyleShell';
import { TemplatesPanel, TemplatesTrigger } from '../../components/PromptTemplatesPicker';
import { usePromptTemplates } from '../../components/usePromptTemplates';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import geminiIcon from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceIcon from '@/assets/layouts/profile/seedance_logo_transparent.png';
import chatResponseDark from '@/assets/layouts/adstudio/chat-response-dark.svg';
import brandIqIcon from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import getCookies from '@/utils/getCookies';
import { useImageCreditsForModel } from '@/utils/hooks/useImageCreditsForModel';
import {
  ALLOWED_IMAGE_ACCEPT,
  IMAGE_TYPE_ERROR,
  isAllowedImageFile,
} from '@/utils/imageValidation';
import {
  AUTOFILL_FAILURE_MESSAGE,
  fetchAutofill,
  fetchBrandList,
  getAuthToken,
  getUserId,
} from '../../ai-creatives/apiClient';
import { silentSaveBrandFromAutofill } from '../../ai-creatives/silentBrandSave';

const PROMPT_API = import.meta.env.VITE_PROMPT_API;

// Each entry carries either a ReactNode `icon` or an image path `iconSrc`
// (the picker renders the latter via <img>).
const MODEL_OPTIONS = [
  { name: 'Nano Banana 2', available: true, iconSrc: geminiIcon },
  { name: 'Nano Banana Pro', available: true, iconSrc: geminiIcon },
  { name: 'OpenAI 1.5', available: true, icon: <SiOpenai size={14} className="text-gray-500 dark:text-white/80" /> },
  { name: 'OpenAI 2.0', available: true, icon: <SiOpenai size={14} className="text-gray-500 dark:text-white/80" /> },
  { name: 'Seedream 5.0 lite', available: true, iconSrc: seedanceIcon },
];

function ModelIcon({ option }) {
  if (option?.iconSrc) {
    return <img src={option.iconSrc} alt="" className="h-3.5 w-3.5 object-contain" />;
  }
  return option?.icon ?? null;
}

const ASPECT_LABELS = [
  { key: '1:1', label: '1:1 (square)' },
  { key: '2:3', label: '2:3 (portrait)' },
  { key: '3:2', label: '3:2 (landscape)' },
  { key: '9:16', label: '9:16 (vertical widescreen)' },
  { key: '16:9', label: '16:9 (widescreen)' },
];

// OpenAI's image models currently only generate these three ratios.
const OPENAI_ALLOWED_RATIOS = new Set(['1:1', '2:3', '3:2']);
const isOpenAIModel = (name) => /^openai/i.test(String(name || ''));
const allowedAspectLabels = (modelName) =>
  isOpenAIModel(modelName)
    ? ASPECT_LABELS.filter((a) => OPENAI_ALLOWED_RATIOS.has(a.key))
    : ASPECT_LABELS;

const DEFAULT_RATIO_COUNTS = { '1:1': 1, '2:3': 0, '3:2': 0, '9:16': 0, '16:9': 0 };

// Generation quality tiers. Value matches the backend contract verbatim
// (Joi accepts 'low' | 'medium' | 'high'); label is the picker text.
const QUALITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// HIDE-MARK — Quality picker hidden (lifestyle/product-shot/apps-saas/brand
// share this step). Named flag avoids a literal `false &&`; flip to re-enable.
// `quality` state stays 'medium' so the payload is unchanged (backend optional).
const SHOW_QUALITY_PICKER = false;

// Reverse of LifestyleAdsFlow.MODEL_TO_API — used to map a stored API model
// id back to the UI label for the recreate-from-history flow.
const API_MODEL_TO_UI = {
  'gemini-3.1-flash-image-preview': 'Nano Banana 2',
  'gemini-3-pro-image-preview': 'Nano Banana Pro',
  'gpt-image-1.5': 'OpenAI 1.5',
  'gpt-image-2': 'OpenAI 2.0',
  'seedream-5.0-lite': 'Seedream 5.0 lite',
};

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

const totalImages = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const primaryRatio = (counts) => ASPECT_LABELS.find(({ key }) => counts[key] > 0)?.key ?? '1:1';

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
    images: { label: 'Product Images:', placeholder: 'Upload your Product images' },
    logo: { label: 'Brand Logo:', placeholder: 'Paste your Brand logo URL' },
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

  const templates = usePromptTemplates({
    type: VARIANT_TO_API_TYPE[variant] || 'lifestyle',
    brandName: brandNameForTemplates,
    targetAudience: targetAudienceForTemplates,
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

  const handleBrandIqOpen = async () => {
    setShowBrandIqPicker((open) => !open);
    if (brandList.length > 0 || brandListState === 'loading') return;
    brandListAbortRef.current?.abort();
    brandListAbortRef.current = new AbortController();
    setBrandListState('loading');
    setBrandListError('');
    try {
      const items = await fetchBrandList(
        getUserId(),
        getAuthToken(),
        brandListAbortRef.current.signal,
      );
      setBrandList(items);
      setBrandListState('loaded');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setBrandListError(err.message || 'Failed to load brands');
      setBrandListState('error');
    }
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

    if (inp.model && API_MODEL_TO_UI[inp.model]) {
      setModel(API_MODEL_TO_UI[inp.model]);
    }

    if (QUALITY_OPTIONS.some((q) => q.value === inp.quality)) {
      setQuality(inp.quality);
    }

    // Aspect ratio. Prefer the structured aspectRatioPerImage if present;
    // otherwise fall back to the flat aspectRatio + numberOfImages pair.
    if (Array.isArray(inp.aspectRatioPerImage) && inp.aspectRatioPerImage.length > 0) {
      const counts = { ...DEFAULT_RATIO_COUNTS };
      for (const { aspectRatio, numberOfImages } of inp.aspectRatioPerImage) {
        if (aspectRatio in counts) counts[aspectRatio] = Number(numberOfImages) || 0;
      }
      setRatioCounts(counts);
    } else if (inp.aspectRatio) {
      const counts = { ...DEFAULT_RATIO_COUNTS, [inp.aspectRatio]: 0 };
      if (inp.aspectRatio in counts) {
        counts[inp.aspectRatio] = Number(inp.numberOfImages) || 1;
      }
      setRatioCounts(counts);
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
      setImages(visuals.filter((u) => u && !brandSet.has(u)).map(toItem));
      const refs = Array.isArray(inp.modelReferenceImages) ? inp.modelReferenceImages : [];
      setModelRefImages(refs.filter(Boolean).map(toItem));
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
        },
      });
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

  const [model, setModel] = useState('Nano Banana 2');
  const [quality, setQuality] = useState('medium');
  const [ratioCounts, setRatioCounts] = useState(DEFAULT_RATIO_COUNTS);
  // Live per-model credit cost from /adsgpt/usage/model-credit-value
  // (shared cache). Falls back to 7 while loading or on API error.
  const creditsPerImage = useImageCreditsForModel(model);

  // Switching to an OpenAI model removes 9:16 / 16:9 from the picker; zero
  // out any counts the user may have already set so totals + payload match
  // what the backend will accept.
  useEffect(() => {
    if (!isOpenAIModel(model)) return;
    setRatioCounts((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of Object.keys(next)) {
        if (!OPENAI_ALLOWED_RATIOS.has(key) && next[key] > 0) {
          next[key] = 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [model]);
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
  const MAX_PROMPT_THUMBS = 5;
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
    }
    images.forEach((it) => push('image', it.preview));
    brandImagesPicked.forEach((u) => push('brand-pool', u));
    return out;
  })();
  const remainingPromptSlots = Math.max(0, MAX_PROMPT_THUMBS - promptThumbs.length);

  // Wrappers around setImages / setModelRefImages that respect the cap and
  // surface a toast-style error when the user tries to overshoot.
  const addImages = (items) => {
    if (remainingPromptSlots <= 0) {
      setErrors((p) => ({
        ...p,
        images: `You can attach up to ${MAX_PROMPT_THUMBS} images.`,
      }));
      return;
    }
    const accepted = items.slice(0, remainingPromptSlots);
    setImages((p) => [...p, ...accepted]);
    if (accepted.length > 0) clearError('images');
  };
  const addModelRefImages = (items) => {
    if (remainingPromptSlots <= 0) {
      setErrors((p) => ({
        ...p,
        images: `You can attach up to ${MAX_PROMPT_THUMBS} images.`,
      }));
      return;
    }
    const accepted = items.slice(0, remainingPromptSlots);
    setModelRefImages((p) => [...p, ...accepted]);
  };

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
    if (Object.keys(e).length > 0 || total === 0) {
      setErrors(e);
      return;
    }
    setErrors({});

    // Items are { file?, preview }. The pasted URL field gets folded in as
    // a final unaffiliated entry so the parent treats it like any other
    // already-hosted item at submit time.
    const allImages = [...images];
    if (imageUrl.trim()) allImages.push({ file: null, preview: imageUrl.trim() });
    // Fold chip-picked brand images into the payload too. They live in their
    // own state so they don't appear as thumbnails in the upload field, but
    // they must still ship as references at submit time.
    for (const u of brandImagesPicked) {
      if (u && !allImages.some((it) => it.preview === u)) {
        allImages.push({ file: null, preview: u });
      }
    }

    const refImages = [...modelRefImages];
    if (modelRefUrl.trim()) refImages.push({ file: null, preview: modelRefUrl.trim() });

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
      <div className="relative w-full min-w-[420px] max-w-[1100px] max-h-[calc(100svh-80px)] overflow-y-auto rounded-[30px] bg-white dark:bg-[#303030]/30 p-6 ring-1 ring-black/10 dark:ring-white/10 backdrop-blur-md lg:px-8 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin] 2xl:max-h-[calc(100svh-140px)]">
        {/* Back arrow always shows. With the single-step flow, there's no
            prior step to return to — so falls back to `onClose`, which
            exits the module (same as AI Creatives Custom). */}
        {(onBack || onClose) && (
          <button
            type="button"
            onClick={onBack ?? onClose}
            aria-label="Back"
            className="absolute top-4 left-4 z-10 flex h-12 w-12 items-center justify-center text-gray-500 dark:text-white/70 transition-colors hover:text-black dark:hover:text-white"
          >
            <ArrowLeft size={26} strokeWidth={2} />
          </button>
        )}
        <h3 className="mb-3 text-center text-[16px] font-semibold text-gray-900 dark:text-white">{cfg.title}</h3>

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

        <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[455fr_443fr] lg:gap-6">
          {/* Left — Instructions textarea + model + ratio pills */}
          <div className={`flex min-h-0 flex-col ${isLifestyle ? '' : 'mb-6 2xl:mb-2'}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[16px] text-gray-900 dark:text-white">
                {/* Instructions<span>*</span> */}
                Prompt<span>*</span>
              </p>
              <TemplatesTrigger controller={templates} />
            </div>
            <TemplatesPanel controller={templates} />
            <div
              className={`relative flex flex-1 flex-col rounded-[24px] bg-gray-100 dark:bg-[#909294]/10 ring-1 focus-within:ring-2 focus-within:ring-black/10 dark:focus-within:ring-white/20 transition-[min-height] duration-[250ms] ease-out ${
                templates.open ? 'min-h-[200px]' : 'min-h-[380px]'
              } ${
                errors.instructions ? 'ring-2 ring-red-500/60' : 'ring-black/10 dark:ring-white/10'
              }`}
            >
              <textarea
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  clearError('instructions');
                }}
                placeholder="How would you like your creatives....."
                className="min-h-0 flex-1 resize-none rounded-t-[24px] bg-transparent px-6 pt-5 pb-2 text-[15px] font-light text-gray-900 dark:text-white outline-none placeholder:text-gray-500 dark:placeholder:text-[#afafaf]/80"
              />
              {/* Prompt-box preview row — selected images (key visuals +
                  model refs for Lifestyle; product/reference images
                  otherwise). Capped at 5. Brand logo is intentionally
                  excluded. Each thumb has an X that removes the matching
                  item from its source list. */}
              {promptThumbs.length > 0 && (
                <div className="flex flex-nowrap items-end justify-end gap-2 overflow-x-auto px-3 pb-2">
                  {promptThumbs.map((t, i) => (
                    <div
                      key={`prompt-thumb-${t.kind}-${i}-${t.preview}`}
                      className="relative h-[160px] w-[90px] shrink-0 overflow-hidden rounded-[10px] ring-1 ring-black/10 dark:ring-white/10"
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
                        }}
                        className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-transform hover:scale-105"
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3">
                {/* Improve prompt with Gemini — same icon + behaviour as
                    Ad Studio's chat-bar wand. Sits immediately to the left
                    of the model picker. */}
                <button
                  type="button"
                  onClick={handleImprovePrompt}
                  disabled={!instructions.trim() || isSuggestingPrompt}
                  title="Improve with Gemini"
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSuggestingPrompt ? (
                    <Loader2 size={20} className="animate-spin text-gray-900 dark:text-white" />
                  ) : (
                    <img
                      src={chatResponseDark}
                      alt="Improve with Gemini"
                      className="h-5 w-5 2xl:h-6 2xl:w-6"
                    />
                  )}
                </button>
                {/* HIDE-MARK — Quality picker hidden via SHOW_QUALITY_PICKER. */}
                {SHOW_QUALITY_PICKER && <QualityPickerPill value={quality} onChange={setQuality} />}
                <ModelPickerPill value={model} onChange={setModel} />
                <RatioPickerPill counts={ratioCounts} onChange={setRatioCounts} model={model} />
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
          <div className={`flex flex-col ${isLifestyle ? '' : 'mt-10'}`}>
            <div className="space-y-6 p-1">
              {/* Inline brand-voice picker — replaces the standalone
                  BrandInfoStep. Picking from BrandIQ or hitting Add on a
                  URL autofills the form below. */}
              <div ref={brandIqWrapperRef} className="relative lg:mr-3">
                <FieldLabel>Attach your Brand Voice</FieldLabel>
                <div className="mt-3 flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#909294]/10 p-1 ring-1 ring-black/10 dark:ring-white/5">
                  <button
                    type="button"
                    onClick={handleBrandIqOpen}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-gray-900 dark:text-white transition-colors ${
                      brandSource.kind === 'list' || brandSource.kind === 'autofill'
                        ? 'bg-black/5 dark:bg-white/15 ring-1 ring-black/10 dark:ring-white/20'
                        : 'bg-white dark:bg-[#303030] hover:bg-black/5 dark:hover:bg-[#3a3a3a]'
                    }`}
                  >
                    <img src={brandIqIcon} alt="" className="h-3.5 w-3.5" />
                    {brandSource.kind === 'list'
                      ? brandSource.item.name
                      : brandSource.kind === 'autofill'
                        ? brandSource.data?.brandInfo?.brandName || 'Brand IQ'
                        : 'Brand IQ'}
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${showBrandIqPicker ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <span className="text-[11px] text-gray-500 dark:text-white/40">or</span>
                  <input
                    type="text"
                    inputMode="url"
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
                    className="flex-1 bg-transparent px-2 text-[13px] text-gray-900 dark:text-white outline-none placeholder:text-gray-500 dark:placeholder:text-[#afafaf]/80"
                  />
                  <button
                    type="button"
                    onClick={handleAutofill}
                    disabled={!bvWebsiteUrl.trim() || autofillState === 'loading'}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-gray-700 dark:bg-[#606060] px-4 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {autofillState === 'loading' && (
                      <Loader2 size={12} className="animate-spin" />
                    )}
                    Add
                  </button>
                </div>

                {/* Selection feedback now lives inside the Brand IQ pill
                    itself (matches AiCreativesCustom), so the "Using {name}"
                    / "Brand added successfully" status rows are intentionally
                    omitted. Only the failure case still surfaces below. */}
                {autofillState === 'error' && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
                    <AlertCircle size={12} /> {autofillError}
                  </p>
                )}

                {/* BrandIQ dropdown */}
                {showBrandIqPicker && (
                  <div className="absolute z-30 mt-2 max-h-72 w-full max-w-sm overflow-y-auto rounded-2xl bg-white dark:bg-[#1f1f1f] p-2 shadow-xl ring-1 ring-black/10 dark:ring-white/10">
                    {brandListState === 'loading' && (
                      <div className="flex items-center justify-center py-6 text-[12px] text-gray-500 dark:text-white/50">
                        <Loader2 size={14} className="mr-2 animate-spin" /> Loading brands…
                      </div>
                    )}
                    {brandListState === 'error' && (
                      <p className="px-3 py-4 text-[12px] text-red-400">
                        {brandListError || 'Failed to load brands'}
                      </p>
                    )}
                    {brandListState === 'loaded' && brandList.length === 0 && (
                      <p className="px-3 py-4 text-[12px] text-gray-500 dark:text-white/50">
                        No brands saved yet.
                      </p>
                    )}
                    {brandListState === 'loaded' &&
                      brandList.map((item) => {
                        const itemId = item.id || item._id;
                        const sourceId =
                          brandSource.kind === 'list'
                            ? brandSource.item.id || brandSource.item._id
                            : null;
                        const selected = sourceId && itemId && sourceId === itemId;
                        return (
                          <button
                            type="button"
                            key={itemId || item.name}
                            onClick={() => handleBrandIqSelect(item)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                              selected ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                          >
                            {item.logoUrls?.[0] ? (
                              <img
                                src={item.logoUrls[0]}
                                alt=""
                                className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                              />
                            ) : (
                              <div className="h-8 w-8 shrink-0 rounded-full bg-black/5 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-gray-900 dark:text-white">
                                {item.name}
                              </p>
                              {item.description && (
                                <p className="truncate text-[11px] text-gray-500 dark:text-white/50">
                                  {item.description}
                                </p>
                              )}
                            </div>
                            {selected && (
                              <Check size={14} className="shrink-0 text-emerald-400" />
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              {cfg.nameField && (
                <LabeledInput
                  label={cfg.nameField.label}
                  required
                  value={nameValue}
                  onChange={(v) => {
                    setNameValue(v);
                    clearError('name');
                  }}
                  placeholder={cfg.nameField.placeholder}
                  error={errors.name}
                  className="lg:mr-3"
                />
              )}

              <LabeledInput
                label={cfg.descLabel}
                required={isLifestyle}
                value={productDescription}
                onChange={(v) => {
                  setProductDescription(v);
                  clearError('productDescription');
                }}
                placeholder={cfg.descPlaceholder}
                error={errors.productDescription}
                className="lg:mr-3"
              />

              {isLifestyle && (
                <div className="space-y-3 lg:mr-3">
                  <FieldLabel>Model Description</FieldLabel>
                  <div className="rounded-[24px] bg-gray-100 dark:bg-[#909294]/10 p-4 ring-1 ring-black/10 dark:ring-white/5 sm:p-5">
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:gap-x-8">
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
                    <div className="mt-8">
                      <FileUploadField
                        label="Model Reference Images (If any):"
                        placeholder="Upload your model Image or URL"
                        url={modelRefUrl}
                        onUrlChange={setModelRefUrl}
                        files={modelRefImages}
                        onAddFiles={(items) => addModelRefImages(items)}
                        onRemoveFile={(i) =>
                          setModelRefImages((p) => p.filter((_, idx) => idx !== i))
                        }
                        onPreview={(i) => openPreview(modelRefImages, i)}
                        onInvalidType={() =>
                          setErrors((p) => ({ ...p, images: IMAGE_TYPE_ERROR }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="lg:mr-3">
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
                  onRemoveFile={(i) => setImages((p) => p.filter((_, idx) => idx !== i))}
                  onPreview={(i) => openPreview(images, i)}
                  onInvalidType={() =>
                    setErrors((p) => ({ ...p, images: IMAGE_TYPE_ERROR }))
                  }
                />
                <FieldError message={errors.images} />
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
                        if (prev.includes(u)) return prev.filter((x) => x !== u);
                        // 5-thumb cap counts both user uploads and chip picks.
                        const totalThumbs = images.length + prev.length;
                        if (totalThumbs >= MAX_PROMPT_THUMBS) {
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
                <div className="lg:mr-3">
                  <FileUploadField
                    label={cfg.logo.label}
                    placeholder={cfg.logo.placeholder}
                    url={logoUrl}
                    onUrlChange={(v) => {
                      setLogoUrl(v);
                      if (v.trim()) clearError('logo');
                    }}
                    files={logoFiles}
                    onAddFiles={(items) => {
                      setLogoFiles((p) => [...p, ...items]);
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

        </div>

        <div className="mt-2 flex items-center justify-end gap-3">
          {total > 0 && (
            <span className="rounded-full bg-gray-100 dark:bg-[#909294]/15 px-4 py-2 text-[13px] font-medium text-gray-500 dark:text-white/70 ring-1 ring-black/10 dark:ring-white/5">
              –{total * creditsPerImage} credits
            </span>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="flex items-center justify-center rounded-full bg-gray-900 text-white dark:bg-white px-8 py-2.5 text-base font-semibold dark:text-black transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
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

function FieldLabel({ children, required }) {
  return (
    <p className="text-[14px] text-gray-900 dark:text-white">
      {children}
      {required && <span>*</span>}
    </p>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-[12px] text-red-400" role="alert">
      {message}
    </p>
  );
}

function LabeledInput({ label, required, value, onChange, placeholder, error, className="" }) {
  return (
    <div className={className}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        className={`mt-3 h-[50px] w-full rounded-full bg-gray-100 dark:bg-[#909294]/10 px-5 text-[14px] font-light text-gray-900 dark:text-white outline-none ring-1 placeholder:text-gray-500 dark:placeholder:text-[#afafaf]/80 focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20 ${error ? 'ring-2 ring-red-500/60' : 'ring-black/10 dark:ring-white/5'}`}
      />
      <FieldError message={error} />
    </div>
  );
}

function LabeledTextarea({ label, required, value, onChange, placeholder, error }) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined}
        className={`mt-2 min-h-[80px] w-full resize-none rounded-[24px] bg-gray-100 dark:bg-[#909294]/10 px-5 py-4 text-[14px] font-light text-gray-900 dark:text-white outline-none ring-1 placeholder:text-gray-500 dark:placeholder:text-[#afafaf]/80 focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20 ${error ? 'ring-2 ring-red-500/60' : 'ring-black/10 dark:ring-white/5'}`}
      />
      <FieldError message={error} />
    </div>
  );
}

// `files` are objects: { file: File | null, preview: string }. `file` is set
// when the user uploaded a local image — the parent uploads to S3 at submit
// time and replaces preview with the hosted URL. URL pastes / brand-sourced
// items have file = null.
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
  // Strict-type forwarder for file entry points. Splits a FileList into the
  // accepted subset (JPG/JPEG/PNG/WebP) and reports rejections so the caller
  // can surface a type-error message.
  const acceptFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    const valid = arr.filter(isAllowedImageFile);
    const rejected = arr.length - valid.length;
    if (valid.length > 0) {
      onAddFiles(
        valid.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
      );
    }
    if (rejected > 0) onInvalidType?.();
  };
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_ACCEPT}
        multiple={multiple}
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          acceptFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onPaste={(e) => {
          // Clipboard file(s) → strict-type forward. Pasted URL → file=null
          // entry directly (no extension check).
          const files = e.clipboardData?.files;
          if (files && files.length > 0) {
            e.preventDefault();
            acceptFiles(files);
            return;
          }
          const text = e.clipboardData?.getData('text');
          if (text && /^https?:\/\//i.test(text.trim())) {
            e.preventDefault();
            onAddFiles([{ file: null, preview: text.trim() }]);
            onUrlChange('');
          }
        }}
        // Drag and drop: file(s) go through the strict filter; dragged URLs
        // become file=null entries. preventDefault on both dragover AND
        // drop is required — without it the browser drops the URL into the
        // focused input field.
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const dt = e.dataTransfer;
          const files = dt?.files;
          if (files && files.length > 0) {
            acceptFiles(files);
            return;
          }
          const dragged = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
          const trimmed = dragged.trim();
          if (trimmed && /^https?:\/\//i.test(trimmed)) {
            onAddFiles([{ file: null, preview: trimmed }]);
            onUrlChange('');
          }
        }}
        className="mt-2 flex h-[50px] items-center gap-2 rounded-full bg-gray-100 dark:bg-[#909294]/10 pl-4 pr-1 ring-1 ring-black/10 dark:ring-white/5"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          // The inner input also needs handlers because dropping directly
          // on it bypasses the parent unless we cancel the default here.
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const dt = e.dataTransfer;
            const files = dt?.files;
            if (files && files.length > 0) {
              acceptFiles(files);
              return;
            }
            const dragged = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
            const trimmed = dragged.trim();
            if (trimmed && /^https?:\/\//i.test(trimmed)) {
              onAddFiles([{ file: null, preview: trimmed }]);
              onUrlChange('');
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-light text-gray-900 dark:text-white outline-none placeholder:text-gray-500 dark:placeholder:text-[#afafaf]/80"
        />
        <LinkIcon size={14} strokeWidth={1.6} className="shrink-0 text-gray-500 dark:text-white/40" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-black/5 dark:bg-white/20 px-4 text-[12px] font-medium text-gray-900 dark:text-white ring-1 ring-black/10 dark:ring-white/10 transition-colors hover:bg-black/10 dark:hover:bg-white/25"
        >
          <UploadCloud size={14} strokeWidth={1.8} />
          Upload Image
        </button>
      </div>
      {!hidePreview && (files.length > 0 || url?.trim()) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((it, i) => (
            <div
              key={`${it.preview}-${i}`}
              className="group relative h-[40px] w-[40px] cursor-pointer shrink-0 rounded-md border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40"
            >
              <img
                src={it.preview}
                alt=""
                onClick={() => onPreview?.(i)}
                className="h-full w-full rounded-sm object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${label} ${i + 1}`}
                onClick={() => onRemoveFile(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {url?.trim() && (
            // Mirror the file thumbnails for a URL the user pasted (or that
            // came from autofill). The X clears the URL field; preview is
            // a separate concern.
            <div
              key="url-preview"
              className="group relative h-[40px] w-[40px] shrink-0 rounded-md border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40"
            >
              <img
                src={url.trim()}
                alt=""
                className="h-full w-full rounded-sm object-cover"
              />
              <button
                type="button"
                aria-label="Clear URL"
                onClick={() => onUrlChange('')}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              >
                <X size={10} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Brand-image chips below the Brand Voice section. Single click toggles
// selection, double-click opens the lightbox. 220ms delay disambiguates
// the two so a single-click handler doesn't fire on the first half of a
// double-click.
function BrandImageChipRow({ options, isSelected, onPick, onDoubleClick }) {
  const clickTimers = useRef({});
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] text-gray-500 dark:text-white/50">
        Brand images — click to select, double-click to preview
      </p>
      <div className="flex flex-wrap gap-2">
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
              title={
                selected
                  ? 'Click to remove · double-click to preview'
                  : 'Click to select · double-click to preview'
              }
              className={`relative h-10 w-10 shrink-0 cursor-pointer rounded-md transition ${
                selected
                  ? 'border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40'
                  : 'border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30'
              }`}
            >
              <img src={url} alt="" className="h-full w-full rounded-md object-cover" />
              {selected && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#02C8C4] text-white shadow">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThumbList({ items }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ src, onRemove, label }, i) => (
        <div
          key={`${src}-${i}`}
          className="group relative h-[56px] w-[56px] shrink-0 overflow-hidden rounded-md ring-1 ring-black/10 dark:ring-white/10"
        >
          <img src={src} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

function PillDropdown({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  return (
    <div className="relative flex items-center justify-between gap-4">
      <span className="min-w-16 shrink-0 text-[13px] text-gray-500 dark:text-white/85">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-gray-100 dark:bg-[#909294]/10 px-3 py-1.5 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#909294]/20"
      >
        <span className="truncate text-[12px] font-light text-gray-900 dark:text-white/85">{value || 'Select…'}</span>
        <ChevronDown size={18} strokeWidth={2} className="shrink-0 text-gray-500 dark:text-white/50" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, 100),
              zIndex: 9999,
            }}
            className="scale-85 -translate-y-2 -translate-x-2 2xl:translate-0 2xl:scale-100 2xl:max-h-[180px] max-h-[120px] overflow-y-auto rounded-[14px] border border-black/10 dark:border-white/10 bg-white dark:bg-[#0D0D0D]/50 py-1 shadow-2xl backdrop-blur-[100px]"
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left 2xl:text-[12px] text-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                  opt === value ? 'bg-gray-100 text-gray-900 dark:bg-[#3d3d3d] dark:text-white' : 'text-gray-500 dark:text-white/80'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

function QualityPickerPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeLabel = QUALITY_OPTIONS.find((q) => q.value === value)?.label || 'Medium';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-[#2b2a2a]/50 px-3 py-3 text-[12px] font-light text-gray-500 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
      >
        {activeLabel}
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[140px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
          {QUALITY_OPTIONS.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center px-3 py-2.5 text-left text-[13px] transition-colors ${
                  selected
                    ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                    : 'text-gray-500 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white'
                }`}
              >
                <span className="flex-1">{opt.label}</span>
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

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
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
        className="flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-[#2b2a2a]/50 px-3 py-3 text-[12px] font-light text-gray-500 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
      >
        <span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center">
          <ModelIcon option={MODEL_OPTIONS.find((m) => m.name === value)} />
        </span>
        {value}
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 min-w-[180px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
          {MODEL_OPTIONS.map((opt) => {
            const { name, available } = opt;
            const selected = name === value;
            return (
              <button
                key={name}
                type="button"
                disabled={!available}
                onClick={() => {
                  if (!available) return;
                  onChange(name);
                  setOpen(false);
                }}
                title={available ? undefined : 'Coming soon'}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                  !available
                    ? 'cursor-not-allowed text-gray-500 dark:text-white/80'
                    : selected
                      ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                      : 'text-gray-500 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white'
                }`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                  <ModelIcon option={opt} />
                </span>
                <span className="flex-1">{name}</span>
                {!available && (
                  <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-[9px] uppercase tracking-wide text-gray-500 dark:text-white/50">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RatioPickerPill({ counts, onChange, model }) {
  // Reuses the shared modelCredits cache — multiple components calling the
  // hook with the same model still cost one network request per session.
  const creditsPerImage = useImageCreditsForModel(model);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const total = totalImages(counts);
  const primary = primaryRatio(counts);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const adjust = (key, delta) => {
    const next = Math.max(0, Math.min(4, (counts[key] ?? 0) + delta));
    onChange({ ...counts, [key]: next });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#2b2a2a]/50 px-4 py-2.5 font-light text-gray-500 dark:text-[#afafaf] ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
      >
        <span className="text-[14px] text-gray-900 dark:text-white/90">{primary}</span>
        <span className="h-3 w-px bg-black/20 dark:bg-white/20" />
        <LayoutGrid size={11} strokeWidth={1.8} className="text-gray-500 dark:text-white/50" />
        <span className="text-[14px]">
          {total} Image{total !== 1 ? 's' : ''}
        </span>
        <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-2 w-[280px] rounded-[20px] bg-white dark:bg-[#1f1f1f] p-5 shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
          <p className="mb-2 text-center text-[13px] font-medium text-gray-500 dark:text-[#d9d9d9]">
            Aspect Ratio per Image
          </p>
          <div className="flex items-center justify-center gap-1.5 text-sm">
            <span className="text-gray-500 dark:text-white/70">Total Number of Images :</span>
            <span className="font-medium text-gray-900 dark:text-white">{total}</span>
          </div>
          <p className="mb-6 mt-1 text-center text-[11px] text-gray-500 dark:text-white/50">
            {creditsPerImage} credits per image
          </p>
          <div className="space-y-1">
            {allowedAspectLabels(model).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between pl-4">
                <span className="text-[12px] text-gray-900 dark:text-white">{label}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => adjust(key, -1)}
                    className="flex h-5 w-5 items-center justify-center text-gray-500 dark:text-white/60 hover:text-black dark:hover:text-white"
                    aria-label={`Decrease ${label}`}
                  >
                    <span className="text-[18px] leading-none select-none">−</span>
                  </button>
                  <span className="w-8 rounded-full bg-gray-100 dark:bg-[#9092941A] py-0.5 text-center text-[11px] font-medium text-gray-900 dark:text-white">
                    {counts[key] ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjust(key, 1)}
                    className="flex h-5 w-5 items-center justify-center text-gray-500 dark:text-white/60 hover:text-black dark:hover:text-white"
                    aria-label={`Increase ${label}`}
                  >
                    <span className="text-[18px] leading-none select-none">+</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-right text-[10px] text-gray-500 dark:text-white/40">Max 4 per ratio</p>
        </div>
      )}
    </div>
  );
}
