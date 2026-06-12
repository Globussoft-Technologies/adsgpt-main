import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  LinkIcon,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  X,
  Loader2,
  Mic,
  Square as StopIcon,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { RiGeminiFill } from 'react-icons/ri';
import KlingIcon from '@/components/icons/KlingIcon';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import BrandSearch from '@/components/AdFactory/BrandsDropDown/BrandSelect';
import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import UpgradeModal from '../.././../UpgradeModal';
import { setFields } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import {
  generateCloneImageAndScript,
  uploadVoice,
} from '@/store/actions/adVideoNew/Advideoactions';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';
import { uploadToS3 } from '@/utils/imageUpload';
import { globalToast } from '@/utils/globalToast';
import { toast } from 'react-toastify';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;

const AIAvatarCommonDropdown = ({ options = [], placeholder = '', value = '', onChange }) => {
  const Icon = value?.Icon;
  const triggerLabel = value?.label?.replace(/\s*\(.*?\)\s*$/, '') || placeholder;

  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className="prompt_selection_button_no_gradient group relative flex items-center gap-0 rounded-full py-4 text-xs shadow-none transition-all duration-200 ease-in [&_svg]:text-current! 2xl:py-5 2xl:text-sm dark:border-none dark:bg-[#2B2A2A80] dark:text-[#AFAFAF] [&>svg]:size-5"
      >
        <div className="flex items-center gap-1 pr-1 capitalize">
          {Icon ? Icon : <></>}
          <span className="ml-1 font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {triggerLabel}
          </span>
        </div>
      </SelectTrigger>
      <SelectContent className="z-[999999] min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <div className="flex flex-col">
          {options.map(({ value: optionValue, Icon, label, credit, tier }) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className={`group cursor-pointer text-xs 2xl:text-sm hover:bg-zinc-100 dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                value?.value === optionValue ? 'bg-zinc-100 dark:bg-[#0D0D0D]/50' : 'bg-transparent'
              }`}
            >
              {Icon}
              <div className="flex w-full items-center justify-between">
                {credit ? (
                  <ShadcnTooltip label={`${credit}`} side="right" className="z-[1000000]">
                    <span className="text-inherit">{label}</span>
                  </ShadcnTooltip>
                ) : (
                  <span className="text-inherit">{label}</span>
                )}
                {tier === 'premium' && (
                  <span className="mr-5 ml-1.5 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 px-1.5 py-0.5 text-[8px] font-semibold 2xl:text-[10px]">
                    <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                      ★ Premium
                    </span>
                  </span>
                )}
                <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    value?.value === optionValue
                      ? 'border-[#575757] dark:bg-[#575757]'
                      : 'border-[#AFAFAF]'
                  }`}
                >
                  {value?.value === optionValue && (
                    <div className="h-[6px] w-[6px] rounded-full bg-gray-900 dark:bg-white" />
                  )}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
};

const ConfigStep = ({ customAvatarImages = [], onBack, onGenerate, recreateData }) => {
  const dispatch = useDispatch();
  const { modelCredits } = useSelector((state) => state.prompt);
  const { brand_name } = useSelector((state) => state.adFactoryNew);
  const { userData, credits } = useSelector((state) => state.socket);
  const { isLoading } = useSelector((state) => state.adVideoNew);
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);

  const [productUrl, setProductUrl] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [promotion, setPromotion] = useState(() =>
    recreateData?.promotion || ''
  );
  const [notes, setNotes] = useState(() =>
    recreateData?.notes || recreateData?.additionalNotes || recreateData?.additional_notes || ''
  );
  const [uploadedImages, setUploadedImages] = useState([]);
  const [imageOrientation, setImageOrientation] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [isUploading, setIsUploading] = useState(false);

  // Voice state
  const [voiceMode, setVoiceMode] = useState('upload'); // 'upload' | 'record'
  const [voiceFile, setVoiceFile] = useState(null);      // uploaded file
  const [recordedBlob, setRecordedBlob] = useState(null); // recorded blob
  const [recordedUrl, setRecordedUrl] = useState(null);   // object URL for playback
  const [recorderState, setRecorderState] = useState('idle'); // 'idle'|'recording'|'paused'|'stopped'
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [uploadFileUrl, setUploadFileUrl] = useState(null); // object URL or remote URL for uploaded file playback
  const [prefillVoiceName, setPrefillVoiceName] = useState(null); // display name when voice prefilled from recreate
  const [uploadIsPlaying, setUploadIsPlaying] = useState(false);
  const [uploadCurrentTime, setUploadCurrentTime] = useState(0);
  const [uploadDuration, setUploadDuration] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const uploadAudioRef = useRef(null);

  const videoChatModels = useMemo(
    () => [
      {
        value: 'veo-3.1-fast',
        label: 'Veo 3.1 Fast (Fast & Social-Ready)',
        tier: 'lower',
        Icon: <RiGeminiFill className="!h-3 !w-3 2xl:!h-4 2xl:!w-4" />,
        credit: modelCredits?.videoModels?.find((m) =>
          m.label.toLowerCase().includes('veo 3.1 fast')
        )?.value,
      },
      // {
      //   value: 'veo',
      //   label: 'Veo 3 (Cinematic Quality)',
      //   tier: 'premium',
      //   Icon: <RiGeminiFill className="!h-3 !w-3 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 3')?.value,
      // },
      // {
      //   value: 'veo_4k',
      //   label: 'Veo 4K (Cinematic 4K Quality)',
      //   tier: 'premium',
      //   Icon: <RiGeminiFill className="!h-3 !w-3 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'veo 4k')?.value,
      // },
      // {
      //   value: 'kling_3.0',
      //   label: 'Kling 3.0',
      //   tier: 'premium',
      //   Icon: <KlingIcon className="!h-3 !w-3 2xl:!h-4 2xl:!w-4" />,
      //   credit: modelCredits?.videoModels?.find((m) => m.label.toLowerCase() === 'kling 3.0')
      //     ?.value,
      // },
    ],
    [modelCredits]
  );

  const videoTimer = useMemo(() => {
    const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
    if (videoModel === 'veo_4k' || videoModel === 'veo-3.1-fast') return [{ value: '8s', label: '8s' }];
    if (videoModel === 'veo' ) {
      return [{ value: '8s', label: '8s' }, { value: '15s', label: '15s' }];
    }
    if (videoModel === 'kling_3.0') {
      return [{ value: '8s', label: '8s' }, { value: '12s', label: '12s' }];
    }
    const opts = [
      { value: '8s', label: '8s' },
      { value: '12s', label: '12s' },
      { value: '16s', label: '16s' },
      { value: '20s', label: '20s' },
    ];
    return hasPlan8 ? opts.slice(0, 1) : opts;
  }, [videoModel, userData]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  useEffect(() => {
    if (videoTimer.length > 0) setVideoDuration(videoTimer[0].value);
  }, [videoModel]);

  useEffect(() => {
    if (videoModel !== 'kling_3.0' && aspectRatio === '1:1') setAspectRatio('16:9');
    if (videoModel === 'kling_3.0' && imageOrientation) {
      if (imageOrientation === 'portrait' && aspectRatio !== '9:16') setAspectRatio('9:16');
      else if (imageOrientation === 'landscape' && aspectRatio !== '16:9') setAspectRatio('16:9');
      else if (imageOrientation === 'square' && aspectRatio !== '1:1') setAspectRatio('1:1');
    }
  }, [videoModel, imageOrientation]);

  useEffect(() => {
    const rawUrl = uploadedImages.length > 0 ? uploadedImages[0].preview : productUrl.trim();
    if (rawUrl) {
      const img = new Image();
      img.src = rawUrl;
      img.onload = () => {
        if (img.height > img.width) setImageOrientation('portrait');
        else if (img.width > img.height) setImageOrientation('landscape');
        else setImageOrientation('square');
      };
    } else {
      setImageOrientation(null);
    }
  }, [uploadedImages, productUrl]);

  useEffect(() => {
    if ((productUrl || uploadedImages.length > 0) && errors.productUrl)
      setErrors((p) => ({ ...p, productUrl: null }));
    if (videoModel && errors.videoModel) setErrors((p) => ({ ...p, videoModel: null }));
    if (videoDuration && errors.videoDuration) setErrors((p) => ({ ...p, videoDuration: null }));
    if (aspectRatio && errors.aspectRatio) setErrors((p) => ({ ...p, aspectRatio: null }));
    if (brand_name && errors.brandName) setErrors((p) => ({ ...p, brandName: null }));
    if ((voiceFile || recordedBlob || uploadFileUrl) && errors.voice) setErrors((p) => ({ ...p, voice: null }));
  }, [productUrl, uploadedImages, videoModel, videoDuration, aspectRatio, brand_name, voiceFile, recordedBlob, uploadFileUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!recreateData) return;
    if (recreateData.model && videoChatModels.some((m) => m.value === recreateData.model))
      setVideoModel(recreateData.model);
    if (recreateData.duration) setVideoDuration(recreateData.duration);
    if (recreateData.aspectRatio) setAspectRatio(recreateData.aspectRatio);
    const s3Base = import.meta.env.VITE_S3_BASE_URL || '';
    const rawImg =
      recreateData.image || recreateData.imageUrl || recreateData.productUrl || recreateData.productImage || '';
    if (rawImg) {
      setUploadedImages([{ file: null, preview: rawImg.startsWith('http') ? rawImg : s3Base + rawImg }]);
    }
    if (recreateData.promotion) setPromotion(recreateData.promotion);
    const notesValue = recreateData.notes || recreateData.additionalNotes || recreateData.additional_notes || '';
    if (notesValue) setNotes(notesValue);
    if (recreateData.productName) dispatch(setFields({ brand_name: recreateData.productName }));
    if (recreateData.voiceSampleUrl) {
      setUploadFileUrl(recreateData.voiceSampleUrl);
      setPrefillVoiceName(recreateData.voiceSampleUrl.split('/').pop());
      setUploadIsPlaying(false);
      setUploadCurrentTime(0);
      setUploadDuration(0);
    }
  }, [recreateData, dispatch]);

  // ── Voice recorder helpers ─────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedUrl(url);
        setRecorderState('stopped');
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecorderState('recording');
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      toast.error('Microphone access denied');
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setRecorderState('paused');
      clearInterval(timerRef.current);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setRecorderState('recording');
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    clearInterval(timerRef.current);
  }, []);

  const discardRecording = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecorderState('idle');
    setRecordingTime(0);
  }, [recordedUrl]);

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // Switch mode → clear the other side
  const switchVoiceMode = (mode) => {
    setVoiceMode(mode);
    if (mode === 'upload') discardRecording();
    else setVoiceFile(null);
  };
  // ──────────────────────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) { setUploadedImages([{ file, preview: URL.createObjectURL(file) }]); return; }
      }
    }
    const pastedText = e.clipboardData.getData('text');
    if (pastedText?.startsWith('http')) {
      const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
      if (!imageExtensions.test(pastedText)) { toast.error('Please paste a valid image URL'); return; }
      setProductUrl(pastedText);
      setUploadedImages([{ file: null, preview: pastedText }]);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadedImages([{ file, preview: URL.createObjectURL(file) }]);
  };

  const removeImage = (index) => setUploadedImages((prev) => prev.filter((_, i) => i !== index));

  const handleGenerateClick = async () => {
    if (isLoading || isUploading) return;
    const newErrors = {};
    if (!productUrl.trim() && uploadedImages.length === 0) newErrors.productUrl = 'Product Image is Required';
    if (!videoModel) newErrors.videoModel = 'Model is required';
    if (!videoDuration) newErrors.videoDuration = 'Duration is required';
    if (!aspectRatio) newErrors.aspectRatio = 'Aspect ratio is required';
    if (!brand_name) newErrors.brandName = 'Brand name is required';
    if (!voiceFile && !recordedBlob && !uploadFileUrl) newErrors.voice = 'Voice is required';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    try {
      setIsUploading(true);
      const userId = userData?.user_id;
      let imageUrl = '';
      const rawUrl = uploadedImages.length > 0 ? uploadedImages[0].preview : productUrl.trim();
      const rawFile = uploadedImages.length > 0 ? uploadedImages[0].file : null;

      if (rawFile) {
        const uploadedUrl = await uploadToS3(rawFile, userId, true);
        globalToast.dismiss();
        if (uploadedUrl) imageUrl = `${import.meta.env.VITE_S3_BASE_URL}${uploadedUrl}`;
        else { globalToast.error('Image upload failed'); setIsUploading(false); return; }
      } else if (rawUrl && !rawUrl.startsWith('blob:')) {
        globalToast.loading('Uploading image...');
        const res = await fetch(rawUrl);
        const blob = await res.blob();
        const urlFile = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
        const uploadedUrl = await uploadToS3(urlFile, userId, true);
        globalToast.dismiss();
        if (uploadedUrl) imageUrl = `${import.meta.env.VITE_S3_BASE_URL}${uploadedUrl}`;
        else { globalToast.error('Image upload failed'); setIsUploading(false); return; }
      }

      if (!imageUrl) { globalToast.error('Please provide a product image or URL'); setIsUploading(false); return; }

      // Upload custom face-angle images to S3
      let uploadedAvatars = [];
      if (customAvatarImages.length > 0) {
        const uploadPromises = customAvatarImages.map(async (img) => {
          if (img.file) {
            const s3Path = await uploadToS3(img.file, userId, true);
            return s3Path ? `${import.meta.env.VITE_S3_BASE_URL}${s3Path}` : null;
          }
          if (img.preview?.startsWith('http')) return img.preview;
          if (img.preview) {
            const blob = await fetch(img.preview).then((r) => r.blob());
            const file = new File([blob], `clone-${Date.now()}.jpg`, { type: 'image/jpeg' });
            const s3Path = await uploadToS3(file, userId, true);
            return s3Path ? `${import.meta.env.VITE_S3_BASE_URL}${s3Path}` : null;
          }
          return null;
        });
        uploadedAvatars = (await Promise.all(uploadPromises)).filter(Boolean);
        if (uploadedAvatars.length !== customAvatarImages.length) {
          globalToast.error('Some face angle images failed to upload');
          setIsUploading(false);
          return;
        }
      }

      // Upload voice (file or recorded blob) to /video/upload-voice
      let voicePath = '';
      const voiceSource = voiceMode === 'upload' ? voiceFile : recordedBlob;
      if (voiceSource) {
        globalToast.loading('Uploading voice...');
        const voiceFileToUpload =
          voiceSource instanceof Blob && !(voiceSource instanceof File)
            ? new File([voiceSource], `voice-${Date.now()}.webm`, { type: voiceSource.type || 'audio/webm' })
            : voiceSource;
        const path = await dispatch(uploadVoice(voiceFileToUpload, userId));
        globalToast.dismiss();
        if (!path) {
          globalToast.error('Voice upload failed');
          setIsUploading(false);
          return;
        }
        voicePath = path;
      }

      const payload = {
        inputs: {
          type: 'clone',
          uploadedAvatars,
          image: imageUrl,
          productName: brand_name || '',
          promotion: promotion || '',
          notes: notes || '',
          duration: videoDuration,
          aspectRatio,
          tone: 'Casual',
          model: videoModel,
          numberOfVideos: 1,
          ...(voicePath
            ? { voiceSampleUrl: voicePath.startsWith('http') ? voicePath : `${import.meta.env.VITE_S3_BASE_URL}${voicePath}` }
            : uploadFileUrl
              ? { voiceSampleUrl: uploadFileUrl }
              : {}),
        },
      };

      const response = await dispatch(generateCloneImageAndScript(payload));
      const id = response?.data?._id || response?.sessionId || response?._id;
      if (id) onGenerate(id);
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const availableRatios = [
    { value: '9:16', label: '9:16', icon: RectangleVertical },
    { value: '1:1', label: '1:1', icon: Square, onlyModels: ['kling_3.0'] },
    { value: '16:9', label: '16:9', icon: RectangleHorizontal },
  ];

  const est = estimateAdVideoCredits({ video_model: videoModel, video_duration: videoDuration, no_of_ads: 1, modelCredits });
  const enough = availableCredits >= est;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-3xl border border-black/10 bg-white sm:grid-cols-2 dark:border-[#3a3a3a] dark:bg-[#1c1c1c]">
      {/* Left: face-angle carousel */}
      <div className="relative h-full min-h-[350px] w-full bg-gray-100 dark:bg-[#1c1c1c]">
        <button
          onClick={onBack}
          disabled={isUploading || isLoading}
          className={`absolute top-6 left-6 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 ${isUploading || isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {customAvatarImages.length > 0 ? (
          <>
            <img
              src={customAvatarImages[carouselIndex]?.preview}
              alt={`Face angle ${carouselIndex + 1}`}
              className="h-full w-full object-cover"
            />
            {customAvatarImages.length > 1 && (
              <>
                <button
                  onClick={() =>
                    setCarouselIndex((p) => (p - 1 + customAvatarImages.length) % customAvatarImages.length)
                  }
                  className="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setCarouselIndex((p) => (p + 1) % customAvatarImages.length)}
                  className="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-black p-2 text-white hover:bg-black/70"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 gap-2">
                  {customAvatarImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCarouselIndex(i)}
                      className={`h-2 w-2 rounded-full transition-all ${i === carouselIndex ? 'scale-125 bg-white' : 'bg-white/40'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-white/40">
            No face images uploaded
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
      </div>

      {/* Right: form */}
      <div className="custom-scrollbar flex flex-col gap-6 overflow-y-auto p-6 pb-10 2xl:px-6 2xl:py-8 2xl:pb-15">
        {/* Product image */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">
            <span className="flex w-fit items-center gap-1 rounded-full border border-[#6b72f8]/60 bg-gray-900 px-2.5 py-0.5 text-10 font-medium text-white 2xl:text-xs dark:bg-white dark:text-black">
              🌐 All regional languages supported
            </span>
            <br />
            Brand/product URL or upload image
          </label>
          <div
            className={`flex items-center gap-2 rounded-full border bg-gray-100 p-1 transition-colors dark:bg-[#9092941A] ${
              errors.productUrl ? 'border-red-500/50' : 'border-transparent'
            }`}
          >
            <input
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              onPaste={handlePaste}
              disabled={isUploading || isLoading}
              className="w-full flex-1 bg-transparent px-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-500 focus:outline-none disabled:cursor-not-allowed 2xl:px-4 2xl:text-sm dark:text-white dark:placeholder:text-white/40"
              placeholder="Paste your product image"
            />
            <LinkIcon className="size-3.5 rotate-90 text-gray-500 dark:text-white/60" />
            <label
              htmlFor="clone-config-product-img"
              className="flex cursor-pointer items-center gap-1.5 rounded-full bg-zinc-200 px-2 py-1.5 text-[10px] whitespace-nowrap text-zinc-800 hover:bg-zinc-300 2xl:text-xs dark:bg-[#FFFFFF]/20 dark:text-white dark:hover:bg-white/10"
            >
              <CloudUpload className="size-3.5 text-zinc-800 dark:text-white" />
              Upload Image
            </label>
            <input
              id="clone-config-product-img"
              type="file"
              className="hidden"
              accept="image/*"
              disabled={isUploading || isLoading}
              onChange={handleImageUpload}
            />
          </div>
          {errors.productUrl && <span className="mt-1 text-[12px] text-red-400">{errors.productUrl}</span>}
          {uploadedImages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 2xl:gap-3">
              {uploadedImages.map((img, index) => (
                <div key={index} className="group relative h-12 w-12 border border-black/10 2xl:h-16 2xl:w-16 dark:border-white/10">
                  <img
                    src={img.preview}
                    alt="upload"
                    className="h-full w-full cursor-pointer rounded-md object-cover"
                    onClick={() => {
                      setLightboxImages(uploadedImages.map((i) => i.preview));
                      setLightboxImage(img.preview);
                      setLightboxOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    disabled={isUploading || isLoading}
                    className="absolute -top-2 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md duration-300 group-hover:opacity-100 disabled:cursor-not-allowed"
                    onClick={() => removeImage(index)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <AnimatePresence>
          {lightboxOpen && (
            <ShowLightBox
              lightboxImage={lightboxImage}
              closeLightbox={() => setLightboxOpen(false)}
              images={lightboxImages}
            />
          )}
        </AnimatePresence>

        {/* Model + Duration */}
        <div className="flex gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Model*</label>
            <AIAvatarCommonDropdown
              options={videoChatModels}
              placeholder="Choose Model"
              value={videoChatModels.find((m) => m.value === videoModel)}
              disabled={isUploading || isLoading}
              onChange={(val) => {
                if (isUploading || isLoading) return;
                const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
                if (hasPlan8 && val !== 'veo-3.1-fast') { setIsUpgradeModalOpen(true); return; }
                setVideoModel(val);
              }}
            />
            {errors.videoModel && <span className="mt-1 text-[12px] text-red-400">{errors.videoModel}</span>}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Duration*</label>
            <AIAvatarCommonDropdown
              options={videoTimer}
              value={videoTimer.find((m) => m.value === videoDuration)}
              disabled={isUploading || isLoading}
              onChange={(val) => { if (!isUploading && !isLoading) setVideoDuration(val); }}
            />
            {errors.videoDuration && <span className="mt-1 text-[12px] text-red-400">{errors.videoDuration}</span>}
          </div>
        </div>

        {/* Aspect ratio */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Aspect Ratio*</label>
          <div className="flex flex-wrap gap-3">
            {availableRatios
              .filter((r) => !r.onlyModels || r.onlyModels.includes(videoModel))
              .map((ratio) => {
                const isSelected = aspectRatio === ratio.value;
                const isKling = videoModel === 'kling_3.0';
                let isDisabled = false;
                if (isKling && imageOrientation) {
                  if (imageOrientation === 'portrait' && ratio.value !== '9:16') isDisabled = true;
                  if (imageOrientation === 'landscape' && ratio.value !== '16:9') isDisabled = true;
                  if (imageOrientation === 'square' && ratio.value !== '1:1') isDisabled = true;
                }
                return (
                  <button
                    key={ratio.value}
                    disabled={isDisabled || isUploading || isLoading}
                    onClick={() => { if (!isDisabled && !isUploading && !isLoading) setAspectRatio(ratio.value); }}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs transition-all ${
                      isSelected
                        ? 'border border-blue-500 bg-blue-500/10 text-gray-900 dark:text-white'
                        : isDisabled
                          ? 'cursor-not-allowed border border-transparent bg-gray-100 text-gray-400 opacity-40 grayscale dark:bg-[#38383840] dark:text-white/20'
                          : errors.aspectRatio ? 'border border-red-500/50 bg-gray-100 text-gray-500 dark:bg-[#38383880] dark:text-white/40'
                          : 'border border-transparent bg-gray-100 text-gray-500 hover:border-black/20 dark:bg-[#38383880] dark:text-white/40 dark:hover:border-white/20'
                    }`}
                  >
                    <ratio.icon className="h-4 w-4" />
                    {ratio.label}
                  </button>
                );
              })}
          </div>
          {errors.aspectRatio && <span className="mt-1 text-[12px] text-red-400">{errors.aspectRatio}</span>}
        </div>

        {/* Brand name */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Brand/product Name*</label>
          <BrandSearch isAvatarAdsSearch={true} />
          {errors.brandName && <span className="mt-1 text-[12px] text-red-400">{errors.brandName}</span>}
        </div>

        {/* Promotional info */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Promotional Info</label>
          <input
            value={promotion}
            onChange={(e) => setPromotion(e.target.value)}
            disabled={isUploading || isLoading}
            className="w-full rounded-full bg-gray-100 p-3 px-4 text-xs text-gray-900 placeholder:text-gray-500 focus:outline-none disabled:cursor-not-allowed 2xl:text-base dark:bg-[#9092941A] dark:text-white dark:placeholder:text-[#AFAFAF]"
            placeholder="Enter your promotional info"
          />
        </div>

        {/* Voice */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Voice*</label>

          {/* Toggle tabs */}
          <div className="flex w-fit rounded-full bg-gray-100 p-0.5 dark:bg-[#2B2A2A]">
            {['upload', 'record'].map((mode) => (
              <button
                key={mode}
                disabled={isUploading || isLoading}
                onClick={() => switchVoiceMode(mode)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-all ${
                  voiceMode === mode
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3a3a3a] dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-white/40 dark:hover:text-white/70'
                }`}
              >
                {mode === 'upload' ? 'Upload File' : 'Record Voice'}
              </button>
            ))}
          </div>

          {/* Upload mode */}
          {voiceMode === 'upload' && (
            <div className="flex flex-col gap-2">
              {(voiceFile || uploadFileUrl) ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-gray-100 p-4 dark:bg-[#2B2A2A]">
                  {/* hidden audio element */}
                  <audio
                    ref={uploadAudioRef}
                    src={uploadFileUrl}
                    className="hidden"
                    onPlay={() => setUploadIsPlaying(true)}
                    onPause={() => setUploadIsPlaying(false)}
                    onEnded={() => { setUploadIsPlaying(false); setUploadCurrentTime(0); if (uploadAudioRef.current) uploadAudioRef.current.currentTime = 0; }}
                    onLoadedMetadata={() => setUploadDuration(uploadAudioRef.current?.duration || 0)}
                    onTimeUpdate={() => setUploadCurrentTime(uploadAudioRef.current?.currentTime || 0)}
                  />
                  {/* filename + remove */}
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 shrink-0 text-blue-400" />
                    <span className="flex-1 truncate text-xs text-gray-700 dark:text-white/80">{voiceFile?.name || prefillVoiceName}</span>
                    <button
                      disabled={isUploading || isLoading}
                      onClick={() => { setVoiceFile(null); setUploadFileUrl(null); setPrefillVoiceName(null); setUploadIsPlaying(false); setUploadCurrentTime(0); setUploadDuration(0); }}
                      className="text-gray-400 hover:text-red-400 disabled:cursor-not-allowed"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {/* controls */}
                  <div className="flex items-center gap-2">
                    <button
                      disabled={isUploading || isLoading}
                      onClick={() => {
                        if (!uploadAudioRef.current) return;
                        if (uploadIsPlaying) uploadAudioRef.current.pause();
                        else uploadAudioRef.current.play();
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploadIsPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {uploadIsPlaying ? 'Pause' : 'Play'}
                    </button>
                  </div>
                  {/* seek bar + time */}
                  <div className="flex flex-col gap-1">
                    <input
                      type="range"
                      min={0}
                      max={uploadDuration || 0}
                      step={0.1}
                      value={uploadCurrentTime}
                      onChange={(e) => {
                        const t = parseFloat(e.target.value);
                        if (uploadAudioRef.current) uploadAudioRef.current.currentTime = t;
                        setUploadCurrentTime(t);
                      }}
                      className="h-1 w-full cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between text-10 text-gray-400 dark:text-white/40">
                      <span>{formatTime(Math.floor(uploadCurrentTime))}</span>
                      <span>{uploadDuration ? formatTime(Math.floor(uploadDuration)) : '--:--'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="clone-voice-upload"
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-dashed border-gray-300 bg-gray-50 px-4 py-2.5 text-xs text-gray-500 transition hover:border-blue-400 hover:text-blue-400 dark:border-white/20 dark:bg-[#2B2A2A] dark:text-white/40 dark:hover:border-blue-400 dark:hover:text-blue-400"
                >
                  <CloudUpload className="h-4 w-4" />
                  Upload voice file (.mp3, .aac, .wav, .m4a, .ogg)
                </label>
              )}
              <input
                id="clone-voice-upload"
                type="file"
                className="hidden"
                accept=".mp3,.aac,.wav,.m4a,.ogg,audio/*"
                disabled={isUploading || isLoading}
                onClick={(e) => { e.target.value = null; }}
                onChange={(e) => {
                  const f = e.target.files[0];
                  if (!f) return;
                  if (uploadFileUrl) URL.revokeObjectURL(uploadFileUrl);
                  setVoiceFile(f);
                  setUploadFileUrl(URL.createObjectURL(f));
                  setUploadIsPlaying(false);
                  setUploadCurrentTime(0);
                  setUploadDuration(0);
                }}
              />
            </div>
          )}

          {/* Record mode */}
          {voiceMode === 'record' && (
            <div className="flex flex-col gap-3 rounded-2xl bg-gray-100 p-4 dark:bg-[#2B2A2A]">
              {/* Timer */}
              <div className="flex items-center gap-2">
                {recorderState === 'recording' && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                )}
                <span className="font-mono text-sm font-medium text-gray-700 dark:text-white/80">
                  {formatTime(recordingTime)}
                </span>
                {recorderState === 'recording' && (
                  <span className="text-xs text-red-400">Recording...</span>
                )}
                {recorderState === 'paused' && (
                  <span className="text-xs text-yellow-400">Paused</span>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                {recorderState === 'idle' && (
                  <button
                    onClick={startRecording}
                    disabled={isUploading || isLoading}
                    className="flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Start
                  </button>
                )}
                {(recorderState === 'recording' || recorderState === 'paused') && (
                  <>
                    {recorderState === 'recording' ? (
                      <button
                        onClick={pauseRecording}
                        disabled={isUploading || isLoading}
                        className="flex items-center gap-1.5 rounded-full bg-yellow-500 px-3 py-2 text-xs font-semibold text-white hover:bg-yellow-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={resumeRecording}
                        disabled={isUploading || isLoading}
                        className="flex items-center gap-1.5 rounded-full bg-green-500 px-3 py-2 text-xs font-semibold text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )}
                    <button
                      onClick={stopRecording}
                      disabled={isUploading || isLoading}
                      className="flex items-center gap-1.5 rounded-full bg-gray-700 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600"
                    >
                      <StopIcon className="h-3.5 w-3.5" />
                      Stop
                    </button>
                  </>
                )}
                {recorderState === 'stopped' && recordedUrl && (
                  <>
                    {/* hidden audio element — events drive state */}
                    <audio
                      ref={audioRef}
                      src={recordedUrl}
                      className="hidden"
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => { setIsPlaying(false); setAudioCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
                      onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || 0)}
                      onTimeUpdate={() => setAudioCurrentTime(audioRef.current?.currentTime || 0)}
                    />
                    <button
                      disabled={isUploading || isLoading}
                      onClick={() => {
                        if (!audioRef.current) return;
                        if (isPlaying) audioRef.current.pause();
                        else audioRef.current.play();
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-blue-500 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      disabled={isUploading || isLoading}
                      onClick={startRecording}
                      className="flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Mic className="h-3.5 w-3.5" />
                      Re-record
                    </button>
                    <button
                      disabled={isUploading || isLoading}
                      onClick={discardRecording}
                      className="rounded-full p-2 text-gray-400 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              {recorderState === 'stopped' && recordedUrl && (
                <div className="flex flex-col gap-1">
                  {/* progress bar */}
                  <input
                    type="range"
                    min={0}
                    max={audioDuration || 0}
                    step={0.1}
                    value={audioCurrentTime}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      if (audioRef.current) audioRef.current.currentTime = t;
                      setAudioCurrentTime(t);
                    }}
                    className="h-1 w-full cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-10 text-gray-400 dark:text-white/40">
                    <span>{formatTime(Math.floor(audioCurrentTime))}</span>
                    <span>{audioDuration ? formatTime(Math.floor(audioDuration)) : '--:--'}</span>
                  </div>
                
                </div>
              )}
            </div>
          )}
          {errors.voice && <span className="mt-1 text-[12px] text-red-400">{errors.voice}</span>}
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-900 2xl:text-base dark:text-white">Additional Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isUploading || isLoading}
            className="w-full resize-none rounded-2xl bg-gray-100 p-3 text-xs text-gray-900 placeholder:text-gray-500 focus:outline-none disabled:cursor-not-allowed 2xl:text-sm dark:bg-[#9092941A] dark:text-white dark:placeholder:text-[#AFAFAF]"
            placeholder="e.g. white background, aerial drone shot, etc"
            rows={3}
          />
        </div>

        {/* Generate */}
        <div className="mt-auto mb-3 flex items-center justify-end gap-2">
          {videoModel && videoDuration && (
            enough ? (
              <ShadcnTooltip label={`Will use: ${est} credits, ${availableCredits - est} left after`}>
                <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-white/20 dark:text-white/90">
                  ~{est} credits
                </span>
              </ShadcnTooltip>
            ) : (
              <span className="rounded-full border border-red-500 bg-red-500 px-2.5 py-1 text-xs font-medium text-white">
                Not enough credits — need {est}, you have {availableCredits}
              </span>
            )
          )}
          <button
            disabled={isLoading || isUploading || !enough}
            onClick={handleGenerateClick}
            className={`rounded-full px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 2xl:py-3 2xl:text-base dark:text-black ${
              isLoading || isUploading || !enough
                ? 'cursor-not-allowed bg-gray-900/30 dark:bg-white/30'
                : 'bg-gray-900 dark:bg-white'
            }`}
          >
            {isLoading || isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-white dark:text-black" />
            ) : (
              'Generate'
            )}
          </button>
        </div>
      </div>

      <UpgradeModal
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        onUpgrade={() => { setIsUpgradeModalOpen(false); window.open(SIGNUP_URL, '_blank'); }}
      />
    </div>
  );
};

export default ConfigStep;
