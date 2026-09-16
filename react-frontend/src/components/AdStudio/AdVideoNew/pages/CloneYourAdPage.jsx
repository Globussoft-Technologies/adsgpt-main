import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import UpgradeModal from '../UpgradeModal';
import { CloudUpload, LinkIcon, Loader2, Video, X, Clock, AlertCircle, AlertTriangle, Sparkles, RotateCcw, ArrowRight, CheckCircle2, Cpu, Layers, Search, FileText, Minus, Plus } from 'lucide-react';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { getSocket } from '@/store/reducers/socket/socketSlice';
import emitter from '@/utils/eventEmitter';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { cloneAdAnalyzeAction, cloneAdGenerateAction, resolveMediaAction } from '@/store/actions/adVideoNew/Advideoactions';
import { useVideoSurfaceModelsState } from '@/utils/hooks/useVideoSurfaceModels';
import {
  AspectRatioPreview,
  getModelAspectRatios,
  getModelDurationOptions,
  getSelectedModelDuration,
} from '@/utils/videoModelCapabilities';
import { getFirstAvailableVideoModel, isVideoModelBlocked } from '@/utils/videoModelAccess';

import { uploadToS3, uploadUrlToS3, uploadVideoToS3 } from '@/utils/imageUpload';
import getCookies from '@/utils/getCookies';
import { setRecreateInputs } from '@/store/reducers/adStudio/adVideoNewSlice';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Default demo visual asset for Clone Your Ad (isolated for easy S3/CDN replacement)
const CLONE_YOUR_AD_DEMO_URL =
  'https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/4dcc2a50-47de-46a1-b7e6-d5bd378bb5d1-91841e48382ec5af.mp4';

// Helper function to extract YouTube video ID from various YouTube URL formats
const getYouTubeVideoId = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Helper function to check if URL has an image file extension
const isImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const imageRegex = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff|heic|ico)(\?.*)?$/i;
  return imageRegex.test(url.trim());
};

// Helper function to extract Instagram embed URL from Instagram Reels/Posts/TV URLs
const getInstagramEmbedUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /(?:instagram\.com|instagr\.am)\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;
  const match = url.trim().match(regExp);
  if (match && match[1]) {
    return `https://www.instagram.com/reel/${match[1]}/embed/`;
  }
  return null;
};

// Helper function to check for valid Instagram Reel/Post/TV URLs
const isInstagramUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return Boolean(getInstagramEmbedUrl(url));
};

// Helper function to extract TikTok embed URL
const getTikTokEmbedUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /tiktok\.com\/@[^/]+\/video\/(\d+)/i;
  const match = url.trim().match(regExp);
  if (match && match[1]) {
    return `https://www.tiktok.com/player/v1/${match[1]}?autoplay=1&loop=1`;
  }
  return null;
};

// Helper function to sanitize and extract single clean URL if concatenated
const extractCleanUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const urlMatches = trimmed.match(/https?:\/\/[^\s]+/gi);
  if (urlMatches && urlMatches.length > 0) {
    return urlMatches[urlMatches.length - 1].trim();
  }
  return trimmed;
};

// Dedicated YouTube player that loops continuously without replay button, end screen, or control overlays
const YouTubePreviewPlayer = ({ videoId, onDurationChange }) => {
  const containerRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!videoId) return;

    let playerInstance = null;
    let isCancelled = false;

    const createPlayer = () => {
      if (isCancelled || !containerRef.current || !window.YT || !window.YT.Player) return;

      const playerDiv = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(playerDiv);

      try {
        playerInstance = new window.YT.Player(playerDiv, {
          videoId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            showinfo: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            disablekb: 1,
            fs: 0,
            cc_load_policy: 0,
            autohide: 1,
          },
          events: {
            onReady: (event) => {
              try {
                event.target.mute();
                event.target.playVideo();
                const dur = event.target.getDuration?.();
                if (dur && typeof onDurationChange === 'function') {
                  onDurationChange(dur);
                }
              } catch (e) {
                console.warn('[YouTubePreviewPlayer] onReady warning:', e);
              }
            },
            onStateChange: (event) => {
              // event.data === 0 (YT.PlayerState.ENDED)
              if (event.data === 0) {
                try {
                  event.target.seekTo(0, true);
                  event.target.playVideo();
                } catch (e) {
                  console.warn('[YouTubePreviewPlayer] loop restart warning:', e);
                }
              }
            },
            onError: (err) => {
              console.warn('[YouTubePreviewPlayer] player warning:', err);
            },
          },
        });
        playerRef.current = playerInstance;
      } catch (err) {
        console.warn('[YouTubePreviewPlayer] init error:', err);
      }
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      if (!window._ytIframeApiLoading) {
        window._ytIframeApiLoading = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }
      }

      const existingCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof existingCallback === 'function') existingCallback();
        createPlayer();
      };

      const pollInterval = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(pollInterval);
          createPlayer();
        }
      }, 100);

      return () => {
        isCancelled = true;
        clearInterval(pollInterval);
        if (playerInstance && typeof playerInstance.destroy === 'function') {
          try {
            playerInstance.destroy();
          } catch (e) {}
        }
      };
    }

    return () => {
      isCancelled = true;
      if (playerInstance && typeof playerInstance.destroy === 'function') {
        try {
          playerInstance.destroy();
        } catch (e) {}
      }
    };
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-black pointer-events-none [&_iframe]:w-[140%] [&_iframe]:h-[140%] [&_iframe]:min-w-full [&_iframe]:min-h-full [&_iframe]:border-0 [&_iframe]:object-cover [&_iframe]:scale-110 [&_iframe]:pointer-events-none"
    />
  );
};

// Dedicated Instagram Reel player with interaction shielding, navigation protection, and in-app replay control
const InstagramPreviewPlayer = ({ embedUrl }) => {
  const [reloadKey, setReloadKey] = useState(0);

  const blockInteraction = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleReplay = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setReloadKey((prev) => prev + 1);
  };

  return (
    <div className="absolute inset-0 z-0 flex items-start justify-center overflow-hidden bg-black select-none">
      {/* Scaled and top-anchored Instagram Reel player */}
      <iframe
        key={`${embedUrl}-${reloadKey}`}
        src={embedUrl}
        title="Instagram Source Video"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
        className="w-[240%] h-[390%] min-w-full border-0 object-cover -translate-y-24 translate-x-4 scale-[1.75] origin-top pointer-events-auto"
      />

      {/* Top interaction guard: Blocks any clicks on the author profile header, audio title, or View profile */}
      <div
        className="absolute top-0 inset-x-0 h-16 z-20 pointer-events-auto cursor-default"
        onClick={blockInteraction}
        onMouseDown={blockInteraction}
        onTouchStart={blockInteraction}
      />

      {/* Bottom interaction & visual guard: Completely hides and blocks clicks on more on Instagram, likes, and comments */}
      <div
        className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-black via-black/90 to-transparent z-20 pointer-events-auto cursor-default"
        onClick={blockInteraction}
        onMouseDown={blockInteraction}
        onTouchStart={blockInteraction}
      />
    </div>
  );
};

// Helper function to format seconds into mm:ss format
const formatDuration = (seconds) => {
  if (seconds == null || isNaN(seconds)) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// Sanitize error messages so internal backend/DS details (session IDs, tracebacks, raw HTTP statuses) are never exposed to the user
const getSanitizedErrorMessage = (rawError) => {
  if (!rawError || typeof rawError !== 'string') return '';
  const trimmed = rawError.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower.includes('sessionid') ||
    lower.includes('mongod') ||
    lower.includes('traceback') ||
    lower.includes('status 5') ||
    lower.includes('status 4') ||
    lower.includes('python') ||
    lower.includes('internal') ||
    lower.includes('exception') ||
    lower.includes('callback') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout of') ||
    lower.includes('objectid') ||
    /^[0-9a-fA-F]{24}$/.test(trimmed)
  ) {
    return '';
  }

  if (lower.startsWith('analysis failed with status')) {
    return '';
  }

  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed;
};



