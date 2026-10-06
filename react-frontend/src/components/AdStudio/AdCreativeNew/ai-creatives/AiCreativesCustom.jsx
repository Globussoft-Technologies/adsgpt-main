import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  ChevronDown,
  Link2,
  UploadCloud,
  Search,
  LayoutGrid,
  Loader2,
  Check,
  AlertCircle,
  LinkIcon,
  ArrowLeft,
  Proportions,
  Sparkles,
} from 'lucide-react';
import { SiOpenai } from 'react-icons/si';
import { LifestyleShell } from '../lifestyle/LifestyleShell';
import { TemplatesPanel, TemplatesTrigger, TemplatesResizer } from '../components/PromptTemplatesPicker';
import { usePromptTemplates } from '../components/usePromptTemplates';
import { getBrandAvatarColor } from '../components/AdStudioPrimitives';
import geminiIcon from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceIcon from '@/assets/layouts/profile/seedance_logo_transparent.png';
import chatResponseDark from '@/assets/layouts/adstudio/chat-response-dark.svg';
import brandIqIcon from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import {
  AUTOFILL_FAILURE_MESSAGE,
  fetchAutofill,
  fetchBrandList,
  getAuthToken,
  getUserId,
} from './apiClient';
import { silentSaveBrandFromAutofill } from './silentBrandSave';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { fetchCompetitorAds } from '@/store/actions/feature/competitorSearchActions';
import {
  resetCompetitorSearch,
  setSearchTerm,
  setSearchType,
} from '@/store/reducers/feature/competitorSearchSlice';
import { generateImageAction } from '@/store/actions/image/imageActions';
import { resetCurrent, clearImageRecreateInputs } from '@/store/reducers/image/imageSlice';
import { buildImageInputs } from '@/store/actions/image/buildImageInputs';
import { uploadToS3 } from '@/utils/imageUpload';
import {
  ALLOWED_IMAGE_ACCEPT,
  IMAGE_TYPE_ERROR,
  filterAllowedImageFiles,
  isAllowedImageFile,
} from '@/utils/imageValidation';
import { useAdCreativeConfig } from '@/utils/hooks/useAdCreativeConfig';
import AspectRatioTiles, {
  AnimatedPanel,
  primaryRatio,
  totalImages,
} from '@/components/AdStudio/AdCreativeNew/AspectRatioPicker';
import getCookies from '@/utils/getCookies';
import axios from 'axios';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import Masonry from 'react-masonry-css';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const PROMPT_API = import.meta.env.VITE_PROMPT_API;

// Models the Go backend accepts. Display order = picker order. Each entry
// carries either a ReactNode `icon` (e.g. SiOpenai) or an `iconSrc` image path
// rendered via <img>. The picker handles both shapes.
// Model list, labels, apiIds, aspect ratios, qualities and per-quality credits
// now come from the backend `ad_creative` surface via useAdCreativeConfig — no
// longer hardcoded here. A DB-backed image icon is preferred when available;
// the existing provider-specific mappings remain the fallback for legacy
// models and models without an uploaded icon.
function ModelIcon({ apiId, icon }) {
  const iconValue = String(icon || '');
  if (/^(data:image\/|https?:\/\/|\/)/i.test(iconValue)) {
    return <img src={iconValue} alt="" className="h-3.5 w-3.5 object-contain" />;
  }

  const id = String(apiId || '');
  if (/gpt-image/i.test(id)) {
    return <SiOpenai size={14} className="text-gray-600 dark:text-white/80" />;
  }
  const src = /seedream/i.test(id) ? seedanceIcon : geminiIcon;
  return <img src={src} alt="" className="h-3.5 w-3.5 object-contain" />;
}

// Quality tiers are per-model, from the `ad_creative` surface
// (selectedModel.qualities). Labels below are presentation-only, with a
// fallback to the raw value.
const QUALITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', ultra_high: 'Ultra High' };
const qualityLabel = (v) => QUALITY_LABELS[v] || v;

// Quality picker is enabled; the backend reads the sent quality (no longer
// forced to "high" in imageController).
const SHOW_QUALITY_PICKER = true;

// Aspect-ratio helpers + the picker panel now live in the shared
// AspectRatioTiles module (imported above), so every AdCreative surface stays
// in sync. Ratios themselves come per-model from the `ad_creative` surface.

const COMPETITOR_PLACEHOLDERS = [
  { hClass: 'h-[250px]', color: 'from-[#1a2a5e] to-[#2a3a7e]' },
  { hClass: 'h-[350px]', color: 'from-[#2a1a5e] to-[#3a2a7e]' },
  { hClass: 'h-[150px]', color: 'from-[#1a3a4e] to-[#2a4a6e]' },
  { hClass: 'h-[350px]', color: 'from-[#1a3a2e] to-[#2a5a3e]' },
  { hClass: 'h-[150px]', color: 'from-[#3a2a1e] to-[#5a3a2e]' },
  { hClass: 'h-[256px]', color: 'from-[#1a2a4e] to-[#2a3a6e]' },
];

const NAS_BASE_URL = import.meta.env.VITE_NAS_BASE_URL || '';
const MAX_REFS_TOTAL = 5;

