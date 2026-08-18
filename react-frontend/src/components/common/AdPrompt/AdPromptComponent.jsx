import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Images,
  Mic,
  Paintbrush,
  Plus,
  Search,
  Send,
  Sparkles,
  Video,
  ImageUp,
  X,
  Loader2,
} from 'lucide-react';
import { FaGoogle, FaLock, FaPinterest, FaReddit, FaYoutube } from 'react-icons/fa';
import { SiGoogleads } from 'react-icons/si';
import { AiFillLinkedin } from 'react-icons/ai';
import { RiTwitterXLine } from 'react-icons/ri';
import { FaMeta } from 'react-icons/fa6';
// Local components and assets
import PromptFilterDropdown from './PromptFilterDropdown';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import RatioDark from '@/assets/layouts/prompt/ratio-dark.svg';
import NoOfAdCopyDark from '@/assets/layouts/prompt/adcopy-dark.svg';
import ShapeDark from '@/assets/layouts/prompt/shape-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import ChatResponseDark from '@/assets/layouts/adstudio/chat-response-dark.svg';
import { useDispatch, useSelector } from 'react-redux';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import {
  addImage,
  clearUploadedImages,
  removeImage,
  setField,
  togglePromptImprovement,
} from '@/store/reducers/adStudio/promptSlice';
import { submitAdCopyRequest } from '@/store/actions/adStudio/adCopyActions';
import SpeechToText from '../SpeechToText';
import BrandPreferenceDropdown from './BrandPrefernceDropdown';
import DescribeBrandDropdown from './DescribeBrandDropdown';
import ColorVariantsDropdown from './ColorVariantsDropdown';
import VideoTypePreference from './AdVideo/VideoTypePreference';
import { deleteImage, submitAdCreativeRequest } from '@/store/actions/adStudio/adCreativeActions';
import CommonDropdown from './CommonDropdown';
import { uploadToS3 } from '@/utils/imageUpload';
import { nanoid } from 'nanoid';
import BorderGlow from '@/components/AIAssistant/BorderGlow/BorderGlow';
import { submitAdVideoRequest } from '@/store/actions/adStudio/adVideoActions';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import ShowLightBox from '../ShowLightBox';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
import { SiOpenai } from 'react-icons/si';
import { RiGeminiFill } from 'react-icons/ri';
import { toast } from 'react-toastify';
import { suggestPrompt } from '@/store/actions/adStudio/promptActions';
import { fetchModelCredits } from '@/utils/fetchModelCredits';
import { estimateAdCreativeCredits, estimateAdVideoCredits } from '@/utils/creditEstimator';
import { detect } from 'tinyld';