const CloneYourAdPage = ({ onClose, handleGenerate: onGenerateSuccess, onGenerate: onGenerateProp }) => {
  const [sourceVideoUrl, setSourceVideoUrl] = useState('');
  const [sourceDuration, setSourceDuration] = useState(null); // Isolated source video length in seconds
  const [previewVideoError, setPreviewVideoError] = useState(false);
  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState(null);
  const [isResolvingMedia, setIsResolvingMedia] = useState(false);
  const [productImages, setProductImages] = useState([]);
  const [productUrlInput, setProductUrlInput] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [brandName, setBrandName] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');

  // Analyze & Socket Async State: 'form' | 'analyzing' | 'success' | 'failed' | 'timeout'
  const [analysisState, setAnalysisState] = useState('form');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSessionId, setAnalysisSessionId] = useState(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeStageText, setAnalyzeStageText] = useState('');
  const [analysisCards, setAnalysisCards] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [userSafeError, setUserSafeError] = useState(null);
  const [editableVisualDescription, setEditableVisualDescription] = useState('');

  const currentSessionIdRef = useRef(null);
  const timeoutTimerRef = useRef(null);

  const getStageDetails = (rawStage) => {
    if (!rawStage) {
      return {
        title: 'Analyzing source video',
        description: 'Deconstructing video stream & keyframes',
        icon: Video,
      };
    }

    const lower = rawStage.toLowerCase();

    // Select dynamic icon based on stage contents
    let IconComp = Sparkles;
    if (lower.includes('video') || lower.includes('stream') || lower.includes('frame') || lower.includes('scan')) {
      IconComp = Video;
    } else if (lower.includes('check') || lower.includes('previous') || lower.includes('logo') || lower.includes('brand') || lower.includes('cache') || lower.includes('image')) {
      IconComp = Layers;
    } else if (lower.includes('product') || lower.includes('identif') || lower.includes('detect')) {
      IconComp = Sparkles;
    } else if (lower.includes('text') || lower.includes('voice') || lower.includes('script')) {
      IconComp = FileText;
    } else if (lower.includes('complete') || lower.includes('finish') || lower.includes('done') || lower.includes('identified')) {
      IconComp = CheckCircle2;
    } else if (lower.includes('scene') || lower.includes('recipe') || lower.includes('analyz')) {
      IconComp = Cpu;
    }

    // Format human-friendly title directly from incoming stage string
    const title = rawStage.includes('_')
      ? rawStage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : rawStage.charAt(0).toUpperCase() + rawStage.slice(1);

    // Provide dynamic description based on stage category
    let description = 'Deconstructing video stream & extracting ad elements';
    if (lower.includes('checking previous analysis') || lower.includes('checking previous')) {
      description = 'Inspecting cached analysis records & embeddings';
    } else if (lower.includes('identifying your product') || lower.includes('identifying product')) {
      description = 'AI scanning visual elements & brand hints';
    } else if (lower.includes('product identified') || lower.includes('identification complete')) {
      description = 'All product & brand features extracted';
    } else if (lower.includes('source video') || lower.includes('analyz')) {
      description = 'Deconstructing video stream & keyframes';
    } else if (lower.includes('logo') || lower.includes('brand')) {
      description = 'Inspecting pre-processed scene embeddings';
    } else if (lower.includes('image') || lower.includes('download')) {
      description = 'Downloading high-resolution product assets';
    } else if (lower.includes('text') || lower.includes('voice') || lower.includes('script')) {
      description = 'Verifying visual & script consistency';
    } else if (lower.includes('extract')) {
      description = 'Extracting key visual moments and keyframes';
    }

    return {
      title,
      description,
      icon: IconComp,
    };
  };

  const pushStageCard = (rawStage) => {
    if (!rawStage || typeof rawStage !== 'string') return;
    setAnalyzeStageText(rawStage);
    const stageDetails = getStageDetails(rawStage);

    setAnalysisCards((prev) => {
      if (prev.length > 0 && prev[0].title.toLowerCase() === stageDetails.title.toLowerCase()) {
        return prev;
      }
      const newCard = {
        id: `${rawStage}_${Date.now()}_${Math.random()}`,
        title: stageDetails.title,
        description: stageDetails.description,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        icon: stageDetails.icon,
      };
      return [newCard, ...prev.slice(0, 5)];
    });
  };

  const formatStageText = (rawStage) => {
    if (!rawStage) return 'Analyzing source video...';
    if (rawStage.includes(' ')) return rawStage;
    return (
      rawStage
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()) + '...'
    );
  };

  useEffect(() => {
    if (analysisResult?.visualDescription !== undefined && analysisResult?.visualDescription !== null) {
      setEditableVisualDescription(analysisResult.visualDescription);
    }
  }, [analysisResult]);

  // Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
  const [generateError, setGenerateError] = useState(null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const { connected, userData } = useSelector((state) => state.socket);
  const { recreateInputs } = useSelector((state) => state.adVideoNew || {});
  const dispatch = useDispatch();

  // Handle Recreate flow from MySpace video cards
  useEffect(() => {
    if (!recreateInputs) return;

    const isCloneAd =
      recreateInputs.type === 'clone_your_ad' ||
      recreateInputs.type === 'clone-ad' ||
      recreateInputs.type === 'clone_ad' ||
      recreateInputs.type === 'clone_video' ||
      Boolean(recreateInputs.sourceVideoUrl || recreateInputs.galleryVideoUrl);

    if (!isCloneAd) return;

    const srcUrl =
      recreateInputs.sourceVideoUrl ||
      recreateInputs.galleryVideoUrl ||
      recreateInputs.videoSample ||
      '';

    if (srcUrl) {
      setSourceVideoUrl(srcUrl);
      setPreviewVideoError(false);
    }

    const rawImgs =
      recreateInputs.productImageUrls ||
      recreateInputs.images ||
      recreateInputs.productImages ||
      [];

    if (Array.isArray(rawImgs) && rawImgs.length > 0) {
      setProductImages(
        rawImgs.slice(0, 3).map((img) => {
          if (typeof img === 'string') return { file: null, preview: img };
          return {
            file: img.file || null,
            preview: img.preview || img.url || img.imageUrl || '',
          };
        })
      );
    }

    if (recreateInputs.model) {
      setVideoModel(recreateInputs.model);
    }

    if (recreateInputs.duration) {
      const rawDur = String(recreateInputs.duration);
      const durStr = rawDur.endsWith('s') ? rawDur : `${rawDur}s`;
      setVideoDuration(durStr);
      setDurationInputText(String(parseInt(durStr, 10) || 4));
    }

    if (recreateInputs.aspectRatio) {
      setAspectRatio(recreateInputs.aspectRatio);
    }

    const bName =
      recreateInputs.brandName ||
      recreateInputs.productBrandName ||
      recreateInputs.identification?.productBrandName ||
      '';
    if (bName) {
      setBrandName(bName);
    }

    const uPrompt =
      recreateInputs.userPrompt ||
      recreateInputs.additionalInstructions ||
      recreateInputs.instructions ||
      '';
    if (uPrompt) {
      setAdditionalInfo(uPrompt);
    }

    const visualDesc =
      recreateInputs.visualDescription ||
      recreateInputs.identification?.visualDescription ||
      '';
    if (visualDesc) {
      setEditableVisualDescription(visualDesc);
      setAnalysisResult({
        visualDescription: visualDesc,
        productBrandName: bName,
        ...(recreateInputs.identification || {}),
      });
      setAnalysisState('success');
      setAnalyzeProgress(100);
    }

    dispatch(setRecreateInputs(null));
  }, [recreateInputs, dispatch]);

  const { models: surfaceModels, isLoading: isAspectRatioLoading } = useVideoSurfaceModelsState('clone_video');

  // Build model dropdown directly from DB surface config — no hardcodes
  const videoChatModels = useMemo(
    () =>
      surfaceModels.map((model) => ({
        value: model.canonical,
        canonical: model.canonical,
        label: model.label,
        tier: model.isPremium ? 'premium' : 'standard',
        credit: model.value,
        creditsPerSecond: model.creditsPerSecond,
        blockedPlanIds: model.blockedPlanIds || [],
      })),
    [surfaceModels]
  );

  // Durations for the selected model — read from surfaces.clone_video in DB
  const configuredDurationOptions = useMemo(
    () => getModelDurationOptions(surfaceModels, videoModel),
    [surfaceModels, videoModel]
  );

  // Aspect ratios for the selected model — read from surfaces.clone_video.aspectRatios in DB
  const aspectRatioOptions = useMemo(
    () => getModelAspectRatios(surfaceModels, 'clone_video', videoModel),
    [surfaceModels, videoModel]
  );

  const selectedVideoDuration = getSelectedModelDuration(configuredDurationOptions, videoDuration);

  // Derive numeric bounds and step from DB-driven duration options
  const numericDurations = useMemo(() => {
    return configuredDurationOptions
      .map((opt) => parseInt(opt.value, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }, [configuredDurationOptions]);

  const minDuration = numericDurations.length > 0 ? numericDurations[0] : 4;
  const maxDuration = numericDurations.length > 0 ? numericDurations[numericDurations.length - 1] : 30;

  const durationStep = useMemo(() => {
    if (numericDurations.length >= 2) {
      const diff = numericDurations[1] - numericDurations[0];
      return diff > 0 ? diff : 1;
    }
    return 1;
  }, [numericDurations]);

  const currentDurationNumber = useMemo(() => {
    const parsed = parseInt(selectedVideoDuration || videoDuration, 10);
    if (Number.isFinite(parsed) && parsed >= minDuration && parsed <= maxDuration) {
      return parsed;
    }
    return minDuration;
  }, [selectedVideoDuration, videoDuration, minDuration, maxDuration]);

  const [durationInputText, setDurationInputText] = useState('');
  const [isEditingDuration, setIsEditingDuration] = useState(false);

  const handleDecreaseDuration = () => {
    const prev = [...numericDurations].reverse().find((n) => n < currentDurationNumber);
    const nextVal = prev !== undefined ? prev : Math.max(minDuration, currentDurationNumber - durationStep);
    setVideoDuration(`${nextVal}s`);
    setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
  };

  const handleIncreaseDuration = () => {
    const next = numericDurations.find((n) => n > currentDurationNumber);
    const nextVal = next !== undefined ? next : Math.min(maxDuration, currentDurationNumber + durationStep);
    setVideoDuration(`${nextVal}s`);
    setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
  };

  const handleDurationInputChange = (e) => {
    let rawVal = e.target.value.replace(/\D/g, '');

    // Disallow leading zeros
    rawVal = rawVal.replace(/^0+/, '');

    if (!rawVal) {
      setDurationInputText('');
      return;
    }

    let parsed = parseInt(rawVal, 10);
    if (!Number.isFinite(parsed)) {
      setDurationInputText('');
      return;
    }

    // Never accept values exceeding maxDuration — clamp immediately
    if (parsed > maxDuration) {
      parsed = maxDuration;
      rawVal = String(maxDuration);
    }

    setDurationInputText(rawVal);

    if (parsed >= minDuration && parsed <= maxDuration) {
      setVideoDuration(`${parsed}s`);
      setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
    }
  };

  const handleDurationInputBlur = () => {
    setIsEditingDuration(false);

    let parsed = parseInt(durationInputText, 10);
    if (!Number.isFinite(parsed) || parsed < minDuration) {
      parsed = minDuration;
    } else if (parsed > maxDuration) {
      parsed = maxDuration;
    }

    // Snap to nearest configured duration if discrete options exist
    const closest = numericDurations.length > 0
      ? numericDurations.reduce((prev, curr) =>
          Math.abs(curr - parsed) < Math.abs(prev - parsed) ? curr : prev
        , minDuration)
      : parsed;

    setVideoDuration(`${closest}s`);
    setDurationInputText(String(closest));
    setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
  };

  // Auto-select first available model from DB when surface models load
  useEffect(() => {
    if (!videoModel || !videoChatModels.some((m) => m.value === videoModel)) {
      const defaultVideoModel = getFirstAvailableVideoModel(videoChatModels, userData);
      if (defaultVideoModel) setVideoModel(defaultVideoModel);
    }
  }, [userData, videoChatModels, videoModel]);

  // Auto-select first available duration when model or surface data changes
  useEffect(() => {
    if (configuredDurationOptions.length > 0) {
      if (!videoDuration || !configuredDurationOptions.some((o) => o.value === videoDuration)) {
        setVideoDuration(configuredDurationOptions[0].value);
      }
    }
  }, [configuredDurationOptions, videoDuration]);

  // Auto-select first available aspect ratio when model or surface data changes
  useEffect(() => {
    if (isAspectRatioLoading || !aspectRatioOptions.length) return;
    if (!aspectRatio || !aspectRatioOptions.some((option) => option.value === aspectRatio)) {
      setAspectRatio(aspectRatioOptions[0].value);
    }
  }, [aspectRatio, aspectRatioOptions, isAspectRatioLoading]);

  // Detect YouTube URL vs Instagram Reel vs TikTok vs Direct Video URL vs Default Demo
  const youtubeId = useMemo(() => getYouTubeVideoId(sourceVideoUrl), [sourceVideoUrl]);
  const instagramEmbedUrl = useMemo(() => getInstagramEmbedUrl(sourceVideoUrl), [sourceVideoUrl]);
  const tiktokEmbedUrl = useMemo(() => getTikTokEmbedUrl(sourceVideoUrl), [sourceVideoUrl]);
  const isImage = useMemo(() => isImageUrl(sourceVideoUrl), [sourceVideoUrl]);

  const sourceType = useMemo(() => {
    if (!sourceVideoUrl || isImage) return 'default';
    if (youtubeId) return 'youtube';
    if (instagramEmbedUrl) return 'instagram';
    if (tiktokEmbedUrl) return 'tiktok';
    return 'direct-video';
  }, [youtubeId, instagramEmbedUrl, tiktokEmbedUrl, sourceVideoUrl, isImage]);

  // Resolve Instagram URL to playable native MP4 stream URL for preview looping
  useEffect(() => {
    if (!sourceVideoUrl || isImage || !isInstagramUrl(sourceVideoUrl)) {
      setResolvedPreviewUrl(null);
      setIsResolvingMedia(false);
      return;
    }

    let isMounted = true;
    setIsResolvingMedia(true);

    dispatch(resolveMediaAction(sourceVideoUrl))
      .then((res) => {
        if (isMounted && res?.playableUrl) {
          setResolvedPreviewUrl(res.playableUrl);
        }
      })
      .catch((err) => {
        console.warn('[CloneYourAd] Failed to resolve media URL, fallback to embed:', err);
      })
      .finally(() => {
        if (isMounted) {
          setIsResolvingMedia(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [sourceVideoUrl, isImage, dispatch]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  // Socket.io & Event Emitter listeners for asynchronous DS team callback events
  useEffect(() => {
    const socket = getSocket();

    const handleAnalyzeReady = (data) => {
      console.log('[CloneYourAd] Received cloneAdAnalyzeReady event:', data);
      const incomingId = data?.sessionId;
      if (currentSessionIdRef.current && incomingId && String(incomingId) !== String(currentSessionIdRef.current)) {
        console.warn(`[CloneYourAd] Ignoring stale cloneAdAnalyzeReady event for sessionId=${incomingId} (current=${currentSessionIdRef.current})`);
        return;
      }

      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }

      const identification = data?.identification || data;
      setAnalysisResult(identification);
      setAnalyzeProgress(100);
      setAnalysisState('success');
      setIsAnalyzing(false);
      setAnalysisError(null);
      setUserSafeError(null);

      // Auto-populate detected brand name if returned by DS
      const detectedBrand =
        data?.productBrandName ||
        data?.brandName ||
        identification?.productBrandName ||
        identification?.brandName;
      if (detectedBrand) {
        setBrandName(detectedBrand);
      }
    };

    const handleAnalyzeFailed = (data) => {
      console.error('[CloneYourAd] Received cloneAdAnalyzeFailed event:', data);
      const incomingId = data?.sessionId;
      if (currentSessionIdRef.current && incomingId && String(incomingId) !== String(currentSessionIdRef.current)) {
        console.warn(`[CloneYourAd] Ignoring stale cloneAdAnalyzeFailed event for sessionId=${incomingId} (current=${currentSessionIdRef.current})`);
        return;
      }

      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }

      setAnalysisState('failed');
      setIsAnalyzing(false);
      const rawError = data?.error || 'Analysis failed. Please try again.';
      setAnalysisError(rawError);
      setUserSafeError(getSanitizedErrorMessage(rawError));
    };

    const handleVideoProgress = (progressData) => {
      console.log('[CloneYourAd] Received videoProgress event:', progressData);
      const incomingId = progressData?._id || progressData?.sessionId || progressData?.id;
      if (!currentSessionIdRef.current || String(incomingId) === String(currentSessionIdRef.current)) {
        const incomingStage = progressData?.stage || progressData?.message || progressData?.status;
        if (incomingStage && typeof incomingStage === 'string') {
          pushStageCard(incomingStage);
        }
        if (typeof progressData?.promptPercentage === 'number') {
          setAnalyzeProgress(progressData.promptPercentage);
        }
      }
    };

    const handleGenerateReady = (data) => {
      console.log('[CloneYourAd] Received cloneAdGenerateReady event:', data);
      const incomingId = data?.sessionId;
      if (!currentSessionIdRef.current || String(incomingId) === String(currentSessionIdRef.current)) {
        setIsGenerating(false);
        if (data?.url) {
          setGeneratedVideoUrl(data.url);
        }
      }
    };

    const handleGenerateFailed = (data) => {
      console.error('[CloneYourAd] Received cloneAdGenerateFailed event:', data);
      const incomingId = data?.sessionId;
      if (!currentSessionIdRef.current || String(incomingId) === String(currentSessionIdRef.current)) {
        setIsGenerating(false);
        setGenerateError(data?.error || 'Video generation failed. Please try again.');
      }
    };

    // Central emitter subscriptions
    emitter.on('cloneAd:analyzeReady', handleAnalyzeReady);
    emitter.on('cloneAd:analyzeFailed', handleAnalyzeFailed);
    emitter.on('videoProgress', handleVideoProgress);
    emitter.on('cloneAd:generateReady', handleGenerateReady);
    emitter.on('cloneAd:generateFailed', handleGenerateFailed);

    // Direct socket listeners as backup
    if (socket) {
      socket.on('cloneAdAnalyzeReady', handleAnalyzeReady);
      socket.on('cloneAdAnalyzeFailed', handleAnalyzeFailed);
      socket.on('videoProgress', handleVideoProgress);
      socket.on('cloneAdGenerateReady', handleGenerateReady);
      socket.on('cloneAdGenerateFailed', handleGenerateFailed);
    }

    return () => {
      emitter.off('cloneAd:analyzeReady', handleAnalyzeReady);
      emitter.off('cloneAd:analyzeFailed', handleAnalyzeFailed);
      emitter.off('videoProgress', handleVideoProgress);
      emitter.off('cloneAd:generateReady', handleGenerateReady);
      emitter.off('cloneAd:generateFailed', handleGenerateFailed);

      if (socket) {
        socket.off('cloneAdAnalyzeReady', handleAnalyzeReady);
        socket.off('cloneAdAnalyzeFailed', handleAnalyzeFailed);
        socket.off('videoProgress', handleVideoProgress);
        socket.off('cloneAdGenerateReady', handleGenerateReady);
        socket.off('cloneAdGenerateFailed', handleGenerateFailed);
      }
    };
  }, [connected]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, []);

  // Fallback Polling Status Check (if socket is delayed or missed)
  useEffect(() => {
    if (analysisState !== 'analyzing' || !analysisSessionId) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_SOCKET_URL}/adsgpt/video/${analysisSessionId}`, {
          headers: {
            Authorization: `Bearer ${getCookies()}`,
          },
        });

        // If backend deleted the record (which it does on failure in updateCloneAdAnalyzeResult), 404 is returned
        if (response.status === 404) {
          console.warn('[CloneYourAd] Polling: session record 404 (deleted on failure). Transitioning to failed.');
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current);
            timeoutTimerRef.current = null;
          }
          setAnalysisState('failed');
          setIsAnalyzing(false);
          setAnalysisError('Analysis could not be completed. Please try again.');
          setUserSafeError('');
          return;
        }

        const json = await response.json();
        const record = json?.data || json;
        if (record?.stage && typeof record.stage === 'string') {
          pushStageCard(record.stage);
        }
        if (typeof record?.promptPercentage === 'number') {
          setAnalyzeProgress(record.promptPercentage);
        }
        if (record?.identification && (record?.status === 'completed' || record?.status === 'copy')) {
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current);
            timeoutTimerRef.current = null;
          }
          setAnalysisResult(record.identification);
          setAnalysisState('success');
          setIsAnalyzing(false);
          setAnalysisError(null);
          setUserSafeError(null);
          const detectedBrand =
            record?.inputs?.productBrandName ||
            record?.inputs?.brandName ||
            record?.productBrandName ||
            record?.brandName ||
            record?.identification?.productBrandName ||
            record?.identification?.brandName;
          if (detectedBrand) {
            setBrandName(detectedBrand);
          }
        } else if (record?.status === 'failed') {
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current);
            timeoutTimerRef.current = null;
          }
          setAnalysisState('failed');
          setIsAnalyzing(false);
          const err = record.errorMessage || record.sceneError || 'Analysis failed. Please try again.';
          setAnalysisError(err);
          setUserSafeError(getSanitizedErrorMessage(err));
        }
      } catch (err) {
        console.error('[CloneYourAd] Polling status check error:', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [analysisState, analysisSessionId]);

  // Inspect source video duration whenever direct video URL changes
  const validateSourceDuration = (duration) => {
    if (isNaN(duration) || duration <= 0) return;
    const sec = Math.round(duration);
    setSourceDuration(sec);
    if (sec > 60) {
      setErrors((prev) => ({
        ...prev,
        sourceVideo: `Video is too long (${formatDuration(sec)}). Please select a video that is 60 seconds or less.`,
      }));
    } else {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
    }
  };

  // Validate source URL and detect invalid image/photo sources
  const validateSourceUrl = (url) => {
    if (!url) {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
      return;
    }

    if (isImageUrl(url)) {
      setErrors((prev) => ({
        ...prev,
        sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
      }));
      setPreviewVideoError(true);
      return;
    }

    // Supported platform URLs (YouTube, Instagram, TikTok)
    if (getYouTubeVideoId(url) || isInstagramUrl(url) || getTikTokEmbedUrl(url)) {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
      setPreviewVideoError(false);
      return;
    }

    // Direct / external URL probe: Check if URL resolves to an image
    const probeImg = new Image();
    probeImg.onload = () => {
      setErrors((prev) => ({
        ...prev,
        sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
      }));
      setPreviewVideoError(true);
    };
    probeImg.onerror = () => {
      const tempVid = document.createElement('video');
      tempVid.src = url;
      tempVid.onloadedmetadata = () => {
        validateSourceDuration(tempVid.duration);
      };
      tempVid.onerror = () => {
        setPreviewVideoError(true);
        setErrors((prev) => ({
          ...prev,
          sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
        }));
      };
    };
    probeImg.src = url;
  };

  // Video URL paste & File Upload handlers
  const handlePasteVideoUrl = (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          setErrors((prev) => ({
            ...prev,
            sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
          }));
          setPreviewVideoError(true);
          return;
        }
        if (items[i].type.indexOf('video') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            if (sourceVideoUrl && sourceVideoUrl.startsWith('blob:')) {
              URL.revokeObjectURL(sourceVideoUrl);
            }
            const url = URL.createObjectURL(file);
            setSourceVideoUrl(url);
            setSourceVideoFile(file);
            setSourceDuration(null);
            setPreviewVideoError(false);
            setErrors((prev) => ({ ...prev, sourceVideo: '' }));

            const tempVid = document.createElement('video');
            tempVid.src = url;
            tempVid.onloadedmetadata = () => validateSourceDuration(tempVid.duration);
            tempVid.onerror = () => {
              setPreviewVideoError(true);
              setErrors((prev) => ({
                ...prev,
                sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
              }));
            };
            return;
          }
        }
      }
    }

    const pastedText = e.clipboardData?.getData('text');
    if (pastedText && pastedText.trim().startsWith('http')) {
      e.preventDefault(); // Crucial: prevent browser native double-paste
      if (sourceVideoUrl && sourceVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(sourceVideoUrl);
      }
      const cleanUrl = extractCleanUrl(pastedText);
      setSourceVideoUrl(cleanUrl);
      setSourceVideoFile(null);
      setSourceDuration(null);
      setPreviewVideoError(false);

      validateSourceUrl(cleanUrl);
    }
  };

  const handleUrlInputChange = (e) => {
    const rawVal = e.target.value;
    if (sourceVideoUrl && sourceVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(sourceVideoUrl);
    }
    const cleanUrl = extractCleanUrl(rawVal);
    setSourceVideoUrl(cleanUrl);
    setSourceVideoFile(null);
    setSourceDuration(null);
    setPreviewVideoError(false);
    if (cleanUrl) {
      validateSourceUrl(cleanUrl);
    } else {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
    }
  };

  const [sourceVideoFile, setSourceVideoFile] = useState(null);

  const handleVideoFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate MIME type
    if (file.type && !file.type.startsWith('video/')) {
      setErrors((prev) => ({
        ...prev,
        sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
      }));
      setPreviewVideoError(true);
      e.target.value = '';
      return;
    }

    if (sourceVideoUrl && sourceVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(sourceVideoUrl);
    }
    const url = URL.createObjectURL(file);
    setSourceVideoUrl(url);
    setSourceVideoFile(file);
    setSourceDuration(null);
    setPreviewVideoError(false);
    setErrors((prev) => ({ ...prev, sourceVideo: '' }));

    const tempVid = document.createElement('video');
    tempVid.src = url;
    tempVid.onloadedmetadata = () => validateSourceDuration(tempVid.duration);
    tempVid.onerror = () => {
      setPreviewVideoError(true);
      setErrors((prev) => ({
        ...prev,
        sourceVideo: 'Invalid video source. Please enter a video URL or select a video from Gallery.',
      }));
    };

    // Reset input value so selecting the same file again still fires onChange
    e.target.value = '';
  };

  const handleClearSourceVideo = () => {
    if (sourceVideoUrl && sourceVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(sourceVideoUrl);
    }
    setSourceVideoUrl('');
    setSourceVideoFile(null);
    setSourceDuration(null);
    setPreviewVideoError(false);
    setErrors((prev) => ({ ...prev, sourceVideo: '' }));
  };

  // Product Image handlers (Max 3)
  const handleProductImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (productImages.length >= 3) return;

    const newImage = {
      file,
      preview: URL.createObjectURL(file),
    };
    setProductImages((prev) => [...prev, newImage]);
    setErrors((prev) => ({ ...prev, productImages: '' }));
  };

  const handleAddProductUrl = (url) => {
    if (!url || productImages.length >= 3) return;
    setProductImages((prev) => [...prev, { file: null, preview: url }]);
    setProductUrlInput('');
    setErrors((prev) => ({ ...prev, productImages: '' }));
  };

  const handlePasteProductImage = (e) => {
    if (productImages.length >= 3) return;
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setProductImages((prev) => [...prev, { file, preview: URL.createObjectURL(file) }]);
          setErrors((prev) => ({ ...prev, productImages: '' }));
          return;
        }
      }
    }
    const pastedText = e.clipboardData.getData('text');
    if (pastedText && pastedText.startsWith('http')) {
      handleAddProductUrl(pastedText);
    }
  };

  const removeProductImage = (index) => {
    setProductImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Check form validity (Source video <= 60s mandatory, must be valid video source)
  const isFormValid = useMemo(() => {
    const isSourceVideoValid =
      Boolean(sourceVideoUrl) &&
      !errors.sourceVideo &&
      !previewVideoError &&
      !isImageUrl(sourceVideoUrl) &&
      (sourceDuration === null || sourceDuration <= 60);

    return (
      isSourceVideoValid &&
      productImages.length >= 1 &&
      productImages.length <= 3 &&
      Boolean(videoModel) &&
      Boolean(selectedVideoDuration) &&
      Boolean(aspectRatio)
    );
  }, [sourceVideoUrl, errors.sourceVideo, previewVideoError, sourceDuration, productImages, videoModel, selectedVideoDuration, aspectRatio]);

  // Execute POST /clone-ad-analyze
  const handleAnalyze = async (overrideSessionId = null, isReanalyze = false) => {
    if (!isFormValid || isImageUrl(sourceVideoUrl) || previewVideoError || errors.sourceVideo || (isAnalyzing && !isReanalyze)) return;

    try {
      setIsAnalyzing(true);
      setAnalysisState('analyzing');
      setAnalyzeProgress(0);
      setAnalyzeStageText('analyzing_source_video');
      const initialCard = {
        id: `init_${Date.now()}`,
        title: 'Analyzing source video',
        description: 'Deconstructing video stream & keyframes',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        icon: Video,
      };
      setAnalysisCards([initialCard]);
      setAnalysisError(null);
      setUserSafeError(null);
      setAnalysisResult(null);
      setGeneratedVideoUrl(null);
      setGenerateError(null);

      // Start safety timeout fallback (150s / 2.5 minutes)
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }
      timeoutTimerRef.current = setTimeout(() => {
        console.warn('[CloneYourAd] Analysis safety timeout reached (150s). Transitioning to timeout state.');
        setAnalysisState('timeout');
        setIsAnalyzing(false);
      }, 150000);

      const targetSessionId =
        typeof overrideSessionId === 'string'
          ? overrideSessionId
          : isReanalyze
            ? analysisSessionId
            : null;

      // 1. Upload Product Images to S3
      const finalProductImageUrls = [];
      for (const img of productImages) {
        let uploadedKey = '';
        if (img.file) {
          uploadedKey = await uploadToS3(img.file, userData?.user_id || 'guest', true);
        } else if (
          img.preview &&
          img.preview.startsWith('http') &&
          !img.preview.startsWith('blob:')
        ) {
          if (img.preview.includes('contents.adsgpt.io')) {
            finalProductImageUrls.push(img.preview);
            continue;
          }
          uploadedKey = await uploadUrlToS3(img.preview, userData?.user_id || 'guest');
        }

        if (uploadedKey) {
          const fullS3Url = uploadedKey.startsWith('http')
            ? uploadedKey
            : `${S3_BASE_URL}/${uploadedKey.replace(/^\//, '')}`;
          finalProductImageUrls.push(fullS3Url);
        } else if (img.preview && !img.preview.startsWith('blob:')) {
          finalProductImageUrls.push(img.preview);
        }
      }

      // 2. Upload Source Video to S3 if uploaded local file
      let finalSourceVidUrl = sourceVideoUrl || '';
      if (sourceVideoFile) {
        const s3Path = await uploadVideoToS3(sourceVideoFile, userData?.user_id || 'guest');
        if (s3Path) {
          finalSourceVidUrl = s3Path.startsWith('http')
            ? s3Path
            : `${S3_BASE_URL}/${s3Path.replace(/^\//, '')}`;
        }
      }

      const targetDurationNum = parseInt(selectedVideoDuration, 10) || 15;

      const payload = {
        ...(targetSessionId ? { sessionId: targetSessionId } : {}),
        inputs: {
          sourceVideoUrl: finalSourceVidUrl,
          galleryVideoUrl: '',
          productImageUrls: finalProductImageUrls,
          productBrandName: brandName || '',
          visualDescription: editableVisualDescription || '',
          analysisSummary: editableVisualDescription || '',
          additionalInstructions: additionalInfo || '',
          model: videoModel || 'seedance-2.5',
          targetDurationSeconds: targetDurationNum,
          aspectRatio: aspectRatio || '16:9',
        },
      };

      const res = await dispatch(cloneAdAnalyzeAction(payload));

      if (res && res.sessionId) {
        setAnalysisSessionId(res.sessionId);
        currentSessionIdRef.current = res.sessionId;
      }
    } catch (err) {
      console.error('[CloneYourAd] Analyze API error:', err);
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      setIsAnalyzing(false);
      setAnalysisState('failed');
      const rawErrorMsg =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Failed to analyze video';
      setAnalysisError(rawErrorMsg);
      setUserSafeError(getSanitizedErrorMessage(rawErrorMsg));
    }
  };

  const handleReanalyze = () => {
    handleAnalyze(analysisSessionId, true);
  };

  const handleTryAgain = () => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    setAnalysisState('form');
    setIsAnalyzing(false);
    setAnalysisResult(null);
    setAnalysisError(null);
    setUserSafeError(null);
    setAnalyzeProgress(0);
    setAnalyzeStageText('');
    setAnalysisCards([]);
    setAnalysisSessionId(null);
    currentSessionIdRef.current = null;
    setIsGenerating(false);
    setGeneratedVideoUrl(null);
    setGenerateError(null);
  };

  const handleResetAnalysis = () => {
    handleTryAgain();
  };

  const handleGenerate = async () => {
    if (!analysisSessionId || isGenerating) return;

    try {
      setIsGenerating(true);
      setGenerateError(null);

      const targetDurationNum = parseInt(selectedVideoDuration, 10) || 15;
      const payload = {
        sessionId: analysisSessionId,
        inputs: {
          targetDurationSeconds: targetDurationNum,
          aspectRatio: aspectRatio || '16:9',
          additionalInstructions: additionalInfo || '',
          model: videoModel || 'seedance-2.5',
        },
      };

      await dispatch(cloneAdGenerateAction(payload));

      // Trigger genie animation + switch to My Space tab (myVideos) exactly like all other modules
      const triggerMySpace = onGenerateSuccess || onGenerateProp;
      if (triggerMySpace) {
        await triggerMySpace('video');
      } else {
        dispatch(setMySpaceTab('videos'));
        dispatch(setActivePage('myVideos'));
      }
    } catch (err) {
      console.error('[CloneYourAd] Generate API error:', err);
      setIsGenerating(false);
      const errorMsg =
        err.response?.data?.error ||
        err.message ||
        'Failed to start video generation';
      setGenerateError(errorMsg);
    }
  };

  return (
    <div className="grid h-full min-h-0 lg:min-h-[560px] grid-cols-1 lg:grid-cols-2">
      {/* Left side — Source Video Preview */}
      <div className="relative flex min-h-[220px] max-h-[280px] lg:max-h-none lg:min-h-[560px] flex-col justify-between overflow-hidden rounded-t-xl lg:rounded-l-xl lg:rounded-tr-none lg:rounded-br-none bg-black shrink-0">
        <div className="pointer-events-none z-20 m-3 lg:m-4 flex items-center justify-between">
          <h1 className="ml-1 lg:ml-2 text-base lg:text-lg font-semibold text-white drop-shadow-lg 2xl:ml-4 2xl:text-2xl">
            Create your Clone Your Ad
          </h1>

          {/* Duration Badge (Max 60 sec rule) */}
          {sourceDuration !== null && (
            <div
              className={`pointer-events-auto flex items-center gap-1.5 rounded-full px-2.5 lg:px-3 py-1 text-[11px] lg:text-xs font-semibold backdrop-blur-md ${
                sourceDuration > 60
                  ? 'bg-red-500/90 text-white'
                  : 'bg-black/60 text-white/90 border border-white/20'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>
                {formatDuration(sourceDuration)} / 60 sec
              </span>
            </div>
          )}
        </div>

        {previewVideoError ? (
          <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-3 shadow-inner">
              <Video className="h-6 w-6 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-zinc-200 max-w-xs leading-relaxed">
              Invalid video source.
            </p>
            <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
              Please enter a video URL or select a video from Gallery.
            </p>
          </div>
        ) : sourceType === 'youtube' ? (
          <YouTubePreviewPlayer
            key={youtubeId}
            videoId={youtubeId}
            onDurationChange={validateSourceDuration}
          />
        ) : sourceType === 'instagram' ? (
          resolvedPreviewUrl ? (
            <video
              key={resolvedPreviewUrl}
              src={resolvedPreviewUrl}
              autoPlay
              muted
              loop
              playsInline
              onLoadedMetadata={(e) => validateSourceDuration(e.target.duration)}
              className="absolute inset-0 z-0 h-full w-full object-cover"
            />
          ) : (
            <InstagramPreviewPlayer embedUrl={instagramEmbedUrl} />
          )
        ) : sourceType === 'tiktok' ? (
          <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-black pointer-events-none">
            <iframe
              key={tiktokEmbedUrl}
              src={tiktokEmbedUrl}
              title="TikTok Source Video"
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="w-[140%] h-[140%] min-w-full min-h-full border-0 object-cover scale-110 pointer-events-none"
            />
          </div>
        ) : sourceType === 'direct-video' ? (
          <video
            key={sourceVideoUrl}
            src={sourceVideoUrl}
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={(e) => validateSourceDuration(e.target.duration)}
            onError={() => setPreviewVideoError(true)}
            className="absolute inset-0 z-0 h-full w-full object-cover"
          />
        ) : CLONE_YOUR_AD_DEMO_URL?.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
          <video
            src={CLONE_YOUR_AD_DEMO_URL}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 z-0 h-full w-full object-cover"
          />
        ) : (
          <img
            src={CLONE_YOUR_AD_DEMO_URL}
            alt="Clone Your Ad Demo Preview"
            className="absolute inset-0 z-0 h-full w-full object-cover"
          />
        )}

        {/* Error overlay if video exceeds 60 seconds */}
        {sourceDuration > 60 && (
          <div className="absolute inset-x-0 bottom-4 z-20 mx-4 flex items-center gap-2 rounded-xl bg-red-600/90 p-3 text-xs font-medium text-white shadow-lg backdrop-blur-md">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>
              Video is too long ({formatDuration(sourceDuration)}). Please select a video that is 60 seconds or less.
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/40" />
      </div>

      {/* Right side — Form / Processing / Result */}
      <div className="relative flex flex-col gap-4 p-4 pb-8 lg:py-6 lg:pr-4 lg:pl-4 2xl:px-5 text-zinc-900 dark:text-white">
        <button
          onClick={onClose}
          type="button"
          className="absolute top-3 right-3 sm:top-4 sm:right-4 z-[50] rounded-full p-1.5 sm:p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X className="h-4 w-4 2xl:h-6 2xl:w-6" />
        </button>

        {/* Top title */}
        <div className="flex flex-col gap-1">
          <h2 className="mt-1 text-lg font-bold text-zinc-900 dark:text-white 2xl:text-xl">
            Clone Your Ad
          </h2>
        </div>

        {/* ── ANALYSIS RESULT STATE ─────────────────────────────────────── */}
        {analysisState === 'success' || analysisResult ? (
          <div className="flex flex-col gap-3.5 pt-1">
            {/* Header Banner - Subtle green & reduced height with Accuracy pill */}
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-2.5 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400">
              <div className="flex items-center gap-2.5">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    ANALYSIS COMPLETE
                  </h3>
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                    Your ad has been successfully analyzed.
                  </p>
                </div>
              </div>

              {/* Accuracy Pill */}
              {(() => {
                const rawAcc = typeof analysisResult?.confidence === 'number'
                  ? (analysisResult.confidence > 0.8 ? 'High' : analysisResult.confidence > 0.5 ? 'Medium' : 'Low')
                  : (analysisResult?.confidence || analysisResult?.accuracy || 'High');
                const accText = typeof rawAcc === 'string' ? rawAcc.charAt(0).toUpperCase() + rawAcc.slice(1).toLowerCase() : rawAcc;
                return (
                  <div className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300">
                    Accuracy: {accText}
                  </div>
                );
              })()}
            </div>

            {/* Generation Output Video (If generated) */}
            {generatedVideoUrl && (
              <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/5">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Generated Clone Ad Video
                </span>
                <video
                  src={generatedVideoUrl}
                  controls
                  autoPlay
                  className="max-h-56 w-full rounded-lg object-cover"
                />
              </div>
            )}

            {generateError && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{generateError}</span>
              </div>
            )}

            {/* Brand / Product (Editable Input) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                BRAND / PRODUCT
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Enter brand or product name"
                className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3.5 py-2.5 text-xs font-semibold text-zinc-800 transition focus:border-[#15DCFF]/50 focus:outline-none focus:ring-1 focus:ring-[#15DCFF]/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>

            {/* Analysis Summary (Editable Textarea) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                ANALYSIS SUMMARY
              </label>
              <textarea
                value={editableVisualDescription}
                onChange={(e) => setEditableVisualDescription(e.target.value)}
                rows={4}
                placeholder="Analysis visual description summary..."
                className="max-h-40 w-full resize-y rounded-xl border border-black/10 bg-zinc-50 p-3.5 text-xs leading-relaxed text-zinc-800 transition focus:border-[#15DCFF]/50 focus:outline-none focus:ring-1 focus:ring-[#15DCFF]/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
              />
            </div>

            {/* Small Disclaimer */}
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#F5C451' }}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: '#F5C451' }} />
              <span style={{ color: '#F5C451' }}>
                ! AI can make mistakes. Please review the details carefully before proceeding.
              </span>
            </div>

            {/* Action Buttons */}
            <div className="mt-2 flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleReanalyze}
                className="flex items-center gap-2 rounded-full border border-black/10 px-5 py-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Re-analyze
              </button>

              <button
                type="button"
                disabled={isGenerating}
                onClick={handleGenerate}
                className={`flex items-center gap-2 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-7 py-2.5 text-xs font-semibold text-white shadow-md transition hover:opacity-90 ${
                  isGenerating ? 'cursor-not-allowed opacity-70' : ''
                }`}
              >
                {isGenerating && <Loader2 className="h-4 w-4 animate-spin" />}
                {isGenerating ? 'Generating Video...' : 'Generate →'}
              </button>
            </div>
          </div>
        ) : analysisState === 'analyzing' || isAnalyzing ? (
          /* ── AI STACKED CARD ANALYSIS UI ────────────────────────────── */
          <div className="flex flex-col items-center justify-between gap-5 py-4 text-center">
            {/* Header */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-3 py-1 text-[10px] font-bold tracking-wider text-[#15DCFF] uppercase dark:border-[#15DCFF]/40 dark:bg-[#15DCFF]/15">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#15DCFF] opacity-75"></span>
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#15DCFF]"></span>
                </span>
                LIVE PROCESSING
              </div>

              <h3 className="text-base font-bold text-zinc-900 2xl:text-lg dark:text-white">
                AI Analysis in Progress
              </h3>
              <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
                “Deconstructing video stream & extracting ad elements in real time”
              </p>
            </div>

            {/* Stacked Cards Area */}
            <div className="relative flex h-36 w-full max-w-sm items-start justify-center pt-2">
              <AnimatePresence mode="popLayout">
                {analysisCards.slice(0, 4).map((card, index) => {
                  const IconComp = card.icon || Sparkles;
                  const isActive = index === 0;

                  return (
                    <motion.div
                      key={card.id}
                      layout
                      initial={{ y: 40, opacity: 0, scale: 0.9 }}
                      animate={{
                        y: index * 14,
                        scale: 1 - index * 0.05,
                        opacity: Math.max(0.3, 1 - index * 0.25),
                        zIndex: 40 - index * 10,
                      }}
                      exit={{ y: -50, opacity: 0, scale: 0.85 }}
                      transition={{
                        type: 'spring',
                        stiffness: 320,
                        damping: 25,
                        mass: 0.8,
                      }}
                      style={{
                        position: 'absolute',
                        width: '100%',
                      }}
                      className={`flex items-center justify-between rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-colors ${
                        isActive
                          ? 'border-[#15DCFF]/40 bg-zinc-900/90 text-white shadow-[#15DCFF]/10 dark:bg-[#18181b]/95'
                          : 'border-zinc-800/80 bg-zinc-900/60 text-zinc-400 dark:bg-[#18181b]/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isActive
                              ? 'bg-gradient-to-tr from-[#15DCFF] to-[#6b72f8] text-white shadow-md'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          <IconComp className="h-4 w-4" />
                        </div>

                        <div className="flex flex-col justify-center text-left">
                          <span className="text-xs font-bold leading-tight text-white">
                            {card.title}
                          </span>
                          <span className="text-[11px] leading-tight text-zinc-400">
                            {card.description}
                          </span>
                        </div>
                      </div>

                      {isActive ? (
                        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/15 px-2.5 py-0.5">
                          <Loader2 className="h-3 w-3 animate-spin text-[#15DCFF]" />
                          <span className="text-[10px] font-semibold text-[#15DCFF]">Active</span>
                        </div>
                      ) : (
                        <span className="shrink-0 text-[10px] font-medium text-zinc-500">
                          {card.timestamp}
                        </span>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Progress Percentage Bar Below Stack */}
            <div className="flex w-full max-w-sm flex-col items-center gap-1.5 pt-0">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10 shadow-inner dark:bg-white/20">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] transition-all duration-500 ease-out"
                  style={{ width: `${analyzeProgress}%` }}
                />
              </div>
              <div className="flex w-full justify-between px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                <span>Processing Stream</span>
                <span className="font-bold text-[#15DCFF]">{analyzeProgress}%</span>
              </div>
            </div>
          </div>
        ) : analysisState === 'failed' ? (
          /* ── ANALYSIS FAILED STATE (Requirements 3, 11, 16) ────────────── */
          <div className="my-auto flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>

            <div className="flex max-w-sm flex-col items-center gap-1.5">
              <h3 className="text-base font-bold text-zinc-900 2xl:text-lg dark:text-white">
                Analysis Failed
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                We couldn't analyze your ad.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The analysis could not be completed. Please try again.
              </p>
              {userSafeError && (
                <div className="mt-2 rounded-xl border border-zinc-200/80 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">Reason: </span>
                  {userSafeError}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleTryAgain}
              className="mt-2 flex items-center gap-2 rounded-full bg-gray-900 px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try Again
            </button>
          </div>
        ) : analysisState === 'timeout' ? (
          /* ── ANALYSIS TIMEOUT STATE (Requirements 9, 17) ───────────────── */
          <div className="my-auto flex flex-col items-center justify-center gap-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-blue-500 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-400">
              <Clock className="h-6 w-6" />
            </div>

            <div className="flex max-w-sm flex-col items-center gap-1.5">
              <h3 className="text-base font-bold text-zinc-900 2xl:text-lg dark:text-white">
                Analysis is taking longer than expected
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                We couldn't get the analysis result in time. Please check your connection and try again.
              </p>
            </div>

            <button
              type="button"
              onClick={handleTryAgain}
              className="mt-2 flex items-center gap-2 rounded-full bg-gray-900 px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Try Again
            </button>
          </div>
        ) : (
          /* ── FORM INPUT STATE ─────────────────────────────────────────── */
          <>
            {/* Analysis Error Alert */}
            {analysisError && (
              <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{analysisError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAnalysisError(null)}
                  className="font-semibold underline hover:opacity-80"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* 1. Source Video URL / Gallery Video */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium 2xl:text-base">
                  Source video URL / Gallery video <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  Max duration: 60 sec
                </span>
              </div>

              <div
                onPaste={handlePasteVideoUrl}
                className="flex items-center gap-3 rounded-4xl border border-black/10 bg-zinc-50 px-1 py-1 text-[10px] text-zinc-600 transition 2xl:py-2 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-[#afafaf]"
              >
                {sourceVideoFile ? (
                  <div className="flex flex-1 items-center justify-between min-w-0 px-3 py-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <Video className="h-3.5 w-3.5 text-zinc-500 2xl:h-4 2xl:w-4 dark:text-[#909294] shrink-0" />
                      <span
                        className="truncate text-xs font-medium text-zinc-800 2xl:text-base dark:text-white"
                        title={sourceVideoFile.name}
                      >
                        {sourceVideoFile.name}
                      </span>
                      {sourceDuration !== null && (
                        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 2xl:text-xs dark:bg-white/10 dark:text-zinc-300">
                          {String(sourceDuration).padStart(2, '0')}s
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleClearSourceVideo}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0"
                      title="Clear source video"
                      aria-label="Clear source video"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-between min-w-0">
                    <input
                      value={sourceVideoUrl}
                      onChange={handleUrlInputChange}
                      className="w-full rounded-lg bg-transparent px-3 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:text-[#afafaf] dark:placeholder:text-[#afafaf]"
                      placeholder="Paste video URL (YouTube, MP4, MOV)"
                    />
                    {sourceVideoUrl ? (
                      <button
                        type="button"
                        onClick={handleClearSourceVideo}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0"
                        title="Clear source video"
                        aria-label="Clear source video"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <LinkIcon className="h-3 w-3 text-zinc-500 2xl:h-4 2xl:w-4 dark:text-[#909294]" />
                    )}
                  </div>
                )}

                <label
                  htmlFor="source-video-file"
                  className="flex cursor-pointer items-center gap-1 rounded-4xl bg-zinc-200 px-2.5 py-1.5 text-[10px] text-zinc-800 hover:bg-zinc-300 2xl:gap-2 dark:bg-[#606060] dark:text-white dark:hover:opacity-70"
                >
                  <CloudUpload className="h-3 w-3 text-current 2xl:h-4 2xl:w-4" />
                  <span className="!text-[10px] whitespace-nowrap 2xl:!text-xs">Upload Video</span>
                </label>

                <input
                  id="source-video-file"
                  type="file"
                  className="hidden"
                  accept="video/*"
                  onChange={handleVideoFileUpload}
                />
              </div>

              {errors.sourceVideo && (
                <span className="text-[12px] font-medium text-red-500">{errors.sourceVideo}</span>
              )}
            </div>

            {/* 2. Product (1-3 images) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium 2xl:text-base">
                  Product <span className="text-red-500">*</span>
                </label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {productImages.length}/3 images
                </span>
              </div>

              <div
                onPaste={handlePasteProductImage}
                className="flex items-center gap-3 rounded-4xl border border-black/10 bg-zinc-50 px-1 py-1 text-[10px] text-zinc-600 transition 2xl:py-2 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-[#afafaf]"
              >
                <div className="flex flex-1 items-center justify-between">
                  <input
                    value={productUrlInput}
                    onChange={(e) => setProductUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && productUrlInput) {
                        e.preventDefault();
                        handleAddProductUrl(productUrlInput);
                      }
                    }}
                    disabled={productImages.length >= 3}
                    className="w-full rounded-lg bg-transparent px-3 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:text-[#afafaf] dark:placeholder:text-[#afafaf] disabled:opacity-50"
                    placeholder={
                      productImages.length >= 3
                        ? 'Maximum 3 images added'
                        : 'Paste product image URL & press Enter'
                    }
                  />
                  <LinkIcon className="h-3 w-3 text-zinc-500 2xl:h-4 2xl:w-4 dark:text-[#909294]" />
                </div>

                <label
                  htmlFor="product-image-file"
                  className={`flex items-center gap-1 rounded-4xl px-2.5 py-1.5 text-[10px] 2xl:gap-2 ${
                    productImages.length >= 3
                      ? 'cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-[#404040] dark:text-zinc-500'
                      : 'cursor-pointer bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-[#606060] dark:text-white dark:hover:opacity-70'
                  }`}
                >
                  <CloudUpload className="h-3 w-3 text-current 2xl:h-4 2xl:w-4" />
                  <span className="!text-[10px] whitespace-nowrap 2xl:!text-xs">Upload Image</span>
                </label>

                <input
                  id="product-image-file"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  disabled={productImages.length >= 3}
                  onChange={handleProductImageUpload}
                />
              </div>

              {errors.productImages && (
                <span className="text-[12px] text-red-500">{errors.productImages}</span>
              )}

              {productImages.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 2xl:gap-3">
                  {productImages.map((img, index) => (
                    <div
                      key={index}
                      className="group relative h-14 w-14 overflow-hidden rounded-lg border border-black/10 2xl:h-16 2xl:w-16 dark:border-white/10"
                    >
                      <img
                        src={img.preview}
                        alt={`Product ${index + 1}`}
                        className="h-full w-full cursor-pointer object-cover"
                        onClick={() => {
                          setLightboxImages(productImages.map((i) => i.preview));
                          setLightboxImage(img.preview);
                          setLightboxOpen(true);
                        }}
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition duration-200 group-hover:opacity-100"
                        onClick={() => removeProductImage(index)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Model + Duration */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="text-sm font-medium text-zinc-900 2xl:text-base dark:text-white">
                  Model <span className="text-red-500">*</span>
                </label>
                <CommonDropdown
                  options={videoChatModels}
                  label="AI Model"
                  icon={SparkleDark}
                  type="b-roll"
                  className="w-full min-w-0 justify-between [&>div]:min-w-0 [&>div>span]:truncate"
                  value={videoChatModels.find((o) => o.value === videoModel)}
                  onChange={(val) => {
                    setVideoModel(val);
                    setErrors((prev) => ({ ...prev, videoModel: '' }));
                  }}
                />
                {errors.videoModel && (
                  <span className="text-[12px] text-red-500">{errors.videoModel}</span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="text-sm font-medium text-zinc-900 2xl:text-base dark:text-white">
                  Duration <span className="text-red-500">*</span>
                </label>
                <div
                  className="prompt_selection_button_no_gradient group relative flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded-[50px] px-3 py-2 pr-2 text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 md:text-[11px] 2xl:h-8 2xl:px-4 2xl:pr-3 2xl:text-13 dark:border-none dark:bg-[#909294]/10 dark:text-[#f0f0f0]"
                >
                  {/* Left: Duration icon + numeric input + unit */}
                  <div className="flex items-center gap-2 pr-1">
                    <img
                      src={TimerDarkLogo}
                      alt="Duration"
                      className="h-3 w-3 shrink-0 brightness-0 opacity-60 transition-opacity group-hover:opacity-100 2xl:h-4 2xl:w-4 dark:brightness-100 dark:opacity-80"
                    />
                    <div className="flex items-center gap-0.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={minDuration}
                        max={maxDuration}
                        value={isEditingDuration ? durationInputText : currentDurationNumber}
                        onFocus={() => {
                          setIsEditingDuration(true);
                          setDurationInputText(String(currentDurationNumber));
                        }}
                        onChange={handleDurationInputChange}
                        onBlur={handleDurationInputBlur}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-5 bg-transparent p-0 text-left font-normal text-zinc-800 focus:outline-none 2xl:w-6 dark:text-white"
                        aria-label="Duration in seconds"
                      />
                      <span className="font-normal text-zinc-500 dark:text-[#afafaf]">s</span>
                    </div>
                  </div>

                  {/* Right: Minus and Plus stepper buttons */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={handleDecreaseDuration}
                      disabled={currentDurationNumber <= minDuration}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-500 transition hover:bg-black/5 hover:text-zinc-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#afafaf] dark:hover:bg-white/10 dark:hover:text-white"
                      title="Decrease duration"
                      aria-label="Decrease duration"
                    >
                      <Minus className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleIncreaseDuration}
                      disabled={currentDurationNumber >= maxDuration}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-500 transition hover:bg-black/5 hover:text-zinc-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:text-[#afafaf] dark:hover:bg-white/10 dark:hover:text-white"
                      title="Increase duration"
                      aria-label="Increase duration"
                    >
                      <Plus className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
                    </button>
                  </div>
                </div>
                {errors.videoDuration && (
                  <span className="text-[12px] text-red-500">{errors.videoDuration}</span>
                )}
              </div>
            </div>

            {/* 4. Aspect Ratio */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-900 2xl:text-base dark:text-white">
                Aspect Ratio <span className="text-red-500">*</span>
                {isAspectRatioLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </label>

              <div className="mt-2 flex flex-wrap gap-3">
                {aspectRatioOptions.map(({ value, label }) => {
                  const isSelected = value === aspectRatio;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={isAspectRatioLoading}
                      onClick={() => {
                        if (isAspectRatioLoading) return;
                        setAspectRatio(value);
                        setErrors((prev) => ({ ...prev, aspectRatio: '' }));
                      }}
                      className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs transition 2xl:text-sm ${
                        isSelected
                          ? 'border-black/10 bg-black/5 font-semibold text-gray-900 dark:border-white/30 dark:bg-white/10 dark:text-white'
                          : 'border-black/10 bg-transparent text-gray-500 hover:text-gray-900 dark:border-white/5 dark:text-white/40 dark:hover:text-white'
                      }`}
                    >
                      <AspectRatioPreview
                        ratio={value}
                        className={`h-4 w-4 ${
                          isSelected
                            ? 'text-gray-900 dark:text-white'
                            : 'text-gray-500 dark:text-white/40'
                        }`}
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
              {errors.aspectRatio && (
                <span className="mt-1 block text-[12px] text-red-500">{errors.aspectRatio}</span>
              )}
            </div>

            {/* 5. Brand Name (Optional) */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-zinc-900 2xl:text-base dark:text-white">
                Brand Name
              </label>
              <input
                className="w-full rounded-4xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-base dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
                placeholder="Enter your brand/product name"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
              />
            </div>

            {/* 6. Additional Info (Optional) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-900 2xl:text-base dark:text-white">
                Additional Info
              </label>
              <textarea
                rows={2}
                className="w-full rounded-xl border border-black/10 bg-zinc-50 px-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none 2xl:text-sm dark:border-transparent dark:bg-[#909294]/10 dark:text-white dark:placeholder:text-[#afafaf]"
                placeholder="Provide additional details or instructions about the ad"
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
              />
            </div>

            {/* 7. Analyze Button */}
            <div className="mt-2 flex flex-col items-end gap-2">
              <button
                type="button"
                disabled={!isFormValid || isAnalyzing}
                onClick={handleAnalyze}
                className={`flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold text-white transition-all 2xl:text-base dark:text-black ${
                  isFormValid && !isAnalyzing
                    ? 'cursor-pointer bg-gray-900 shadow-md hover:opacity-90 dark:bg-white'
                    : 'cursor-not-allowed bg-gray-900/30 dark:bg-white/30'
                }`}
              >
                {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" />}
                {isAnalyzing ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
          </>
        )}
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

export default CloneYourAdPage;