export function AiCreativesCustom({ onClose, onComplete }) {
  const headerSelectedBrand = useSelector((state) => state.brandIQTabs.selectedCompetitorBrand);
  const headerBrands = useSelector((state) => state.brandIQTabs.myBrands);
  const headerBrand = Array.isArray(headerBrands)
    ? headerBrands.find((brand) => brand.id === headerSelectedBrand?.id)
    : null;
  const [prompt, setPrompt] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  // Each reference is { file: File | null, preview: string }. `file` is set
  // when the user uploads a local image; we keep it around so we can upload
  // to S3 at submit time and replace the blob URL with the hosted URL.
  // Pasted URLs come in with file = null. Brand-IQ scraped images live in
  // brandImagePool below — they only flow into referenceImages (and into
  // the payload) when the user double-clicks them to opt-in.
  const [referenceImages, setReferenceImages] = useState([]);
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  // Inline cap warning for the references area. Set when the user tries to
  // overshoot the 5-image cap; cleared whenever any contributing slot is
  // freed (remove ref / unpick brand chip / clear competitor).
  const [imagesError, setImagesError] = useState('');
  // Inline type warning for the brand logo upload — surfaces under the logo
  // row when the user tries to drop / paste / pick a non-allowed file.
  const [logoError, setLogoError] = useState('');
  // Pool of brand-scraped images (display-only by default). Single-click a
  // chip to toggle inclusion in the payload (`brandImagesPicked`). Picks
  // do NOT flow into `referenceImages` so the prompt-thumb row only
  // surfaces user-uploaded/pasted refs + the chosen competitor visual.
  // Double-click a chip to open the lightbox preview.
  const [brandImagePool, setBrandImagePool] = useState([]);
  const [brandImagesPicked, setBrandImagesPicked] = useState([]);
  // Brand logo: `brandLogoUrl` is the URL input field — strictly user-typed.
  // Chip picks DO NOT write here. `brandLogoFile` is set only when the user
  // uploaded a local file (present means we'll upload before submit).
  // `brandLogoPicked` is the chip-selected URL — kept separate so the input
  // stays clean for user input.
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandLogoFile, setBrandLogoFile] = useState(null);
  // Object-URL preview for an uploaded logo file. Kept separate from
  // `brandLogoUrl` so the visible URL input never shows a `blob:` string —
  // the upload surfaces as a thumbnail instead (mirrors the references flow).
  const [brandLogoFilePreview, setBrandLogoFilePreview] = useState('');
  const [brandLogoPicked, setBrandLogoPicked] = useState('');
  // Logo options surfaced after autofill / BrandIQ pick. Display-only by
  // default — user must click one to make it the active logo.
  const [brandLogoOptions, setBrandLogoOptions] = useState([]);
  const [competitorAdRef, setCompetitorAdRef] = useState('');
  const [model, setModel] = useState('');
  const [quality, setQuality] = useState('high');
  const [aspectCounts, setAspectCounts] = useState({});

  // Model list + per-model aspect ratios / qualities / credits from the backend
  // `ad_creative` surface (shared cache, hardcoded fallback baked in).
  const { models: configModels } = useAdCreativeConfig();
  const selectedModel = configModels.find((m) => m.apiId === model);

  // The database catalog owns the initial model. Keep the canonical ID in
  // state for the generation payload, but never hardcode a model here.
  useEffect(() => {
    if (!model && configModels.length > 0) setModel(configModels[0].apiId);
  }, [configModels, model]);
  // Per-image credits for the selected model + quality (falls back to the
  // model's default/high tier, then 7).
  const creditsPerImage =
    selectedModel?.creditsByQuality?.[quality] ?? selectedModel?.creditsPerImage ?? 7;

  // Lightbox preview state for thumbnail clicks.
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxImage, setLightboxImage] = useState('');

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showAspectPicker, setShowAspectPicker] = useState(false);
  const [showBrandIqPicker, setShowBrandIqPicker] = useState(false);
  // Refs on each picker wrapper — used by the outside-click listener
  // below. We can't rely on a fixed z-30 backdrop overlay because the
  // form's panel has `backdrop-blur-md`, which creates a CSS stacking
  // context that traps the pickers below the backdrop.
  const modelPickerWrapperRef = useRef(null);
  const qualityPickerWrapperRef = useRef(null);
  const aspectPickerWrapperRef = useRef(null);
  const brandIqPickerWrapperRef = useRef(null);
  const [showCompetitorModal, setShowCompetitorModal] = useState(false);
  const [competitorSearch, setCompetitorSearch] = useState('');
  const [competitorTab, setCompetitorTab] = useState('Competitors');

  // The Ad Studio header is the initial brand choice. The picker can still
  // replace it, and subsequent local edits retain precedence for this session.
  const [brandSource, setBrandSource] = useState(() =>
    headerBrand?.id ? { kind: 'list', item: headerBrand } : { kind: 'none' }
  );
  const [brandList, setBrandList] = useState([]);
  const [brandListState, setBrandListState] = useState('idle');
  const [brandListError, setBrandListError] = useState('');
  const [autofillState, setAutofillState] = useState('idle');
  const [autofillError, setAutofillError] = useState('');

  const [view, setView] = useState({ kind: 'form' });
  // True from the moment Generate is clicked until the slice flips to
  // 'submitting' (or fails). Drives the button label/disabled state and
  // suppresses the upload toast — the button is the upload indicator.
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);
  // Improve-prompt (Gemini) state — drives the spinner on the wand button.
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);

  // Reconcile per-ratio counts whenever the selected model changes — models
  // support different aspect-ratio sets. Keep counts for ratios the new model
  // still offers, drop the rest, and default to a single 1:1 (or the first
  // ratio) if nothing is selected so the payload stays valid.
  useEffect(() => {
    const ratios = selectedModel?.aspectRatios;
    if (!ratios || ratios.length === 0) return;
    setAspectCounts((prev) => {
      const next = {};
      for (const r of ratios) next[r] = prev[r] || 0;
      if (totalImages(next) === 0) {
        next[ratios.includes('1:1') ? '1:1' : ratios[0]] = 1;
      }
      return next;
    });
  }, [selectedModel]);

  // Keep the selected quality valid for the current model — tiers differ per
  // model (only Nano Banana 2 offers "ultra_high"). Reset to high (or the first
  // available) when the current pick isn't supported.
  useEffect(() => {
    const qualities = selectedModel?.qualities;
    if (!qualities || qualities.length === 0 || qualities.includes(quality)) return;
    setQuality(qualities.includes('high') ? 'high' : qualities[0]);
  }, [selectedModel, quality]);

  // Derive (and clean up) the blob preview for the uploaded logo file. This
  // is what the thumbnail renders — the URL text input stays untouched.
  useEffect(() => {
    if (!brandLogoFile) {
      setBrandLogoFilePreview('');
      return undefined;
    }
    const url = URL.createObjectURL(brandLogoFile);
    setBrandLogoFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [brandLogoFile]);

  const dispatch = useDispatch();
  const imageState = useSelector((s) => s.image.current);
  const recreateInputs = useSelector((s) => s.image.recreateInputs);
  const userData = useSelector((s) => s.socket?.userData);
  // Captured once at mount: true when this form was opened via Recreate. Used
  // to keep the templates picker collapsed by default in that flow.
  const isRecreateSessionRef = useRef(
    Boolean(recreateInputs && recreateInputs.type === 'ai_ads'),
  );

  // ── Recreate-from-history prefill ─────────────────────────────────────
  // Stashed by MySpace > Images > Recreate. We hydrate this form once on
  // mount when the stored type matches, then clear redux so a remount
  // doesn't re-prefill.
  useEffect(() => {
    if (!recreateInputs || recreateInputs.type !== 'ai_ads') return;
    const inp = recreateInputs;

    // Backend stores the user's prompt as `prompt` on inputs; older records
    // may still carry `userPrompt`, so honour both.
    setPrompt(inp.prompt || inp.userPrompt || '');

    // Recreate-from-history flows brand assets into the chip slots so the
    // URL input stays clean (user-typed only).
    const refs = Array.isArray(inp.referenceImages) ? inp.referenceImages : [];
    const refList = refs.filter(Boolean);
    setBrandImagePool(refList.map((u) => ({ file: null, preview: u })));
    setBrandImagesPicked(Array.from(new Set(refList)).slice(0, MAX_REFS_TOTAL));

    if (inp.brandLogo) {
      setBrandLogoFile(null);
      setBrandLogoOptions([inp.brandLogo]);
      setBrandLogoPicked(inp.brandLogo);
    }

    if (inp.competitorReferenceImage) {
      setCompetitorAdRef(inp.competitorReferenceImage);
    }

    if (inp.model && configModels.some((m) => m.apiId === inp.model)) {
      // Records store the canonical model id — which is now what `model` holds.
      setModel(inp.model);
    }

    if (inp.quality && QUALITY_LABELS[inp.quality]) {
      setQuality(inp.quality);
    }

    if (Array.isArray(inp.aspectRatioPerImage) && inp.aspectRatioPerImage.length > 0) {
      const counts = {};
      for (const { aspectRatio, numberOfImages } of inp.aspectRatioPerImage) {
        if (aspectRatio) counts[aspectRatio] = Number(numberOfImages) || 0;
      }
      setAspectCounts(counts);
    } else if (inp.aspectRatio) {
      setAspectCounts({ [inp.aspectRatio]: Number(inp.numberOfImages) || 1 });
    }

    // Mirror brand info into the brand-voice chip so resolveBrandInfo()
    // surfaces these fields in the request body at submit time.
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
      // inputs didn't carry one, look it up from the user's saved brands (which
      // get-lists returns with a category already) by matching the name — a
      // pure frontend lookup, no extra classification. Patch it in so the
      // templates picker auto-matches the right category.
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

  const refImgInputRef = useRef(null);
  const logoImgInputRef = useRef(null);
  const autofillAbortRef = useRef(null);
  const brandListAbortRef = useRef(null);
  const generateAbortRef = useRef(null);

  // Track which logo/images came from the currently-selected brand source so
  // they can be cleanly swapped out when the user picks a different brand.
  // User-uploaded/pasted assets are preserved across brand switches. The
  // images ref stores the `preview` URLs (matches the `referenceImages` shape).
  const brandSourceLogoRef = useRef('');
  const brandSourceImagesRef = useRef([]);

  // Pull brand name + first target audience out of whichever brand source
  // is active so the Templates picker can substitute {brand} /
  // {target_audience} placeholders live as the brand changes.
  const brandName =
    brandSource.kind === 'list'
      ? brandSource.item?.name || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.brandInfo?.brandName || ''
        : '';
  const targetAudience =
    brandSource.kind === 'list'
      ? brandSource.item?.targetAudiences?.[0] || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.objectives?.targetAudience?.[0] || ''
        : '';
  // Category drives the auto-matched template category. A saved brand carries
  // it (get-lists); an autofill brand carries DS's category inline. brandId is
  // only known for saved brands — used to lazy-classify old brands with none.
  const brandCategory =
    brandSource.kind === 'list'
      ? brandSource.item?.category || ''
      : brandSource.kind === 'autofill'
        ? brandSource.data?.brandInfo?.category || ''
        : '';
  // Exclude the synthetic 'recreate' id — it's not a saved brand, so the hook
  // must NOT try to lazy-classify it (that shows a stuck "finding category"
  // loader). The category for recreate is resolved via the name-match instead.
  const brandId =
    brandSource.kind === 'list' &&
    brandSource.item?.id &&
    brandSource.item.id !== 'recreate'
      ? brandSource.item.id
      : '';

  const templates = usePromptTemplates({
    type: 'ai_custom',
    brandName,
    targetAudience,
    brandCategory,
    brandId,
    // On Recreate, land with the picker collapsed (per request).
    autoOpen: !isRecreateSessionRef.current,
    currentValue: prompt,
    onSelect: setPrompt,
    // Manual edit of a {brand}/{target_audience} token deselects the
    // brand chip so the UI matches the new source of truth (the typed
    // values). The hook's sync effect intentionally skips truthy → ''
    // transitions so this clear doesn't wipe the user's typing.
    onClearBrand: () => setBrandSource({ kind: 'none' }),
  });

  // Hit the Gemini prompt-improve endpoint, replace the textarea content with
  // the suggested rewrite. Mirrors the Ad Studio chat-bar's suggestPrompt
  // thunk but kept local since this form's prompt isn't in redux.
  const handleImprovePrompt = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSuggestingPrompt) return;
    setIsSuggestingPrompt(true);
    try {
      const res = await axios.post(
        PROMPT_API,
        { user_id: getUserId(), prompt: trimmed, type: 'image' },
        { headers: { Authorization: `Bearer ${getCookies()}` } },
      );
      const suggestion = res?.data?.suggested_prompt;
      if (suggestion) setPrompt(suggestion);
    } catch (err) {
      toast.error(
        err?.response?.data?.message || 'Prompt must contain at least 3 words',
      );
    } finally {
      setIsSuggestingPrompt(false);
    }
  };

  // Open the lightbox preview for a list of items, focused on `idx`.
  const openLightbox = (items, idx) => {
    const urls = items.map((it) => it.preview).filter(Boolean);
    if (urls.length === 0) return;
    setLightboxImages(urls);
    setLightboxImage(urls[idx] ?? urls[0]);
    setLightboxOpen(true);
  };

  const total = totalImages(aspectCounts);

  useEffect(() => {
    return () => {
      autofillAbortRef.current?.abort();
      brandListAbortRef.current?.abort();
      generateAbortRef.current?.abort();
      dispatch(resetCurrent());
    };
  }, [dispatch]);

  // Fire onComplete once the backend acknowledges submission (status flips to
  // 'pending' on a 200 with sessionId, or straight to 'completed' for sync
  // backends). The parent plays the genie animation and navigates to MySpace.
  //
  // `intendedSubmitRef` gates this on a submit initiated from THIS mount —
  // without it, a stale `image.current` left in `pending` by another flow
  // (e.g. the AdLibrary RecreateAdModal) would re-trigger the genie the
  // moment this component mounts.
  const completeFiredRef = useRef(false);
  const intendedSubmitRef = useRef(false);
  useEffect(() => {
    const handedOff =
      imageState.status === 'pending' || imageState.status === 'completed';
    if (handedOff && !completeFiredRef.current && intendedSubmitRef.current) {
      completeFiredRef.current = true;
      intendedSubmitRef.current = false;
      onComplete?.();
    }
    if (imageState.status === 'idle' || imageState.status === 'submitting') {
      completeFiredRef.current = false;
    }
  }, [imageState.status, onComplete]);

  // Total images shown in the prompt box are capped at 5. The competitor
  // visual + every picked brand-pool chip count toward the same five slots.
  const competitorSelected =
    Boolean(competitorAdRef) && !competitorAdRef.startsWith('competitor-ref-');
  const remainingRefSlots = () =>
    Math.max(
      0,
      MAX_REFS_TOTAL
        - referenceImages.length
        - brandImagesPicked.length
        - (competitorSelected ? 1 : 0),
    );

  const handleRefImageFiles = (files) => {
    if (!files) return;
    // Strict type filter first — JPG/JPEG/PNG/WebP only. Anything else gets
    // dropped here and surfaces a type error, even if the cap had room.
    const { valid, rejectedCount } = filterAllowedImageFiles(files);
    if (valid.length === 0) {
      if (rejectedCount > 0) setImagesError(IMAGE_TYPE_ERROR);
      return;
    }
    const slots = remainingRefSlots();
    if (slots <= 0) {
      setImagesError(
        rejectedCount > 0 ? IMAGE_TYPE_ERROR : `You can attach up to ${MAX_REFS_TOTAL} images.`,
      );
      return;
    }
    const incoming = valid.slice(0, slots);
    setReferenceImages((prev) => [
      ...prev,
      ...incoming.map((f) => ({ file: f, preview: URL.createObjectURL(f) })),
    ]);
    // Priority: surface type error if anything was rejected for type; else
    // cap error if more were dropped than slots had; else clear.
    if (rejectedCount > 0) {
      setImagesError(IMAGE_TYPE_ERROR);
    } else if (valid.length > slots) {
      setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
    } else {
      setImagesError('');
    }
  };

  const addRefImageUrl = (rawUrl) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const isDuplicate =
      referenceImages.some((item) => item.preview?.trim() === trimmed)
      || brandImagesPicked.includes(trimmed)
      || (competitorSelected && competitorAdRef.trim() === trimmed);
    if (isDuplicate) {
      setReferenceImageUrl('');
      setImagesError('This image is already attached.');
      return;
    }
    if (remainingRefSlots() <= 0) {
      setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
      return;
    }
    setReferenceImages((prev) => [...prev, { file: null, preview: trimmed }]);
    setReferenceImageUrl('');
    setImagesError('');
  };

  const handleRefImageUrlAdd = () => addRefImageUrl(referenceImageUrl);

  // Clipboard paste: any file goes through the strict-type filter, URL text
  // gets added as-is (no type check — URLs may not carry an extension).
  const handleRefPaste = (e) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      handleRefImageFiles(files);
      return;
    }
    const text = e.clipboardData?.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) {
      e.preventDefault();
      addRefImageUrl(text);
    }
  };

  // Drag and drop: image files become uploads, dragged image URLs (from
  // another browser tab, the brand-pool chip row, etc.) become file=null
  // entries. preventDefault on both dragover AND drop is required —
  // without it the browser falls back to its default and drops the URL
  // text into the focused input.
  const handleRefDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    const files = dt?.files;
    if (files && files.length > 0) {
      // Always route dropped files through the strict filter — a dropped
      // PDF / SVG / GIF should surface the type error instead of silently
      // falling through to the URL-drop branch below.
      handleRefImageFiles(files);
      return;
    }
    const url = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
    const trimmed = url.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) {
      addRefImageUrl(trimmed);
    }
  };

  const handleLogoDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    const files = dt?.files;
    if (files && files.length > 0) {
      const f = Array.from(files).find(isAllowedImageFile);
      if (f) {
        // Uploaded file lives in brandLogoFile (+ thumbnail); the URL input
        // stays clean so it never shows a blob: string.
        setBrandLogoFile(f);
        setBrandLogoUrl('');
        setLogoError('');
        return;
      }
      // A file was dropped but none matched the allow-list.
      setLogoError(IMAGE_TYPE_ERROR);
      return;
    }
    const url = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
    const trimmed = url.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) {
      setBrandLogoFile(null);
      setBrandLogoUrl(trimmed);
      setLogoError('');
    }
  };

  const preventDefaultDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

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
      setBrandListError(err.message);
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

  const openBrandIqPicker = async () => {
    setShowModelPicker(false);
    setShowQualityPicker(false);
    setShowAspectPicker(false);
    setShowBrandIqPicker((v) => !v);
    if (brandListState === 'loaded' || brandListState === 'loading') return;

    await refreshBrandList();
  };

  const handleBrandIqSelect = (item) => {
    const itemId = item.id || item._id;
    const sourceId =
      brandSource.kind === 'list'
        ? brandSource.item.id || brandSource.item._id
        : null;
    // Clicking the already-selected brand toggles the selection off and
    // resets every field the brand source had filled in.
    if (sourceId && itemId && sourceId === itemId) {
      setBrandSource({ kind: 'none' });
      brandSourceLogoRef.current = '';
      setBrandLogoOptions([]);
      setReferenceImages((prev) =>
        prev.filter((it) => !brandSourceImagesRef.current.includes(it.preview)),
      );
      setBrandImagePool([]);
      brandSourceImagesRef.current = [];
      setBrandLogoPicked('');
      setBrandImagesPicked([]);
      setShowBrandIqPicker(false);
      return;
    }

    setBrandSource({ kind: 'list', item });

    // Track the BrandIQ-discovered logo so we know about it internally, but
    // do NOT prefill the visible brand-logo input — the field is strictly
    // user-input now (typed URL or upload). The same applies to autofill.
    brandSourceLogoRef.current = item.logoUrls?.[0] || '';

    // Surface the brand's logos as picker options under the logo field
    // (unselected — user clicks one to make it active).
    setBrandLogoOptions(
      Array.isArray(item.logoUrls) ? item.logoUrls.filter(Boolean) : [],
    );

    // Replace the pool with the new brand's images. Drop any previously
    // selected pool items from referenceImages so the two brands' assets
    // don't blend; user uploads / pastes are preserved.
    const newBrandImages = Array.isArray(item.imageUrl)
      ? item.imageUrl.filter(Boolean)
      : [];
    setReferenceImages((prev) =>
      prev.filter((it) => !brandSourceImagesRef.current.includes(it.preview)),
    );
    setBrandImagePool(newBrandImages.map((u) => ({ file: null, preview: u })));
    brandSourceImagesRef.current = newBrandImages;

    // Reset picked-state slots so the previous brand's selection doesn't
    // bleed into the new brand's payload.
    setBrandLogoPicked('');
    setBrandImagesPicked([]);

    setShowBrandIqPicker(false);
    setAutofillState('idle');
  };

  // The global Ad Studio selector is authoritative. Apply it in-place so the
  // active prompt, category match, logo options, and image pool update without
  // closing or remounting this form.
  useEffect(() => {
    if (!headerBrand?.id) return;
    setBrandSource({ kind: 'list', item: headerBrand });
    brandSourceLogoRef.current = headerBrand.logoUrls?.[0] || '';
    setBrandLogoOptions(Array.isArray(headerBrand.logoUrls) ? headerBrand.logoUrls.filter(Boolean) : []);
    const images = Array.isArray(headerBrand.imageUrl) ? headerBrand.imageUrl.filter(Boolean) : [];
    setReferenceImages((prev) => prev.filter((item) => !brandSourceImagesRef.current.includes(item.preview)));
    setBrandImagePool(images.map((url) => ({ file: null, preview: url })));
    brandSourceImagesRef.current = images;
    setBrandLogoPicked('');
    setBrandImagesPicked([]);
    setAutofillState('idle');
  }, [headerBrand?.id]);

  const handleAutofill = async () => {
    const raw = websiteUrl.trim();
    if (!raw) return;
    // Accept inputs without a scheme / with www. by normalising to https://
    // before hitting the autofill endpoint.
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

      // Track the autofill-discovered logo so resolveBrandInfo can pass it
      // along in the payload, but DO NOT prefill the visible brand-logo
      // input — the user wants those fields to stay blank and only fill them
      // explicitly. The autofilled logo still ends up in the request body
      // via brand.brandLogo coming from resolveBrandInfo.
      const logoUrls = Array.isArray(data.brandInfo.brandLogo)
        ? data.brandInfo.brandLogo.filter(Boolean).slice(0, 10)
        : [];
      brandSourceLogoRef.current = logoUrls[0] || '';
      // Surface every scraped logo as a picker option below the field. The
      // first one is NOT auto-selected — the user explicitly clicks to pick.
      setBrandLogoOptions(logoUrls);

      // Replace the pool with this brand's scraped images and drop any
      // previously-selected pool items from referenceImages. Cap at 10 so
      // the chip row stays manageable on image-heavy sites.
      const newBrandImages = Array.isArray(data.brandInfo.brandImages)
        ? data.brandInfo.brandImages.filter(Boolean).slice(0, 10)
        : [];
      setReferenceImages((prev) =>
        prev.filter((it) => !brandSourceImagesRef.current.includes(it.preview)),
      );
      setBrandImagePool(newBrandImages.map((u) => ({ file: null, preview: u })));
      brandSourceImagesRef.current = newBrandImages;

      // Reset picked-state on source change.
      setBrandLogoPicked('');
      setBrandImagesPicked([]);

      setAutofillState('ok');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAutofillError(err.message || AUTOFILL_FAILURE_MESSAGE);
      setAutofillState('error');
    }
  };

  const closeAllPickers = () => {
    setShowModelPicker(false);
    setShowQualityPicker(false);
    setShowAspectPicker(false);
    setShowBrandIqPicker(false);
  };

  // Close any open picker on outside click. Done with a document listener
  // instead of a fixed-position backdrop because the form panel uses
  // `backdrop-blur-md`, which creates a stacking context that pinned the
  // backdrop above the picker dropdowns and ate every click.
  useEffect(() => {
    if (!showModelPicker && !showQualityPicker && !showAspectPicker && !showBrandIqPicker)
      return undefined;
    const onMouseDown = (e) => {
      const t = e.target;
      // The aspect quantity dropdown is portalled to <body> (to escape the
      // panel's overflow + the form's backdrop-blur), so it lives outside
      // aspectPickerWrapperRef. Treat clicks inside it as "inside" so picking a
      // quantity doesn't close the whole aspect panel.
      if (t?.closest?.('[data-aspect-quantity-menu]')) return;
      const inModel = modelPickerWrapperRef.current?.contains(t);
      const inQuality = qualityPickerWrapperRef.current?.contains(t);
      const inAspect = aspectPickerWrapperRef.current?.contains(t);
      const inBrandIq = brandIqPickerWrapperRef.current?.contains(t);
      if (!inModel && !inQuality && !inAspect && !inBrandIq) closeAllPickers();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showModelPicker, showQualityPicker, showAspectPicker, showBrandIqPicker]);

  // Pulls a brandInfo object out of whichever brand source is currently active.
  // Empty/none → empty strings/arrays (backend accepts that).
  const resolveBrandInfo = () => {
    if (brandSource.kind === 'list') {
      const item = brandSource.item;
      return {
        brandName: item.name || '',
        brandDescription: item.description || '',
        brandLogo: item.logoUrls?.[0] || '',
        brandImages: Array.isArray(item.imageUrl) ? item.imageUrl : [],
        brandColors: [],
      };
    }
    if (brandSource.kind === 'autofill') {
      const bi = brandSource.data?.brandInfo ?? {};
      return {
        brandName: bi.brandName || '',
        brandDescription: bi.brandDescription || '',
        brandLogo: bi.brandLogo?.[0] || '',
        brandImages: Array.isArray(bi.brandImages) ? bi.brandImages : [],
        brandColors: bi.brandGuidelines?.colorPalette || [],
      };
    }
    return { brandName: '', brandDescription: '', brandLogo: '', brandImages: [], brandColors: [] };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (total === 0) return;

    const brand = resolveBrandInfo();

    // Resolve every reference + brand logo to a real hosted URL. Items with
    // `file` were uploads (blob: previews) — push them to S3 first; items
    // with file=null are already real URLs (paste / brand IQ / autofill).
    // The Generate button itself is the upload indicator (label + disabled),
    // so we deliberately don't surface a toast.
    let referenceUrls = [];
    // The brand logo only ships in the payload when the user explicitly
    // supplies one (upload OR typed/pasted URL). Logos coming from the
    // autofill scrape or a Brand IQ pick are deliberately NOT propagated.
    let logoUrl = '';
    setIsSubmittingLocal(true);
    // Mark that the next pending/completed transition was initiated here —
    // gates the onComplete genie handoff below.
    intendedSubmitRef.current = true;
    completeFiredRef.current = false;
    try {
      const uid = getUserId();
      referenceUrls = (
        await Promise.all(
          referenceImages.map(async (it) => {
            if (it.file) {
              const path = await uploadToS3(it.file, uid, true);
              return path ? `${S3_BASE_URL}${path}` : null;
            }
            return it.preview || null;
          })
        )
      ).filter(Boolean);

      // Logo precedence: uploaded file > typed URL > chip-picked URL.
      if (brandLogoFile) {
        const path = await uploadToS3(brandLogoFile, uid, true);
        if (path) logoUrl = `${S3_BASE_URL}${path}`;
      } else if (brandLogoUrl.trim()) {
        logoUrl = brandLogoUrl.trim();
      } else if (brandLogoPicked) {
        logoUrl = brandLogoPicked;
      }
    } catch (err) {
      setIsSubmittingLocal(false);
      toast.error(err?.message || 'Image upload failed');
      return;
    }

    // Drop placeholder competitor-ref-* sentinels — only send real URLs.
    const realCompetitorRef =
      competitorAdRef && !competitorAdRef.startsWith('competitor-ref-') ? competitorAdRef : '';

    const apiModel = model; // `model` already holds the canonical apiId

    // Combine user-supplied refs with the chip-picked brand images. Dedupe
    // so the same URL never lands in the payload twice.
    const referenceSet = new Set(referenceUrls.filter(Boolean));
    for (const u of brandImagesPicked) if (u) referenceSet.add(u);
    const referencePayloadLimit = MAX_REFS_TOTAL - (realCompetitorRef ? 1 : 0);
    const referenceImagesPayload = Array.from(referenceSet).slice(0, referencePayloadLimit);

    const body = buildImageInputs('ai_ads', {
      ...brand,
      brandLogo: logoUrl,
      userPrompt: prompt.trim(),
      referenceImages: referenceImagesPayload,
      competitorReferenceImage: realCompetitorRef,
      aspectCounts,
      model: apiModel,
      quality,
    });

    try {
      await dispatch(generateImageAction(body));
      // Render flow is driven by `imageState` from the slice.
    } catch {
      // Already surfaced via slice → imageState.error; nothing to do here.
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  const resetToForm = () => {
    dispatch(resetCurrent());
    setView({ kind: 'form' });
  };

  // Loading view — driven by the slice. 'submitting' = POST in flight,
  // 'pending' = sessionId received and we're polling for the worker result.
  if (imageState.status === 'submitting' || imageState.status === 'pending') {
    return (
      <LifestyleShell title="AI Creatives - Custom Ads" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 text-gray-900 dark:text-white">
          <Loader2 size={36} className="animate-spin text-gray-500 dark:text-white/80" />
          <p className="text-[15px] text-gray-500 dark:text-white/80">
            {imageState.status === 'submitting' ? 'Submitting…' : 'Generating your creatives…'}
          </p>
          <p className="text-[12px] text-gray-500 dark:text-white/40">This usually takes 20–60 seconds.</p>
        </div>
      </LifestyleShell>
    );
  }

  // Results view — only used when there's no parent handoff; the AdCreative
  // layout always wires onComplete, which fires the genie effect and routes
  // the user to MySpace > Images instead of showing this inline screen.
  if (!onComplete && imageState.status === 'completed' && imageState.result?.url) {
    return (
      <ResultsView
        images={[{ url: imageState.result.url, aspect: primaryRatio(aspectCounts) }]}
        taskId={imageState.sessionId ?? ''}
        onClose={onClose}
        onBack={resetToForm}
      />
    );
  }

  return (
    <LifestyleShell title="AI Creatives - Custom Ads" onClose={onClose}>
      {showCompetitorModal ? (
        <CompetitorModal
          search={competitorSearch}
          onSearchChange={setCompetitorSearch}
          tab={competitorTab}
          onTabChange={setCompetitorTab}
          initialSelectedUrl={competitorAdRef}
          onSelect={(ref) => {
            // 5-cap: competitor counts as one slot alongside refs + brand
            // picks. If the other slots are already full, surface the
            // inline warning instead of letting the user overshoot.
            if (
              ref
              && referenceImages.length + brandImagesPicked.length >= MAX_REFS_TOTAL
            ) {
              setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
              return;
            }
            setCompetitorAdRef(ref);
            setImagesError('');
            setShowCompetitorModal(false);
          }}
          onClose={() => setShowCompetitorModal(false)}
        />
      ) : (
        <>
      <form onSubmit={handleSubmit} className="relative w-full max-w-[1043px]">
        <div className="adcreative-setup-modal relative w-full max-w-[1043px] max-h-[calc(100svh-40px)] overflow-y-auto rounded-[24px] bg-[var(--ws-surface)] dark:bg-[var(--adcreative-dark-surface)] p-[22px_26px] border border-[var(--ws-border)] dark:border-[var(--adcreative-dark-border)] shadow-[var(--ws-shadow-md)] dark:shadow-[0_30px_70px_-30px_rgba(0,0,0,0.55)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="relative flex items-center justify-center min-h-[40px] mb-4">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center h-10 w-10 text-[#4A4758] hover:text-[#1F1D29] transition-colors rounded-full hover:bg-black/5 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10"
            >
              <ArrowLeft size={20} strokeWidth={2.2} />
            </button>
            <h3 className="text-[17px] font-bold text-[#1F1D29] dark:text-white text-center">
              Create Custom Ads
            </h3>
          </div>

          {(view.kind === 'error' || imageState.status === 'failed') && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-[13px] text-red-700 ring-1 ring-red-500/30 dark:text-red-200">
              <AlertCircle size={14} />
              {view.kind === 'error' ? view.message : imageState.error}
              <button
                type="button"
                onClick={resetToForm}
                className="ml-auto text-red-600 hover:text-red-800 dark:text-red-200/80 dark:hover:text-white"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:min-h-[360px] lg:grid-cols-[minmax(0,455fr)_minmax(0,443fr)] gap-[22px] items-stretch">
            {/* Left: Prompt */}
            <div className="flex flex-1 min-w-0 flex-col h-full">
              <div className="flex items-center justify-between gap-3 mb-[7px]">
                <span className="text-[13px] font-semibold text-[#1F1D29] dark:text-white">
                  Prompt<span className="text-[#5867EB] ml-0.5">*</span>
                </span>
                <TemplatesTrigger controller={templates} />
              </div>

              <TemplatesPanel controller={templates} />
              <TemplatesResizer controller={templates} />

              <div
                className="adcreative-prompt-card relative flex flex-1 flex-col rounded-[16px] border bg-[var(--ws-surface-control)] dark:bg-[var(--adcreative-dark-control)] min-h-[140px] transition-colors border-[var(--ws-border)] focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:border-[var(--adcreative-dark-border)]"
              >
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="write your prompt..."
                  required
                  style={{ backgroundColor: 'transparent' }}
                  className="flex-1 min-h-[60px] resize-none border-0 !bg-transparent bg-transparent px-[18px] pt-4 pb-2 text-[14px] leading-[1.6] text-[#1F1D29] placeholder:text-[#85829A] outline-none dark:text-white dark:placeholder:text-gray-500 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                />

                {(() => {
                  const promptThumbs = [
                    ...referenceImages.map((it, refIndex) => ({
                      kind: 'ref',
                      preview: it.preview,
                      refIndex,
                    })),
                    ...brandImagesPicked.map((u) => ({
                      kind: 'brand-pool',
                      preview: u,
                    })),
                    ...(competitorAdRef && !competitorAdRef.startsWith('competitor-ref-')
                      ? [{ kind: 'competitor', preview: competitorAdRef }]
                      : []),
                  ].slice(0, 5);

                  if (promptThumbs.length === 0) return null;

                  return (
                    <div className="flex flex-wrap items-end justify-end gap-2 px-3 pb-2">
                      {promptThumbs.map((t, i) => (
                        <div
                          key={'prompt-preview-' + t.kind + '-' + i + '-' + t.preview}
                          className="relative h-[84px] w-14 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-black/10 sm:h-24 sm:w-16 dark:ring-white/10"
                        >
                          <img
                            src={t.preview}
                            alt={t.kind + ' ' + (i + 1)}
                            onClick={() => openLightbox(promptThumbs, i)}
                            className="h-full w-full cursor-pointer object-cover"
                          />
                          <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0F0F0F]/80 via-[#0F0F0F]/20 to-transparent"
                          />
                          <button
                            type="button"
                            aria-label={'Remove ' + t.kind}
                            onClick={() => {
                              if (t.kind === 'competitor') {
                                setCompetitorAdRef('');
                              } else if (t.kind === 'brand-pool') {
                                setBrandImagesPicked((prev) => prev.filter((u) => u !== t.preview));
                              } else {
                                setReferenceImages((prev) =>
                                  prev.filter((_, index) => index !== t.refIndex),
                                );
                              }
                              setImagesError('');
                            }}
                            className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md transition-transform hover:scale-105"
                          >
                            <X className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="flex items-center gap-1.5 p-[8px_10px] bg-[var(--ws-surface-header)] border-t border-[var(--ws-border)] rounded-b-[16px] dark:bg-transparent dark:border-[var(--adcreative-dark-field-border)]">
                  <button
                    type="button"
                    onClick={handleImprovePrompt}
                    disabled={!prompt.trim() || isSuggestingPrompt}
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
                    {SHOW_QUALITY_PICKER && (
                      <QualityPickerPill value={quality} onChange={setQuality} model={model} />
                    )}
                    <ModelPickerPill value={model} onChange={setModel} />
                    <RatioPickerPill counts={aspectCounts} onChange={setAspectCounts} model={model} quality={quality} />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: References Fields */}
            <div className="min-w-0 grid grid-cols-2 gap-x-[14px] gap-y-4 content-start">
              {/* 1. Brand Voice */}
              <div className="col-span-2">
                <span className="text-[13px] font-semibold text-[#1F1D29] dark:text-white block mb-[7px]">
                  Attach your Brand Voice
                </span>
                <div className="adcreative-field-white flex items-center gap-1.5 h-[44px] p-1 bg-[var(--ws-surface-control)] border border-[var(--ws-border)] rounded-[12px] focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)] transition-all">
                  <div ref={brandIqPickerWrapperRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={openBrandIqPicker}
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
                      <ChevronDown size={13} className={'transition-transform ' + (showBrandIqPicker ? 'rotate-180' : '')} />
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
                                className={'flex items-center gap-2 p-[6px_8px] rounded-[9px] text-[12.5px] text-left transition-colors min-w-0 ' + (
                                  selected
                                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                                    : 'text-[#1F1D29] hover:bg-[var(--ws-surface-hover)] dark:text-white dark:hover:bg-white/10'
                                )}
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
                              brandSourceLogoRef.current = '';
                              setBrandLogoOptions([]);
                              setReferenceImages((prev) =>
                                prev.filter((it) => !brandSourceImagesRef.current.includes(it.preview)),
                              );
                              setBrandImagePool([]);
                              brandSourceImagesRef.current = [];
                              setBrandLogoPicked('');
                              setBrandImagesPicked([]);
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
                    value={websiteUrl}
                    onChange={(e) => {
                      setWebsiteUrl(e.target.value);
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
                    disabled={!websiteUrl.trim() || autofillState === 'loading'}
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
                {autofillState === 'ok' && brandSource.kind === 'autofill' && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-500">
                    <Check size={11} /> Brand added successfully
                  </p>
                )}
              </div>

              {/* 2. Upload your own reference Images */}
              <div className="col-span-2">
                <FileUploadField
                  label="Upload your own reference Images"
                  placeholder="Paste your image URL or upload"
                  url={referenceImageUrl}
                  onUrlChange={(v) => {
                    setReferenceImageUrl(v);
                    if (v.trim()) setImagesError('');
                  }}
                  files={referenceImages}
                  onAddFiles={(items) => {
                    const slots = remainingRefSlots();
                    if (slots <= 0) {
                      setImagesError('You can attach up to ' + MAX_REFS_TOTAL + ' images.');
                      return;
                    }
                    const incoming = items.slice(0, slots);
                    setReferenceImages((prev) => [...prev, ...incoming]);
                    if (items.length > slots) {
                      setImagesError('You can attach up to ' + MAX_REFS_TOTAL + ' images.');
                    } else {
                      setImagesError('');
                    }
                  }}
                  onRemoveFile={(i) => {
                    setReferenceImages((p) => p.filter((_, idx) => idx !== i));
                    setImagesError('');
                  }}
                  onPreview={(i) => openLightbox(referenceImages, i)}
                  onInvalidType={() => setImagesError(IMAGE_TYPE_ERROR)}
                />
                {imagesError && <FieldError message={imagesError} />}
                {brandImagePool.length > 0 && (
                  <BrandImageChipRow
                    options={brandImagePool.map((it) => it.preview)}
                    isSelected={(u) => brandImagesPicked.includes(u)}
                    onPick={(u) => {
                      setBrandImagesPicked((prev) => {
                        if (prev.includes(u)) {
                          setImagesError('');
                          return prev.filter((x) => x !== u);
                        }
                        if (remainingRefSlots() <= 0) {
                          setImagesError('You can attach up to ' + MAX_REFS_TOTAL + ' images.');
                          return prev;
                        }
                        setImagesError('');
                        return [...prev, u];
                      });
                    }}
                    onDoubleClick={(u) => {
                      const urls = brandImagePool.map((it) => it.preview);
                      setLightboxImages(urls);
                      setLightboxImage(u);
                      setLightboxOpen(true);
                    }}
                  />
                )}
              </div>

              {/* 3. Brand logo */}
              <div className="col-span-2">
                <FileUploadField
                  label="Brand logo"
                  placeholder="Paste your image URL or upload"
                  url={brandLogoUrl}
                  onUrlChange={(v) => {
                    setBrandLogoUrl(v);
                    if (brandLogoFile) setBrandLogoFile(null);
                    if (v.trim()) setLogoError('');
                  }}
                  files={brandLogoFile ? [{ file: brandLogoFile, preview: brandLogoFilePreview }] : []}
                  onAddFiles={(items) => {
                    if (items[0]?.file) {
                      setBrandLogoFile(items[0].file);
                      setBrandLogoUrl('');
                      setLogoError('');
                    } else if (items[0]?.preview) {
                      setBrandLogoFile(null);
                      setBrandLogoUrl(items[0].preview);
                      setLogoError('');
                    }
                  }}
                  onRemoveFile={() => {
                    setBrandLogoFile(null);
                    setLogoError('');
                  }}
                  onPreview={() => {
                    if (brandLogoFilePreview) {
                      setLightboxImages([brandLogoFilePreview]);
                      setLightboxImage(brandLogoFilePreview);
                      setLightboxOpen(true);
                    }
                  }}
                  onInvalidType={() => setLogoError(IMAGE_TYPE_ERROR)}
                  multiple={false}
                />
                {logoError && <FieldError message={logoError} />}
                {brandLogoOptions.length > 0 && (
                  <BrandImageChipRow
                    options={brandLogoOptions}
                    isSelected={(u) => u === brandLogoPicked}
                    onPick={(u) => {
                      setBrandLogoFile(null);
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

              {/* 4. Attach a Competitor Ad Reference */}
              <div className="col-span-2">
                <span className="text-[13px] font-semibold text-[#1F1D29] dark:text-white block mb-[7px]">
                  Attach a Competitor Ad Reference
                </span>
                <div className="group rounded-full max-w-90 p-px [background:linear-gradient(90deg,rgba(2,200,196,0.5)_0%,rgba(88,103,235,0.5)_78%)] transition-all hover:[background:linear-gradient(90deg,rgba(2,200,196,0.75)_0%,rgba(88,103,235,0.75)_78%)]">
                  <button
                    type="button"
                    onClick={() => setShowCompetitorModal(true)}
                    className="flex w-full max-w-90 items-center justify-center gap-2 rounded-full bg-[var(--ws-surface-control)] dark:bg-[var(--adcreative-dark-popup)] py-2 text-[13px] font-semibold text-[#1F1D29] dark:text-[#ebebeb] transition-colors hover:bg-[var(--ws-surface-hover)] dark:hover:bg-[var(--adcreative-dark-raised)]"
                  >
                    <Search size={16} strokeWidth={2.2} />
                    Search competitors ads
                  </button>
                </div>
                {competitorAdRef && (
                  <p className="mt-1.5 text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">✓ Reference added</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end items-center gap-[10px] mt-[18px] pt-[14px] border-t border-[var(--ws-border)] dark:border-white/10">
            {total > 0 && (
              <span className="text-[12px] text-[#85829A] font-medium border border-[var(--ws-border)] bg-[var(--ws-surface-control)] rounded-full px-[9px] py-[3px] dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)] dark:text-gray-300">
                ~{total * creditsPerImage} credits
              </span>
            )}
            <button
              type="submit"
              disabled={!prompt.trim() || total === 0 || isSubmittingLocal}
              className="h-[42px] px-[26px] rounded-[11px] bg-[#5867EB] hover:bg-[#4755D9] text-white font-semibold text-[14px] shadow-[0_8px_18px_-8px_rgba(88,103,235,0.6)] transition-all disabled:bg-[#B9C0F5] disabled:shadow-none disabled:cursor-default dark:disabled:border dark:disabled:border-white/10 dark:disabled:bg-[#353442] dark:disabled:text-[#9692AB] flex items-center gap-2"
            >
              {isSubmittingLocal && <Loader2 size={16} className="animate-spin" />}
              {isSubmittingLocal ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </form>
      {lightboxOpen && (
        <ShowLightBox
          images={lightboxImages}
          lightboxImage={lightboxImage}
          closeLightbox={() => setLightboxOpen(false)}
        />
      )}
        </>
      )}
    </LifestyleShell>
  );
}

// Picker chips rendered below a section. Single click → onPick(url), double
// click → onDoubleClick(url) — disambiguated with a 220ms delay so single
// clicks don't fire on the first half of a double-click. Active chip gets
// a cyan ring + check. `rounded` switches between square (images) and
// pill-shaped (logos) chips.
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
        className={'adcreative-field-white flex items-center gap-1.5 h-[42px] pl-3 pr-1 bg-white border rounded-[10px] transition-all ' + (
          isDrag
            ? 'border-solid border-[#5867EB] ring-[3px] ring-[#5867EB]/16'
            : 'border-dashed border-[var(--ws-border)] focus-within:border-solid focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16'
        ) + ' dark:bg-[var(--adcreative-dark-control)] dark:border-[var(--adcreative-dark-border)]'}
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
              key={it.preview + '-' + i}
              className="relative h-[34px] w-[34px] shrink-0 rounded-[8px] border border-[#3AD0C8] bg-white transition-transform hover:-translate-y-0.5"
            >
              <img
                src={it.preview}
                alt=""
                onClick={() => onPreview?.(i)}
                className="h-full w-full rounded-[7px] object-cover cursor-pointer"
              />
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#3AD0C8] text-white border-2 border-white text-[10px]">
                <Check size={10} strokeWidth={3} />
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(i);
                }}
                className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow"
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
        {options.map((item, i) => {
          const url = typeof item === 'string' ? item : item?.preview || '';
          if (!url) return null;
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
              key={'bp-' + i + '-' + url}
              onClick={handleSingle}
              onDoubleClick={handleDouble}
              title={selected ? 'Click to remove · double-click to preview' : 'Click to select · double-click to preview'}
              className={'relative h-[34px] w-[34px] shrink-0 rounded-[8px] border bg-white cursor-pointer transition-transform hover:-translate-y-0.5 ' + (
                selected ? 'border-[#3AD0C8]' : 'border-[var(--ws-border)]'
              )}
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
                className={'flex w-full items-center px-3 py-2.5 text-left text-[13px] transition-colors ' + (
                  selected
                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                    : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                )}
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
                className={'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ' + (
                  selected
                    ? 'bg-[#ECEEFD] text-[#5867EB] font-medium dark:bg-[#5867EB]/20 dark:text-[#8D99FF]'
                    : 'text-gray-700 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                )}
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

function ResultsView({ images, taskId, onClose, onBack }) {
  return (
    <LifestyleShell title="AI Creatives - Results" onClose={onClose}>
      <div className="w-full max-w-[1100px]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className=" text-[18px] font-semibold text-gray-900 dark:text-white">
              Generated {images.length} image{images.length === 1 ? '' : 's'}
            </h3>
            {taskId && <p className="text-[11px] text-gray-500 dark:text-white/40">task {taskId.slice(0, 12)}…</p>}
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-gray-900 text-white dark:bg-white px-6 py-2.5 text-[13px] font-medium dark:text-black hover:opacity-90"
          >
            Generate again
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, i) => (
            <figure
              key={i}
              className="overflow-hidden rounded-[20px] bg-gray-50 dark:bg-[#202121] ring-1 ring-black/10 dark:ring-white/5"
            >
              <img
                src={img.url}
                alt={`Generated ${img.aspect}`}
                className="block h-auto w-full"
              />
              <figcaption className="flex items-center justify-between px-4 py-3 text-[11px]">
                <span className="text-gray-500 dark:text-white/70">{img.aspect}</span>
                <a
                  href={img.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-500 dark:text-white/60 hover:text-black dark:hover:text-white"
                >
                  Open
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </LifestyleShell>
  );
}

function PillButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-3 py-3 text-[12px] font-light text-gray-600 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
    >
      {icon && <span aria-hidden>{icon}</span>}
      {label}
      <ChevronDown size={18} strokeWidth={2} className="text-gray-500 dark:text-white/40" />
    </button>
  );
}

function CompetitorModal({
  search,
  onSearchChange,
  tab,
  onTabChange,
  onSelect,
  onClose,
  // URL of the competitor visual the user previously confirmed (persisted
  // across modal opens within a session so the chip stays marked).
  initialSelectedUrl,
}) {
  const dispatch = useDispatch();
  const { ads, loading, hasMore, onScrollLoading } = useSelector(
    (state) => state.competitorSearch
  );

  // Seed from the parent's confirmed competitor URL so reopening the modal
  // shows the previously-selected card as still selected.
  const [selectedImage, setSelectedImage] = useState(
    initialSelectedUrl ? { url: initialSelectedUrl } : null,
  );
  const containerRef = useRef(null);
  const initialLoadRef = useRef(false);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    dispatch(setSearchTerm(''));
    dispatch(setSearchType('competitor'));
    dispatch(resetCompetitorSearch());
    dispatch(fetchCompetitorAds());
    return () => dispatch(resetCompetitorSearch());
  }, [dispatch]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        if (!onScrollLoading && hasMore) dispatch(fetchCompetitorAds());
      }
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [dispatch, onScrollLoading, hasMore]);

  useEffect(() => {
    if (!initialLoadRef.current) return;
    const term = search.trim();
    if (term.length < 3) return;
    const debounce = setTimeout(() => {
      dispatch(setSearchTerm(term));
      dispatch(setSearchType(tab === 'Competitors' ? 'competitor' : 'keyword'));
      dispatch(resetCompetitorSearch());
      dispatch(fetchCompetitorAds());
    }, 600);
    return () => clearTimeout(debounce);
    // `tab` is intentionally NOT in the deps — the tab buttons' onClick
    // already dispatches the fetch immediately. Including `tab` here would
    // queue a duplicate debounced fetch on every tab switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dispatch]);

  // Only re-fetch when the user actually clears a previously-non-empty
  // search. Without the prevSearchRef guard this effect double-dispatched
  // alongside the initial-load effect on mount, racing the first fetch's
  // result and leaving the modal empty even though ads had returned.
  const prevSearchRef = useRef('');
  useEffect(() => {
    if (!initialLoadRef.current) return;
    const wasNonEmpty = prevSearchRef.current.trim().length > 0;
    const isEmpty = !search.trim();
    prevSearchRef.current = search;
    if (wasNonEmpty && isEmpty) {
      dispatch(setSearchTerm(''));
      dispatch(setSearchType('competitor'));
      dispatch(resetCompetitorSearch());
      dispatch(fetchCompetitorAds());
    }
  }, [search, dispatch]);

  const handleSearchSubmit = () => {
    const term = search.trim();
    if (!term) return;
    dispatch(setSearchTerm(term));
    dispatch(setSearchType(tab === 'Competitors' ? 'competitor' : 'keyword'));
    dispatch(resetCompetitorSearch());
    dispatch(fetchCompetitorAds());
  };

  const toggleImage = (image) => {
    setSelectedImage((prev) => (prev?.url === image.url ? null : image));
  };

  // Modal-local lightbox for double-click preview of a competitor ad.
  const [modalLightbox, setModalLightbox] = useState(null); // { url } | null
  const openModalLightbox = (image) => setModalLightbox({ url: image?.url });
  const closeModalLightbox = () => setModalLightbox(null);

  const breakpointColumnsObj = { default: 3, 1024: 2, 640: 1 };

  return (
    <div className="w-full max-w-[800px] min-w-[420px] 2xl:max-w-[900px]">
      {/* min-h on the OUTER panel guarantees the modal never collapses
          when the ads response is small. The grid below uses min-h too as
          a secondary safety net. */}
      <div className="relative -mt-5 flex min-h-[680px] flex-col rounded-[30px] bg-white dark:bg-[#303030]/30 p-6 ring-1 ring-black/10 dark:ring-white/10 backdrop-blur-md lg:px-8 2xl:min-h-[760px] 2xl:mt-0">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-7 right-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 dark:text-white/60 transition-colors hover:text-black dark:hover:text-white"
          aria-label="Close"
        >
          <X size={26} strokeWidth={2} />
        </button>

        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 pr-6">
          <h3 className="text-[18px] font-semibold text-gray-900 dark:text-white">Add a competitor visual</h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-gray-100 dark:bg-[#0d0d0d]/50 px-4 py-2 ring-1 ring-black/10 dark:ring-white/10">
              <Search size={16} strokeWidth={1.8} className="shrink-0 text-gray-500 dark:text-[#969696]" />
              <input
                type="text"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchSubmit();
                  }
                }}
                placeholder="Search..."
                className="w-24 min-w-0 flex-1 bg-transparent text-[12px] font-light text-gray-900 dark:text-white outline-none placeholder:text-gray-500 dark:placeholder:text-[#969696]"
              />
              <div className="flex items-center gap-1">
                {['Competitors', 'Keyword'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      onTabChange(t);
                      if (search.trim()) {
                        dispatch(setSearchTerm(search.trim()));
                        dispatch(setSearchType(t === 'Competitors' ? 'competitor' : 'keyword'));
                        dispatch(resetCompetitorSearch());
                        dispatch(fetchCompetitorAds());
                      }
                    }}
                    className={`rounded-2xl px-3 py-1 text-[12px] font-light whitespace-nowrap transition-colors ${
                      t === tab
                        ? 'bg-gray-200 text-gray-900 ring-1 ring-black/10 dark:bg-[#3c3c3c] dark:text-white dark:ring-white/20'
                        : 'text-gray-500 dark:text-white/50 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Masonry Grid — fixed minimum height (≈two rows of three cards)
            so the panel never collapses when the response is small.
            Dropped `flex-1` because it was negotiating the height down
            with sibling rows. `min-h` is the load-bearing rule here. */}
        <div
          ref={containerRef}
          className="mt-3 min-h-[65vh] max-h-[65vh] overflow-y-auto rounded-xl pr-2 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin] 2xl:min-h-[560px] 2xl:max-h-[55vh]"
        >
          {/* In-flight skeleton grid while the API is loading. Once the
              response arrives we switch to the masonry, where every card
              has its own per-image Skeleton that lasts until that image
              finishes loading. */}
          {loading && ads.length === 0 ? (
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i}>
                  <Skeleton
                    height={250}
                    borderRadius="0.75rem"
                    baseColor="#2A2A2A"
                    highlightColor="#3A3A3A"
                  />
                </div>
              ))}
            </div>
          ) : ads.length > 0 ? (
            <Masonry
              breakpointCols={breakpointColumnsObj}
              className="flex w-full gap-4"
              columnClassName="space-y-4"
            >
              {ads.map((ad, idx) => {
                const rawUrl = ad?.postImage || ad?.media_url || ad?.image_url || ad?.data || '';
                const imageUrl =
                  rawUrl && typeof rawUrl === 'string'
                    ? rawUrl.startsWith('http')
                      ? rawUrl
                      : `${NAS_BASE_URL}${rawUrl}`
                    : '';
                const imageWithId = { ...ad, url: imageUrl, id: ad.id || idx };
                const isSelected = selectedImage?.url === imageUrl;
                return (
                  <CompetitorImageCard
                    key={imageWithId.id}
                    image={imageWithId}
                    isSelected={isSelected}
                    onSelect={toggleImage}
                    onPreview={openModalLightbox}
                  />
                );
              })}
            </Masonry>
          ) : (
            !loading && (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400">No results found</p>
              </div>
            )
          )}
          {onScrollLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-white/50" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            disabled={!selectedImage}
            onClick={() => onSelect(selectedImage?.url || '')}
            className="rounded-full bg-gray-900 text-white dark:bg-white px-8 py-2 text-[15px] font-bold dark:text-[#151515] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add Reference
          </button>
        </div>
      </div>
      {modalLightbox?.url && (
        <ShowLightBox
          images={[modalLightbox.url]}
          lightboxImage={modalLightbox.url}
          closeLightbox={closeModalLightbox}
        />
      )}
    </div>
  );
}

function CompetitorImageCard({ image, isSelected, onSelect, onPreview }) {
  const [imgLoading, setImgLoading] = useState(true);
  // Click vs. double-click disambiguation: defer the single-click action by
  // 220 ms so a double-click can cancel it. Single click = toggle selection,
  // double-click = open the preview lightbox.
  const clickTimerRef = useRef(null);
  const handleClick = (e) => {
    e.stopPropagation();
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onSelect?.(image);
      clickTimerRef.current = null;
    }, 220);
  };
  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onPreview?.(image);
  };
  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`relative cursor-pointer rounded-xl ${imgLoading ? 'min-h-[250px]' : ''}`}
    >
      {imgLoading && (
        // Mirrors the page-level skeleton style (#2A2A2A → #3A3A3A) so the
        // per-card loading state visually matches the initial-load grid.
        <div className="absolute inset-0 overflow-hidden rounded-xl">
          <Skeleton
            height="100%"
            width="100%"
            borderRadius="0.75rem"
            baseColor="#2A2A2A"
            highlightColor="#3A3A3A"
            containerClassName="block h-full w-full"
          />
        </div>
      )}
      <div
        className={`relative overflow-hidden rounded-2xl transition-all duration-200 ${
          isSelected ? 'border-3 border-[#2364B8]' : ''
        }`}
      >
        <img
          src={image.url}
          alt=""
          onLoad={() => setImgLoading(false)}
          onError={() => setImgLoading(false)}
          className={`w-full rounded-xl object-cover transition-transform duration-300 hover:scale-[1.02] ${
            imgLoading ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#2364B8]">
          <div className="h-2 w-2 rounded-full bg-white" />
        </div>
      )}
    </div>
  );
}

const inputCls = `
  h-[39px] min-w-full max-w-full flex-1 rounded-full bg-gray-100 dark:bg-[#909294]/10 px-4  text-[13px] font-light text-gray-900 dark:text-white
  outline-none ring-1 ring-black/10 dark:ring-white/5 placeholder:text-gray-500 dark:placeholder:text-[#afafaf]
  focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20
`;
