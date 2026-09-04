import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import UpgradeModal from '../UpgradeModal';
import {
  CloudUpload,
  LinkIcon,
  Loader2,
  X,
} from 'lucide-react';
import geminiLogo from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import BrandsDropdown from '@/components/layout/header/BrandIQ/Competitors/BrandsDropdown';
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { generateVideoAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { setRecreateInputs } from '@/store/reducers/adStudio/adVideoNewSlice';
import emitter from '@/utils/eventEmitter';
import { AnimatePresence } from 'framer-motion';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { useVideoSurfaceModelsState } from '@/utils/hooks/useVideoSurfaceModels';
import { AspectRatioPreview, getModelAspectRatios, getModelDurationOptions, getSelectedModelDuration } from '@/utils/videoModelCapabilities';
import { getFirstAvailableVideoModel, isVideoModelBlocked } from '@/utils/videoModelAccess';
const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const ProductBrollPage = ({ pageVideo, handleGenerate: onGenerate, onClose }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [productUrl, setProductUrl] = useState('');
  // const [productName, setProductName] = useState('');
  const [promotion, setPromotion] = useState('');
  const [notes, setNotes] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [imageOrientation, setImageOrientation] = useState(null); // 'portrait', 'landscape', 'square'
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const { brand_name, brandInfo } = useSelector((state) => state.adFactoryNew);
  const sessionId = useSelector((state) => state.adHistory?.avs3);
  const { isLoading, error, recreateInputs } = useSelector((state) => state.adVideoNew);
  const { userData } = useSelector((state) => state.socket);
  const dispatch = useDispatch();
  const productName = brand_name || brandInfo?.brandName || '';
  const { video_model, modelCredits } = useSelector((state) => state.prompt);
  const { models: surfaceModels, isLoading: isAspectRatioLoading } = useVideoSurfaceModelsState('broll');
  const aspectRatioOptions = useMemo(
    () => getModelAspectRatios(surfaceModels, 'broll', videoModel),
    [surfaceModels, videoModel]
  );
  const { credits } = useSelector((state) => state.socket);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);

  const videoChatModels = useMemo(
    () => surfaceModels.map((model) => ({
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
    if (uploadedImages.length > 0) {
      const img = new Image();
      img.src = uploadedImages[0].preview;
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
  }, [uploadedImages]);

  // useEffect(() => {
  //   dispatch(fetchProcessingCount());
  // }, [dispatch]);

  useEffect(() => {
    const handleRecreate = (inputs) => {
      console.log('Recreating video with inputs:', inputs);
      if (!inputs || inputs.type === 'ugc') return;

      if (inputs.model && videoChatModels.some((m) => m.value === inputs.model)) {
        setVideoModel(inputs.model);
      }
      if (inputs.duration) setVideoDuration(inputs.duration);
      if (inputs.aspectRatio) setAspectRatio(inputs.aspectRatio);

      const s3Base = import.meta.env.VITE_S3_BASE_URL || '';
      const rawImageUrl =
        inputs.image || inputs.imageUrl || inputs.productUrl || inputs.productImage || '';

      if (rawImageUrl) {
        const isFullUrl = rawImageUrl.startsWith('http');
        const previewUrl = isFullUrl ? rawImageUrl : s3Base + rawImageUrl;

        setProductUrl('');
        setUploadedImages([
          {
            file: null,
            preview: previewUrl,
          },
        ]);
      }

      if (inputs.promotion) setPromotion(inputs.promotion);
      if (inputs.notes) setNotes(inputs.notes);
      if (inputs.productName) {
        dispatch(setFields({ brand_name: inputs.productName }));
      }
      dispatch(setRecreateInputs(null));
    };

    if (recreateInputs && recreateInputs.type !== 'ugc') {
      handleRecreate(recreateInputs);
    }

    emitter.on('recreate-video', handleRecreate);
    return () => {
      emitter.off('recreate-video', handleRecreate);
    };
  }, [dispatch, recreateInputs, videoChatModels]);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const preview = {
      file,
      preview: URL.createObjectURL(file),
    };

    setUploadedImages([preview]);
    setErrors((prev) => ({ ...prev, productImage: '' }));
  };

  const handlePaste = (e) => {
    const items = e.clipboardData.items;

    // 1. Handle actual image file paste — store file, upload happens on Generate
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setUploadedImages([{ file, preview: URL.createObjectURL(file) }]);
          setErrors((prev) => ({ ...prev, productImage: '' }));
          return;
        }
      }
    }

    // 2. Handle pasted URL — store as-is, upload happens on Generate
    const pastedText = e.clipboardData.getData('text');

    if (pastedText && pastedText.startsWith('http')) {
      setProductUrl(pastedText);
      setUploadedImages([{ file: null, preview: pastedText }]);
      setErrors((prev) => ({ ...prev, productImage: '' }));
    }
  };

  const removeImage = (index) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (productName) {
      setErrors((prev) => ({ ...prev, productName: '' }));
    }
  }, [productName]);

  const validateForm = () => {
    const newErrors = {};
    if (!productUrl && uploadedImages.length === 0) {
      newErrors.productImage = 'Product image is required';
    }
    if (!videoModel) {
      newErrors.videoModel = 'Model is required';
    }
    if (!selectedVideoDuration) {
      newErrors.videoDuration = 'Duration is required';
    }
    if (!aspectRatio) {
      newErrors.aspectRatio = 'Aspect Ratio is required';
    }
    if (!productName) {
      newErrors.productName = 'Brand/Product Name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGenerate = async () => {
    if (isLoading || isSubmitting) return;
    if (!validateForm()) return;

    const payload = {
      // sessionId,
      inputs: {
        type: 'broll',
        productUrl,
        productName,
        duration: selectedVideoDuration,
        aspectRatio,
        promotion,
        notes,
        model: videoModel,
        numberOfVideos: 1,
      },
    };

    setIsSubmitting(true);
    try {
      await dispatch(generateVideoAction(payload, uploadedImages));

      dispatch(
        setFields({
          brand_name: '',
          selectedBrand: {},
          brandInfo: {},
        })
      );

      setProductUrl('');
      setUploadedImages([]);
      setPromotion('');
      setNotes('');
      if (onGenerate) await onGenerate();
    } catch (error) {
      console.log('Error in generating video:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <div className="grid h-full grid-cols-1 sm:grid-cols-2">
      {/* Preview */}
      <div className="relative flex min-h-[350px] rounded-xl rounded-tr-none rounded-br-none bg-white">
        <h1 className="z-4 m-4 ml-6 text-lg font-semibold text-white 2xl:m-6 2xl:ml-8 2xl:text-2xl">
          Create your B-rolls
        </h1>

        <img
          src={import.meta.env.VITE_S3_BASE_URL + pageVideo}
          alt={`b-roll-preview`}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src={pageVideo} type="video/mp4" />
        </video> */}

        <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-black/30" />
      </div>

      {/* Form */}
      <div className="relative flex max-h-[85vh] flex-col gap-5 overflow-y-auto py-8 pr-3 pl-4 text-zinc-900 2xl:px-5 dark:text-white">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-[50] rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X className="h-4 w-4 2xl:h-6 2xl:w-6" />
        </button>
        {/* URL */}
        <div className="flex flex-col gap-2">
          <span className="flex w-fit items-center gap-1 rounded-full border border-[#6b72f8]/60 bg-zinc-100 px-2.5 py-0.5 text-10 font-medium text-zinc-800 2xl:text-xs dark:bg-white dark:text-black">
                  🌐 All regional languages supported
                </span> <br />
          <label className="text-sm 2xl:text-base">Brand/product URL or upload image*</label>
          <div
            onPaste={handlePaste}
            className="flex items-center gap-3 rounded-4xl border border-black/10 bg-zinc-50 px-1 py-1 text-[10px] text-zinc-600 transition 2xl:py-2 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-[#afafaf]"
          >
            <div className="flex flex-1 items-center justify-between">
              <input
                value={productUrl}
                // readOnly
                onChange={(e) => {
                  setProductUrl(e.target.value);
                  if (e.target.value) setErrors((prev) => ({ ...prev, productImage: '' }));
                }}
                className="w-full rounded-lg bg-transparent px-3 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:text-[#afafaf] dark:placeholder:text-[#afafaf]"
                placeholder="Paste your product Image"
              />
              <LinkIcon className="h-3 w-3 text-zinc-500 2xl:h-4 2xl:w-4 dark:text-[#909294]" />
            </div>

            <label
              htmlFor="brand-logo"
              className="flex cursor-pointer items-center gap-1 rounded-4xl bg-zinc-200 px-2.5 py-1.5 text-[10px] text-zinc-800 hover:bg-zinc-300 2xl:gap-2 dark:bg-[#606060] dark:text-white dark:hover:opacity-70"
            >
              <CloudUpload className="h-3 w-3 text-current 2xl:h-4 2xl:w-4" />
              <span className="!text-[10px] whitespace-nowrap 2xl:!text-xs">Upload Image</span>
            </label>

            <input
              id="brand-logo"
              type="file"
              className="hidden"
              accept="image/*"
              onChange={handleImageUpload}
            />
          </div>

          {errors.productImage && (
            <span className="text-[12px] text-red-500">{errors.productImage}</span>
          )}
          {uploadedImages.length > 0 && (
            <div className="mt-2">
              <div className="flex flex-wrap gap-2 2xl:gap-3">
                {uploadedImages.map((img, index) => (
                  <div
                    key={index}
                    className="group relative h-12 w-12 border border-black/10 2xl:h-16 2xl:w-16 dark:border-white/10"
                  >
                    <img
                      src={img.preview}
                      alt="upload"
                      className="h-full w-full cursor-pointer rounded-md object-cover"
                      onClick={() => {
                        const allImages = uploadedImages.map((img) => img.preview);
                        setLightboxImages(allImages);
                        setLightboxImage(img.preview);
                        setLightboxOpen(true);
                      }}
                    />
                    <button
                      type="button"
                      className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md duration-300 group-hover:opacity-100"
                      onClick={() => removeImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Model + Duration */}
        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Model *</label>
            <CommonDropdown
              options={videoChatModels}
              label="AI Model"
              icon={SparkleDark}
              type="b-roll"
              value={videoChatModels.find((o) => o.value === videoModel)}
              onChange={(val) => {
                if (isVideoModelBlocked(videoChatModels.find((model) => model.value === val), userData)) {
                  setIsUpgradeModalOpen(true);
                  return;
                }
                if (val !== videoModel) setVideoDuration('');
                setVideoModel(val);
                setErrors((prev) => ({ ...prev, videoModel: '' }));
              }}
            />
            {errors.videoModel && (
              <span className="text-[12px] text-red-500">{errors.videoModel}</span>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Duration *</label>
            <CommonDropdown
              options={configuredDurationOptions}
              label="Durations"
              icon={TimerDarkLogo}
              type="b-roll"
              value={configuredDurationOptions.find((o) => o.value === selectedVideoDuration)}
              onChange={(value) => {
                setVideoDuration(value);
                setErrors((prev) => ({ ...prev, videoDuration: '' }));
              }}
            />
            {errors.videoDuration && (
              <span className="text-[12px] text-red-500">{errors.videoDuration}</span>
            )}
          </div>
        </div>

        {['sora', 'veo-3.1-fast'].includes(videoModel) && (
          <div className="flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
            <span>⚠</span>
            <span>Lower quality model selected. Video output quality may be reduced.</span>
          </div>
        )}

        {/* Aspect Ratio */}
        <div>
          <label className="flex items-center gap-2 text-sm text-zinc-900 2xl:text-base dark:text-white">Aspect Ratio * {isAspectRatioLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</label>

          <div className="mt-2 flex flex-wrap gap-4">
            {aspectRatioOptions
              .map(({ value, label }) => {
                const isSelected = value === aspectRatio;
                return (
                  <button
                    key={value}
                    disabled={isAspectRatioLoading}
                    onClick={() => {
                      if (isAspectRatioLoading) return;
                      setAspectRatio(value);
                      setErrors((prev) => ({ ...prev, aspectRatio: '' }));
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs transition 2xl:text-sm ${isSelected ? 'border-black/10 bg-black/5 text-gray-900 dark:border-white/30 dark:bg-white/10 dark:text-white' : 'border-black/10 bg-transparent text-gray-500 dark:border-white/5 dark:text-white/40'}`}
                  >
                    <AspectRatioPreview ratio={value} className={`h-4 w-4 ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-white/40'}`} />
                    {label}
                  </button>
                );
              })}
          </div>
          {errors.aspectRatio && (
            <span className="text-[12px] text-red-500">{errors.aspectRatio}</span>
          )}
          {/* {videoModel === 'kling_3.0' && aspectRatio === '9:16' && (
            <div className="mt-3 flex w-fit items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400 2xl:text-xs">
              <span>ℹ</span>
              <span>Product image also should be in 9:16 ratio</span>
            </div>
          )} */}
        </div>

        {/* Brand Name */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Brand/Product Name*</label>
          <BrandSearch placeholder="Enter your brand/product name" />
          {errors.productName && (
            <span className="text-[12px] text-red-500">{errors.productName}</span>
          )}
        </div>

        {/* Promotional Info */}
        <div>
            <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Promotional Info</label>
            <input
              className="mt-2 w-full rounded-4xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
              placeholder="Enter promotional info/offers"
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
            />
        </div>

        {/* Prompt */}
        <div>
          <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Prompt</label>
          <input
            className="mt-2 w-full rounded-4xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
            placeholder="e.g. white background, aerial drone shot"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-col items-end gap-2">
          {(() => {
            const selectedModel = videoChatModels.find((model) => model.value === videoModel);
            const hasEstimateInputs = Boolean(videoModel && selectedVideoDuration && selectedModel);
            const est = hasEstimateInputs
              ? estimateAdVideoCredits({ video_model: videoModel, video_duration: selectedVideoDuration, no_of_ads: 1, modelCredits, creditsPerSecond: selectedModel.creditsPerSecond })
              : 0;
            const enough = hasEstimateInputs && availableCredits >= est;
            return (
              <div className="flex items-center gap-2">
                {hasEstimateInputs && enough ? (
                  <ShadcnTooltip
                    label={`Will use : ${est} credits, ${availableCredits - est} left after`}
                  >
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-white/20 dark:text-white/90">
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
                  className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 2xl:py-3 2xl:text-base dark:text-black ${isLoading || isSubmitting || !hasEstimateInputs || !enough ? 'cursor-not-allowed bg-gray-900/40 dark:bg-white/30' : 'bg-gray-900 dark:bg-white'}`}
                >
                  {isLoading || isSubmitting ? 'Generating...' : 'Generate'}
                </button>
              </div>
            );
          })()}
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

export default ProductBrollPage;
