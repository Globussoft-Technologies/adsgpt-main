import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Upload,
  CloudUpload,
  Image as ImageIcon,
  LayoutGrid,
  Palette,
  Mic2,
  Plus,
  Sparkles,
  Timer,
  Loader2,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';

import { useDispatch, useSelector } from 'react-redux';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { RiGeminiFill } from 'react-icons/ri';
import { generateAiAdsSceneAction, copyAiAdsSessionAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setAiAdsSceneLoading } from '@/store/reducers/adStudio/adVideoNewSlice';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { useVideoSurfaceModelsState } from '@/utils/hooks/useVideoSurfaceModels';
import { getModelAspectRatios } from '@/utils/videoModelCapabilities';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import VoiceSelector from '@/components/VoiceSelector/VoiceSelector';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { analyzeLogoTransparency, LOGO_BACKGROUND_ERROR } from '@/utils/logoTransparency';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const IMAGE_TYPE_ERROR = 'Only .jpg, .jpeg, .png, and .webp image are allowed.';
// The logo field takes any image format the browser can decode — SVG and AVIF
// logos are usually the cut-out ones, so restricting the list here rejected
// exactly the files the transparency check is meant to accept.
const LOGO_TYPE_ERROR = 'Only image files are allowed for the logo.';
const LOGO_ACCEPT = 'image/*';

const isImageFile = (file) =>
  ALLOWED_IMAGE_TYPES.includes(file.type) ||
  ALLOWED_IMAGE_EXTENSIONS.test(file.name || '');

const isAnyImageFile = (file) =>
  (file?.type || '').startsWith('image/') || /\.[a-z0-9]+$/i.test(file?.name || '');