const AdPromptComponent = () => {
  const dispatch = useDispatch();
  const isDarkMode = useSelector((s) => s.theme?.isDarkMode);
  const {
    prompt,
    platform,
    no_of_ads,
    isListening,
    model,
    aspect_ratio,
    uploadedImages,
    video_duration,
    video_aspect_ratio,
    video_model,
    isSuggestingPrompt,
    originalPrompt,
    improvedPrompt,
    isUsingImprovedPrompt,
    modelCredits,
  } = useSelector((state) => state.prompt);
  const { userData, credits } = useSelector((state) => state.socket);
  const { isEditorOpen } = useSelector((state) => state.editor);
  const user_id = userData?.user_id;
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);
  const uploadImageExists =
    Array.isArray(uploadedImages) && uploadedImages.some((img) => img.type === 'uploaded');

  const textAreaRef = useRef(null);
  const fileInputRef = useRef(null);
  // const [uploadedImages, setUploadedImages] = useState([]);
  const [isImageUploading, setIsImageUploading] = useState(false);

  useEffect(() => {
    // Clear prompt on component mount to start anew
    dispatch(setField({ key: 'prompt', value: '' }));

    const loadCredits = async () => {
      const data = await fetchModelCredits();
      if (data) {
        dispatch(setField({ key: 'modelCredits', value: data }));
      }
    };
    loadCredits();
  }, [dispatch]);

  const selectPlateformsOptions = [
    {
      value: 'meta',
      Icon: <FaMeta className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Meta Ads',
    },
    {
      value: 'youtube',
      Icon: <FaYoutube className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Youtube Ads',
    },
    {
      value: 'google',
      Icon: <Search className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Google Search Ads',
    },
    {
      value: 'google_performance_max_ads',
      Icon: <FaGoogle className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Google Performance Max Ads',
    },
    {
      value: 'google_display_ads',
      Icon: <SiGoogleads className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Google Display Ads',
    },

    {
      value: 'linkedin',
      Icon: <AiFillLinkedin className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'LinkedIn Ads',
    },
    {
      value: 'twitter',
      Icon: <RiTwitterXLine className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Twitter Ads',
    },
    {
      value: 'pinterest',
      Icon: <FaPinterest className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Pinterest Ads',
    },
    {
      value: 'reddit',
      Icon: <FaReddit className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Reddit Ads',
    },
    {
      value: 'google_video_ads',
      Icon: <Video className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      label: 'Google Video Ads',
    },
  ];

  const shapes = [
    { value: 1, label: '1V' },
    { value: 2, label: '2V' },
    { value: 3, label: '3V' },
    { value: 4, label: '4V' },
    { value: 5, label: '5V' },
  ];

  const model1Ratios = useMemo(
    () => [
      { value: 'AUTO', label: 'Auto' },
      { value: 'ASPECT_1_1', label: '1:1' },
      { value: 'ASPECT_3_4', label: '3:4' },
      { value: 'ASPECT_16_9', label: '16:9' },
    ],
    []
  );

  const model23Ratios = useMemo(
    () => [
      { value: 'ASPECT_1_1', label: '1:1' },
      { value: 'ASPECT_3_4', label: '3:4' },
      { value: 'ASPECT_4_3', label: '4:3' },
      { value: 'ASPECT_9_16', label: '9:16' },
      { value: 'ASPECT_16_9', label: '16:9' },
    ],
    []
  );
  const videoShapes = [
    { value: 1, label: '1V' },
    { value: 2, label: '2V' },
    { value: 3, label: '3V' },
  ];

  const videoRatios = [
    { value: 'ASPECT_16_9', label: '16:9' },
    { value: 'ASPECT_9_16', label: '9:16' },
  ];
  const MODEL_ASPECT_RATIO_MAP = useMemo(
    () => ({
      'ADSGPT-3.0': model1Ratios,
      'ADSGPT-3.1': model1Ratios,
      'ADSGPT-2.0': model23Ratios,
      'ADSGPT-1.0': model23Ratios,
    }),
    [model1Ratios, model23Ratios]
  );

  const [ratio, setRatio] = useState(MODEL_ASPECT_RATIO_MAP[model]);

  useEffect(() => {
    if (model) {
      setRatio(MODEL_ASPECT_RATIO_MAP[model]);
      if (model === 'ADSGPT-3.0' || model === 'ADSGPT-3.1') {
        dispatch(setField({ key: 'aspect_ratio', value: 'AUTO' }));
      } else {
        dispatch(setField({ key: 'aspect_ratio', value: 'ASPECT_1_1' }));
      }
    }
  }, [model, MODEL_ASPECT_RATIO_MAP, dispatch]);

  // const noOfAdCreatives = [
  //   { value: '1', label: '1' },
  //   { value: '3', label: '3' },
  //   { value: '9', label: '9' },
  //   { value: '9', label: '9' },
  // ];

  const chatModels = useMemo(
    () => [
      {
        value: 'ADSGPT-1.0',
        label: 'Imagen (Highly creative & stylized)',
        Icon: (
          <img src={SparkleDark} className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />
        ),
        credit: modelCredits?.imageModels?.find((m) => m.label.toLowerCase() === 'imagen')?.value,
      },
      {
        value: 'ADSGPT-3.0',
        label: 'OpenAI 1.5 (Balanced, Fast)',
        Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.imageModels?.find((m) => m.label.toLowerCase() === 'openai 1.5')
          ?.value,
      },
      // {
      //   value: 'ADSGPT-3.1',
      //   label: 'OpenAI 2.0 (Photorealistic, Best Quality)',
      //   Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.imageModels?.find((m) => m.label.toLowerCase() === 'openai 2.0')
      //     ?.value,
      // },
      {
        value: 'ADSGPT-2.0',
        label: 'Nano Banana Pro (Best for Lifestyle & People)',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.imageModels?.find((m) => m.label.toLowerCase() === 'nano banana pro')
          ?.value,
      },
    ],
    [modelCredits]
  );

  const videoChatModels = useMemo(
    () => [
      {
        value: 'sora',
        label: 'Sora 2',
        Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2')?.value,
      },
      {
        value: 'veo-3.1-fast',
        label: 'Veo 3.1 Fast',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) =>
          m.label.toLowerCase().includes('veo 3.1 fast')
        )?.value,
      },
      {
        value: 'veo',
        label: 'Veo 3',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 3')?.value,
      },
      {
        value: 'soraPro',
        label: 'Sora 2 Pro',
        Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'sora 2 pro')
          ?.value,
      },
      {
        value: 'soraPro_4k',
        label: 'Sora Pro 4K',
        Icon: <SiOpenai className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find(
          (m) =>
            m.label.toLowerCase().includes('sora 2 pro 4k') ||
            m.label.toLowerCase().includes('sora pro 4k')
        )?.value,
      },
      {
        value: 'veo_4k',
        label: 'Veo 4K',
        Icon: <RiGeminiFill className="!h-3 !w-3 group-hover:text-white 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 4k')?.value,
      },
    ],
    [modelCredits]
  );

  const videoTimer = useMemo(() => {
    if (video_model === 'veo_4k') {
      return [{ value: '8s', label: '8s' }];
    }
    if (video_model === 'veo' || video_model === 'veo-3.1-fast') {
      return [
        { value: '4s', label: '4s' },
        { value: '6s', label: '6s' },
        { value: '8s', label: '8s' },
      ];
    }
    return [
      { value: '4s', label: '4s' },
      { value: '8s', label: '8s' },
      { value: '12s', label: '12s' },
    ];
  }, [video_model]);

  const handleVideoTimerChange = (value) => {
    dispatch(setField({ key: 'video_duration', value: value }));
  };

  // const brandsArray = [{ value: 'Describe Brand', label: 'Describe Brand' }];
  const activeAdStudioTabId = useSelector((state) => state.adStudioTabs.activeAdStudioTabId);
  const { open: isSidebarOpen } = useSidebar();

  const creditEstimate = useMemo(() => {
    if (activeAdStudioTabId === 'adCreative') {
      const c = estimateAdCreativeCredits({ model, no_of_ads, modelCredits });
      return { estimated: c, label: `~${c} credit${c !== 1 ? 's' : ''}` };
    }
    if (activeAdStudioTabId === 'adVideo') {
      const c = estimateAdVideoCredits({ video_model, video_duration, no_of_ads, modelCredits });
      return { estimated: c, label: `~${c} credit${c !== 1 ? 's' : ''}` };
    }
    return null;
  }, [activeAdStudioTabId, model, video_model, video_duration, no_of_ads, modelCredits]);

  const hasEnoughCredits = creditEstimate ? availableCredits >= creditEstimate.estimated : true;

  useEffect(() => {
    // Clear prompt and improvement states when switching tabs
    dispatch(setField({ key: 'prompt', value: '' }));
    dispatch(setField({ key: 'improvedPrompt', value: '' }));
    dispatch(setField({ key: 'originalPrompt', value: '' }));
    dispatch(setField({ key: 'isUsingImprovedPrompt', value: false }));

    if (activeAdStudioTabId === 'adVideo') {
      dispatch(setField({ key: 'video_aspect_ratio', value: 'ASPECT_16_9' }));
      dispatch(setField({ key: 'no_of_ads', value: 1 }));
      dispatch(clearUploadedImages());
    }
  }, [dispatch, activeAdStudioTabId]);

  const getPositionClasses = () => {
    if (activeAdStudioTabId === 'adCreative') {
      if (isSidebarOpen) {
        return 'fixed left-0 right-0 lg:left-[calc(50%+64px)] lg:-translate-x-[calc(50%-64px)]';
      } else {
        return 'fixed left-0 right-0 lg:left-[calc(50%+20px)] lg:-translate-x-[calc(50%-20px)]';
      }
    } else {
      return 'absolute bottom-0 left-0 right-0 lg:left-1/2 lg:-translate-x-1/2';
    }
  };

  const langDetectTimerRef = useRef(null);

  const detectRegionalLanguage = (text) => {
    if (!text || text.trim().length < 3) return null;

  // tinyld doesn't detect Malayalam — use Unicode block range as fallback
  if (/[ഀ-ൿ]/.test(text)) return 'Malayalam';

  const langCode = detect(text);

    const langMap = {
      hi: 'Hindi',
      bn: 'Bengali',
      ta: 'Tamil',
      te: 'Telugu',
      mr: 'Marathi',
      gu: 'Gujarati',
      kn: 'Kannada',
      ml: 'Malayalam',
      pa: 'Punjabi',
      ur: 'Urdu',
    };

    if (langMap[langCode]) return langMap[langCode];

    // Hindi romanized fallback
    const lower = text.toLowerCase();
    if (/\b(kya|hai|nahi|mujhe|tum|mera|meri|kyu|kaise|acha|theek|haan)\b/.test(lower)) {
      return 'Hindi';
    }

    return null;
  };

  const handlePromptChange = (e) => {
    const value = e.target.value;
    dispatch(setField({ key: 'prompt', value }));
    adjustTextareaHeight();

    clearTimeout(langDetectTimerRef.current);
    langDetectTimerRef.current = setTimeout(() => {
      const lang = detectRegionalLanguage(value);
      if (lang) {
        toast.info(`${lang} prompt detected — output will be ${lang}-aware.`, {
          toastId: 'lang-detect',
          autoClose: 3000,
        });
        console.debug('prompt.regional_language_detected', lang.toLowerCase());
      }
    }, 500);

    // Clear improvement state if user manually edits the prompt
    if (improvedPrompt) {
      dispatch(setField({ key: 'improvedPrompt', value: '' }));
      dispatch(setField({ key: 'originalPrompt', value: '' }));
      dispatch(setField({ key: 'isUsingImprovedPrompt', value: false }));
    }
  };

  const adjustTextareaHeight = () => {
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.style.height = 'auto';
        textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, 180) + 'px';
      }
    }, 0);
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt]);

  const handleRequestSubmit = () => {
    if (!prompt || !prompt.trim()) return;

    //  BLOCK AD VIDEO WITHOUT IMAGE
    if (activeAdStudioTabId === 'adVideo') {
      const hasUploadedImage =
        Array.isArray(uploadedImages) && uploadedImages.some((img) => img.type === 'uploaded');

      if (!hasUploadedImage) {
        toast.error('Upload product image before generating Ad Video');
        return;
      }
    }

    if (prompt && prompt.trim()) {
      switch (activeAdStudioTabId) {
        case 'adCopy':
          dispatch(submitAdCopyRequest('', isSidebarOpen));
          break;

        case 'adCreative':
          dispatch(submitAdCreativeRequest(isSidebarOpen));
          break;

        case 'adVideo':
          dispatch(submitAdVideoRequest(isSidebarOpen));
          break;

        default:
          console.warn(`No handler found for tab: ${activeAdStudioTabId}`);
      }
    }
  };

  const handlePlatformChange = (selectedValue) => {
    dispatch(setField({ key: 'platform', value: selectedValue }));
  };

  const handleVariantsChange = (selectedValue) => {
    dispatch(setField({ key: 'no_of_ads', value: selectedValue }));
  };

  const handleModelChange = (selectedValue) => {
    dispatch(setField({ key: 'model', value: selectedValue }));
  };

  const handleVideoModelChange = (selectedValue) => {
    dispatch(setField({ key: 'video_model', value: selectedValue }));
  };

  const handleRatioChange = (selectedValue) => {
    dispatch(setField({ key: 'aspect_ratio', value: selectedValue }));
  };
  const handleVideoRatioChange = (selectedValue) => {
    dispatch(setField({ key: 'video_aspect_ratio', value: selectedValue }));
  };

  const handleEnterKeyPress = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (event.target.value) handleRequestSubmit();
    }
  };

  const handlePaste = async (event) => {
    if (activeAdStudioTabId !== 'adCreative') return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        setIsImageUploading(true);
        const url = await uploadToS3(file, user_id, true);
        if (url) {
          dispatch(addImage({ id: nanoid(), url, type: 'uploaded' }));
        }
        setIsImageUploading(false);
        break;
      }
    }
  };

  // Handle file input change
  const handleFileChange = async (event) => {
    // const files = Array.from(event.target.files);
    // const newImages = files.map((file) => ({
    //   id: Date.now() + Math.random(),
    //   file: file,
    //   url: URL.createObjectURL(file),
    // }));

    // setUploadedImages((prev) => [...prev, ...newImages]);
    const file = event.target.files[0];
    let types = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    if (!types?.includes(file.type)) {
      return;
    }
    setIsImageUploading(true);
    const url = await uploadToS3(file, user_id, true);
    if (url) {
      const newImage = {
        id: nanoid(),
        url,
        type: 'uploaded',
      };
      dispatch(addImage(newImage));
    }

    // Reset file input
    event.target.value = '';
    setPopoverOpen(false);
    setIsImageUploading(false);
  };

  // Handle image removal
  const handleRemoveImage = async (imageId) => {
    const imageToRemove = uploadedImages.find((img) => img.id === imageId);
    if (imageToRemove && imageToRemove?.type === 'uploaded') {
      deleteImage(imageToRemove?.url);
    }
    dispatch(removeImage(imageId));
  };

  const [popoverOpen, setPopoverOpen] = useState(false);

  const updatedModels = useMemo(() => {
    if (isEditorOpen) {
      if (model === 'ADSGPT-1.0') dispatch(setField({ key: 'model', value: 'ADSGPT-2.0' }));
      // return chatModels.filter((m) => m.label === 'OpenAI');
      return chatModels.filter(
        (m) => m.value === 'ADSGPT-3.0' || m.value === 'ADSGPT-3.1' || m.value === 'ADSGPT-2.0'
      );
    }
    return chatModels;
  }, [isEditorOpen, chatModels, dispatch]);

  // sample show common lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeNormalLightbox = () => {
    setLightboxOpen(false);
  };

  const isUploadedImageShowActive =
    activeAdStudioTabId === 'adCreative' || activeAdStudioTabId === 'adVideo';

  return (
    <>
      <div
        className={`layout_for_chat prompt_containerr bottom-0 z-50 w-full max-w-[850px] scale-100 p-2 2xl:bottom-0 2xl:max-w-[1000px] ${getPositionClasses()}`}
      >
        {/* Main Input Container */}
        <div className="lm-composer-card w-full">
          <BorderGlow
            edgeSensitivity={30}
            glowColor="40 80 80"
            backgroundColor={isDarkMode ? 'rgba(13,13,13,0.5)' : 'rgba(238,241,243,0.85)'}
            className="backdrop-blur-[40px] glow-edge-only"
            borderRadius={28}
            glowRadius={48}
            glowIntensity={1.3}
            coneSpread={25}
            animated={false}
            colors={['#c084fc', '#f472b6', '#38bdf8']}
          >
            <div className="relative flex min-h-28 flex-col justify-between p-3 sm:p-4 2xl:min-h-32">
          {/* Gemini Suggest Button - Top Right */}
          <div className="absolute top-4 right-4.5 z-[60] flex items-center gap-2">



            <ShadcnTooltip label="Improve with Gemini">
              <button
                className="flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50"
                onClick={() => dispatch(suggestPrompt())}
                disabled={isSuggestingPrompt || !prompt?.trim()}
              >
                {isSuggestingPrompt ? (
                  <Loader2 className="h-6 w-6 animate-spin text-white 2xl:h-8 2xl:w-8" />
                ) : (
                  <img
                    src={ChatResponseDark}
                    className="h-6 w-6 2xl:h-7.5 2xl:w-7.5"
                    alt="Gemini Suggest"
                  />
                )}
              </button>
            </ShadcnTooltip>
          </div>

          {/* Input Field */}
          <div
            className={`relative mb-2 flex flex-1 items-start gap-2 border-0 bg-transparent px-1 py-1 transition-all ${
              uploadedImages.length > 0 && isUploadedImageShowActive && !isEditorOpen ? 'mt-6 2xl:mt-7' : 'mt-8 sm:mt-0'
            }`}
          >
            {/* image upload plus button only visible for adcreatives */}
            {activeAdStudioTabId === 'adCreative' && !uploadImageExists && !isEditorOpen && (
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    id="tour_adcreatives_upload"
                    className={` ${popoverOpen ? 'prompt_selection_button' : ''} relative top-0.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-zinc-200 data-[state=open]:border data-[state=open]:border-black/20 data-[state=open]:bg-zinc-200 2xl:h-8 2xl:w-8 dark:hover:bg-[#202020]/50 dark:data-[state=open]:border-white/30 dark:data-[state=open]:bg-[#202020]/50`}
                  >
                    <ShadcnTooltip label={popoverOpen ? 'Close Options' : 'More Options'}>
                      {isImageUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-700 2xl:h-5 2xl:w-5 dark:text-white" />
                      ) : (
                        <Plus className="h-4 w-4 text-zinc-700 2xl:h-5 2xl:w-5 dark:text-white" />
                      )}
                    </ShadcnTooltip>
                  </button>
                </PopoverTrigger>

                <PopoverContent
                  side="top"
                  align="start"
                  className="backdrop-blur-100 w-56 rounded-2xl border border-black/10 bg-white px-2 py-3 pb-4 dark:border-white/20 dark:bg-[#0D0D0D]/50"
                >
                  <p className="mb-2.5 ml-2 text-xs font-light text-zinc-700 2xl:text-sm dark:text-[#d9d9d9]">
                    Add Images
                  </p>

                  <div className="flex flex-col gap-2">
                    {/* <button className="flex items-center gap-2 px-2 py-0.5 text-[#AFAFAF] hover:text-white">
                    <Images className="h-4 w-4" />
                    <span className="text-xs 2xl:text-sm">Choose from library</span>
                  </button> */}

                    <label
                      htmlFor="choose_from_device"
                      className="flex cursor-pointer items-center gap-2 px-2 py-0.5 text-zinc-700 hover:text-black dark:text-[#AFAFAF] dark:hover:text-white"
                    >
                      <ImageUp className="h-4 w-4" />
                      <span className="text-xs 2xl:text-sm">Upload from device</span>
                      <input
                        id="choose_from_device"
                        className="hidden"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleFileChange}
                        ref={fileInputRef}
                      />
                    </label>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <textarea
              value={prompt}
              onChange={handlePromptChange}
              placeholder={
                activeAdStudioTabId === 'adCopy'
                  ? 'Bring your campaign to life — type your ad copy idea here in any language…'
                  : Array.isArray(uploadedImages) && uploadedImages.length > 0
                    ? 'Describe how you want to recreate or modify the reference image…'
                    : 'Turn your ideas into visuals — start typing in any language…'
              }
              className="md:text-13 md:placeholder:text-13 max-h-[110px] min-h-8 w-full resize-none border-0 bg-transparent pr-10 text-xs text-zinc-900 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [scrollbar-width:none] placeholder:text-xs placeholder:font-normal placeholder:text-zinc-500 [&::-webkit-scrollbar]:hidden 2xl:max-h-[180px] 2xl:pr-12 2xl:text-sm 2xl:placeholder:text-sm dark:text-slate-200 dark:placeholder:text-[#CCCCCC]/60"
              onKeyDown={handleEnterKeyPress}
              onPaste={handlePaste}
              ref={textAreaRef}
            />
          </div>

          {activeAdStudioTabId === 'adCopy' && (
            <div className="filter_container flex w-full flex-wrap items-center justify-between gap-2">
              <div className="left_side_filter_adcopy flex items-center gap-1 2xl:gap-1.5">
                {/* PLATFORM */}
                <CommonDropdown
                  options={selectPlateformsOptions}
                  label="Platforms"
                  icon={SparkleDark}
                  value={selectPlateformsOptions.find((p) => p.value === platform)}
                  onChange={handlePlatformChange}
                />

                {/* VARIANTS */}
                <CommonDropdown
                  options={shapes}
                  label="Variations"
                  icon={ShapeDark}
                  onChange={handleVariantsChange}
                  value={shapes.find((s) => s.value === no_of_ads)}
                />
              </div>
              <div className="right_side_filter_adcopy flex items-center gap-2">
                {improvedPrompt && (
                  <ShadcnTooltip label={isUsingImprovedPrompt ? 'Switch to Original' : 'Switch to Improved'}>
                    <button
                      onClick={() => dispatch(togglePromptImprovement())}
                      className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-10 font-bold transition-all hover:scale-105 2xl:h-8 2xl:gap-2 2xl:px-3 2xl:text-xs ${isUsingImprovedPrompt
                          ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                          : 'border-white/10 bg-white/5 text-white/60'
                        }`}
                    >
                      <Sparkles className={`h-3 w-3 ${isUsingImprovedPrompt ? 'animate-pulse' : ''} 2xl:h-4 2xl:w-4`} />
                      {isUsingImprovedPrompt ? 'Improved' : 'Original'}
                    </button>
                  </ShadcnTooltip>
                )}
                <span className="hidden md:flex items-center gap-1 rounded-full border border-black/10 bg-zinc-100 px-2 py-1 text-[10px] text-zinc-700 2xl:text-xs whitespace-nowrap dark:border-white/10 dark:bg-white/15 dark:text-white">
                  🌐 All regional languages supported
                </span>
                <div id="tour_describe_brand_for_copy">
                  <DescribeBrandDropdown />
                </div>

                {prompt && !isListening ? (
                  <button
                    id="tour_copy_prompt_by_mic"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white 2xl:h-9 2xl:w-9 dark:bg-white dark:text-black"
                    onClick={handleRequestSubmit}
                  >
                    <ShadcnTooltip label="Generate Ad Copy">
                      <Send className="h-4 w-4 text-current xl:h-5 xl:w-5" />
                    </ShadcnTooltip>
                  </button>
                ) : (
                  <button
                    id="tour_copy_prompt_by_mic"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-white 2xl:h-9 2xl:w-9 dark:bg-white dark:text-black"
                  >
                    <SpeechToText />
                  </button>
                )}

                {/* <button
                  id="tour_copy_prompt_by_mic"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white 2xl:h-9 2xl:w-9"
                >
                  {prompt && !isListening ? (
                    <ShadcnTooltip label="Generate Ad Copy">
                      <Send
                        className="h-4 w-4 text-black xl:h-5 xl:w-5"
                        onClick={handleRequestSubmit}
                      />
                    </ShadcnTooltip>
                  ) : (
                    <SpeechToText />
                  )}
                </button> */}
              </div>
            </div>
          )}

          {activeAdStudioTabId === 'adCreative' && (
            <div className="filter_container flex w-full flex-wrap items-center justify-between gap-2">
              <div
                id="tour_creatives_config_filters"
                className="left_side_filter_adcreative flex items-center gap-1 2xl:gap-1.5"
              >
                <CommonDropdown
                  options={updatedModels}
                  label="AI Model"
                  icon={SparkleDark}
                  onChange={handleModelChange}
                  value={updatedModels.find((s) => s.value === model)}
                />
                <CommonDropdown
                  options={ratio}
                  label="Aspect Ratio"
                  icon={RatioDark}
                  onChange={handleRatioChange}
                  value={ratio.find((s) => s.value === aspect_ratio)}
                />
                {/* <PromptFilterDropdown
                options={noOfAdCreatives}
                label="AdCreatives"
                icon={NoOfAdCopyDark}
                defaultValue="1"
              /> */}
                <CommonDropdown
                  options={shapes}
                  label="Variations"
                  icon={ShapeDark}
                  onChange={handleVariantsChange}
                  value={shapes.find((s) => s.value === no_of_ads)}
                />
                {/* eslint-disable-next-line no-constant-binary-expression */}
                {model !== 'ADSGPT-3.0' && model !== 'ADSGPT-3.1' && false && <ColorVariantsDropdown />}
              </div>
              <div className="left_side_filter_adcreative flex items-center gap-2">
                {improvedPrompt && (
                  <ShadcnTooltip label={isUsingImprovedPrompt ? 'Switch to Original' : 'Switch to Improved'}>
                    <button
                      onClick={() => dispatch(togglePromptImprovement())}
                      className={`flex h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-10 font-bold transition-all hover:scale-105 2xl:h-8 2xl:gap-2 2xl:px-3 2xl:text-xs ${isUsingImprovedPrompt
                          ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                          : 'border-white/10 bg-white/5 text-white/60'
                        }`}
                    >
                      <Sparkles className={`h-3 w-3 ${isUsingImprovedPrompt ? 'animate-pulse' : ''} 2xl:h-4 2xl:w-4`} />
                      {isUsingImprovedPrompt ? 'Improved' : 'Original'}
                    </button>
                  </ShadcnTooltip>
                )}
                <span className="hidden md:flex items-center gap-1 rounded-full border border-black/10 bg-zinc-100 px-2 py-1 text-[10px] text-zinc-700 2xl:text-xs whitespace-nowrap dark:border-white/10 dark:bg-white/15 dark:text-white">
                  🌐 All regional languages supported
                </span>
                <BrandPreferenceDropdown />
                {/* <div className="rounded-full bg-gradient-to-br from-white/10 via-white to-white/10 p-[1px]">
                <button className="mic_button flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#222222] to-[#5771F6] 2xl:h-8 2xl:w-8">
                  <Send className="h-3.5 w-3.5 text-[#AFAFAF]" />
                </button>
              </div> */}

                {creditEstimate && (
                  <ShadcnTooltip
                    label={
                      hasEnoughCredits
                        ? `Will use : ${creditEstimate.label} , ${availableCredits - creditEstimate.estimated} left after`
                        : `Not enough credits — need ${creditEstimate.estimated}, you have ${availableCredits}`
                    }
                  >
                    <span
                      className={`cursor-default rounded-full px-2 py-0.5 text-10 font-medium 2xl:text-xs ${hasEnoughCredits ? 'bg-zinc-200 text-zinc-700 dark:bg-white/20 dark:text-white/90' : 'bg-red-500 text-white'}`}
                    >
                      {creditEstimate.label}
                    </span>
                  </ShadcnTooltip>
                )}
                {prompt && !isListening ? (
                  <button
                    // id="tour_creative_prompt_by_mic"
                    disabled={!hasEnoughCredits}
                    className={`absolute top-4 right-12 flex h-6.75 w-6.75 items-center justify-center rounded-full sm:static 2xl:h-9 2xl:w-9 ${hasEnoughCredits ? 'bg-zinc-900 text-white dark:bg-white dark:text-black' : 'cursor-not-allowed bg-zinc-300 text-zinc-500 dark:bg-white/30 dark:text-white/50'}`}
                    onClick={handleRequestSubmit}
                  >
                    <ShadcnTooltip label={hasEnoughCredits ? 'Generate Ad Creative' : 'Not enough credits'}>
                      <Send className="h-4 w-4 text-current xl:h-5 xl:w-5" />
                    </ShadcnTooltip>
                  </button>
                ) : (
                  <button
                    id="tour_creative_prompt_by_mic"
                    className="absolute top-4 right-12 flex h-[27px] w-[27px] items-center justify-center rounded-full bg-zinc-900 text-white sm:static 2xl:h-9 2xl:w-9 dark:bg-white dark:text-black"
                  >
                    <SpeechToText />
                  </button>
                )}

                {/* <button
                  id="tour_creative_prompt_by_mic"
                  className="absolute top-[30px] right-5 flex h-[27px] w-[27px] items-center justify-center rounded-full bg-white sm:static 2xl:h-9 2xl:w-9"
                >
                  {prompt && !isListening ? (
                    <ShadcnTooltip label="Generate Ad Copy">
                      <Send
                        className="h-4 w-4 text-black xl:h-5 xl:w-5"
                        onClick={handleRequestSubmit}
                      />
                    </ShadcnTooltip>
                  ) : (
                    <SpeechToText />
                  )}
                </button> */}
              </div>
            </div>
          )}

          {activeAdStudioTabId === 'adVideo' && (
            <div className="filter_container flex w-full flex-wrap items-center justify-between gap-2">
              <div className="left_side_filter_advideo flex items-center gap-1 2xl:gap-1.5">
                <button
                  disabled={uploadImageExists}
                  className={`rounded-full bg-gradient-to-br from-[#202020]/50 to-[#202020]/50 ${!uploadImageExists ? 'hover:from-[#222222] hover:to-[#5771F6]/20' : 'cursor-not-allowed opacity-60'}`}
                >
                  <label
                    htmlFor="choose_from_device"
                    className={`prompt_selection_button_no_gradient flex items-center gap-1 rounded-full px-2 py-[5px] pr-3 backdrop-blur-[100px] transition-all 2xl:gap-1.5 2xl:px-3 2xl:py-[7px] 2xl:pr-4 ${!uploadImageExists ? 'cursor-pointer' : ''}`}
                  >
                    {isImageUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white 2xl:h-4 2xl:w-4" />
                    ) : (
                      <Plus className="h-3 w-3 text-[#6b72f8] 2xl:h-4 2xl:w-4" />
                    )}
                    <span className="2xl:text-13 bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-[9px] font-medium text-transparent">
                      Upload Product Image
                    </span>
                  </label>
                  <input
                    id="choose_from_device"
                    className="hidden"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    disabled={uploadImageExists}
                  />
                </button>
                <CommonDropdown
                  options={videoChatModels}
                  label="AI Model"
                  icon={SparkleDark}
                  onChange={handleVideoModelChange}
                  value={videoChatModels.find((s) => s.value === video_model)}
                />
                {/* <ShadcnTooltip label={`Aspect Ratio`}> */}
                <div>
                  <CommonDropdown
                    options={videoRatios}
                    label="Aspect Ratio"
                    icon={RatioDark}
                    onChange={handleVideoRatioChange}
                    value={videoRatios.find((s) => s.value === video_aspect_ratio)}
                  />
                </div>
                {/* </ShadcnTooltip> */}
                {/* <ShadcnTooltip label={`Variations`}> */}
                <div>
                  <CommonDropdown
                    options={videoShapes}
                    label="Variations"
                    icon={ShapeDark}
                    onChange={handleVariantsChange}
                    value={videoShapes.find((s) => s.value === no_of_ads)}
                  />
                </div>
                {/* </ShadcnTooltip> */}
                {/* <ShadcnTooltip label={`Durations`}> */}
                <div>
                  <CommonDropdown
                    options={videoTimer}
                    label="Durations"
                    icon={TimerDarkLogo}
                    onChange={handleVideoTimerChange}
                    value={videoTimer.find((s) => s.value === video_duration)}
                  />
                </div>
                {/* </ShadcnTooltip> */}
              </div>
              <div className="left_side_filter_advideo flex items-center gap-2">
                {/* <ShadcnTooltip label={`Choose Video Preference`}> */}
                <div id="video_type_preference">
                  <VideoTypePreference />
                </div>
                {/* </ShadcnTooltip> */}
                {/* <div className="rounded-full bg-gradient-to-br from-white/10 via-white to-white/10 p-[1px]">
                <button className="mic_button flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#222222] to-[#5771F6] 2xl:h-8 2xl:w-8">
                  <Send className="h-3.5 w-3.5 text-[#AFAFAF]" />
                </button>
              </div> */}

                {creditEstimate && (
                  <ShadcnTooltip
                    label={
                      hasEnoughCredits
                        ? `Will use : ${creditEstimate.label} , ${availableCredits - creditEstimate.estimated} left after`
                        : `Not enough credits — need ${creditEstimate.estimated}, you have ${availableCredits}`
                    }
                  >
                    <span
                      className={`cursor-default rounded-full px-2 py-0.5 text-10 font-medium 2xl:text-xs ${hasEnoughCredits ? 'bg-zinc-200 text-zinc-700 dark:bg-white/20 dark:text-white/90' : 'bg-red-500 text-white'}`}
                    >
                      {creditEstimate.label}
                    </span>
                  </ShadcnTooltip>
                )}
                {prompt && !isListening ? (
                  <button
                    // id="tour_video_prompt_by_mic"
                    disabled={!hasEnoughCredits}
                    className={`flex h-6.75 w-6.75 items-center justify-center rounded-full 2xl:h-9 2xl:w-9 ${hasEnoughCredits ? 'bg-zinc-900 text-white dark:bg-white dark:text-black' : 'cursor-not-allowed bg-zinc-300 text-zinc-500 dark:bg-white/30 dark:text-white/50'}`}
                    onClick={handleRequestSubmit}
                  >
                    <ShadcnTooltip label={hasEnoughCredits ? 'Generate Ad Video' : 'Not enough credits'}>
                      <Send className="h-4 w-4 text-current xl:h-5 xl:w-5" />
                    </ShadcnTooltip>
                  </button>
                ) : (
                  <button
                    id="tour_video_prompt_by_mic"
                    className="flex h-6.75 w-6.75 items-center justify-center rounded-full bg-zinc-900 text-white 2xl:h-9 2xl:w-9 dark:bg-white dark:text-black"
                  >
                    <SpeechToText />
                  </button>
                )}

                {/* <button
                  id="tour_video_prompt_by_mic"
                  className="flex h-[27px] w-[27px] items-center justify-center rounded-full bg-white 2xl:h-9 2xl:w-9"
                >
                  {prompt && !isListening ? (
                    <ShadcnTooltip label="Generate Ad Copy">
                      <Send className="h-5 w-5 text-black" onClick={handleRequestSubmit} />
                    </ShadcnTooltip>
                  ) : (
                    <SpeechToText />
                  )}
                </button> */}
              </div>
            </div>
          )}

            {/* image upload show here */}
            </div>
          </BorderGlow>
        </div>
        {uploadedImages.length > 0 &&
          !isEditorOpen &&
          (activeAdStudioTabId === 'adCreative' || activeAdStudioTabId === 'adVideo') && (
            <div className="image_show_container absolute -top-16 left-4 flex gap-2 2xl:-top-[5rem] 2xl:left-3">
              {uploadedImages.map(({ id, url, type }) => (
                <div
                  key={id}
                  className="individual_image relative h-24 w-20 -rotate-3 2xl:h-[7.5rem] 2xl:w-24"
                >
                  <div className="animated-border h-full w-full">
                    <img
                      className="h-full w-full cursor-pointer rounded-[15px] object-cover shadow-md"
                      src={type === 'uploaded' ? `${S3_BASE_URL}${url}` : url}
                      alt="Uploaded image"
                      onClick={() =>
                        setLightboxOpen(type === 'uploaded' ? `${S3_BASE_URL}${url}` : url)
                      }
                    />
                  </div>

                  <button
                    className="absolute top-1 right-1 rounded-full bg-black/40 p-1 hover:bg-black/60"
                    onClick={() => handleRemoveImage(id)}
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              ))}

              {/* to add other image */}
              {/* <div className="individual_image backdrop-blur-100 relative top-4 ml-1.5 flex h-[6.5rem] w-[5.25rem] rotate-3 cursor-pointer items-center rounded-lg border border-white/5 bg-[#6D6D6D]/43 p-4 transition-all duration-200 hover:scale-[1.01] hover:bg-[#6D6D6D]/60">
                <div className="flex flex-col justify-center gap-4">
                  <Plus className="h-5" />
                  <div className="TEXT flex flex-col text-xs leading-4">
                    <span>END</span>
                    <span>FRAME</span>
                  </div>
                </div>
              </div> */}
            </div>
          )}
      </div>
      {lightboxOpen && (
        <ShowLightBox lightboxImage={lightboxOpen} closeLightbox={closeNormalLightbox} />
      )}
    </>
  );
};

export default AdPromptComponent;
