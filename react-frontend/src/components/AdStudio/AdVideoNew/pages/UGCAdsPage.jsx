import React, { useState, useMemo, useEffect } from 'react';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import { useDispatch, useSelector } from 'react-redux';
import {
  CloudUpload,
  LinkIcon,
  X,
  Clapperboard,
  ChevronLeft,
  Check,
  Loader2,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import UpgradeModal from '../UpgradeModal';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import {
  generateVideoAction,
  generateVideoUGCAction,
} from '@/store/actions/adVideoNew/Advideoactions';
import { analazeDomain } from '@/store/actions/brandIQ/myBrandActions';
import { toast } from 'react-toastify';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { useVideoSurfaceModelsState } from '@/utils/hooks/useVideoSurfaceModels';
import { AspectRatioPreview, getModelAspectRatios, getModelDurationOptions, getSelectedModelDuration } from '@/utils/videoModelCapabilities';
import emitter from '@/utils/eventEmitter';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import { setRecreateInputs } from '@/store/reducers/adStudio/adVideoNewSlice';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { uploadToS3 } from '@/utils/imageUpload';
import { globalToast } from '@/utils/globalToast';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { getFirstAvailableVideoModel, isVideoModelBlocked } from '@/utils/videoModelAccess';
const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const UGCAdsPage = ({ handleGenerate: onGenerate, onClose }) => {
  const dispatch = useDispatch();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isLoading, recreateInputs } = useSelector((state) => state.adVideoNew);
  const [localRecreateData, setLocalRecreateData] = useState(recreateInputs);
  const [step, setStep] = useState(recreateInputs?.type === 'ugc' ? 2 : 1);
  const { modelCredits } = useSelector((state) => state.prompt);
  const { models: surfaceModels, isLoading: isAspectRatioLoading } = useVideoSurfaceModelsState('ugc');
  const { userData, credits } = useSelector((state) => state.socket);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);

  // Form State
  const [website, setWebsite] = useState('');
  const [productName, setProductName] = useState('');
  const [description, setDescription] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const aspectRatioOptions = useMemo(
    () => getModelAspectRatios(surfaceModels, 'ugc', videoModel),
    [surfaceModels, videoModel]
  );
  const [promotion, setPromotion] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [imageOrientation, setImageOrientation] = useState(null); // 'portrait', 'landscape', 'square'
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [urlError, setUrlError] = useState('');

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  useEffect(() => {
    if (productName && errors.productName) setErrors((prev) => ({ ...prev, productName: null }));
    if (description && errors.description) setErrors((prev) => ({ ...prev, description: null }));
    if (videoModel && errors.videoModel) setErrors((prev) => ({ ...prev, videoModel: null }));
    if (aspectRatio && errors.aspectRatio) setErrors((prev) => ({ ...prev, aspectRatio: null }));
    if ((productUrl || uploadedImages.length > 0) && errors.productUrl)
      setErrors((prev) => ({ ...prev, productUrl: null }));
  }, [
    productName,
    description,
    videoModel,
    aspectRatio,
    productUrl,
    uploadedImages,
    errors,
  ]);

  const videoChatModels = useMemo(
    () =>
      surfaceModels.map((model) => ({
        value: model.canonical,
        label: model.label,
        tier: model.isPremium ? 'premium' : 'standard',
        credit: model.value,
        creditsPerSecond: model.creditsPerSecond,
        blockedPlanIds: model.blockedPlanIds || [],
      })),
    [surfaceModels]
  );
  const configuredDurationOptions = useMemo(() => getModelDurationOptions(surfaceModels, videoModel), [surfaceModels, videoModel]);
  const selectedVideoDuration = getSelectedModelDuration(configuredDurationOptions, videoDuration);

  useEffect(() => {
    if (videoModel) return;
    const defaultVideoModel = getFirstAvailableVideoModel(videoChatModels, userData);
    if (defaultVideoModel) setVideoModel(defaultVideoModel);
  }, [userData, videoChatModels, videoModel]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  useEffect(() => {
    if (isAspectRatioLoading || !aspectRatioOptions.length) return;
    if (!aspectRatioOptions.some((option) => option.value === aspectRatio)) {
      setAspectRatio(aspectRatioOptions[0].value);
    }
  }, [aspectRatio, aspectRatioOptions, isAspectRatioLoading]);

  useEffect(() => {
    const selectedImg = uploadedImages[selectedImageIndex];
    if (selectedImg?.preview) {
      const img = new Image();
      img.src = selectedImg.preview;
      img.onload = () => {
        if (img.height > img.width) {
          setImageOrientation('portrait');
        } else if (img.width > img.height) {
          setImageOrientation('landscape');
        } else {
          setImageOrientation('square');
        }
      };
    } else {
      setImageOrientation(null);
    }
  }, [uploadedImages, selectedImageIndex]);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const previews = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setUploadedImages((prev) => [...prev, ...previews]);
  };

  const removeImage = (index) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (isLoading || isSubmitting) return;
    const newErrors = {};
    if (!productName.trim()) newErrors.productName = 'Product name is required';
    if (!description.trim()) newErrors.description = 'Description is required';
    if (!videoModel) newErrors.videoModel = 'Model is required';
    if (!selectedVideoDuration) newErrors.videoDuration = 'Duration is required';
    if (!aspectRatio) newErrors.aspectRatio = 'Aspect ratio is required';
    if (!productUrl.trim() && uploadedImages.length === 0) {
      newErrors.productUrl = 'Product image is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const payload = {
      // sessionId,
      inputs: {
        type: 'ugc',
        productUrl,
        productName,
        duration: selectedVideoDuration,
        aspectRatio,
        promotion,
        notes,
        model: videoModel,
        numberOfVideos: 1,
        productDescription: description,
      },
    };

    setIsSubmitting(true);
    try {
      const selectedImage = uploadedImages[selectedImageIndex]
        ? [uploadedImages[selectedImageIndex]]
        : [];
      await dispatch(generateVideoUGCAction(payload, selectedImage));
      if (onGenerate) await onGenerate();
    } catch (error) {
      console.log('Error in generating video:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isStep2Valid =
    productName &&
    description &&
    videoModel &&
    selectedVideoDuration &&
    aspectRatio &&
    (productUrl || uploadedImages.length > 0);

  const handleNext = async () => {
    if (!website || isAnalyzing) return;

    setUrlError('');
    setIsAnalyzing(true);
    try {
      const response = await analazeDomain(website).catch((error) => {
        if (error?.response?.status === 409) return null; // ✅ silently ignore, proceed to step 2
        throw error;
      });

      if (response) {
        if (response.meta?.title) setProductName(response.meta.title);
        if (response.meta?.description) setDescription(response.meta.description);
        if (response.images && response.images.length > 0) {
          const apiImages = response.images.map((url) => ({
            file: null,
            preview: url,
            isApiImage: true,
          }));
          setUploadedImages(apiImages);
          setSelectedImageIndex(0);
        }
      }
      setStep(2);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      if (detail) {
        setUrlError(detail);
      } else {
        console.error('Error in handleNext:', error);
        setStep(2); // still proceed on any other error
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData.items;

    // Case 1: Image pasted directly — store file, upload happens on Generate
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setUploadedImages((prev) => [...prev, { file, preview: URL.createObjectURL(file) }]);
          return;
        }
      }
    }

    // Case 2: Image URL pasted — store as-is, upload happens on Generate
    const pastedText = e.clipboardData.getData('text');

    if (pastedText && pastedText.startsWith('http')) {
      const isDuplicate = uploadedImages.some((img) => img.preview === pastedText);
      if (isDuplicate) {
        toast.error('This image is already added');
        return;
      }
      setProductUrl(pastedText);
      setUploadedImages((prev) => [...prev, { file: null, preview: pastedText, isUrl: true }]);
    }
  };

  useEffect(() => {
    const handleRecreate = (inputs) => {
      console.log('Recreating UGC video with inputs:', inputs);
      if (!inputs || inputs.type !== 'ugc') return;

      setStep(2); // Jump to form step

      if (inputs.productName) setProductName(inputs.productName);
      if (inputs.productDescription) setDescription(inputs.productDescription);
      if (inputs.model && videoChatModels.some((m) => m.value === inputs.model)) {
        setVideoModel(inputs.model);
      }
      if (inputs.duration) setVideoDuration(inputs.duration);
      if (inputs.aspectRatio) setAspectRatio(inputs.aspectRatio);
      if (inputs.promotion) setPromotion(inputs.promotion);
      if (inputs.notes) setNotes(inputs.notes);

      const s3Base = import.meta.env.VITE_S3_BASE_URL || '';
      const rawImageUrl = inputs.image || inputs.imageUrl || inputs.productUrl || '';

      if (rawImageUrl) {
        const isFullUrl = rawImageUrl.startsWith('http');
        const previewUrl = isFullUrl ? rawImageUrl : s3Base + rawImageUrl;

        setProductUrl('');
        setUploadedImages([
          {
            file: null,
            preview: previewUrl,
            isUrl: true,
          },
        ]);
        setSelectedImageIndex(0);
      }
      // Clear recreateInputs from Redux after handled
      setLocalRecreateData(inputs);
      dispatch(setFields({ brand_name: inputs.productName || '' }));
      dispatch(setRecreateInputs(null));
    };

    if (recreateInputs?.type === 'ugc') {
      handleRecreate(recreateInputs);
    }

    emitter.on('recreate-video', handleRecreate);
    return () => {
      emitter.off('recreate-video', handleRecreate);
    };
  }, [dispatch, recreateInputs, videoChatModels]);

  if (step === 1) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="advideo-ugc-setup-card w-full max-w-[520px] rounded-[32px] border border-[#DDD7CD] bg-[#FCFAF7] p-10 shadow-[0_20px_40px_rgba(80,70,58,0.08),0_8px_16px_rgba(80,70,58,0.05),0_2px_6px_rgba(80,70,58,0.03)] backdrop-blur-xl dark:border-white/5 dark:bg-[#18181B]/60 dark:shadow-2xl">
          {/* Header */}
          <div className="relative mb-10 flex items-center justify-center gap-3 text-gray-900 dark:text-white">
            <Clapperboard className="h-6 w-6 text-gray-900 dark:text-white" />
            <h2 className="text-xl font-semibold tracking-tight">Create your UGC ad</h2>
            <button
              onClick={onClose}
              className="absolute -top-2 -right-4 rounded-full p-2 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Input */}
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-gray-500 dark:text-white/90">Brand Website</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Enter your website..."
                value={website}
                onChange={(e) => { setWebsite(e.target.value); setUrlError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNext();
                }}
                className={`w-full rounded-full border bg-[#F6F2EC] px-6 py-4 text-sm text-gray-900 shadow-inner transition-all placeholder:text-gray-500 focus:ring-1 focus:ring-[#02C8C4]/30 focus:outline-none dark:bg-white/[0.03] dark:text-white dark:placeholder:text-white/20 dark:focus:ring-white/20 ${
                  urlError
                    ? 'border-red-500 focus:ring-red-500/30'
                    : 'border-[#DDD7CD] dark:border-white/10'
                }`}
              />
              <LinkIcon className="absolute top-1/2 right-6 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-white/20" />
            </div>
            {urlError && <p className="mt-1 text-xs text-red-400">{urlError}</p>}
          </div>

          {/* Footer Buttons */}
          <div className="mt-10 flex justify-end gap-3">
            <button
              onClick={() => setStep(2)}
              disabled={isAnalyzing}
              className={`rounded-full bg-[#EAE5DC] px-8 py-2.5 text-sm font-medium text-[#7A7369] transition hover:bg-[#DDD7CD] hover:text-[#24211D] dark:bg-white/[0.08] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white ${
                isAnalyzing ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              disabled={!website || isAnalyzing}
              className={`rounded-full bg-gray-900 text-white dark:bg-white px-8 py-2.5 text-sm font-bold dark:text-black shadow-lg transition hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] ${
                !website || isAnalyzing ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              {isAnalyzing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Analyzing...</span>
                </div>
              ) : (
                'Next'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="advideo-ugc-setup-card relative h-full w-full max-w-[1100px] rounded-[32px] border border-[#DDD7CD] bg-[#FCFAF7] pt-6 backdrop-blur-xl sm:px-6 2xl:px-8 2xl:pt-8 dark:border-white/5 dark:bg-[#18181B]/60">
        {/* Back Button */}
        {!localRecreateData && (
          <button
            onClick={() => setStep(1)}
            className="absolute top-5.5 left-1 rounded-full p-2 text-gray-900 dark:text-white transition hover:bg-black/5 dark:hover:bg-white/10 sm:left-6"
          >
            <ChevronLeft className="h-5 w-5 2xl:h-7 2xl:w-7" />
          </button>
        )}

        {/* Header */}
        <div className="mt-1 mb-6 ml-2 flex items-center justify-center gap-1 text-gray-900 dark:text-white sm:mt-0 sm:gap-3">
          <Clapperboard className="h-5 w-5 text-gray-900 dark:text-white" />
          <h2 className="font-semibold tracking-tight uppercase sm:text-lg 2xl:text-xl">
            Create Your UGC Ad
          </h2>
        </div>

        <div className="mt-10 flex h-full flex-col gap-6 pb-10">
          <div className="h-full max-h-[500px] overflow-y-auto px-6">
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {/* Left Column - Scrollable if content overflows */}
              <div className="flex flex-col gap-6 pr-4 sm:gap-[29px] 2xl:gap-6">
                {/* Language support chip */}
                <span className="flex w-fit items-center gap-1 rounded-full border border-[#6b72f8]/60 bg-gray-900 text-white dark:bg-white px-2.5 py-0.5 text-10 font-medium dark:text-black 2xl:text-xs">
                  🌐 All regional languages supported
                </span>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                    Brand/product Name*
                  </label>
                  <input
                    placeholder="Enter your Brand/product name"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className={`w-full rounded-xl border bg-black/5 dark:bg-white/5 px-4 py-2 text-[11px] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none 2xl:py-3 2xl:text-sm ${
                      errors.productName ? 'border-red-500/50' : 'border-black/10 dark:border-white/10'
                    }`}
                  />
                  {errors.productName && (
                    <span className="mt-1 text-[12px] text-red-400">{errors.productName}</span>
                  )}
                </div>

                {/* URL / Upload */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-500 dark:text-white/80">
                    Brand/product URL or upload image*
                  </label>

                  <div
                    className={`flex items-center gap-2 rounded-full border bg-black/5 dark:bg-white/5 px-1 py-0.5 ${
                      errors.productUrl ? 'border-red-500/50' : 'border-black/10 dark:border-white/10'
                    }`}
                  >
                    <div className="flex flex-1 items-center justify-between">
                      <input
                        placeholder="Paste your product Image"
                        value={productUrl}
                        onChange={(e) => setProductUrl(e.target.value)}
                        onPaste={handlePaste}
                        className="w-full bg-transparent px-2 py-1 text-[11px] text-gray-900 dark:text-white focus:outline-none 2xl:text-xs"
                      />

                      <LinkIcon className="h-3 w-3 text-gray-500 dark:text-white/40" />
                    </div>

                    <label
                      htmlFor="ugc-image-upload"
                      className="flex cursor-pointer items-center gap-1 rounded-full bg-zinc-200 px-3 py-1 transition hover:bg-zinc-300 dark:bg-white/20 dark:hover:bg-white/30"
                    >
                      <CloudUpload className="h-3 w-3 text-zinc-800 2xl:h-3.5 2xl:w-3.5 dark:text-white" />
                      <span className="!text-[8px] font-bold tracking-wider text-zinc-800 uppercase 2xl:text-[11px] dark:text-white">
                        Upload
                      </span>
                    </label>

                    <input
                      id="ugc-image-upload"
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </div>
                  {errors.productUrl && (
                    <span className="mt-1 text-[12px] text-red-400">{errors.productUrl}</span>
                  )}
                </div>

                {/* Model & Duration */}
                <div className="flex gap-4">
                  <div className="flex flex-1 flex-col gap-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">Model *</label>
                    <CommonDropdown
                      options={videoChatModels}
                      label="Model"
                      icon={SparkleDark}
                      value={videoChatModels.find((o) => o.value === videoModel)}
                      onChange={(val) => {
                        if (isVideoModelBlocked(videoChatModels.find((model) => model.value === val), userData)) {
                          setIsUpgradeModalOpen(true);
                          return;
                        }
                        if (val !== videoModel) setVideoDuration('');
                        setVideoModel(val);
                      }}
                      type="ugc"
                    />
                    {errors.videoModel && (
                      <span className="mt-1 text-[12px] text-red-400">{errors.videoModel}</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                      Duration *
                    </label>
                    <CommonDropdown
                      options={configuredDurationOptions}
                      label="Duration"
                      icon={TimerDarkLogo}
                      value={configuredDurationOptions.find((o) => o.value === selectedVideoDuration)}
                      onChange={(value) => {
                        setVideoDuration(value);
                        setErrors((prev) => ({ ...prev, videoDuration: null }));
                      }}
                      type="ugc"
                    />
                    {errors.videoDuration && (
                      <span className="mt-1 text-[12px] text-red-400">{errors.videoDuration}</span>
                    )}
                  </div>
                </div>
                {['sora', 'veo-3.1-fast'].includes(videoModel) && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
                    <span>⚠</span>
                    <span>Lower quality model selected. Video output quality may be reduced.</span>
                  </div>
                )}

                {/* Aspect Ratio */}
                <div className="flex flex-col gap-3">
                  <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                    Aspect Ratio * {isAspectRatioLoading && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" />}
                  </label>
                  <div className="flex gap-4">
                    {aspectRatioOptions
                      .map((ratio) => {
                        const isSelected = aspectRatio === ratio.value;
                        return (
                          <button
                            key={ratio.value}
                            disabled={isAspectRatioLoading}
                            onClick={() => {
                              if (isAspectRatioLoading) return;
                              setAspectRatio(ratio.value);
                            }}
                            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs transition 2xl:text-sm ${
                              isSelected
                                ? 'border-black/10 dark:border-white/30 bg-black/5 dark:bg-white/10 text-gray-900 dark:text-white shadow-inner'
                                : errors.aspectRatio
                                    ? 'border-red-500/50 bg-transparent text-gray-500 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5'
                                    : 'border-black/10 dark:border-white/5 bg-transparent text-gray-500 dark:text-white/40 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white/60'
                            }`}
                          >
                            <AspectRatioPreview ratio={ratio.value} className={`h-4 w-4 ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/40'}`} />
                            {ratio.label}
                          </button>
                        );
                      })}
                  </div>
                  {errors.aspectRatio && (
                    <span className="mt-1 text-[12px] text-red-400">{errors.aspectRatio}</span>
                  )}
                  {/* {videoModel === 'kling_3.0' && aspectRatio === '9:16' && (
                    <div className="mt-1 flex w-fit items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400 2xl:text-xs">
                      <span>ℹ</span>
                      <span>Product image also should be in 9:16 ratio</span>
                    </div>
                  )} */}
                </div>

                {/* Promotional Info */}
                {(
                  <div className="mt-0.5 flex flex-col gap-2 2xl:mt-0">
                    <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                      Promotional Info
                    </label>
                    <input
                      placeholder="Enter any promotional info/offers"
                      value={promotion}
                      onChange={(e) => setPromotion(e.target.value)}
                      className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-4 py-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none 2xl:text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Right Column */}
              <div className="flex flex-col gap-6 overflow-hidden">
                {/* Description */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                    Brand description*
                  </label>
                  <textarea
                    placeholder="Enter your Brand Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className={`w-full resize-none rounded-xl border bg-black/5 dark:bg-white/5 px-4 py-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none 2xl:text-sm ${
                      errors.description ? 'border-red-500/50' : 'border-black/10 dark:border-white/10'
                    }`}
                  />
                  {errors.description && (
                    <span className="mt-1 text-[12px] text-red-400">{errors.description}</span>
                  )}
                </div>

                {/* Thumbnails */}
                {uploadedImages.length > 0 && (
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                        Product Images *
                      </label>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-white/30">
                        {uploadedImages.length} Images
                      </span>
                    </div>

                    <div
                      className="scrollbar-thin scrollbar-track-white/5 scrollbar-thumb-[#4F46E5]/40 grid grid-cols-3 gap-4 overflow-y-auto rounded-3xl border border-black/10 dark:border-white/5 bg-gray-50 dark:bg-[#1C1C1F] p-4"
                      style={{ height: '180px', alignContent: 'start' }}
                    >
                      {uploadedImages.map((img, idx) => {
                        const isSelected = selectedImageIndex === idx;
                        return (
                          <div
                            key={idx}
                            onClick={() => setSelectedImageIndex(idx)}
                            onDoubleClick={() => {
                              const allImages = uploadedImages.map((img) => img.preview);
                              setLightboxImages(allImages);
                              setLightboxImage(img.preview);
                              setLightboxOpen(true);
                            }}
                            className={`group relative flex h-[70px] w-full cursor-pointer flex-col items-center justify-center rounded-2xl border shadow-xl transition-all duration-300 ${
                              isSelected
                                ? 'border-[#4F46E5] bg-[#4F46E5]/10 ring-1 ring-[#4F46E5]'
                                : 'border-black/10 dark:border-white/5 bg-black/5 dark:bg-white/[0.03] hover:border-black/10 dark:hover:border-white/20'
                            }`}
                          >
                            <div className="relative flex h-full w-full items-center justify-center p-2">
                              <img
                                src={img.preview}
                                alt={`Product ${idx}`}
                                className={`max-h-full max-w-full object-contain transition-transform duration-500 ${
                                  isSelected ? 'scale-110' : 'group-hover:scale-105'
                                }`}
                              />
                            </div>
                            {isSelected && (
                              <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#4F46E5] text-white shadow-lg">
                                <Check className="h-3 w-3" />
                              </div>
                            )}
                            <button
                              type="button"
                              className="absolute -top-2 -right-2 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md duration-300 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeImage(idx);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4.5 flex flex-col gap-2">
                  <label className="text-xs font-medium text-gray-500 dark:text-white/80 2xl:text-sm">
                    Prompt
                  </label>
                  <input
                    placeholder="e.g., white background, aerial drone shot, etc"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 px-4 py-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-white/30 focus:ring-1 focus:ring-white/20 focus:outline-none 2xl:text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mr-4 flex items-center justify-end gap-2 2xl:gap-3">
            {(() => {
              const selectedModel = videoChatModels.find((model) => model.value === videoModel);
              const hasEstimateInputs = Boolean(videoModel && selectedVideoDuration && selectedModel);
              const est = hasEstimateInputs
                ? estimateAdVideoCredits({
                    video_model: videoModel,
                    video_duration: selectedVideoDuration,
                    no_of_ads: 1,
                    modelCredits,
                    creditsPerSecond: selectedModel.creditsPerSecond,
                  })
                : 0;
              const enough = hasEstimateInputs && availableCredits >= est;
              return (
                <>
                  {hasEstimateInputs && enough ? (
                    <ShadcnTooltip
                      label={`Will use : ${est} credits, ${availableCredits - est} left after`}
                    >
                      <span className="rounded-full bg-black/5 px-6 py-2 text-xs font-medium text-gray-500 2xl:text-sm dark:bg-white/20 dark:text-white/90">
                        ~{est} credits
                      </span>
                    </ShadcnTooltip>
                  ) : hasEstimateInputs ? (
                    <span className="rounded-full border border-red-500 bg-red-500 px-2.5 py-1 text-xs font-medium text-white">
                      Not enough credits — need {est}, you have {availableCredits}
                    </span>
                  ) : null}
                  <button
                    disabled={isLoading || isSubmitting || !hasEstimateInputs || !enough}
                    onClick={handleGenerate}
                    className={`rounded-full px-10 py-2 text-xs font-bold text-white shadow-2xl transition 2xl:text-sm dark:text-black ${
                      isLoading || isSubmitting || !hasEstimateInputs || !enough
                        ? 'cursor-not-allowed bg-gray-900/40 dark:bg-white/30'
                        : 'bg-gray-900 hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] dark:bg-white'
                    }`}
                  >
                    {isLoading || isSubmitting ? 'Generating...' : 'Generate'}
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {lightboxOpen && (
          <ShowLightBox
            images={lightboxImages}
            lightboxImage={lightboxImage}
            closeLightbox={() => setLightboxOpen(false)}
          />
        )}
      </AnimatePresence>
      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        onUpgrade={() => {
          setIsUpgradeModalOpen(false);
          window.open(SIGNUP_URL, '_blank');
        }}
      />
    </div>
  );
};

export default UGCAdsPage;
