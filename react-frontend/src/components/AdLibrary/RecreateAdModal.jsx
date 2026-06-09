import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';
import { Check, ChevronDown, LayoutGrid, Link2, Loader2, Upload, X } from 'lucide-react';
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
import { useImageCreditsForModel } from '@/utils/hooks/useImageCreditsForModel';

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

const MODEL_OPTIONS = [
  { name: 'Nano Banana 2', available: true, iconSrc: geminiIcon },
  { name: 'Nano Banana Pro', available: true, iconSrc: geminiIcon },
  { name: 'OpenAI 1.5', available: true, icon: <SiOpenai size={14} className="text-gray-700 dark:text-white/80" /> },
  { name: 'OpenAI 2.0', available: true, icon: <SiOpenai size={14} className="text-gray-700 dark:text-white/80" /> },
  { name: 'Seedream 5.0 lite', available: true, iconSrc: seedanceIcon },
];

const MODEL_TO_API = {
  'Nano Banana 2': 'gemini-3.1-flash-image-preview',
  'Nano Banana Pro': 'gemini-3-pro-image-preview',
  'OpenAI 1.5': 'gpt-image-1.5',
  'OpenAI 2.0': 'gpt-image-2',
  'Seedream 5.0 lite': 'seedream-5.0-lite',
};

const ASPECT_LABELS = [
  { key: '1:1', label: '1:1 (square)' },
  { key: '2:3', label: '2:3 (portrait)' },
  { key: '3:2', label: '3:2 (landscape)' },
  { key: '9:16', label: '9:16 (vertical widescreen)' },
  { key: '16:9', label: '16:9 (widescreen)' },
];

const OPENAI_ALLOWED_RATIOS = new Set(['1:1', '2:3', '3:2']);
const isOpenAIModel = (name) => /^openai/i.test(String(name || ''));
const allowedAspectLabels = (modelName) =>
  isOpenAIModel(modelName)
    ? ASPECT_LABELS.filter((a) => OPENAI_ALLOWED_RATIOS.has(a.key))
    : ASPECT_LABELS;

const DEFAULT_COUNTS = { '1:1': 1, '2:3': 0, '3:2': 0, '9:16': 0, '16:9': 0 };

// Combined 5-image cap across uploads + chip picks. Matches AiCreativesCustom.
// The source ad on the left is the implicit competitor reference and lives
// outside this count — only user-added images contribute.
const MAX_REFS_TOTAL = 5;

const totalImages = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const primaryRatio = (counts) => {
  for (const { key } of ASPECT_LABELS) if (counts[key] > 0) return key;
  return '1:1';
};

function ModelIcon({ option }) {
  if (option?.iconSrc) {
    return <img src={option.iconSrc} alt="" className="h-3.5 w-3.5 object-contain" />;
  }
  return option?.icon ?? null;
}

