import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { Check, ChevronDown, LayoutGrid, Link2, Loader2, Proportions, Upload, X } from 'lucide-react';
import AspectRatioTiles, {
  AnimatedPanel,
  totalImages,
} from '@/components/AdStudio/AdCreativeNew/AspectRatioPicker';
import { SiOpenai } from 'react-icons/si';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import brandIqIcon from '@/assets/layouts/appsidebar/brand-iq-dark.svg';
import chatResponseDark from '@/assets/layouts/adstudio/chat-response-dark.svg';
import geminiIcon from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceIcon from '@/assets/layouts/profile/seedance_logo_transparent.png';
import {
  AUTOFILL_FAILURE_MESSAGE,
  fetchAutofill,
  fetchBrandList,
  getAuthToken,
  getUserId,
} from '@/components/AdStudio/AdCreativeNew/ai-creatives/apiClient';
import { silentSaveBrandFromAutofill } from '@/components/AdStudio/AdCreativeNew/ai-creatives/silentBrandSave';
import { generateImageAction } from '@/store/actions/image/imageActions';
import {
  clearImageRecreateInputs,
  resetCurrent,
} from '@/store/reducers/image/imageSlice';
import { buildImageInputs } from '@/store/actions/image/buildImageInputs';
import { uploadToS3 } from '@/utils/imageUpload';
import {
  ALLOWED_IMAGE_ACCEPT,
  IMAGE_TYPE_ERROR,
  isAllowedImageFile,
} from '@/utils/imageValidation';
import { useGenieToMySpace } from '@/utils/ui/useGenieToMySpace';
import { useAdCreativeConfig } from '@/utils/hooks/useAdCreativeConfig';

