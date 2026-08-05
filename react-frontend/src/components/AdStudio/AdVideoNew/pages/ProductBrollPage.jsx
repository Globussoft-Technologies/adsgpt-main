import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import UpgradeModal from '../UpgradeModal';
import {
  CloudUpload,
  LinkIcon,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  X,
} from 'lucide-react';
import { RiGeminiFill } from 'react-icons/ri';
import { SiOpenai, SiBytedance } from 'react-icons/si';
import KlingIcon from '@/components/icons/KlingIcon';
import geminiLogo from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import BrandsDropdown from '@/components/layout/header/BrandIQ/Competitors/BrandsDropdown';
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { generateVideoAction } from '@/store/actions/adVideoNew/Advideoactions';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { setActivePage, setRecreateInputs } from '@/store/reducers/adStudio/adVideoNewSlice';
import emitter from '@/utils/eventEmitter';
import { AnimatePresence } from 'framer-motion';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const availableRatios = [
  { value: '9:16', label: '9:16', icon: RectangleVertical },
  { value: '1:1', label: '1:1', icon: Square, onlyModels: ['kling_3.0'] },
  { value: '16:9', label: '16:9', icon: RectangleHorizontal },
];

const ProductBrollPage = ({ pageVideo, handleGenerate: onGenerate }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('4s');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [productUrl, setProductUrl] = useState('');
  // const [productName, setProductName] = useState('');
  const [promotion, setPromotion] = useState('');
  const [notes, setNotes] = useState('');
  const [aspectRatio, setAspectRatio] = useState(availableRatios[1].value);
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
  const { credits } = useSelector((state) => state.socket);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);

  const videoChatModels = useMemo(
    () => [
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
      //   value: 'sora',
      //   label: 'Sora 2 (Creative & Stylised)',
      //   tier: 'lower',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2')?.value,
      // },

      {
        value: 'veo',
        label: 'Veo 3 (Cinematic Quality)',
        tier: 'premium',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 3')?.value,
      },
      // {
      //   value: 'soraPro',
      //   label: 'Sora 2 Pro (Cinematic Storytelling)',
      //   tier: 'premium',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2 pro')
      //     ?.value,
      // },
      // {
      //   value: 'soraPro_4k',
      //   label: 'Sora Pro 4K (Premium 4K Film Quality)',
      //   tier: 'premium',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find(
      //     (m) =>
      //       m.label.toLowerCase().includes('sora 2 pro 4k') ||
      //       m.label.toLowerCase().includes('sora pro 4k')
      //   )?.value,
      // },
      {
        value: 'veo_4k',
        label: 'Veo 4K (Cinematic 4K Quality)',
        tier: 'premium',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 4k')?.value,
      },
      // {
      //   value: 'seedance_v1',
      //   label: 'Seedance 1.5 Pro',
      //   tier: 'premium',
      //   Icon: <SiBytedance className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'seedance v1')
      //     ?.value,
      // },
      {
        value: 'seedance_v2',
        label: 'Seedance 2.0 (Smooth Motion & Transitions)',
        tier: 'premium',
        Icon: <SiBytedance className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'seedance 2.0')
          ?.value,
      },
      {
        value: 'seedance_fast',
        label: 'Seedance 2.0 Fast (Quick Turnaround)',
        tier: 'premium',
        Icon: <SiBytedance className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'seedance 2.0 fast')
          ?.value,
      },
      {
        value: 'kling_3.0',
        label: 'Kling 3.0',
        tier: 'premium',
        Icon: <KlingIcon className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'kling 3.0')
          ?.value,
      },
    ],
    [modelCredits]
  );

  useEffect(() => {
    if (videoChatModels.length && !videoModel) {
      setVideoModel(videoChatModels[0].value);
    }
  }, [videoChatModels, videoModel]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  useEffect(() => {
    if (videoModel !== 'kling_3.0' && aspectRatio === '1:1') {
      setAspectRatio('16:9');
    }
    
    // Kling specific ratio enforcement based on image orientation
    if (videoModel === 'kling_3.0' && imageOrientation) {
      if (imageOrientation === 'portrait' && aspectRatio !== '9:16') {
        setAspectRatio('9:16');
      } else if (imageOrientation === 'landscape' && aspectRatio !== '16:9') {
        setAspectRatio('16:9');
      } else if (imageOrientation === 'square' && aspectRatio !== '1:1') {
        setAspectRatio('1:1');
      }
    }
  }, [videoModel, aspectRatio, imageOrientation]);

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

  const videoTimer = useMemo(() => {
    const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');

    if (videoModel === 'veo_4k') {
      return [{ value: '8s', label: '8s' }];
    }
    if (videoModel === 'veo' || videoModel === 'veo-3.1-fast') {
      let options = [
        // { value: '4s', label: '4s' },
        // { value: '6s', label: '6s' },
        { value: '8s', label: '8s' },
      ];

      if (hasPlan8) {
        if (videoModel === 'veo-3.1-fast') {
          // limit to 8s
          options = options.filter((opt) => parseInt(opt.value) <= 8);
        }

        // if (videoModel === 'veo') {
        //   // limit to 6s
        //   options = options.filter((opt) => parseInt(opt.value) <= 6);
        // }
      }

      return options;
    }
    if (videoModel === 'soraPro_4k') {
      return [
        // { value: '4s', label: '4s' },
        { value: '8s', label: '8s' },
        { value: '12s', label: '12s' },
        { value: '16s', label: '16s' },
        { value: '21s', label: '21s' },
      ];
    }
    if (videoModel === 'seedance_v2' || videoModel === 'seedance_fast' || videoModel === 'kling_3.0') {
      return [
        // { value: '4s', label: '4s' },
        // {value: '6s', label: '6s' },  
        { value: '8s', label: '8s' },
        { value: '12s', label: '12s' },
      
      ]
    };
    // sora, soraPro (sora-2, sora-2-pro)
    return [
      // { value: '4s', label: '4s' },
      { value: '8s', label: '8s' },
      { value: '12s', label: '12s' },
      { value: '16s', label: '16s' },
      { value: '20s', label: '20s' },
    ];
  }, [videoModel]);

  // useEffect(() => {
  //   dispatch(fetchProcessingCount());
  // }, [dispatch]);

  useEffect(() => {
    setVideoDuration(videoTimer[0].value);
  }, [videoTimer]);

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
  }, [dispatch, recreateInputs, videoTimer, videoChatModels]);

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
    if (!videoDuration) {
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
        duration: videoDuration,
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
          onClick={() => dispatch(setActivePage('home'))}
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
                const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
                if (hasPlan8) {
                  if (val !== 'sora' && val !== 'veo-3.1-fast') {
                    // window.location.href = 'https://adsgpt-dev.poweradspy.com/amember/signup';
                    setIsUpgradeModalOpen(true);
                    return;
                  }
                }
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
              options={videoTimer}
              label="Durations"
              icon={TimerDarkLogo}
              type="b-roll"
              value={videoTimer.find((o) => o.value === videoDuration)}
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
          <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Aspect Ratio *</label>

          <div className="mt-2 flex flex-wrap gap-3">
            {availableRatios
              .filter((r) => !r.onlyModels || r.onlyModels.includes(videoModel))
              .map(({ value, label, icon: Icon }) => {
                const isSelected = value === aspectRatio;
                const isKling = videoModel === 'kling_3.0';
                let isDisabled = false;

                if (isKling && imageOrientation) {
                  if (imageOrientation === 'portrait' && value !== '9:16') isDisabled = true;
                  if (imageOrientation === 'landscape' && value !== '16:9') isDisabled = true;
                  if (imageOrientation === 'square' && value !== '1:1') isDisabled = true;
                }

                return (
                  <div
                    key={value}
                    onClick={() => {
                      if (isDisabled) return;
                      setAspectRatio(value);
                      setErrors((prev) => ({ ...prev, aspectRatio: '' }));
                    }}
                    className={`group rounded-full bg-gradient-to-r ${
                      isSelected
                        ? 'from-[#02C8C4] to-[#5867EB]'
                        : isDisabled
                          ? 'from-transparent to-transparent opacity-30 grayscale cursor-not-allowed'
                          : 'from-zinc-200 to-zinc-200 dark:from-[#2d2d2d] dark:to-[#2d2d2d]'
                    } w-fit p-[1px] hover:bg-gradient-to-tr transition-all`}
                  >
                    <button
                      type="button"
                      disabled={isDisabled}
                      className={`flex min-w-20 items-center justify-between gap-1.5 rounded-full px-5 py-1.5 text-xs transition-all 2xl:min-w-22 2xl:py-2 ${
                        isSelected
                          ? 'bg-zinc-100 text-zinc-800 dark:bg-[#2d2d2d] dark:text-white'
                          : isDisabled
                            ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-[#383838]/30 dark:text-[#AFAFAF]/50'
                            : 'bg-white text-zinc-700 hover:border-black/10 hover:text-zinc-900 dark:bg-[#383838]/50 dark:text-[#AFAFAF] dark:hover:border-white/10 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="h-4 w-4 2xl:h-5 2xl:w-5" />
                      <span className="text-xs 2xl:text-sm">{label}</span>
                    </button>
                  </div>
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
        {videoModel !== 'seedance_v1' && (
          <div>
            <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Promotional Info</label>
            <input
              className="mt-2 w-full rounded-4xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
              placeholder="Enter promotional info/offers"
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
            />
          </div>
        )}

        {/* Additional Notes */}
        <div>
          <label className="text-sm text-zinc-900 2xl:text-base dark:text-white">Additional Notes</label>
          <input
            className="mt-2 w-full rounded-4xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
            placeholder="e.g. white background, aerial drone shot"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-col items-end gap-2">
          {(() => {
            const est = estimateAdVideoCredits({ video_model: videoModel, video_duration: videoDuration, no_of_ads: 1, modelCredits });
            const enough = availableCredits >= est;
            return (
              <div className="flex items-center gap-2">
                {enough ? (
                  <ShadcnTooltip
                    label={`Will use : ${est} credits, ${availableCredits - est} left after`}
                  >
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-white/20 dark:text-white/90">
                      ~{est} credits
                    </span>
                  </ShadcnTooltip>
                ) : (
                  <span className="rounded-full border border-red-500 bg-red-500 px-2.5 py-1 text-xs font-medium text-white">
                    Not enough credits — need {est}, you have {availableCredits}
                  </span>
                )}
                <button
                  disabled={isLoading || isSubmitting || !enough}
                  onClick={handleGenerate}
                  className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 2xl:py-3 2xl:text-base dark:text-black ${isLoading || isSubmitting || !enough ? 'cursor-not-allowed bg-gray-900/40 dark:bg-white/30' : 'bg-gray-900 dark:bg-white'}`}
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