const RecreateAdModal = ({ open, onOpenChange, image, ad }) => {
  const dispatch = useDispatch();
  const imageState = useSelector((s) => s.image.current);
  const recreateInputs = useSelector((s) => s.image.recreateInputs);
  const userData = useSelector((s) => s.socket?.userData);

  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('Nano Banana 2');
  const [aspectCounts, setAspectCounts] = useState(DEFAULT_COUNTS);
  // Live per-model credit cost from /adsgpt/usage/model-credit-value
  // (shared cache). Falls back to 7 while loading or on API error.
  const creditsPerImage = useImageCreditsForModel(model);

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
  const [showAspectPicker, setShowAspectPicker] = useState(false);
  const [showBrandIqPicker, setShowBrandIqPicker] = useState(false);
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modelPickerWrapperRef = useRef(null);
  const aspectPickerWrapperRef = useRef(null);
  const brandIqPickerWrapperRef = useRef(null);
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

  useEffect(() => {
    if (!isOpenAIModel(model)) return;
    setAspectCounts((prev) => {
      const next = { ...prev, '9:16': 0, '16:9': 0 };
      if (totalImages(next) === 0) next['1:1'] = 1;
      return next;
    });
  }, [model]);

  useEffect(() => {
    if (!showModelPicker && !showAspectPicker && !showBrandIqPicker) return undefined;
    const onDocClick = (e) => {
      const t = e.target;
      const inModel = modelPickerWrapperRef.current?.contains(t);
      const inAspect = aspectPickerWrapperRef.current?.contains(t);
      const inBrandIq = brandIqPickerWrapperRef.current?.contains(t);
      if (!inModel && !inAspect && !inBrandIq) {
        setShowModelPicker(false);
        setShowAspectPicker(false);
        setShowBrandIqPicker(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showModelPicker, showAspectPicker, showBrandIqPicker]);

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

    // Reverse-map the stored API model id back to the UI label.
    if (inp.model) {
      const reverseModel = Object.fromEntries(
        Object.entries(MODEL_TO_API).map(([k, v]) => [v, k]),
      );
      if (reverseModel[inp.model]) setModel(reverseModel[inp.model]);
    }

    // Aspect ratio — honour the structured array first, otherwise fall
    // back to the flat aspectRatio + numberOfImages pair.
    if (Array.isArray(inp.aspectRatioPerImage) && inp.aspectRatioPerImage.length > 0) {
      const counts = { ...DEFAULT_COUNTS };
      for (const { aspectRatio, numberOfImages } of inp.aspectRatioPerImage) {
        if (aspectRatio in counts) counts[aspectRatio] = Number(numberOfImages) || 0;
      }
      setAspectCounts(counts);
    } else if (inp.aspectRatio) {
      const counts = { ...DEFAULT_COUNTS, [inp.aspectRatio]: 0 };
      if (inp.aspectRatio in counts) {
        counts[inp.aspectRatio] = Number(inp.numberOfImages) || 1;
      }
      setAspectCounts(counts);
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

  const adjustCount = (key, delta) => {
    setAspectCounts((prev) => ({ ...prev, [key]: Math.max(0, prev[key] + delta) }));
  };

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
        model: MODEL_TO_API[model] || model,
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
                  {showBrandIqPicker && (
                    <div className="absolute top-full left-0 z-40 mt-2 w-[280px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
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
                    </div>
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

                <div className="flex items-center justify-end gap-2 px-1 pt-2">
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

                  <div ref={modelPickerWrapperRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setShowModelPicker((v) => !v);
                        setShowAspectPicker(false);
                        setShowBrandIqPicker(false);
                      }}
                      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-3 py-1.5 text-[12px] font-light text-gray-600 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
                    >
                      <ModelIcon option={MODEL_OPTIONS.find((m) => m.name === model)} />
                      {model}
                      <ChevronDown size={14} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                    </button>
                    {showModelPicker && (
                      <div className="absolute right-0 bottom-full z-40 mb-2 min-w-[180px] overflow-hidden rounded-[18px] bg-white dark:bg-[#1f1f1f] shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
                        {MODEL_OPTIONS.map((opt) => {
                          const selected = opt.name === model;
                          return (
                            <button
                              key={opt.name}
                              type="button"
                              disabled={!opt.available}
                              onClick={() => {
                                if (!opt.available) return;
                                setModel(opt.name);
                                setShowModelPicker(false);
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors ${
                                !opt.available
                                  ? 'cursor-not-allowed text-gray-400 dark:text-white/40'
                                  : selected
                                    ? 'bg-gray-100 text-gray-900 dark:bg-[#373839] dark:text-white'
                                    : 'text-gray-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                              }`}
                            >
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                <ModelIcon option={opt} />
                              </span>
                              <span className="flex-1">{opt.name}</span>
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
                      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100 dark:bg-[#2b2a2a]/80 px-3 py-1.5 font-light text-gray-600 dark:text-[#afafaf] ring-1 ring-black/10 dark:ring-white/5 transition-colors hover:bg-black/5 dark:hover:bg-[#33333a]"
                    >
                      <span className="text-[12px] text-gray-900 dark:text-white/90">{primaryRatio(aspectCounts)}</span>
                      <span className="h-3 w-px bg-black/15 dark:bg-white/20" />
                      <LayoutGrid size={11} strokeWidth={1.8} className="text-gray-400 dark:text-white/50" />
                      <span className="text-[12px]">
                        {total} Image{total !== 1 ? 's' : ''}
                      </span>
                      <ChevronDown size={14} strokeWidth={2} className="text-gray-400 dark:text-white/40" />
                    </button>

                    {showAspectPicker && (
                      <div className="absolute right-0 bottom-full z-40 mb-2 w-[280px] rounded-[20px] bg-white dark:bg-[#1f1f1f] p-5 shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
                        <p className="mb-2 text-center text-[13px] font-medium text-gray-900 dark:text-[#d9d9d9]">
                          Aspect Ratio per Image
                        </p>
                        <div className="flex items-center justify-center gap-1.5 text-sm">
                          <span className="text-gray-600 dark:text-white/70">Total Number of Images :</span>
                          <span className="font-medium text-gray-900 dark:text-white">{total}</span>
                        </div>
                        <p className="mt-1 mb-6 text-center text-[11px] text-gray-500 dark:text-white/50">
                          {creditsPerImage} credits per image
                        </p>
                        <div className="space-y-1">
                          {allowedAspectLabels(model).map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between pl-4">
                              <span className="text-[12px] text-gray-900 dark:text-white">{label}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => adjustCount(key, -1)}
                                  className="flex h-5 w-5 items-center justify-center text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                                >
                                  <span className="text-[18px] leading-none select-none">−</span>
                                </button>
                                <span className="w-8 rounded-full bg-gray-100 dark:bg-[#9092941A] py-0.5 text-center text-[11px] font-medium text-gray-900 dark:text-white">
                                  {aspectCounts[key]}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    adjustCount(key, Math.min(4 - aspectCounts[key], 1))
                                  }
                                  className="flex h-5 w-5 items-center justify-center text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
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
                </div>
              </div>
            </Section>
            </div>

            {/* Pinned footer — stays visible while the form above scrolls. */}
            <div className="mt-4 flex shrink-0 items-center justify-end gap-3">
              {/* Live credit estimate. Mirrors the pill from AiCreativesCustom
                  + AdSetupStep so the user sees the deduction before they
                  click Generate. Hidden when no images are queued. The
                  per-image cost is pulled from the shared
                  useImageCreditsForModel hook so it tracks the model's
                  live value (no hardcoded number). */}
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