const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Single-item S3 upload helper. `value` is either a File (push to S3 and
// return the hosted URL) or a string URL (pass through). Returns '' for
// falsy / failed uploads so the caller can treat the field as absent.
async function resolveAsset(value, userId) {
  if (!value) return '';
  if (value instanceof File) {
    const path = await uploadToS3(value, userId, true);
    return path ? `${S3_BASE_URL}${path}` : '';
  }
  return typeof value === 'string' ? value : '';
}

const PROMPT_API = import.meta.env.VITE_PROMPT_API;

// Model list, aspect ratios, qualities and credits come from the backend
// `ad_creative` surface via useAdCreativeConfig — no longer hardcoded.

// Aspect-ratio helpers + the picker panel live in the shared AspectRatioTiles
// module (imported above).

// Quality tiers are per-model (selectedModel.qualities). Labels are
// presentation-only.
const QUALITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', ultra_high: 'Ultra High' };
const qualityLabel = (v) => QUALITY_LABELS[v] || v;

// Quality picker enabled; the backend reads the sent quality.
const SHOW_QUALITY_PICKER = true;

// Combined 5-image cap across uploads + chip picks. Matches AiCreativesCustom.
// The source ad on the left is the implicit competitor reference and lives
// outside this count — only user-added images contribute.
const MAX_REFS_TOTAL = 5;


// Icons are frontend-owned, chosen by model id: OpenAI → SiOpenai react-icon,
// Seedream → Seedance logo, everything else → Gemini image.
function ModelIcon({ apiId }) {
  const id = String(apiId || '');
  if (/gpt-image/i.test(id)) {
    return <SiOpenai size={14} className="text-gray-700 dark:text-white/80" />;
  }
  const src = /seedream/i.test(id) ? seedanceIcon : geminiIcon;
  return <img src={src} alt="" className="h-3.5 w-3.5 object-contain" />;
}

const RecreateAdModal = ({ open, onOpenChange, image, ad }) => {
  const dispatch = useDispatch();
  const imageState = useSelector((s) => s.image.current);
  const recreateInputs = useSelector((s) => s.image.recreateInputs);
  const userData = useSelector((s) => s.socket?.userData);

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('gemini-3.1-flash-image-preview'); // Nano Banana 2 (canonical apiId)
  const [quality, setQuality] = useState('high');
  const [aspectCounts, setAspectCounts] = useState({});

  // Model list + per-model aspect ratios / qualities / credits from the backend
  // `ad_creative` surface (shared cache, fallback baked in).
  const { models: configModels } = useAdCreativeConfig();
  const selectedModel = configModels.find((m) => m.apiId === model);
  // Per-image credits for the selected model + quality (falls back to the
  // model's default/high tier, then 7).
  const creditsPerImage =
    selectedModel?.creditsByQuality?.[quality] ?? selectedModel?.creditsPerImage ?? 7;

  const [brandSource, setBrandSource] = useState({ kind: 'none' });
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [autofillState, setAutofillState] = useState('idle');
  const [autofillError, setAutofillError] = useState('');

  // URL field text is strictly what the user typed/pasted — chip picks do
  // NOT flow into it. The chip selection (brandLogoPicked / referenceImagesPicked)
  // lives in its own slot so the input stays clean for new user entries.
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  // Multi-upload / multi-paste reference images. Each entry is
  // { file: File|null, preview: string } — preview is a blob URL for files
  // and the raw URL for pastes. Single click removes that specific chip,
  // double click opens the lightbox.
  const [referenceImages, setReferenceImages] = useState([]);
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandLogoFile, setBrandLogoFile] = useState(null);
  // Picker options from autofill / BrandIQ — shown as clickable chips but
  // NOT auto-selected. User explicitly clicks to populate the field.
  const [brandLogoOptions, setBrandLogoOptions] = useState([]);
  const [referenceImageOptions, setReferenceImageOptions] = useState([]);
  // Chip selections (decoupled from the URL inputs).
  //   - brandLogoPicked  : single string (one logo)
  //   - referenceImagesPicked : array (multi-select)
  const [brandLogoPicked, setBrandLogoPicked] = useState('');
  const [referenceImagesPicked, setReferenceImagesPicked] = useState([]);
  // Inline cap / type warning for the references area. Set when the user
  // tries to overshoot the 5-image cap OR pastes/drops a non-allowed file
  // type; cleared whenever any contributing slot is freed.
  const [imagesError, setImagesError] = useState('');
  // Inline type warning for the brand-logo upload — surfaces under the logo
  // row when a non-allowed file type is dropped / pasted / picked.
  const [logoError, setLogoError] = useState('');
  const remainingRefSlots = () =>
    Math.max(
      0,
      MAX_REFS_TOTAL - referenceImages.length - referenceImagesPicked.length,
    );
  // Lightbox URL for double-click preview of a chip.
  const [lightboxUrl, setLightboxUrl] = useState('');
  // Portal target for the lightbox. Resolved after first mount so we
  // don't hand `null`/`undefined` to createPortal during SSR-style render
  // (which throws "Target container is not a DOM element").
  const [portalTarget, setPortalTarget] = useState(null);
  useEffect(() => {
    if (typeof document !== 'undefined') {
      setPortalTarget(document.body);
    }
  }, []);

  const [brandList, setBrandList] = useState([]);
  const [brandListState, setBrandListState] = useState('idle');
  const [brandListError, setBrandListError] = useState('');

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showAspectPicker, setShowAspectPicker] = useState(false);
  const [showBrandIqPicker, setShowBrandIqPicker] = useState(false);
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modelPickerWrapperRef = useRef(null);
  const qualityPickerWrapperRef = useRef(null);
  const aspectPickerWrapperRef = useRef(null);
  const brandIqPickerWrapperRef = useRef(null);
  // The Brand IQ menu is portalled to <body> so it can overlay the Prompt
  // area below instead of being clipped by the right-column scroll
  // container's overflow-y-auto. brandIqMenuRef points at the portalled
  // node (needed for click-outside); brandIqMenuPos holds its fixed coords.
  const brandIqMenuRef = useRef(null);
  const [brandIqMenuPos, setBrandIqMenuPos] = useState(null);
  const referenceInputRef = useRef(null);
  const logoInputRef = useRef(null);
  const brandListAbortRef = useRef(null);
  const autofillAbortRef = useRef(null);

  // Modal DOM ref for the genie animation. Captured to a snapshot before
  // the genie minimize fires and the dialog closes.
  const modalRef = useRef(null);
  const mySpaceIconRef = useRef(null);
  const triggerGenieToMySpace = useGenieToMySpace(modalRef, mySpaceIconRef);
  // Guard so we only fire the genie + close-dialog handoff once per submit.
  const completeFiredRef = useRef(false);

  // Reconcile per-ratio counts when the model changes — models offer different
  // ratio sets. Keep valid ratios, drop the rest, default to a single 1:1.
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

  // Keep the selected quality valid for the current model.
  useEffect(() => {
    const qualities = selectedModel?.qualities;
    if (!qualities || qualities.length === 0 || qualities.includes(quality)) return;
    setQuality(qualities.includes('high') ? 'high' : qualities[0]);
  }, [selectedModel, quality]);

  useEffect(() => {
    if (!showModelPicker && !showQualityPicker && !showAspectPicker && !showBrandIqPicker)
      return undefined;
    const onDocClick = (e) => {
      const t = e.target;
      // The aspect quantity dropdown is portalled to <body>, outside these
      // wrappers — treat clicks inside it as "inside" so selecting a quantity
      // doesn't close the aspect panel.
      if (t?.closest?.('[data-aspect-quantity-menu]')) return;
      const inModel = modelPickerWrapperRef.current?.contains(t);
      const inQuality = qualityPickerWrapperRef.current?.contains(t);
      const inAspect = aspectPickerWrapperRef.current?.contains(t);
      const inBrandIq =
        brandIqPickerWrapperRef.current?.contains(t) ||
        brandIqMenuRef.current?.contains(t);
      if (!inModel && !inQuality && !inAspect && !inBrandIq) {
        setShowModelPicker(false);
        setShowQualityPicker(false);
        setShowAspectPicker(false);
        setShowBrandIqPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showModelPicker, showQualityPicker, showAspectPicker, showBrandIqPicker]);

  // Keep the portalled Brand IQ menu anchored to its trigger. Recompute on
  // open and on any scroll/resize (the trigger sits in a scroll container)
  // so the fixed-position menu tracks the button.
  useEffect(() => {
    if (!showBrandIqPicker) {
      setBrandIqMenuPos(null);
      return undefined;
    }
    const place = () => {
      const el = brandIqPickerWrapperRef.current;
      const host = modalRef.current;
      if (!el || !host) return;
      // Coords are relative to the DialogContent (the portal host), which
      // is `position: fixed` with a centering transform → it's the
      // containing block for our absolutely-positioned menu.
      const r = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      setBrandIqMenuPos({ top: r.bottom - h.top + 8, left: r.left - h.left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [showBrandIqPicker]);

  useEffect(() => {
    if (!open) {
      brandListAbortRef.current?.abort();
      autofillAbortRef.current?.abort();
    }
  }, [open]);

  // Recreate-from-history prefill. When this modal is opened from MySpace
  // > Recreate on a `recreate_ads` card, ImageCard stashes the (tailored)
  // inputs into state.image.recreateInputs immediately before raising the
  // open. We hydrate once when the modal opens, then clear redux so a
  // remount doesn't re-apply the prefill.
  useEffect(() => {
    if (!open || !recreateInputs || recreateInputs.type !== 'recreate_ads') return;
    const inp = recreateInputs;

    setPrompt(inp.userPrompt || inp.prompt || '');

    // Records store the canonical model id — which is now what `model` holds.
    if (inp.model && configModels.some((m) => m.apiId === inp.model)) {
      setModel(inp.model);
    }

    if (inp.quality && QUALITY_LABELS[inp.quality]) {
      setQuality(inp.quality);
    }

    // Aspect ratio — honour the structured array first, otherwise fall back to
    // the flat aspectRatio + numberOfImages pair. The reconcile effect merges
    // these into the selected model's ratio set.
    if (Array.isArray(inp.aspectRatioPerImage) && inp.aspectRatioPerImage.length > 0) {
      const counts = {};
      for (const { aspectRatio, numberOfImages } of inp.aspectRatioPerImage) {
        if (aspectRatio) counts[aspectRatio] = Number(numberOfImages) || 0;
      }
      setAspectCounts(counts);
    } else if (inp.aspectRatio) {
      setAspectCounts({ [inp.aspectRatio]: Number(inp.numberOfImages) || 1 });
    }

    // Brand voice — synthesize a list source so the pill shows the brand
    // name + chips appear for logos and images.
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
    setBrandLogoOptions(inp.brandLogo ? [inp.brandLogo] : []);
    setBrandLogoPicked(inp.brandLogo || '');
    // Previously-used references rehydrate as user-supplied chips (file
    // is null since we only have the URL — they pass through resolveAsset
    // untouched at submit time).
    const refs = Array.isArray(inp.referenceImages) ? inp.referenceImages : [];
    setReferenceImages(
      refs.filter(Boolean).map((u) => ({ file: null, preview: u, selected: true })),
    );

    dispatch(clearImageRecreateInputs());
  }, [open, recreateInputs, dispatch]);


  const total = totalImages(aspectCounts);

  const openBrandIqPicker = async () => {
    setShowModelPicker(false);
    setShowAspectPicker(false);
    setShowBrandIqPicker((v) => !v);
    if (brandListState === 'loaded' || brandListState === 'loading') return;

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
      setBrandListError(err.message);
      setBrandListState('error');
    }
  };

  const handleBrandIqSelect = (item) => {
    const itemId = item.id || item._id;
    const sourceId =
      brandSource.kind === 'list'
        ? brandSource.item.id || brandSource.item._id
        : null;
    // Clicking the already-selected brand toggles it off — clear every
    // field the brand source had populated.
    if (sourceId && itemId && sourceId === itemId) {
      setBrandSource({ kind: 'none' });
      setBrandLogoOptions([]);
      setReferenceImageOptions([]);
      setBrandLogoPicked('');
      setReferenceImagesPicked([]);
      setShowBrandIqPicker(false);
      setAutofillState('idle');
      return;
    }
    setBrandSource({ kind: 'list', item });
    setShowBrandIqPicker(false);
    setAutofillState('idle');
    // Surface the brand's logos and images as picker chips below the
    // respective inputs — unselected so the user explicitly opts in.
    setBrandLogoOptions(Array.isArray(item.logoUrls) ? item.logoUrls.filter(Boolean) : []);
    setReferenceImageOptions(
      Array.isArray(item.imageUrl) ? item.imageUrl.filter(Boolean) : [],
    );
    // Drop any chip selections from the previous source so they don't
    // bleed into the new brand's payload.
    setBrandLogoPicked('');
    setReferenceImagesPicked([]);
  };

  const handleAutofill = async () => {
    const trimmed = websiteUrl.trim();
    if (!trimmed || autofillState === 'loading') return;
    autofillAbortRef.current?.abort();
    autofillAbortRef.current = new AbortController();
    setAutofillState('loading');
    setAutofillError('');
    try {
      const data = await fetchAutofill(trimmed, autofillAbortRef.current.signal);
      setBrandSource({ kind: 'autofill', data });
      silentSaveBrandFromAutofill({
        userId: getUserId(),
        userName: userData?.user_name,
        websiteUrl: trimmed,
        autofillData: data,
      });
      setAutofillState('ok');
      // Mirror AiCreativesCustom: show scraped logos + brand images as
      // clickable chips. Empty arrays cleanly hide the chip rows below.
      // Autofill can return very large pools — cap at 10 so the chip row
      // stays manageable.
      const bi = data?.brandInfo || {};
      setBrandLogoOptions(
        Array.isArray(bi.brandLogo) ? bi.brandLogo.filter(Boolean).slice(0, 10) : [],
      );
      setReferenceImageOptions(
        Array.isArray(bi.brandImages) ? bi.brandImages.filter(Boolean).slice(0, 10) : [],
      );
      // Drop prior chip picks so they don't carry over from a previous brand.
      setBrandLogoPicked('');
      setReferenceImagesPicked([]);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAutofillError(err.message || AUTOFILL_FAILURE_MESSAGE);
      setAutofillState('error');
    }
  };

  const handleImprovePrompt = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSuggestingPrompt) return;
    setIsSuggestingPrompt(true);
    try {
      const res = await axios.post(
        PROMPT_API,
        { user_id: getUserId(), prompt: trimmed, type: 'image' },
        { headers: { Authorization: `Bearer ${getAuthToken()}` } },
      );
      const suggestion = res?.data?.suggested_prompt;
      if (suggestion) setPrompt(suggestion);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Prompt must contain at least 3 words');
    } finally {
      setIsSuggestingPrompt(false);
    }
  };

  // Resolve the active brand-voice source into the shape buildImageInputs
  // expects. The actual brandLogo is filled in by handleGenerate after S3
  // upload; here we leave it blank.
  const resolveBrandInfo = () => {
    if (brandSource.kind === 'list') {
      const item = brandSource.item;
      return {
        brandName: item.name || '',
        brandDescription: item.description || '',
        brandLogo: '',
        brandImages: [],
        brandColors: Array.isArray(item.colorPalette) ? item.colorPalette : [],
      };
    }
    if (brandSource.kind === 'autofill') {
      const bi = brandSource.data?.brandInfo || {};
      return {
        brandName: bi.brandName || '',
        brandDescription: bi.brandDescription || '',
        brandLogo: '',
        brandImages: [],
        brandColors: bi.brandGuidelines?.colorPalette ?? [],
      };
    }
    return {
      brandName: '',
      brandDescription: '',
      brandLogo: '',
      brandImages: [],
      brandColors: [],
    };
  };

  // Submit handler. Pushes any locally-uploaded files (brand logo, reference
  // image) to S3 first, then dispatches generateImageAction with the
  // `recreate_ads` body. The source ad's image goes into
  // `competitorReferenceImage`.
  const handleGenerate = async () => {
    if (isSubmitting) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || total === 0) return;

    setIsSubmitting(true);
    completeFiredRef.current = false;
    dispatch(resetCurrent());

    try {
      const uid = getUserId();
      // Logo precedence at submit time: uploaded file > typed URL > picked chip.
      // resolveAsset uploads File → S3, passes strings through.
      // For reference images (multi-upload), resolve each entry in
      // parallel — files become hosted URLs, pasted URLs pass through.
      // Only chips the user kept selected are sent; unselected ones stay
      // in the UI for quick re-toggling but are excluded from the payload.
      const selectedRefs = referenceImages.filter((it) => it.selected !== false);
      const [logoHosted, ...refsHosted] = await Promise.all([
        resolveAsset(brandLogoFile || brandLogoUrl.trim() || brandLogoPicked, uid),
        ...selectedRefs.map((it) => resolveAsset(it.file || it.preview, uid)),
      ]);

      // Reference images payload combines:
      //   1. Hosted user-supplied uploads/pastes (this run's chip list)
      //   2. Chip-picked URLs from brand voice (multi-select)
      //   3. Any in-progress typed URL still in the input field
      // Dedupe and drop falsy entries.
      const refSet = new Set();
      for (const u of refsHosted) if (u) refSet.add(u);
      for (const u of referenceImagesPicked) if (u) refSet.add(u);
      const typedUrl = referenceImageUrl.trim();
      if (typedUrl) refSet.add(typedUrl);
      const referenceImagesPayload = Array.from(refSet);

      const brandInfo = resolveBrandInfo();
      brandInfo.brandLogo = logoHosted || '';

      const body = buildImageInputs('recreate_ads', {
        brandName: brandInfo.brandName,
        brandDescription: brandInfo.brandDescription,
        brandLogo: brandInfo.brandLogo,
        brandImages: brandInfo.brandImages,
        brandColors: brandInfo.brandColors,
        userPrompt: trimmedPrompt,
        referenceImages: referenceImagesPayload,
        competitorReferenceImage: image || '',
        aspectCounts,
        model, // already the canonical apiId
        quality,
      });

      await dispatch(generateImageAction(body));
      // status transitions in `imageState` drive the genie handoff (see
      // the effect below). We don't close the dialog here — the effect
      // closes it after the animation runs.
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Generation failed';
      toast.error(msg);
      setIsSubmitting(false);
    }
  };

  // Hand off to MySpace > Images the moment the backend acknowledges the
  // submission (status === 'pending' OR 'completed'). Fires once per submit.
  useEffect(() => {
    if (!open || !isSubmitting) return;
    const handedOff =
      imageState.status === 'pending' || imageState.status === 'completed';
    if (handedOff && !completeFiredRef.current) {
      completeFiredRef.current = true;
      (async () => {
        // onCaptured fires right after the snapshot is grabbed and the
        // modal opacity is dropped — close the Dialog there so its dim
        // overlay doesn't stay over the page during animation/navigate.
        await triggerGenieToMySpace('image', {
          onCaptured: () => onOpenChange(false),
        });
        setIsSubmitting(false);
      })();
    } else if (imageState.status === 'failed') {
      toast.error(imageState.error || 'Generation failed');
      setIsSubmitting(false);
    }
  }, [open, isSubmitting, imageState.status, imageState.error, triggerGenieToMySpace, onOpenChange]);

  const brandPillLabel =
    brandSource.kind === 'list'
      ? brandSource.item.name
      : brandSource.kind === 'autofill'
        ? brandSource.data?.brandInfo?.brandName || 'From website'
        : 'Brand IQ';

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Genie-target anchor. Zero-size, fixed top-right — used as a
          fallback if the sidebar's My Space button isn't mounted. */}
      <span
        ref={mySpaceIconRef}
        aria-hidden
        className="pointer-events-none fixed right-4 top-[700px] h-0 w-0"
      />
      <DialogContent
        ref={modalRef}
        className="max-w-[960px] gap-0 rounded-[30px] border border-black/10 dark:border-white/10 bg-white dark:bg-[#303030]/30 p-0 text-gray-900 dark:text-white ring-1 ring-black/10 dark:ring-white/10 backdrop-blur-md sm:!max-w-[960px] sm:scale-100"
        showCloseButton
        // The X and Escape both close the modal. Clicking outside (or
        // dragging an upload over the page) does NOT — that protects
        // in-progress prompts. Escape behavior is layered: if the chip
        // lightbox is open, the keystroke is consumed by closing it (and
        // prevented from bubbling up to Radix so the modal stays mounted).
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (lightboxUrl) {
            e.preventDefault();
            setLightboxUrl('');
          }
        }}
      >
        <DialogTitle className="px-6 pt-5 pb-3 text-center text-sm font-medium text-gray-600 dark:text-white/80">
          Recreate this Ad with your own configurations
        </DialogTitle>

        {/* Modal height is capped to the image's natural height so the
            two columns visually match. Image side is aspect-square (the
            wrapper itself, not the img) so its height equals its width;
            the form side caps its scroll area to the same value. */}
        <div className="flex flex-col gap-6 p-6 pt-2 md:h-[min(85svh,520px)] md:flex-row">
          <div className="flex shrink-0 justify-center md:h-full md:basis-[42%]">
            {/* aspect-square on the wrapper itself + h-full keeps the
                source ad visually square AND the wrapper at the same
                height as the right-column scroll area. */}
            <div className="aspect-square h-full overflow-hidden rounded-2xl bg-gray-100 dark:bg-black/40">
              {image ? (
                <img src={image} alt="Source ad" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" />
              )}
            </div>
          </div>

          {/* Right column: Brand Voice + Brand logo scroll on top; Prompt
              AND Generate are pinned together at the bottom. Prompt is the
              primary input, so growing the upper sections (brand image
              chips, brand logo chips appearing after a brand is picked)
              must never push the textarea off-screen. min-h-0 on the
              scroll area lets it clip cleanly instead of stretching the
              modal. */}
          <div className="flex w-full min-w-0 flex-1 flex-col md:h-full">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]">
            <Section title="Attach your Brand Voice">
              <div className="flex items-center gap-2">
                <div ref={brandIqPickerWrapperRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={openBrandIqPicker}
                    className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-light ring-1 transition-colors ${
                      brandSource.kind === 'list'
                        ? 'bg-black/10 dark:bg-white/15 text-gray-900 dark:text-white ring-black/10 dark:ring-white/20'
                        : 'bg-gray-100 dark:bg-[#909294]/10 text-gray-600 dark:text-[#f0f0f0] ring-black/10 dark:ring-white/5 hover:bg-black/5 dark:hover:bg-[#33333a]'
                    }`}
                  >
                    <img src={brandIqIcon} alt="" className="h-4 w-4" />
                    {brandPillLabel}
                    <ChevronDown size={18} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                  </button>
                  {showBrandIqPicker && brandIqMenuPos && modalRef.current &&
                    createPortal(
                    <div
                      ref={brandIqMenuRef}
                      style={{
                        position: 'absolute',
                        top: brandIqMenuPos.top,
                        left: brandIqMenuPos.left,
                        zIndex: 1000,
                      }}
                      className="w-[280px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
                    >
                      <div className="max-h-[280px] overflow-y-auto">
                        {brandListState === 'loading' && (
                          <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-gray-600 dark:text-white/60">
                            <Loader2 size={12} className="animate-spin" />
                            Loading brands…
                          </div>
                        )}
                        {brandListState === 'error' && (
                          <div className="px-4 py-3 text-[12px] text-red-300">
                            {brandListError || 'Failed to load.'}
                          </div>
                        )}
                        {brandListState === 'loaded' && brandList.length === 0 && (
                          <div className="px-4 py-3 text-[12px] text-gray-500 dark:text-white/50">No brands found.</div>
                        )}
                        {brandListState === 'loaded' &&
                          brandList.map((b) => {
                            const selected =
                              brandSource.kind === 'list' && brandSource.item.id === b.id;
                            return (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => handleBrandIqSelect(b)}
                                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                  selected
                                    ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                                    : 'text-gray-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                                }`}
                              >
                                {b.logoUrls?.[0] ? (
                                  <img
                                    src={b.logoUrls[0]}
                                    alt=""
                                    className="h-7 w-7 shrink-0 rounded-full bg-black/10 dark:bg-white/10 object-cover"
                                  />
                                ) : (
                                  <span className="h-7 w-7 shrink-0 rounded-full bg-black/10 dark:bg-white/10" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium">
                                    {b.name}
                                  </span>
                                  <span className="block truncate text-[11px] text-gray-500 dark:text-white/50">
                                    {b.websiteUrl || b.description}
                                  </span>
                                </span>
                                {selected && (
                                  <Check size={14} className="shrink-0 text-emerald-400" />
                                )}
                              </button>
                            );
                          })}
                      </div>
                    </div>,
                    modalRef.current,
                  )}
                </div>
                <span className="shrink-0 text-[14px] text-gray-600 dark:text-white/60">or</span>
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    inputMode="url"
                    value={websiteUrl}
                    onChange={(e) => {
                      setWebsiteUrl(e.target.value);
                      if (autofillState !== 'idle') setAutofillState('idle');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAutofill();
                      }
                    }}
                    placeholder="Enter your website URL..."
                    className="h-[39px] w-full rounded-full bg-gray-100 dark:bg-[#909294]/10 px-4 pr-20 text-[13px] font-light text-gray-900 dark:text-white outline-none ring-1 ring-black/10 dark:ring-white/5 placeholder:text-gray-500 dark:placeholder:text-[#afafaf] focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20"
                  />
                  <button
                    type="button"
                    onClick={handleAutofill}
                    disabled={!websiteUrl.trim() || autofillState === 'loading'}
                    className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-gray-900 dark:bg-white/20 px-4 py-1.5 text-[12px] font-medium text-white dark:text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {autofillState === 'loading' && <Loader2 size={12} className="animate-spin" />}
                    Add
                  </button>
                </div>
              </div>
              {autofillState === 'ok' && brandSource.kind === 'autofill' && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-400/90">
                  <Check size={11} /> Brand added successfully
                </p>
              )}
              {autofillState === 'error' && (
                <p className="mt-1.5 text-[11px] text-red-300">{autofillError}</p>
              )}
            </Section>

            <Section title="Upload your own reference Images">
              <UploadRow
                placeholder="Paste your image URL or upload"
                url={referenceImageUrl}
                onUrlChange={(v) => {
                  // Auto-add when a full http(s) URL is pasted/typed and
                  // Enter happens via onKeyDown elsewhere. Here we just
                  // track the in-progress text.
                  setReferenceImageUrl(v);
                }}
                onUrlCommit={(u) => {
                  const trimmed = u.trim();
                  if (!trimmed) return;
                  if (remainingRefSlots() <= 0) {
                    setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
                    return;
                  }
                  setReferenceImages((prev) => [
                    ...prev,
                    { file: null, preview: trimmed, selected: true },
                  ]);
                  setReferenceImageUrl('');
                  setImagesError('');
                }}
                onFile={(f) => {
                  if (remainingRefSlots() <= 0) {
                    setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
                    return;
                  }
                  setReferenceImages((prev) => [
                    ...prev,
                    { file: f, preview: URL.createObjectURL(f), selected: true },
                  ]);
                  setImagesError('');
                }}
                onInvalidType={() => setImagesError(IMAGE_TYPE_ERROR)}
                inputRef={referenceInputRef}
                multipleFiles
              />
              {/* Multi-upload chips. Single click toggles whether the
                  image is included in the generation payload (cyan border
                  + check when selected). The small red × at the top-right
                  removes the chip entirely. Double click opens the
                  lightbox preview. */}
              {referenceImages.length > 0 && (
                <UploadedChipList
                  items={referenceImages}
                  onToggle={(idx) =>
                    setReferenceImages((prev) =>
                      prev.map((it, i) =>
                        i === idx ? { ...it, selected: it.selected === false } : it,
                      ),
                    )
                  }
                  onRemove={(idx) => {
                    setReferenceImages((prev) => prev.filter((_, i) => i !== idx));
                    setImagesError('');
                  }}
                  onPreview={(src) => setLightboxUrl(src)}
                />
              )}
              {/* Brand images from autofill / BrandIQ. Multi-select: single
                  click toggles inclusion, double-click opens the preview.
                  The URL input above stays untouched. */}
              {referenceImageOptions.length > 0 && (
                <OptionChips
                  label="Brand images — click to select, double-click to preview"
                  options={referenceImageOptions}
                  isSelected={(u) => referenceImagesPicked.includes(u)}
                  onPick={(u) => {
                    setReferenceImagesPicked((prev) => {
                      // Deselecting always succeeds and frees a slot.
                      if (prev.includes(u)) {
                        setImagesError('');
                        return prev.filter((x) => x !== u);
                      }
                      // Selecting: respect the combined 5-image cap.
                      if (remainingRefSlots() <= 0) {
                        setImagesError(`You can attach up to ${MAX_REFS_TOTAL} images.`);
                        return prev;
                      }
                      setImagesError('');
                      return [...prev, u];
                    });
                  }}
                  onDoubleClick={(u) => setLightboxUrl(u)}
                />
              )}
              {imagesError && (
                <p className="mt-2 text-[11px] text-red-300">{imagesError}</p>
              )}
            </Section>

            <Section title="Brand logo">
              <UploadRow
                placeholder="Paste your image URL or upload"
                url={brandLogoUrl}
                onUrlChange={(v) => {
                  setBrandLogoUrl(v);
                  if (logoError) setLogoError('');
                }}
                onFile={(f) => {
                  setBrandLogoFile(f);
                  setLogoError('');
                }}
                onInvalidType={() => setLogoError(IMAGE_TYPE_ERROR)}
                inputRef={logoInputRef}
              />
              {(brandLogoFile || brandLogoUrl.trim()) && (
                <UploadedChip
                  src={
                    brandLogoFile
                      ? URL.createObjectURL(brandLogoFile)
                      : brandLogoUrl.trim()
                  }
                  onClear={() => {
                    setBrandLogoFile(null);
                    setBrandLogoUrl('');
                  }}
                  onPreview={() =>
                    setLightboxUrl(
                      brandLogoFile
                        ? URL.createObjectURL(brandLogoFile)
                        : brandLogoUrl.trim(),
                    )
                  }
                  rounded
                />
              )}
              {/* Single-select. Click toggles, double-click previews. */}
              {brandLogoOptions.length > 0 && (
                <OptionChips
                  label="Brand logos — click to select, double-click to preview"
                  options={brandLogoOptions}
                  isSelected={(u) => u === brandLogoPicked}
                  rounded
                  onPick={(u) => setBrandLogoPicked((cur) => (cur === u ? '' : u))}
                  onDoubleClick={(u) => setLightboxUrl(u)}
                />
              )}
              {logoError && (
                <p className="mt-2 text-[11px] text-red-300">{logoError}</p>
              )}
            </Section>
            </div>

            {/* Pinned Prompt — lives outside the scroll area so the
                textarea + model/aspect pickers remain visible no matter
                how many brand images or logos populate the sections
                above. shrink-0 keeps it from being squeezed by the
                scroll container's flex-1. */}
            <div className="mt-5 shrink-0">
            <Section title="Prompt">
              <div className="rounded-[24px] bg-gray-100 dark:bg-[#909294]/10 p-3 ring-1 ring-black/10 dark:ring-white/10">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="Describe the changes you want in the image..."
                  className="w-full resize-none bg-transparent px-2 pt-1 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#afafaf] focus:outline-none"
                />

                <div className="flex items-center justify-end gap-1.5 px-1 pt-2">
                  <button
                    type="button"
                    onClick={handleImprovePrompt}
                    disabled={!prompt.trim() || isSuggestingPrompt}
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

                  {/* HIDE-MARK — Quality picker hidden. Unhide: flip SHOW_QUALITY_PICKER to true. */}
                  {SHOW_QUALITY_PICKER && (
                  <div ref={qualityPickerWrapperRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowQualityPicker((v) => !v);
                        setShowModelPicker(false);
                        setShowAspectPicker(false);
                        setShowBrandIqPicker(false);
                      }}
                      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-2.5 py-1.5 text-[11px] font-light text-gray-600 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
                    >
                      {qualityLabel(quality)}
                      <ChevronDown size={12} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                    </button>
                    {showQualityPicker && (
                      <div className="absolute right-0 bottom-full z-40 mb-2 min-w-[120px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
                        {(selectedModel?.qualities || []).map((q) => {
                          const selected = q === quality;
                          return (
                            <button
                              key={q}
                              type="button"
                              onClick={() => {
                                setQuality(q);
                                setShowQualityPicker(false);
                              }}
                              className={`flex w-full items-center px-3 py-2.5 text-left text-[13px] transition-colors ${
                                selected
                                  ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                                  : 'text-gray-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              <span className="flex-1">{qualityLabel(q)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )}
                  <div ref={modelPickerWrapperRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowModelPicker((v) => !v);
                        setShowQualityPicker(false);
                        setShowAspectPicker(false);
                        setShowBrandIqPicker(false);
                      }}
                      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-2.5 py-1.5 text-[11px] font-light text-gray-600 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
                    >
                      <ModelIcon apiId={selectedModel?.apiId} />
                      {selectedModel?.label || model}
                      <ChevronDown size={12} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                    </button>
                    {showModelPicker && (
                      <div className="absolute right-0 bottom-full z-40 mb-2 min-w-[180px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
                        {configModels.map((opt) => {
                          const selected = opt.apiId === model;
                          return (
                            <button
                              key={opt.apiId}
                              type="button"
                              onClick={() => {
                                setModel(opt.apiId);
                                setShowModelPicker(false);
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                                selected
                                  ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                                  : 'text-gray-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                <ModelIcon apiId={opt.apiId} />
                              </span>
                              <span className="flex-1">{opt.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div ref={aspectPickerWrapperRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAspectPicker((v) => !v);
                        setShowModelPicker(false);
                        setShowBrandIqPicker(false);
                      }}
                      className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-2.5 py-1.5 font-light text-gray-600 dark:text-[#afafaf] ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
                    >
                      <Proportions size={14} strokeWidth={1.8} className="text-gray-600 dark:text-white/70" />
                      <span className="h-3 w-px bg-black/15 dark:bg-white/20" />
                      <LayoutGrid size={11} strokeWidth={1.8} className="text-gray-400 dark:text-white/50" />
                      <span className="text-[11px]">
                        {total} Image{total !== 1 ? 's' : ''}
                      </span>
                      <ChevronDown size={12} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                    </button>

                    <AnimatedPanel
                      open={showAspectPicker}
                      className="absolute right-0 bottom-full z-40 mb-2 w-[300px] rounded-[20px] bg-white dark:bg-[#1f1f1f] p-4 shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
                    >
                      <AspectRatioTiles
                        counts={aspectCounts}
                        onChange={setAspectCounts}
                        ratios={selectedModel?.aspectRatios || []}
                        creditsPerImage={creditsPerImage}
                      />
                    </AnimatedPanel>
                  </div>
                </div>
              </div>
            </Section>
            </div>

            {/* Pinned footer — stays visible while the form above scrolls. */}
            <div className="mt-4 flex shrink-0 items-center justify-end gap-3">
              {/* Live credit estimate. Mirrors the pill from AiCreativesCustom
                  + AdSetupStep so the user sees the deduction before they
                  click Generate. Hidden when no images are queued. The
                  per-image cost comes from the shared ad_creative config
                  (useAdCreativeConfig) for the selected model + quality. */}
              {total > 0 && (
                <span className="rounded-full bg-gray-100 dark:bg-[#909294]/15 px-4 py-2 text-[13px] font-medium text-gray-500 dark:text-white/70 ring-1 ring-black/10 dark:ring-white/5">
                  –{total * creditsPerImage} credits
                </span>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim() || total === 0 || isSubmitting}
                className="flex items-center gap-2 rounded-full bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-white/90 px-6 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                {isSubmitting ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {/* Chip-preview overlay. Portaled to document.body and rendered
        OUTSIDE the Dialog so its stacking context isn't nested under
        Radix's Portal — z-[9999] reliably sits above the dialog content
        and the X / backdrop both close just the lightbox, leaving the
        recreate form open. */}
    {lightboxUrl && portalTarget &&
      createPortal(
        <div
          role="dialog"
          aria-label="Preview"
          onClick={() => setLightboxUrl('')}
          // Radix Dialog applies `pointer-events: none` to body when open
          // to block clicks outside its content. Without re-enabling them
          // here, our portal inherits that and every click falls through
          // to the form behind. Explicit pointer-events-auto fixes it.
          className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6"
        >
          <div
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close preview"
              className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/80 text-white shadow-lg ring-1 ring-white/20 hover:bg-black"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxUrl('');
              }}
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={lightboxUrl}
              alt="Preview"
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            />
          </div>
        </div>,
        portalTarget,
      )}
    </>
  );
};

const Section = ({ title, children }) => (
  <div className="flex flex-col gap-2">
    <p className="text-[14px] font-medium text-gray-900 dark:text-white">{title}</p>
    {children}
  </div>
);

// Picker chips rendered below an upload field. Each chip is a 40×40 image;
// single click → onPick(url) (caller decides single-vs-multi toggle),
// double-click → onDoubleClick(url) (open preview). The two are
// disambiguated with a 220ms delay so single-click handlers don't fire
// for the first half of a double-click.
const OptionChips = ({ label, options, isSelected, onPick, onDoubleClick, rounded }) => {
  const clickTimers = useRef({});
  return (
    <div className="mt-1">
      <p className="mb-1.5 text-[11px] text-gray-500 dark:text-white/50">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((url, i) => {
          const selected = isSelected?.(url);
          const shape = rounded ? 'rounded-full' : 'rounded-md';
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
            <button
              type="button"
              key={`${url}-${i}`}
              onClick={handleSingle}
              onDoubleClick={handleDouble}
              title={selected ? 'Click to remove · double-click to preview' : 'Click to select · double-click to preview'}
              className={`relative h-10 w-10 shrink-0 ${shape} transition ${
                selected
                  ? 'border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40'
                  : 'border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30'
              }`}
            >
              <img
                src={url}
                alt=""
                className={`h-full w-full ${shape} object-cover`}
              />
              {selected && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#02C8C4] text-white shadow">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Single-line input + Upload button. Mirrors AiCreativesCustom: the text
// field is strictly for user-typed URLs — uploaded file names DO NOT
// bleed into it. The wrapper handles clipboard paste (image file OR URL
// text) so users can Ctrl+V directly. The caller renders any chosen
// file / pasted URL as a chip below this row.
//
// Props:
//   - onFile: called per File (multiple times if multipleFiles enabled
//     and several were selected/dropped).
//   - onUrlCommit: optional — called when the user hits Enter on the URL
//     input or pastes a URL while onUrlCommit is wired. Caller decides
//     whether to commit the URL to a chip list or keep it as a single value.
//   - multipleFiles: switches the hidden file input to allow multi-select.
const UploadRow = ({
  placeholder,
  url,
  onUrlChange,
  onUrlCommit,
  onFile,
  onInvalidType,
  inputRef,
  multipleFiles = false,
}) => {
  const commitUrl = (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onUrlCommit) onUrlCommit(trimmed);
    else onUrlChange(trimmed);
  };
  // Strict-type forwarder: passes through allowed files to onFile and tracks
  // whether anything was rejected so the caller can surface a type warning.
  const forwardFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    let rejected = 0;
    for (const f of arr) {
      if (isAllowedImageFile(f)) onFile?.(f);
      else rejected += 1;
    }
    if (rejected > 0) onInvalidType?.();
  };
  return (
    <div
      onPaste={(e) => {
        // Clipboard file(s) → strict-type forward. Clipboard text URL →
        // commit as a new chip when onUrlCommit is wired, otherwise drop
        // into the URL input.
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
          e.preventDefault();
          forwardFiles(files);
          onUrlChange('');
          return;
        }
        const text = e.clipboardData?.getData('text');
        if (text && /^https?:\/\//i.test(text.trim())) {
          e.preventDefault();
          if (onUrlCommit) onUrlCommit(text.trim());
          else onUrlChange(text.trim());
        }
      }}
      // preventDefault on dragover is required to allow drop. Without
      // both handlers the browser falls back to its default and drops
      // the URL into the focused input.
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
          forwardFiles(files);
          onUrlChange('');
          return;
        }
        const url =
          dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
        const trimmed = url.trim();
        if (trimmed && /^https?:\/\//i.test(trimmed)) {
          if (onUrlCommit) onUrlCommit(trimmed);
          else onUrlChange(trimmed);
        }
      }}
      className="flex items-center gap-2"
    >
      <div className="flex h-[39px] flex-1 items-center gap-2 rounded-full bg-gray-100 dark:bg-[#909294]/10 px-4 text-[13px] ring-1 ring-black/10 dark:ring-white/5">
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitUrl(url);
            }
          }}
          // The input itself must cancel the drop default — without these
          // the browser drops the URL straight into the field even when
          // the wrapper above has handlers, because the input is the
          // direct drop target.
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
              forwardFiles(files);
              onUrlChange('');
              return;
            }
            const dragged =
              dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
            const trimmed = dragged.trim();
            if (trimmed && /^https?:\/\//i.test(trimmed)) {
              if (onUrlCommit) onUrlCommit(trimmed);
              else onUrlChange(trimmed);
            }
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-[13px] font-light text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#afafaf] focus:outline-none"
        />
        <Link2 className="h-4 w-4 text-gray-400 dark:text-white/50" />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_ACCEPT}
        multiple={multipleFiles}
        className="hidden"
        onChange={(e) => {
          forwardFiles(e.target.files);
          // Reset so the same file can be picked again.
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex h-[39px] items-center gap-1.5 rounded-full bg-gray-100 dark:bg-[#909294]/10 px-4 text-[12px] font-light text-gray-900 dark:text-white ring-1 ring-black/10 dark:ring-white/5 hover:bg-black/5 dark:hover:bg-[#33333a]"
      >
        <Upload className="h-3.5 w-3.5" />
        Upload Image
      </button>
    </div>
  );
};

// Row of user-supplied chips (multi-upload). Single click on a chip
// toggles whether it's included in the payload; the small red × at the
// top-right corner removes the chip entirely. Double click opens the
// lightbox preview. 220 ms delay disambiguates single from double click.
const UploadedChipList = ({ items, onToggle, onRemove, onPreview }) => {
  const clickTimers = useRef({});
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((it, i) => {
        const key = `${it.preview}-${i}`;
        const isSelected = it.selected !== false;
        const cancelPendingClick = () => {
          clearTimeout(clickTimers.current[key]);
          delete clickTimers.current[key];
        };
        const handleSingle = () => {
          clearTimeout(clickTimers.current[key]);
          clickTimers.current[key] = setTimeout(() => {
            onToggle?.(i);
            delete clickTimers.current[key];
          }, 220);
        };
        const handleDouble = () => {
          cancelPendingClick();
          onPreview?.(it.preview);
        };
        return (
          <div key={key} className="relative h-10 w-10 shrink-0">
            <button
              type="button"
              onClick={handleSingle}
              onDoubleClick={handleDouble}
              title={
                isSelected
                  ? 'Click to deselect · double-click to preview'
                  : 'Click to select · double-click to preview'
              }
              className={`relative h-full w-full cursor-pointer overflow-hidden rounded-md transition ${
                isSelected
                  ? 'border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40'
                  : 'border border-white/15 opacity-60 hover:border-white/30 hover:opacity-80'
              }`}
            >
              <img src={it.preview} alt="" className="h-full w-full rounded-md object-cover" />
            </button>
            {/* Top-right corner badge — flips by selection state:
                  selected   → cyan check (decorative, non-interactive)
                  unselected → red × (clickable to remove the chip)
                A selected chip is therefore removed in two steps:
                single-click to deselect, then click the × that appears. */}
            {isSelected ? (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-[#02C8C4] text-white shadow"
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelPendingClick();
                  onRemove?.(i);
                }}
                aria-label="Remove image"
                title="Remove"
                className="absolute -top-1.5 -right-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow transition-colors hover:bg-red-600"
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

// A single user-supplied chip (uploaded file or pasted URL). Single click
// toggles selection (clears the source); double-click opens the preview.
// 220ms delay disambiguates single from the first half of a double-click.
const UploadedChip = ({ src, onClear, onPreview, rounded }) => {
  const shape = rounded ? 'rounded-full' : 'rounded-md';
  const clickTimerRef = useRef(null);
  const handleSingle = () => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onClear?.();
      clickTimerRef.current = null;
    }, 220);
  };
  const handleDouble = () => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    onPreview?.();
  };
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={handleSingle}
        onDoubleClick={handleDouble}
        title="Click to remove · double-click to preview"
        className={`relative h-10 w-10 shrink-0 cursor-pointer ${shape} border-2 border-[#02C8C4] ring-1 ring-[#02C8C4]/40 transition`}
      >
        <img src={src} alt="" className={`h-full w-full ${shape} object-cover`} />
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#02C8C4] text-white shadow">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
    </div>
  );
};

export default RecreateAdModal;