// Reusable Input Component
const CustomInput = ({ label, value, onChange, placeholder, required = false, error, disabled }) => (
  <div className="flex w-full min-w-0 flex-col">
    {label && (
      <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:mb-2 sm:text-sm">
        {label}
        {required && '*'}
      </label>
    )}
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full min-w-0 rounded-full border bg-gray-100 dark:bg-[#909294]/15 px-3 py-2.5 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF] focus:outline-none sm:px-4 sm:py-3 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-red-500 focus:border-red-500' : 'border-black/10 dark:border-white/5 focus:border-white/20'}`}
    />
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
  </div>
);

// File Upload
const FileUpload = ({ label, required = false, fileName, onClear, onChange, id, error, disabled, accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' }) => (
  <div className="flex w-full min-w-0 flex-col">
    {label && (
      <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:text-sm">
        {label}
        {required && '*'}
      </label>
    )}
    <div className={`flex w-full min-w-0 items-center gap-1 rounded-full bg-gray-100 dark:bg-[#909294]/15 px-1 py-1 sm:gap-2 sm:py-1.5 ${error ? 'ring-1 ring-red-500' : ''} ${disabled ? 'opacity-50' : ''}`}>
      <label
        htmlFor={disabled ? undefined : id}
        className={`flex shrink-0 items-center gap-1 rounded-full bg-zinc-200 px-3 py-1.5 text-[10px] font-normal text-zinc-800 transition sm:px-4 sm:py-2 sm:text-[11px] dark:bg-[#606060] dark:text-white ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-zinc-300 dark:hover:opacity-80'}`}
      >
        <CloudUpload className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        Choose File
        <input
          id={id}
          type="file"
          className="hidden"
          accept={accept}
          onChange={onChange}
          multiple={label === 'Images'}
          disabled={disabled}
        />
      </label>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-1 px-1 text-[11px] text-gray-500 dark:text-[#AFAFAF] sm:px-2 sm:text-xs">
        <span className="min-w-0 flex-1 truncate">{fileName || 'No file chosen'}</span>
        {fileName && (
          <button onClick={onClear} disabled={disabled} className="shrink-0 text-gray-500 dark:text-white/40 hover:text-black dark:hover:text-white disabled:cursor-not-allowed">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
    {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
  </div>
);

const categoryOptions = [
  { value: 'skincare', label: 'Skincare' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'fashion', label: 'Fashion' },
  { value: 'food-beverage', label: 'Food & Beverage' },
  { value: 'technology', label: 'Technology' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'education', label: 'Education' },
  { value: 'real-estate', label: 'Real Estate' },
  { value: 'travel', label: 'Travel' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'other', label: 'Other' },
];

const productTypeOptions = [
  { value: 'physical_small', label: 'Physical - Small' },
  { value: 'physical_large', label: 'Physical - Large' },
  { value: 'wearable', label: 'Wearable' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'digital_app', label: 'Digital App' },
  { value: 'saas', label: 'SaaS' },
  { value: 'service_based', label: 'Service-Based' },
];

const durationOptions = [
  { value: '8', label: '8s' },
  { value: '10', label: '10s' },
  { value: '20', label: '20s' },
  { value: '30', label: '30s' },
  { value: '40', label: '40s' },
];

// const aspectRatioOptions = [
//   { value: '9:16', label: '9:16' },
//   { value: '16:9', label: '16:9' },
// ];

// If the saved duration isn't in the active list (e.g. '4'/'6' were removed),
// pick the closest available value so the field is never blank on recreate.
const normalizeDuration = (value, options) => {
  if (!value) return '';
  const exact = options.find((o) => o.value === String(value));
  if (exact) return exact.value;
  const num = parseInt(value, 10);
  if (isNaN(num)) return '';
  const closest = options.reduce((prev, curr) =>
    Math.abs(parseInt(curr.value, 10) - num) < Math.abs(parseInt(prev.value, 10) - num) ? curr : prev
  );
  return closest.value;
};

const matchOption = (options, apiValue) => {
  if (!apiValue) return '';
  const normalized = apiValue.toLowerCase().trim();

  const exact = options.find(
    (opt) => opt.value === apiValue || opt.value.toLowerCase() === normalized || opt.label.toLowerCase() === normalized
  );
  if (exact) return exact.value;

  const partial = options.find(
    (opt) => normalized.includes(opt.value.toLowerCase()) || normalized.includes(opt.label.toLowerCase())
  );
  return partial ? partial.value : '';
};

const DetailsFormStep = ({ type, data, originalInputs, existingSceneData, onBack, onNext, onClose }) => {
  const isBrand = type === 'brand';
  const title = isBrand ? 'Brand Details' : 'Product Details';
  const dispatch = useDispatch();
  const { modelCredits } = useSelector((state) => state.prompt);
  const { models: surfaceModels, isLoading: isAspectRatioLoading } = useVideoSurfaceModelsState('ai_ads');
  const availableCanonicalKeys = useMemo(
    () => new Set(surfaceModels.map((entry) => entry.canonical || entry.model)),
    [surfaceModels]
  );
  const { credits } = useSelector((state) => state.socket);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  const validate = () => {
    const e = {};
    if (!formData.optimizedPrompt.trim()) e.optimizedPrompt = 'Prompt is required';
    if (!formData.name.trim()) e.name = `${isBrand ? 'Brand' : 'Product'} Name is required`;
    if (!formData.description.trim()) e.description = `${isBrand ? 'Brand' : 'Product'} Description is required`;
    if (urlImages.length + uploadedImages.length === 0) e.images = 'At least one image is required';
    if (!formData.model) e.model = 'Model is required';
    if (!formData.duration) e.duration = 'Duration is required';
    // Deliverable differs by provider: Sarvam picks resolve to voiceName
    // (voiceId is always '' for Sarvam), ElevenLabs to voiceId.
    const vv = formData.voice || {};
    const hasVoice = vv.provider === 'sarvam' ? !!vv.voiceName : !!vv.voiceId;
    if (!hasVoice) e.voice = 'Voice is required';
    return e;
  };

  const [formData, setFormData] = useState(() => ({
    name: data?.name || '',
    category: matchOption(categoryOptions, data?.category),
    description: data?.description || '',
    adStyle: data?.adStyle || '',
    tone: data?.tone || '',
    cta: data?.cta || data?.ctaType || '',
    tagline: data?.tagline || '',
    productType: matchOption(productTypeOptions, data?.productType),
    optimizedPrompt: data?.optimizedPrompt || data?.userPrompt || '',
    model: data?.model || '',
    duration: data?.duration || '',
    aspectRatio: data?.aspectRatio || '9:16',
    captionsEnabled: data?.captionsEnabled ?? false,
    voice: {
      // Voice data may arrive in two shapes:
      //   (a) Runtime/formData shape (on Back navigation): data.voice.{...}
      //   (b) Saved/DB shape (on first entry or recreate): data.voiceFilters,
      //       data.voiceId, data.voiceName (flat)
      // Check (a) first so a user's selection survives Back→forward.
      // Language is non-clearable and defaults to English, but the code differs
      // by provider: ElevenLabs uses ISO "en", Sarvam uses BCP-47 "en-IN".
      provider: data?.voice?.provider || data?.voiceProvider || 'sarvam',
      language:
        data?.voice?.language ||
        data?.voiceFilters?.language ||
        ((data?.voice?.provider || data?.voiceProvider || 'sarvam') === 'sarvam' ? 'en-IN' : 'en'),
      languageLabel: data?.voice?.languageLabel || data?.voiceFilters?.languageLabel || 'English',
      gender: data?.voice?.gender || data?.voiceFilters?.gender || '',
      accent: data?.voice?.accent || data?.voiceFilters?.accent || '',
      age: data?.voice?.age || data?.voiceFilters?.age || '',
      voiceId: data?.voice?.voiceId || data?.voiceId || '',
      voiceName: data?.voice?.voiceName || data?.voiceName || '',
    },
  }));
  const aspectRatioOptions = useMemo(
    () => getModelAspectRatios(surfaceModels, 'ai_ads', formData.model),
    [surfaceModels, formData.model]
  );

  // URL-based images from analysis (not File objects)
  // brandImages takes priority — these are already on S3 from BrandIQ, no re-upload needed
  const [urlImages, setUrlImages] = useState(() => {
    if (Array.isArray(data?.brandImages) && data.brandImages.length > 0)
      return data.brandImages.slice(0, 5);
    return data?.images?.slice(0, 5).map((src) => ({ url: src, preview: src, name: src.split('/').pop() })) || [];
  });
  const [urlLogo, setUrlLogo] = useState(() => {
    if (data?.brandLogoUrl) return data.brandLogoUrl;
    const src = data?.logoUrl || data?.brandLogo || '';
    return src ? { url: src, preview: src, name: 'brand-logo' } : null;
  });

  const [uploadedImages, setUploadedImages] = useState(() => {
    const incoming = data?.uploadedImages;
    if (Array.isArray(incoming) && incoming.length) {
      return incoming.slice(0, 5);
    }
    return [];
  });
  const [uploadedLogo, setUploadedLogo] = useState(null);
  const [checkingLogo, setCheckingLogo] = useState(false);

  const [lightbox, setLightbox] = useState({ open: false, images: [], index: 0 });
  const openLightbox = (images, index) => setLightbox({ open: true, images, index });
  const closeLightbox = () => setLightbox((prev) => ({ ...prev, open: false }));

  const prefillInputs = useSelector((state) => state.adVideoNew.aiAdsPrefillInputs);

  useEffect(() => {
    if (!prefillInputs) return;
    const inputs = prefillInputs;
    setFormData({
      name: inputs.name || inputs.brandName || inputs.productName || '',
      category: matchOption(categoryOptions, inputs.category),
      description: inputs.description || inputs.productDescription || '',
      adStyle: inputs.adStyle || '',
      tone: inputs.tone || '',
      cta: inputs.cta || inputs.ctaType || '',
      tagline: inputs.tagline || '',
      productType: matchOption(productTypeOptions, inputs.productType),
      optimizedPrompt: inputs.optimizedPrompt || inputs.userPrompt || '',
      model: inputs.model || '',
      duration: normalizeDuration(inputs.duration, durationOptions),
      aspectRatio: inputs.aspectRatio || '9:16',
      captionsEnabled: inputs.captionsEnabled ?? false,
      voice: {
        // Same dual-shape handling as the useState initializer above.
        // Runtime shape (inputs.voice) wins over saved shape (inputs.voiceFilters).
        provider: inputs.voice?.provider || inputs.voiceProvider || 'sarvam',
        language:
          inputs.voice?.language ||
          inputs.voiceFilters?.language ||
          ((inputs.voice?.provider || inputs.voiceProvider || 'sarvam') === 'sarvam' ? 'en-IN' : 'en'),
        languageLabel: inputs.voice?.languageLabel || inputs.voiceFilters?.languageLabel || 'English',
        gender: inputs.voice?.gender || inputs.voiceFilters?.gender || '',
        accent: inputs.voice?.accent || inputs.voiceFilters?.accent || '',
        age: inputs.voice?.age || inputs.voiceFilters?.age || '',
        voiceId: inputs.voice?.voiceId || inputs.voiceId || '',
        voiceName: inputs.voice?.voiceName || inputs.voiceName || '',
      },
    });
    if (inputs._savedImages?.length) {
      setUrlImages(inputs._savedImages);
    } else {
      const imgs = inputs.images || [];
      setUrlImages(imgs.slice(0, 5).map((src) => {
        if (typeof src === 'object') return src;
        return { url: src, preview: src, name: src.split('/').pop() };
      }));
    }
    if (inputs._savedUploadedImages?.length) {
      setUploadedImages(inputs._savedUploadedImages);
    } else {
      setUploadedImages([]);
    }
    if (inputs._savedLogo) {
      setUrlLogo(inputs._savedLogo);
    } else {
      const logoSrc = inputs.logoUrl || inputs.brandLogo || '';
      setUrlLogo(logoSrc ? { url: logoSrc, preview: logoSrc, name: 'brand-logo' } : null);
    }
    if (inputs._savedUploadedLogo) {
      setUploadedLogo(inputs._savedUploadedLogo);
      setUrlLogo(null);
    } else {
      setUploadedLogo(null);
    }
    setErrors({});
  }, [prefillInputs, dispatch]);

  const updateField = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  const hasFormChanged = () => {
    if (!originalInputs || !existingSceneData) return true;
    // The "no changes → copy session" shortcut only makes sense when the
    // existing session actually succeeded (has scenes to clone). After a failed
    // generation the session has status "failed" / no scenes — copying it would
    // clone an empty doc and land on a blank Implementation Plan. In that case
    // force the fresh generate-scene path by reporting the form as changed.
    const existing = existingSceneData?.data || existingSceneData;
    const existingScenes = existing?.scenes || [];
    if (existing?.status === 'failed' || existingScenes.length === 0) return true;
    const orig = originalInputs;

    // URL images
    const currentImageUrls = urlImages.map((i) => i.url);
    const origUrlImages = orig._savedImages ? orig._savedImages.map((i) => i.url) : (orig.images || []);
    const urlImagesChanged =
      currentImageUrls.length !== origUrlImages.length ||
      currentImageUrls.some((url, i) => url !== origUrlImages[i]);

    // Uploaded (File) images — compare by name; new files not in original = changed
    const origUploadedNames = (orig._savedUploadedImages || []).map((i) => i.name);
    const currentUploadedNames = uploadedImages.map((i) => i.name);
    const uploadedImagesChanged =
      currentUploadedNames.length !== origUploadedNames.length ||
      currentUploadedNames.some((name, i) => name !== origUploadedNames[i]);

    const imagesChanged = urlImagesChanged || uploadedImagesChanged;

    // Logo
    const origUploadedLogoName = orig._savedUploadedLogo?.name || '';
    const currentUploadedLogoName = uploadedLogo?.name || '';
    const uploadedLogoChanged = currentUploadedLogoName !== origUploadedLogoName;

    const currentLogoUrl = urlLogo?.url || '';
    const origLogoUrl = orig._savedLogo?.url || orig.logoUrl || orig.brandLogo || '';
    const urlLogoChanged = currentLogoUrl !== origLogoUrl;

    const logoChanged = uploadedLogoChanged || urlLogoChanged;

    return (
      formData.name !== (orig.name || orig.brandName || orig.productName || '') ||
      formData.description !== (orig.description || orig.productDescription || '') ||
      formData.category !== (orig.category || '') ||
      formData.adStyle !== (orig.adStyle || '') ||
      formData.tone !== (orig.tone || '') ||
      formData.cta !== (orig.cta || orig.ctaType || '') ||
      formData.tagline !== (orig.tagline || '') ||
      formData.productType !== (orig.productType || '') ||
      formData.optimizedPrompt !== (orig.optimizedPrompt || orig.userPrompt || '') ||
      formData.model !== (orig.model || '') ||
      formData.duration !== normalizeDuration(orig.duration, durationOptions) ||
      formData.aspectRatio !== (orig.aspectRatio || '') ||
      formData.captionsEnabled !== (orig.captionsEnabled ?? false) ||
      formData.voice?.voiceId !== (orig.voice?.voiceId || orig.voiceId || '') ||
      imagesChanged ||
      logoChanged
    );
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;

    const imageFiles = files.filter(isImageFile);
    const hadInvalid = imageFiles.length < files.length;
    if (!imageFiles.length) {
      setErrors((prev) => ({ ...prev, images: IMAGE_TYPE_ERROR }));
      return;
    }

    const totalCount = uploadedImages.length + urlImages.length;
    const remainingSlots = 5 - totalCount;

    if (remainingSlots <= 0) {
      setErrors((prev) => ({ ...prev, images: 'Max 5 images allowed' }));
      return;
    }

    if (imageFiles.length > remainingSlots) {
      setErrors((prev) => ({ ...prev, images: 'Max 5 images allowed' }));
    } else if (hadInvalid) {
      setErrors((prev) => ({ ...prev, images: IMAGE_TYPE_ERROR }));
    } else {
      setErrors((prev) => ({ ...prev, images: '' }));
    }

    const filesToUpload = imageFiles.slice(0, remainingSlots);
    const newPreviews = filesToUpload.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    setUploadedImages((prev) => [...prev, ...newPreviews]);
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!isAnyImageFile(file)) {
      setErrors((prev) => ({ ...prev, logo: LOGO_TYPE_ERROR }));
      return;
    }
    // A logo carrying its own background shows up as a solid box once it's
    // composited onto the generated ad, so keep it out of the flow entirely.
    setErrors((prev) => ({ ...prev, logo: '' }));
    setCheckingLogo(true);
    let check = { transparent: true };
    try {
      check = await analyzeLogoTransparency(file);
    } finally {
      setCheckingLogo(false);
    }
    if (import.meta.env?.DEV) console.debug('[logoTransparency]', file?.name, check);
    if (!check.transparent) {
      setErrors((prev) => ({ ...prev, logo: LOGO_BACKGROUND_ERROR }));
      return;
    }
    setUrlLogo(null);
    setUploadedLogo({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    });
  };

  const removeImage = (index) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeLogo = () => {
    setUploadedLogo(null);
  };

  const extractImageFiles = (clipboardData, accepts = isImageFile) => {
    const items = clipboardData?.items || [];
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && accepts(file)) files.push(file);
      }
    }
    return files;
  };

  const handleImagesPaste = (e) => {
    const files = extractImageFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    handleImageUpload({ target: { files, value: '' } });
  };

  const handleLogoPaste = (e) => {
    const files = extractImageFiles(e.clipboardData, isAnyImageFile);
    if (!files.length) return;
    e.preventDefault();
    handleLogoUpload({ target: { files: [files[0]], value: '' } });
  };

  // Options

  const styleOptions = [
    { value: 'luxury', label: 'Luxury' },
    { value: 'cinematic', label: 'Cinematic' },
    { value: 'clean', label: 'Clean' },
    { value: 'modern', label: 'Modern' },
    { value: 'energetic', label: 'Energetic' },
    { value: 'professional', label: 'Professional' },
    { value: 'friendly', label: 'Friendly' }
  ];

  const toneOptions = [
    { value: 'emotional', label: 'Emotional' },
    { value: 'professional', label: 'Professional' },
    { value: 'confident', label: 'Confident' },
    { value: 'playful', label: 'Playful' },
    { value: 'aspirational', label: 'Aspirational' },
    { value: 'motivational', label: 'Motivational' },
    { value: 'casual', label: 'Casual' }
  ];

  const modelOptions = [
    {
      value: 'veo-3.1-fast',
      label: 'Veo 3.1 Fast (Fast & Social-Ready)',
      tier: 'lower',
      Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      credit: modelCredits?.videoModels?.find((m) =>
        m.label.toLowerCase().includes('veo 3.1 fast')
      )?.value,
    },
    // {
    //   value: 'veo',
    //   label: 'Veo 3.0 (Cinematic Quality)',
    //   tier: 'premium',
    //   Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
    //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 3')?.value,
    // },
  ].filter((option) => availableCanonicalKeys.has(option.value));

  const visibleModelOptions = surfaceModels.map((model) => {
    const value = model.canonical || model.model;
    const metadata = modelOptions.find((option) => option.value === value);
    return {
      value,
      label: model.label || metadata?.label || value,
      tier: metadata?.tier,
      Icon: metadata?.Icon || <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      credit: model.value || metadata?.credit,
    };
  });

  useEffect(() => {
    if (!visibleModelOptions.length) return;

    const nextModel = visibleModelOptions[0].value;
    if (!visibleModelOptions.some((option) => option.value === formData.model) && formData.model !== nextModel) {
      updateField('model', nextModel);
    }
  }, [surfaceModels, formData.model]);

  useEffect(() => {
    if (isAspectRatioLoading || !aspectRatioOptions.length) return;
    if (!aspectRatioOptions.some((option) => option.value === formData.aspectRatio)) {
      updateField('aspectRatio', aspectRatioOptions[0].value);
    }
  }, [aspectRatioOptions, formData.aspectRatio, isAspectRatioLoading]); // eslint-disable-line react-hooks/exhaustive-deps



  return (
    <div className="relative flex h-full max-h-[100vh] w-full min-w-0 flex-col items-center overflow-x-hidden overflow-y-auto bg-white dark:bg-[#303030]/30 pt-1 pb-6 sm:pt-1 sm:pb-8 2xl:max-h-[90vh]">
      {/* Close button */}
      <button
        onClick={onClose}
        disabled={submitting}
        className="pointer-events-auto absolute top-5 right-4 z-50 cursor-pointer text-gray-500 dark:text-white/50 hover:text-black dark:hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>

      {submitting && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-black/55">
          <div className="flex min-w-72 flex-col items-center gap-4 rounded-2xl border border-black/10 bg-white px-8 py-6 text-center shadow-2xl dark:border-white/10 dark:bg-[#202020]">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-white/20 dark:border-t-white" />
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Preparing script generation
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-white/60">
                Uploading assets and starting AI video generation...
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative mb-2 w-full min-w-0 rounded-2xl px-4 pt-1 pb-4 sm:px-6 sm:pt-2 sm:pb-6 xl:px-8 xl:pt-2 xl:pb-4">
        {/* Title */}
        <h2 className="mb-2 text-center text-lg font-bold text-gray-900 dark:text-white sm:mb-3 sm:text-xl xl:mb-2 xl:text-2xl">{title}</h2>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-stretch xl:gap-6">
          {/* LEFT: Prompt textarea with Model/Duration pills INSIDE at the bottom */}
          <div className="flex w-full min-w-0 flex-col">
            <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:mb-2 sm:text-sm">Prompt*</label>
            <div
              className={`relative flex h-full flex-1 flex-col rounded-2xl border bg-gray-100 dark:bg-[#909294]/15 focus-within:border-white/20 ${errors.optimizedPrompt ? 'border-red-500' : 'border-black/10 dark:border-white/5'}`}
            >
              <textarea
                value={formData.optimizedPrompt}
                onChange={(e) => { updateField('optimizedPrompt', e.target.value); setErrors((prev) => ({ ...prev, optimizedPrompt: '' })); }}
                placeholder="Write your prompt here..."
                disabled={submitting}
                className="min-h-[120px] w-full flex-1 resize-none rounded-2xl bg-transparent px-4 py-3 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[180px] sm:px-5 sm:py-3.5 sm:text-sm xl:min-h-0"
              />
              {/* Inline Model + Duration + Aspect ratio pills at the bottom-right of the prompt box */}
              <div className={`flex flex-wrap items-center justify-end gap-2 px-3 pb-3 sm:px-4 ${submitting ? 'pointer-events-none opacity-50' : ''}`}>
                <div className="flex flex-col items-end">
                  <div className={errors.model ? 'rounded-full ring-1 ring-red-500' : ''}>
                    <CommonDropdown
                      label="Model"
                      type="b-roll"
                      side="top"
                      className="h-auto w-auto bg-gray-100 dark:bg-[#1a1a1a]/60! px-3! py-1.5! text-[11px]! sm:text-[12px]!"
                      options={visibleModelOptions}
                      value={visibleModelOptions.find((opt) => opt.value === formData.model)}
                      onChange={(val) => { updateField('model', val); setErrors((prev) => ({ ...prev, model: '' })); }}
                    />
                  </div>
                  {errors.model && <p className="mt-1 text-[10px] text-red-400">{errors.model}</p>}
                </div>
                <div className="flex flex-col items-end">
                  <div className={errors.duration ? 'rounded-full ring-1 ring-red-500' : ''}>
                    <CommonDropdown
                      label="Duration"
                      type="b-roll"
                      side="top"
                      className="h-auto w-auto bg-gray-100 dark:bg-[#1a1a1a]/60! px-3! py-1.5! text-[11px]! sm:text-[12px]!"
                      options={durationOptions}
                      value={durationOptions.find((opt) => opt.value === formData.duration)}
                      onChange={(val) => { updateField('duration', val); setErrors((prev) => ({ ...prev, duration: '' })); }}
                    />
                  </div>
                  {errors.duration && <p className="mt-1 text-[10px] text-red-400">{errors.duration}</p>}
                </div>
                <div className="flex flex-col items-end">
                  <div className={errors.aspectRatio ? 'rounded-full ring-1 ring-red-500' : ''}>
                    <CommonDropdown
                      label={isAspectRatioLoading ? 'Loading ratios...' : 'Aspect Ratio'}
                      type="b-roll"
                      side="top"
                      className="h-auto w-auto bg-gray-100 dark:bg-[#1a1a1a]/60! px-3! py-1.5! text-[11px]! sm:text-[12px]!"
                      options={aspectRatioOptions}
                      value={aspectRatioOptions.find((opt) => opt.value === formData.aspectRatio) || (isAspectRatioLoading ? { label: 'Loading ratios...', Icon: <Loader2 className="h-3 w-3 animate-spin" /> } : undefined)}
                      onChange={(val) => { updateField('aspectRatio', val); setErrors((prev) => ({ ...prev, aspectRatio: '' })); }}
                      disabled={isAspectRatioLoading || !aspectRatioOptions.length}
                    />
                  </div>
                  {errors.aspectRatio && <p className="mt-1 text-[10px] text-red-400">{errors.aspectRatio}</p>}
                </div>
              </div>
            </div>
            {errors.optimizedPrompt && (
              <p className="mt-1 text-xs text-red-400">{errors.optimizedPrompt}</p>
            )}
          </div>

          {/* RIGHT: All other fields */}
          <div className="min-w-0 space-y-4 xl:space-y-3">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <CustomInput
              label={`${isBrand ? 'Brand' : 'Product'} Name`}
              required
              placeholder={`Add ${isBrand ? 'Brand' : 'Product'} Name`}
              value={formData.name}
              onChange={(e) => { updateField('name', e.target.value); setErrors((prev) => ({ ...prev, name: '' })); }}
              error={errors.name}
              disabled={submitting}
            />
            <div className="flex w-full flex-col">
              <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:mb-2 sm:text-sm">Category</label>
              <div className={`${errors.category ? 'rounded-full ring-1 ring-red-500' : ''} ${submitting ? 'pointer-events-none opacity-50' : ''}`}>
                <CommonDropdown
                  label="Choose category"
                  className="h-auto w-full bg-gray-100 dark:bg-[#909294]/15! px-3! py-3 text-[13px]! sm:px-4! sm:py-[23px] sm:text-sm! 2xl:py-6"
                  type="b-roll"
                  options={categoryOptions}
                  value={categoryOptions.find((opt) => opt.value === formData.category)}
                  onChange={(val) => { updateField('category', val); setErrors((prev) => ({ ...prev, category: '' })); }}
                />
              </div>
              {errors.category && <p className="mt-1 text-xs text-red-400">{errors.category}</p>}
            </div>
          </div>

          <div className="flex w-full min-w-0 flex-col">
            <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:mb-2 sm:text-sm">
              {isBrand ? 'Brand' : 'Product'} Description*
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => { updateField('description', e.target.value); setErrors((prev) => ({ ...prev, description: '' })); }}
              placeholder={`Briefly describe your ${type} including key features.`}
              rows={3}
              disabled={submitting}
              className={`w-full max-h-20 2xl:max-h-[91px] min-w-0 resize-none rounded-[20px] border bg-gray-100 dark:bg-[#909294]/15! px-4 py-3 text-[13px] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:py-3.5 sm:text-sm ${errors.description ? 'border-red-500 focus:border-red-500' : 'border-black/10 dark:border-white/5 focus:border-white/20'}`}
            />
            {errors.description && <p className="mt-1 text-xs text-red-400">{errors.description}</p>}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div
              tabIndex={submitting ? -1 : 0}
              onPaste={submitting ? undefined : handleImagesPaste}
              className="rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              title="Click here and press Ctrl+V to paste an image"
            >
              {urlImages.length + uploadedImages.length === 0 ? (
                <FileUpload
                  id="images-upload"
                  label="Product Images"
                  required
                  fileName=""
                  onChange={handleImageUpload}
                  onClear={() => { setUploadedImages([]); setUrlImages([]); }}
                  error={errors.images}
                  disabled={submitting}
                />
              ) : (
                <>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:text-sm">
                    Product Images*
                  </label>
                  <div className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-gray-100 px-2.5 py-2 dark:bg-[#909294]/15 ${
                    errors.images
                      ? 'border-red-500'
                      : 'border-black/10 dark:border-white/5'
                  } ${submitting ? 'opacity-50' : ''}`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {urlImages.map((img, index) => (
                    <div
                      key={`url-${index}`}
                      className="group relative h-11 w-11 cursor-pointer rounded-lg border border-black/10 dark:border-white/10"
                    >
                      <img
                        src={img.preview}
                        alt={`Product image ${index + 1}`}
                        className="h-full w-full rounded-lg object-cover"
                        onClick={() => openLightbox([...urlImages.map((i) => i.preview), ...uploadedImages.map((i) => i.preview)], index)}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <button
                        type="button"
                        onClick={() => setUrlImages((prev) => prev.filter((_, i) => i !== index))}
                        disabled={submitting}
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {uploadedImages.map((img, index) => (
                    <div
                      key={`file-${index}`}
                      className="group relative h-11 w-11 cursor-pointer rounded-lg border border-black/10 dark:border-white/10"
                    >
                      <img
                        src={img.preview}
                        alt={`Product image ${urlImages.length + index + 1}`}
                        className="h-full w-full rounded-lg object-cover"
                        onClick={() => openLightbox([...urlImages.map((i) => i.preview), ...uploadedImages.map((i) => i.preview)], urlImages.length + index)}
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        disabled={submitting}
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                      {urlImages.length + uploadedImages.length < 5 && (
                        <label
                          htmlFor={submitting ? undefined : 'images-upload-more'}
                          title="Add more product images"
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/20 bg-black/[0.025] text-gray-500 transition dark:border-white/20 dark:bg-white/[0.035] dark:text-white/50 ${
                            submitting
                              ? 'cursor-not-allowed'
                              : 'cursor-pointer hover:border-emerald-400/60 hover:text-emerald-500 dark:hover:text-emerald-300'
                          }`}
                        >
                          <Plus className="h-4 w-4" />
                          <input
                            id="images-upload-more"
                            type="file"
                            className="hidden"
                            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                            onChange={handleImageUpload}
                            multiple
                            disabled={submitting}
                          />
                        </label>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-black/5 px-2 py-1 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-white/50">
                      {urlImages.length + uploadedImages.length}/5
                    </span>
                  </div>
                  {errors.images && <p className="mt-1 text-xs text-red-400">{errors.images}</p>}
                </>
              )}
            </div>
            <div
              tabIndex={submitting ? -1 : 0}
              onPaste={submitting ? undefined : handleLogoPaste}
              className="rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              title="Click here and press Ctrl+V to paste an image"
            >
              {!uploadedLogo && !urlLogo ? (
                <FileUpload
                  id="logo-upload"
                  label={isBrand ? 'Brand Logo' : 'Product Logo'}
                  fileName={checkingLogo ? 'Checking logo…' : ''}
                  accept={LOGO_ACCEPT}
                  onChange={handleLogoUpload}
                  onClear={() => { removeLogo(); setUrlLogo(null); }}
                  error={errors.logo}
                  disabled={submitting || checkingLogo}
                />
              ) : (
                <>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:text-sm">
                    {isBrand ? 'Brand Logo' : 'Product Logo'}
                  </label>
                  <div className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-gray-100 px-2.5 py-2 dark:bg-[#909294]/15 ${
                    errors.logo
                      ? 'border-red-500'
                      : 'border-black/10 dark:border-white/5'
                  } ${submitting ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <div className="group relative h-11 w-11 cursor-pointer rounded-lg border border-black/10 dark:border-white/10">
                        <img
                          src={uploadedLogo?.preview || urlLogo?.preview}
                          alt={`${isBrand ? 'Brand' : 'Product'} logo`}
                          className="h-full w-full rounded-lg object-cover"
                          onClick={() => openLightbox([uploadedLogo?.preview || urlLogo?.preview], 0)}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        <button
                          type="button"
                          onClick={() => { removeLogo(); setUrlLogo(null); }}
                          disabled={submitting}
                          className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <label
                        htmlFor={submitting || checkingLogo ? undefined : 'logo-upload-replace'}
                        title="Replace logo"
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-black/20 bg-black/[0.025] text-gray-500 transition dark:border-white/20 dark:bg-white/[0.035] dark:text-white/50 ${
                          submitting
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer hover:border-emerald-400/60 hover:text-emerald-500 dark:hover:text-emerald-300'
                        }`}
                      >
                        <Plus className="h-4 w-4" />
                        <input
                          id="logo-upload-replace"
                          type="file"
                          className="hidden"
                          accept={LOGO_ACCEPT}
                          onChange={handleLogoUpload}
                          disabled={submitting || checkingLogo}
                        />
                      </label>
                    </div>
                    <span className="shrink-0 rounded-full bg-black/5 px-2 py-1 text-[10px] font-medium text-gray-500 dark:bg-white/10 dark:text-white/50">
                      1/1
                    </span>
                  </div>
                  {errors.logo && <p className="mt-1 text-xs text-red-400">{errors.logo}</p>}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <CustomInput
              label="CTA"
              placeholder="Add Call to Action"
              value={formData.cta}
              onChange={(e) => { updateField('cta', e.target.value); setErrors((prev) => ({ ...prev, cta: '' })); }}
              error={errors.cta}
              disabled={submitting}
            />
            {isBrand ? (
              <CustomInput
                label="Tagline"
                placeholder="Add Tagline"
                value={formData.tagline}
                onChange={(e) => { updateField('tagline', e.target.value); setErrors((prev) => ({ ...prev, tagline: '' })); }}
                error={errors.tagline}
                disabled={submitting}
              />
            ) : (
              <div className="flex w-full min-w-0 flex-col">
                <label className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#afafaf] sm:mb-2 sm:text-sm">Product Type</label>
                <div className={`${errors.productType ? 'rounded-full ring-1 ring-red-500' : ''} ${submitting ? 'pointer-events-none opacity-50' : ''}`}>
                  <CommonDropdown
                    label="Choose Product Type"
                    type="b-roll"
                    className="h-auto w-full bg-gray-100 dark:bg-[#909294]/15! px-3! py-3 text-[13px]! sm:px-4! sm:py-[23px] sm:text-sm! 2xl:py-6"
                    options={productTypeOptions}
                    value={productTypeOptions.find((opt) => opt.value === formData.productType)}
                    onChange={(val) => { updateField('productType', val); setErrors((prev) => ({ ...prev, productType: '' })); }}
                  />
                </div>
                {errors.productType && <p className="mt-1 text-xs text-red-400">{errors.productType}</p>}
              </div>
            )}
          </div>

          {/* Settings Divider */}
          <div>
            <div className={`mb-3 rounded-2xl border border-black/10 dark:border-white/5 bg-gray-100 dark:bg-[#909294]/10 p-3 sm:p-4 ${submitting ? 'pointer-events-none opacity-50' : ''}`}>
              <VoiceSelector
                value={formData.voice}
                onChange={(next) => { updateField('voice', next); setErrors((prev) => ({ ...prev, voice: '' })); }}
                error={errors.voice}
                compactHeader
              />
            </div>

            <div className="mt-3 flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className={`flex w-full items-center justify-between gap-2 rounded-xl border border-black/10 bg-gray-100 px-3 py-2 dark:border-white/5 dark:bg-[#909294]/10 sm:w-[245px] sm:flex-none ${submitting ? 'pointer-events-none opacity-50' : ''}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Captions
                </p>
                <p className="mt-0.5 whitespace-nowrap text-[11px] text-gray-500 dark:text-white/50">
                  Add subtitles to the final video.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.captionsEnabled}
                aria-label="Enable captions"
                onClick={() => updateField('captionsEnabled', !formData.captionsEnabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                  formData.captionsEnabled
                    ? 'border-emerald-400 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)]'
                    : 'border-black/20 bg-black/10 dark:border-white/15 dark:bg-white/10'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${
                    formData.captionsEnabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex min-w-0 flex-col sm:ml-auto">
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  {(() => {
                    const est = estimateAdVideoCredits({ video_model: formData.model, video_duration: formData.duration, no_of_ads: 1, modelCredits });
                    const enough = availableCredits >= est;
                    if (!formData.model || !formData.duration) return null;
                    return enough ? (
                      <ShadcnTooltip label={`Will use : ${est} credits, ${availableCredits - est} left after`}>
                        <span className="rounded-full bg-black/5 dark:bg-white/20 px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-white/90">
                          ~{est} credits
                        </span>
                      </ShadcnTooltip>
                    ) : (
                      <span className="shrink-0 whitespace-nowrap rounded-full border border-red-500 bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white">
                        Not enough credits — need {est}, you have {availableCredits}
                      </span>
                    );
                  })()}
                  <button
                    onClick={onBack}
                    disabled={submitting}
                    className="rounded-sm border border-black/20 dark:border-[#efefef]/70 px-4 py-1.5 text-13 font-medium text-gray-900 dark:text-white transition hover:bg-black/5 dark:hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6 sm:text-sm"
                  >
                    Back
                  </button>
                  <button
                    disabled={submitting || availableCredits < estimateAdVideoCredits({ video_model: formData.model, video_duration: formData.duration, no_of_ads: 1, modelCredits })}
                    onClick={async () => {
                      const validationErrors = validate();
                      if (Object.keys(validationErrors).length > 0) {
                        setErrors(validationErrors);
                        return;
                      }

                      // Recreate with no edits: clone the original session into a new
                      // doc (status="copy") so generate-video runs on a fresh _id and
                      // doesn't mutate the original. Backend's /ai-ads/copy/:sessionId
                      // carries over inputs + scenes + scripts; results[] stays empty
                      // until the user triggers generate-video on the new id.
                      if (!hasFormChanged()) {
                        const originalSessionId = existingSceneData?._id || existingSceneData?.data?._id;
                        if (!originalSessionId) {
                          dispatch(setAiAdsSceneLoading(false));
                          onNext({ formData, uploadedImages, uploadedLogo, urlImages, urlLogo });
                          return;
                        }
                        setSubmitting(true);
                        try {
                          const result = await dispatch(copyAiAdsSessionAction(originalSessionId));
                          if (result?.sessionId) {
                            const url = new URL(window.location.href);
                            url.searchParams.set('id', result.sessionId);
                            window.history.replaceState(null, '', url.toString());
                          }
                          dispatch(setAiAdsSceneLoading(false));
                          onNext({ formData, uploadedImages, uploadedLogo, urlImages, urlLogo });
                        } catch {
                          // error already toasted in action
                        } finally {
                          setSubmitting(false);
                        }
                        return;
                      }

                      setSubmitting(true);
                      try {
                        const result = await dispatch(generateAiAdsSceneAction(type, {
                          formData,
                          uploadedImages,
                          uploadedLogo,
                          urlImages,
                          urlLogo,
                        }));
                        if (result?.__validationError) {
                          const fieldMap = { ctaType: 'cta', userPrompt: 'optimizedPrompt' };
                          const apiErrors = {};
                          result.fields.forEach(({ field, reason }) => {
                            // Strip array index suffix: "images[0]" -> "images", trim whitespace
                            const baseField = field.trim().replace(/\[\d+\]/g, '');
                            const key = fieldMap[baseField] || baseField;
                            apiErrors[key] = reason;
                          });
                          setErrors((prev) => ({ ...prev, ...apiErrors }));
                          return;
                        }
                        if (result?.sessionId) {
                          const url = new URL(window.location.href);
                          url.searchParams.set('id', result.sessionId);
                          window.history.replaceState(null, '', url.toString());
                        }
                        onNext({ formData, uploadedImages, uploadedLogo, urlImages, urlLogo });
                      } catch {
                        // error already toasted in action
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="rounded-sm bg-gray-900 text-white dark:bg-white px-4 py-1.5 text-13 font-medium dark:text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:px-6 sm:text-sm"
                  >
                    {submitting ? 'Generating...' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {lightbox.open && (
          <ShowLightBox
            images={lightbox.images}
            lightboxImage={lightbox.images[lightbox.index]}
            closeLightbox={closeLightbox}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default DetailsFormStep;
