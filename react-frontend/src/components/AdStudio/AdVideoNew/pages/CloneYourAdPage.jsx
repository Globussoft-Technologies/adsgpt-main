import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import UpgradeModal from '../UpgradeModal';
import { CloudUpload, LinkIcon, Loader2, Video, X, Clock, AlertCircle, AlertTriangle, Sparkles, RotateCcw, ArrowRight, CheckCircle2, Cpu, Layers, Search, FileText, Minus, Plus, ChevronLeft, Clapperboard } from 'lucide-react';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { getSocket } from '@/store/reducers/socket/socketSlice';
import emitter from '@/utils/eventEmitter';
import ShowLightBox from '@/components/AdFactory/Cards/Lightbox';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { cloneAdAnalyzeAction, cloneAdGenerateAction } from '@/store/actions/adVideoNew/Advideoactions';
import axios from 'axios';
import {
  LinkedInEmbed,
  TikTokEmbed,
  TwitterEmbed,
  PinterestEmbed,
  YouTubeEmbed,
} from 'react-social-media-embed';
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
import { setRecreateInputs, setActivePage, setMySpaceTab } from '@/store/reducers/adStudio/adVideoNewSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Default demo visual asset for Clone Your Ad (isolated for easy S3/CDN replacement)
const CLONE_YOUR_AD_DEMO_URL =
  'https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/4dcc2a50-47de-46a1-b7e6-d5bd378bb5d1-91841e48382ec5af.mp4';

// Helper function to extract YouTube video ID from various YouTube URL formats
const getYouTubeVideoId = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Helper function to check if URL has an image file extension
const isImageUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const imageRegex = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff|heic|ico)(\?.*)?$/i;
  return imageRegex.test(url.trim());
};

// Helper function to check for supported resolvable social video URLs
const isResolvablePlatformUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    /(?:instagram\.com|instagr\.am)/i.test(trimmed) ||
    /(?:facebook\.com|fb\.watch)/i.test(trimmed) ||
    /tiktok\.com/i.test(trimmed) ||
    /(?:twitter\.com|x\.com)/i.test(trimmed) ||
    /(?:pinterest\.com|pin\.it)/i.test(trimmed) ||
    /(?:linkedin\.com|lnkd\.in)/i.test(trimmed) ||
    /vimeo\.com/i.test(trimmed)
  );
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
          } catch (_e) {
            // Ignored destroy error
          }
        }
      };
    }

    return () => {
      isCancelled = true;
      if (playerInstance && typeof playerInstance.destroy === 'function') {
        try {
          playerInstance.destroy();
        } catch (_e) {
          // Ignored destroy error
        }
      }
    };
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-black pointer-events-none [&_div]:w-full [&_div]:h-full [&_div]:flex [&_div]:items-center [&_div]:justify-center [&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:max-h-full [&_iframe]:border-0 [&_iframe]:object-contain [&_iframe]:pointer-events-none"
    />
  );
};



// Dedicated Meta Instagram oEmbed Player via AdsGPT backend proxy (https://developers.facebook.com/documentation/instagram-platform/oembed)
const InstagramMetaEmbed = ({ url }) => {
  const [embedHtml, setEmbedHtml] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!url) return;

    let isMounted = true;
    const controller = new AbortController();

    setIsLoading(true);
    setHasError(false);
    setEmbedHtml(null);

    const fetchOEmbed = async () => {
      try {
        const host = import.meta.env.VITE_SOCKET_URL || '';
        const token = getCookies('token');
        const endpoint = `${host}/adsgpt/video/instagram-oembed`;

        const res = await axios.post(
          endpoint,
          { url: url.trim() },
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
          }
        );

        const data = res.data?.data;
        if (!data || !data.html) {
          throw new Error('No embed HTML returned');
        }

        if (isMounted) {
          setEmbedHtml(data.html);
          setIsLoading(false);
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError' || err.name === 'CanceledError') return;
        console.warn('[InstagramMetaEmbed] oEmbed fetch error:', err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    fetchOEmbed();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [url]);

  // Handle Instagram embed.js script loading and process() call
  useEffect(() => {
    if (!embedHtml || !containerRef.current) return;

    let isCancelled = false;

    const processInstagramEmbed = () => {
      if (isCancelled) return;
      if (window.instgrm && window.instgrm.Embeds && typeof window.instgrm.Embeds.process === 'function') {
        window.instgrm.Embeds.process(containerRef.current);
      }
    };

    if (window.instgrm?.Embeds?.process) {
      processInstagramEmbed();
    } else {
      if (!window._instgrmScriptLoading) {
        window._instgrmScriptLoading = true;
        const script = document.createElement('script');
        script.id = 'instagram-embed-script';
        script.src = 'https://www.instagram.com/embed.js';
        script.async = true;
        script.onload = () => {
          processInstagramEmbed();
        };
        document.body.appendChild(script);
      } else {
        const checkInterval = setInterval(() => {
          if (window.instgrm?.Embeds?.process) {
            clearInterval(checkInterval);
            processInstagramEmbed();
          }
        }, 100);
        return () => {
          isCancelled = true;
          clearInterval(checkInterval);
        };
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [embedHtml]);

  if (hasError) {
    return (
      <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-3 shadow-inner">
          <Video className="h-6 w-6 text-zinc-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-200 max-w-xs leading-relaxed">
          Unable to preview this Instagram video
        </p>
        <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
          We couldn't load the Instagram preview. Please check the URL or try another video.
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-transparent p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center [&_iframe]:!min-w-full [&_iframe]:!w-full [&_iframe]:!border-0 [&_blockquote]:!min-w-full [&_blockquote]:!w-full [&_blockquote]:!m-0 [&_blockquote]:!p-0 [&_blockquote]:!border-0 [&_blockquote]:!shadow-none">
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-2.5 text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-xs font-medium text-zinc-300">Loading Instagram preview...</span>
        </div>
      )}
      {embedHtml && (
        <div
          ref={containerRef}
          className={`w-full h-full flex justify-center items-start ${isLoading ? 'hidden' : ''}`}
          dangerouslySetInnerHTML={{ __html: embedHtml }}
        />
      )}
    </div>
  );
};

// Dedicated Meta Facebook Embedded Video Player via AdsGPT backend proxy (https://developers.facebook.com/docs/plugins/embedded-video-player/)
const FacebookMetaEmbed = ({ url }) => {
  const [embedHtml, setEmbedHtml] = useState(null);
  const [embedUrl, setEmbedUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!url) return;

    let isMounted = true;
    const controller = new AbortController();

    setIsLoading(true);
    setHasError(false);
    setEmbedHtml(null);
    setEmbedUrl(null);

    const fetchFacebookEmbed = async () => {
      try {
        const host = import.meta.env.VITE_SOCKET_URL || '';
        const token = getCookies('token');
        const endpoint = `${host}/adsgpt/video/facebook-embed`;

        const res = await axios.post(
          endpoint,
          { url: url.trim() },
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
          }
        );

        const data = res.data?.data;
        if (!data || (!data.embedUrl && !data.html)) {
          throw new Error('No Facebook embed returned');
        }

        if (isMounted) {
          setEmbedUrl(data.embedUrl);
          setEmbedHtml(data.html);
          setIsLoading(false);
        }
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'AbortError' || err.name === 'CanceledError') return;
        console.warn('[FacebookMetaEmbed] embed fetch error:', err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    fetchFacebookEmbed();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [url]);

  // Handle Facebook JavaScript SDK script loading & XFBML parse() call
  useEffect(() => {
    if (!containerRef.current) return;

    let isCancelled = false;

    const processFacebookEmbed = () => {
      if (isCancelled) return;
      if (window.FB && window.FB.XFBML && typeof window.FB.XFBML.parse === 'function') {
        try {
          window.FB.XFBML.parse(containerRef.current);
        } catch (e) {
          console.warn('[FacebookMetaEmbed] XFBML parse notice:', e);
        }
      }
    };

    if (window.FB?.XFBML?.parse) {
      processFacebookEmbed();
    } else {
      if (!window._fbScriptLoading) {
        window._fbScriptLoading = true;
        if (!document.getElementById('fb-root')) {
          const fbRoot = document.createElement('div');
          fbRoot.id = 'fb-root';
          document.body.prepend(fbRoot);
        }
        const script = document.createElement('script');
        script.id = 'facebook-jssdk';
        script.src = 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v20.0';
        script.async = true;
        script.defer = true;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
          processFacebookEmbed();
        };
        document.body.appendChild(script);
      } else {
        const checkInterval = setInterval(() => {
          if (window.FB?.XFBML?.parse) {
            clearInterval(checkInterval);
            processFacebookEmbed();
          }
        }, 100);
        return () => {
          isCancelled = true;
          clearInterval(checkInterval);
        };
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [embedUrl, embedHtml]);

  if (hasError) {
    return (
      <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-3 shadow-inner">
          <Video className="h-6 w-6 text-zinc-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-200 max-w-xs leading-relaxed">
          Unable to preview this Facebook video
        </p>
        <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
          We couldn't load the Facebook preview. Please check the URL or try another video.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black p-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center"
    >
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-2.5 text-zinc-400">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
          <span className="text-xs font-medium text-zinc-300">Loading Facebook preview...</span>
        </div>
      )}
      {embedUrl && (
        <iframe
          src={embedUrl}
          title="Facebook Video Player"
          className={`w-full h-full border-0 ${isLoading ? 'hidden' : ''}`}
          style={{ border: 'none', overflow: 'hidden', minHeight: '320px' }}
          scrolling="no"
          frameBorder="0"
          allowFullScreen={true}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        />
      )}
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

// Sanitize error messages so internal backend/DS details (session IDs, tracebacks, raw HTTP statuses) are formatted into clean, user-friendly feedback
const getSanitizedErrorMessage = (rawError) => {
  if (!rawError || typeof rawError !== 'string') return '';
  let trimmed = rawError.trim();

  // Strip technical category prefixes e.g. "invalid_product_image: ", "error: "
  trimmed = trimmed.replace(/^[a-z0-9_]+:\s*/i, '');

  const lower = trimmed.toLowerCase();

  // Specific user-friendly category detections
  if (
    lower.includes('person') ||
    lower.includes('hand') ||
    lower.includes('face') ||
    lower.includes('wearing') ||
    lower.includes('holding') ||
    lower.includes('invalid_product_image')
  ) {
    return 'Your product photo appears to include a person, hand, or face. Please upload a photo showing only the product and try again.';
  }

  if (
    lower.includes('no product') ||
    lower.includes('could not detect') ||
    lower.includes('not detected') ||
    lower.includes('product not found')
  ) {
    return 'Could not clearly identify the product in the provided image. Please upload a clear, well-lit photo showing only your product.';
  }

  if (
    lower.includes('video is too long') ||
    (lower.includes('exceeds') && lower.includes('duration'))
  ) {
    return 'The source video exceeds the maximum duration of 60 seconds. Please choose a shorter video.';
  }

  if (
    lower.includes('traceback') ||
    lower.includes('mongod') ||
    lower.includes('status 5') ||
    lower.includes('status 4') ||
    lower.includes('econnrefused') ||
    lower.includes('exception') ||
    lower.includes('internal') ||
    lower.startsWith('analysis failed with status') ||
    /^[0-9a-fA-F]{24}$/.test(trimmed)
  ) {
    return 'We were unable to complete the analysis. Please check your product image and source video, then try again.';
  }

  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
};

const getSanitizedPrefillErrorMessage = (rawError) => {
  if (!rawError || typeof rawError !== 'string') {
    return 'Invalid video link or file. Please provide a valid video URL or upload a video.';
  }
  const trimmed = rawError.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower.includes('unsupported url') ||
    lower.includes('video download failed') ||
    lower.includes('extractorerror') ||
    lower.includes('no video') ||
    lower.includes('invalid url') ||
    lower.includes('cannot download') ||
    lower.includes('unsupported')
  ) {
    return 'Invalid or unsupported video URL. Please provide a direct video link or a supported video platform URL (e.g., YouTube, Instagram, TikTok, Facebook).';
  }

  if (
    lower.includes('python') ||
    lower.includes('status 5') ||
    lower.includes('internal') ||
    lower.includes('traceback') ||
    lower.includes('econnrefused') ||
    lower.includes('session')
  ) {
    return 'Unable to process this video right now. Please try again or upload a video file.';
  }

  return trimmed.length > 150 ? `${trimmed.slice(0, 147)}...` : trimmed;
};



const CloneYourAdPage = ({ onClose, handleGenerate: onGenerateSuccess, onGenerate: onGenerateProp }) => {
  const [sourceVideoUrl, setSourceVideoUrl] = useState('');
  const [galleryVideoUrl, setGalleryVideoUrl] = useState('');
  const [sourceVideoFile, setSourceVideoFile] = useState(null);
  const [sourceDuration, setSourceDuration] = useState(null); // Isolated source video length in seconds
  const [previewVideoError, setPreviewVideoError] = useState(false);
  const [productImages, setProductImages] = useState([]);
  const [productUrlInput, setProductUrlInput] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoDuration, setVideoDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [brandName, setBrandName] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [recommendationReason, setRecommendationReason] = useState('');

  // Step state: 'input' | 'workspace'
  const { recreateInputs } = useSelector((state) => state.adVideoNew || {});
  const [currentStep, setCurrentStep] = useState(
    recreateInputs?.sourceVideoUrl ||
      recreateInputs?.galleryVideoUrl ||
      recreateInputs?.videoSample
      ? 'workspace'
      : 'input'
  );
  const [prefillUrl, setPrefillUrl] = useState('');
  const [prefillError, setPrefillError] = useState('');

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
  const uploadedS3UrlRef = useRef('');
  const lastUploadedFileRef = useRef(null);
  const lastPrefilledSourceRef = useRef('');

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

  const { connected, userData, credits } = useSelector((state) => state.socket);
  const { modelCredits } = useSelector((state) => state.prompt || {});
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  const handlePrefillVideoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type && !file.type.startsWith('video/')) {
      setPrefillError('Please select a valid video file');
      e.target.value = '';
      return;
    }

    const isSameFile =
      lastUploadedFileRef.current &&
      (file === lastUploadedFileRef.current ||
        (file.name === lastUploadedFileRef.current.name &&
          file.size === lastUploadedFileRef.current.size &&
          file.lastModified === lastUploadedFileRef.current.lastModified));

    if (!isSameFile) {
      uploadedS3UrlRef.current = '';
      lastPrefilledSourceRef.current = '';
    }

    setSourceVideoFile(file);
    setPrefillUrl(file.name);
    setSourceVideoUrl('');
    setGalleryVideoUrl('');
    setPrefillError('');
    e.target.value = '';
  };

  const handlePrefillPaste = (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('video/')) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            const isSameFile =
              lastUploadedFileRef.current &&
              (file === lastUploadedFileRef.current ||
                (file.name === lastUploadedFileRef.current.name &&
                  file.size === lastUploadedFileRef.current.size &&
                  file.lastModified === lastUploadedFileRef.current.lastModified));

            if (!isSameFile) {
              uploadedS3UrlRef.current = '';
              lastUploadedFileRef.current = null;
              lastPrefilledSourceRef.current = '';
            }

            setSourceVideoFile(file);
            setPrefillUrl(file.name);
            setSourceVideoUrl('');
            setGalleryVideoUrl('');
            setPrefillError('');
            return;
          }
        }
      }
    }

    const pastedText = e.clipboardData?.getData('text')?.trim();
    if (pastedText) {
      e.preventDefault();
      const cleanUrl = extractCleanUrl(pastedText);
      if (cleanUrl !== lastPrefilledSourceRef.current) {
        uploadedS3UrlRef.current = '';
        lastUploadedFileRef.current = null;
        lastPrefilledSourceRef.current = cleanUrl;
      }
      setSourceVideoFile(null);
      setPrefillUrl(cleanUrl);
      setSourceVideoUrl(cleanUrl);
      setGalleryVideoUrl('');
      setPrefillError('');
    }
  };

  const handleStartAnalyze = async () => {
    const trimmed = (prefillUrl || '').trim();
    const effectiveSource = trimmed || (sourceVideoFile ? sourceVideoFile.name : '') || sourceVideoUrl || galleryVideoUrl;
    if (!effectiveSource && !sourceVideoFile) {
      setPrefillError('Please enter a video URL or upload a video');
      return;
    }
    if (productImages.length === 0) {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Please provide at least 1 product image.',
      }));
      return;
    }

    try {
      setIsAnalyzing(true);
      setCurrentStep('workspace');
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

      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }
      timeoutTimerRef.current = setTimeout(() => {
        console.warn('[CloneYourAd] Analysis safety timeout reached (150s). Transitioning to timeout state.');
        setAnalysisState('timeout');
        setIsAnalyzing(false);
      }, 150000);

      // 1. Upload Product Images to S3 (caching uploaded URLs to avoid re-uploading)
      const updatedProductImages = [...productImages];
      const finalProductImageUrls = [];

      for (let i = 0; i < updatedProductImages.length; i++) {
        const img = updatedProductImages[i];

        // If image already has a cached S3 URL, reuse it directly
        if (img.s3Url) {
          finalProductImageUrls.push(img.s3Url);
          continue;
        }

        let uploadedKey = '';
        if (img.file) {
          uploadedKey = await uploadToS3(img.file, userData?.user_id || 'guest', true);
        } else if (
          img.preview &&
          img.preview.startsWith('http') &&
          !img.preview.startsWith('blob:')
        ) {
          if (
            img.preview.includes('contents.adsgpt.io') ||
            img.preview.includes('s3.amazonaws.com') ||
            img.preview.includes('amazonaws.com')
          ) {
            updatedProductImages[i] = { ...img, s3Url: img.preview };
            finalProductImageUrls.push(img.preview);
            continue;
          }
          uploadedKey = await uploadUrlToS3(img.preview, userData?.user_id || 'guest');
        }

        if (uploadedKey) {
          const fullS3Url = uploadedKey.startsWith('http')
            ? uploadedKey
            : `${S3_BASE_URL}/${uploadedKey.replace(/^\//, '')}`;
          updatedProductImages[i] = { ...img, s3Url: fullS3Url };
          finalProductImageUrls.push(fullS3Url);
        } else if (img.preview && !img.preview.startsWith('blob:')) {
          updatedProductImages[i] = { ...img, s3Url: img.preview };
          finalProductImageUrls.push(img.preview);
        }
      }

      setProductImages(updatedProductImages);

      // 2. Determine Source Video vs Gallery Video (Uploaded from local)
      let finalSourceVidUrl = '';
      let finalGalleryVidUrl = galleryVideoUrl || '';

      if (sourceVideoFile) {
        // User uploaded local video file -> upload to S3 and assign as galleryVideoUrl
        const isSameFile =
          lastUploadedFileRef.current &&
          (sourceVideoFile === lastUploadedFileRef.current ||
            (sourceVideoFile.name === lastUploadedFileRef.current.name &&
              sourceVideoFile.size === lastUploadedFileRef.current.size &&
              sourceVideoFile.lastModified === lastUploadedFileRef.current.lastModified));

        if (isSameFile && uploadedS3UrlRef.current) {
          finalGalleryVidUrl = uploadedS3UrlRef.current;
        } else {
          const s3Path = await uploadVideoToS3(sourceVideoFile, userData?.user_id || 'guest');
          if (s3Path) {
            finalGalleryVidUrl = s3Path.startsWith('http')
              ? s3Path
              : `${S3_BASE_URL}/${s3Path.replace(/^\//, '')}`;
            uploadedS3UrlRef.current = finalGalleryVidUrl;
            lastUploadedFileRef.current = sourceVideoFile;
          }
        }
        setGalleryVideoUrl(finalGalleryVidUrl);
        setSourceVideoUrl('');
      } else {
        // User pasted video URL (youtube, facebook, instagram, linkedin, tiktok, direct url, etc.)
        finalSourceVidUrl = trimmed || sourceVideoUrl || '';
        finalGalleryVidUrl = '';
        setSourceVideoUrl(finalSourceVidUrl);
        setGalleryVideoUrl('');
      }

      const defaultModel = videoModel || 'google-omni';
      const defaultDuration = 8;
      const defaultAspectRatio = aspectRatio || '9:16';

      const payload = {
        inputs: {
          sourceVideoUrl: finalSourceVidUrl,
          galleryVideoUrl: finalGalleryVidUrl,
          productImageUrls: finalProductImageUrls,
          productBrandName: brandName || '',
          visualDescription: editableVisualDescription || '',
          analysisSummary: editableVisualDescription || '',
          additionalInstructions: additionalInfo || '',
          model: defaultModel,
          targetDurationSeconds: defaultDuration,
          aspectRatio: defaultAspectRatio,
        },
      };

      const res = await dispatch(cloneAdAnalyzeAction(payload));

      if (res && res.sessionId) {
        setAnalysisSessionId(res.sessionId);
        currentSessionIdRef.current = res.sessionId;
      }
    } catch (err) {
      console.error('[CloneYourAd] Start Analyze error:', err);
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

  // Handle Recreate flow from MySpace video cards
  const handleRecreate = (inputs) => {
    if (!inputs) return;

    const isCloneAd =
      inputs.type === 'clone_your_ad' ||
      inputs.type === 'clone-ad' ||
      inputs.type === 'clone_ad' ||
      inputs.type === 'clone_video' ||
      Boolean(inputs.sourceVideoUrl || inputs.galleryVideoUrl || inputs.videoSample);

    if (!isCloneAd) return;

    const s3Base = import.meta.env.VITE_S3_BASE_URL || '';
    const resolveMedia = (u) => {
      if (!u || typeof u !== 'string') return '';
      if (/^(https?:)?\/\//i.test(u) || u.startsWith('blob:') || u.startsWith('data:')) return u;
      const base = String(s3Base).replace(/\/$/, '');
      return base ? `${base}/${u.replace(/^\/+/, '')}` : u;
    };

    if (inputs.sessionId || inputs._id || inputs.id) {
      const sId = String(inputs.sessionId || inputs._id || inputs.id);
      setAnalysisSessionId(sId);
      currentSessionIdRef.current = sId;
    }

    if (inputs.sourceVideoUrl) {
      const resolvedSrc = resolveMedia(inputs.sourceVideoUrl);
      setSourceVideoUrl(resolvedSrc);
      setGalleryVideoUrl('');
      setPrefillUrl(resolvedSrc);
      lastPrefilledSourceRef.current = resolvedSrc;
      setCurrentStep('workspace');
      setPreviewVideoError(false);
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
    } else if (inputs.galleryVideoUrl) {
      const resolvedGallery = resolveMedia(inputs.galleryVideoUrl);
      setGalleryVideoUrl(resolvedGallery);
      setSourceVideoUrl('');
      setPrefillUrl(resolvedGallery);
      lastPrefilledSourceRef.current = resolvedGallery;
      setCurrentStep('workspace');
      setPreviewVideoError(false);
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
    } else if (inputs.videoSample) {
      const resolvedSample = resolveMedia(inputs.videoSample);
      setSourceVideoUrl(resolvedSample);
      setGalleryVideoUrl('');
      setPrefillUrl(resolvedSample);
      lastPrefilledSourceRef.current = resolvedSample;
      setCurrentStep('workspace');
      setPreviewVideoError(false);
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
    }

    const rawImgs =
      inputs.productImageUrls ||
      inputs.images ||
      inputs.productImages ||
      (inputs.image ? [inputs.image] : []) ||
      (inputs.imageUrl ? [inputs.imageUrl] : []) ||
      [];

    if (Array.isArray(rawImgs) && rawImgs.length > 0) {
      setProductImages(
        rawImgs.slice(0, 3).map((img) => {
          if (typeof img === 'string') {
            return { file: null, preview: resolveMedia(img) };
          }
          return {
            file: img.file || null,
            preview: resolveMedia(img.preview || img.url || img.imageUrl || ''),
          };
        })
      );
      setErrors((prev) => ({ ...prev, productImages: '' }));
    }

    if (inputs.model) {
      setVideoModel(inputs.model);
    }

    if (inputs.duration || inputs.targetDurationSeconds) {
      const rawDur = String(inputs.duration || inputs.targetDurationSeconds);
      const durNum = parseInt(rawDur, 10) || 8;
      const durStr = `${durNum}s`;
      setVideoDuration(durStr);
      setDurationInputText(String(durNum));
      setErrors((prev) => ({ ...prev, videoDuration: '' }));
    }

    if (inputs.aspectRatio) {
      setAspectRatio(inputs.aspectRatio);
    }

    const bName =
      inputs.brandName ||
      inputs.productBrandName ||
      inputs.identification?.productBrandName ||
      '';
    if (bName) {
      setBrandName(bName);
    }

    const uPrompt =
      inputs.userPrompt ||
      inputs.additionalInstructions ||
      inputs.instructions ||
      '';
    if (uPrompt) {
      setAdditionalInfo(uPrompt);
    }

    const visualDesc =
      inputs.visualDescription ||
      inputs.identification?.visualDescription ||
      '';
    if (visualDesc) {
      setEditableVisualDescription(visualDesc);
    }

    const recReason =
      inputs?.recommendationReason ||
      inputs?.reason ||
      inputs?.identification?.recommendationReason ||
      inputs?.identification?.reason ||
      '';
    if (recReason) {
      setRecommendationReason(recReason);
    }

    setAnalysisState('success');
    setAnalysisResult(inputs.identification || { visualDescription: visualDesc, productBrandName: bName });
    setIsAnalyzing(false);
    setAnalyzeProgress(100);
    setAnalysisCards([]);

    dispatch(setRecreateInputs(null));
  };

  useEffect(() => {
    if (recreateInputs) {
      handleRecreate(recreateInputs);
    }

    emitter.on('recreate-video', handleRecreate);
    return () => {
      emitter.off('recreate-video', handleRecreate);
    };
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

  const selectedModel = useMemo(
    () => videoChatModels.find((model) => model.value === videoModel),
    [videoChatModels, videoModel]
  );

  const creditsPerSecond = useMemo(() => {
    if (selectedModel?.creditsPerSecond && Number.isFinite(Number(selectedModel.creditsPerSecond))) {
      return Number(selectedModel.creditsPerSecond);
    }
    const modelStr = (videoModel || '').toLowerCase();
    if (modelStr.includes('seedance')) return 6;
    if (modelStr.includes('omni')) return 3;
    return 3;
  }, [selectedModel, videoModel]);

  const requiredCredits = useMemo(() => {
    const durationNum = currentDurationNumber || parseInt(selectedVideoDuration || videoDuration, 10) || 4;
    return Math.ceil(creditsPerSecond * durationNum);
  }, [creditsPerSecond, currentDurationNumber, selectedVideoDuration, videoDuration]);

  const hasEnoughCredits = useMemo(() => {
    return availableCredits >= requiredCredits;
  }, [availableCredits, requiredCredits]);

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

  const effectiveMediaUrl = useMemo(
    () => sourceVideoUrl || galleryVideoUrl || '',
    [sourceVideoUrl, galleryVideoUrl]
  );

  // Detect social platforms directly on frontend using react-social-media-embed
  const youtubeId = useMemo(() => getYouTubeVideoId(effectiveMediaUrl), [effectiveMediaUrl]);
  const isImage = useMemo(() => isImageUrl(effectiveMediaUrl), [effectiveMediaUrl]);

  const isDirectVideo = useMemo(() => {
    if (!effectiveMediaUrl || isImage) return false;
    return (
      effectiveMediaUrl.startsWith('blob:') ||
      Boolean(galleryVideoUrl) ||
      /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(effectiveMediaUrl)
    );
  }, [effectiveMediaUrl, isImage, galleryVideoUrl]);

  const isInstagram = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:instagram\.com|instagr\.am)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isLinkedIn = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:linkedin\.com|lnkd\.in)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isTikTok = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /tiktok\.com/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isFacebook = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:facebook\.com|fb\.watch)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isTwitter = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:twitter\.com|x\.com)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isPinterest = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:pinterest\.com|pin\.it)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);

  const sourceType = useMemo(() => {
    if (!effectiveMediaUrl || isImage || previewVideoError) return 'default';
    if (youtubeId) return 'youtube';
    if (isInstagram) return 'instagram';
    if (isLinkedIn) return 'linkedin';
    if (isTikTok) return 'tiktok';
    if (isFacebook) return 'facebook';
    if (isTwitter) return 'twitter';
    if (isPinterest) return 'pinterest';
    if (isDirectVideo) return 'direct-video';
    return 'default';
  }, [effectiveMediaUrl, isImage, previewVideoError, isDirectVideo, youtubeId, isInstagram, isLinkedIn, isTikTok, isFacebook, isTwitter, isPinterest]);

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
        data?.inputs?.productBrandName ||
        data?.inputs?.brandName ||
        identification?.productBrandName ||
        identification?.brandName;
      if (detectedBrand) {
        setBrandName(detectedBrand);
      }

      // Auto-populate recommended model, duration, and aspect ratio from analysis
      const recModel =
        data?.recommendedModel ||
        data?.inputs?.model ||
        identification?.recommendedModel;
      if (recModel) {
        setVideoModel(recModel);
      }

      const recDuration =
        data?.recommendedDurationSeconds ||
        data?.inputs?.duration ||
        identification?.recommendedDurationSeconds;
      if (recDuration) {
        const durNum = parseInt(String(recDuration).replace(/\D/g, ''), 10);
        if (durNum) {
          setVideoDuration(`${durNum}s`);
          setDurationInputText(String(durNum));
        }
      }

      const recAspect =
        data?.recommendedAspectRatio ||
        data?.inputs?.aspectRatio ||
        identification?.recommendedAspectRatio;
      if (recAspect) {
        setAspectRatio(recAspect);
      }

      const recReason =
        data?.recommendationReason ||
        data?.reason ||
        identification?.recommendationReason ||
        identification?.reason ||
        '';
      if (recReason) {
        setRecommendationReason(recReason);
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

          const recModel =
            record?.inputs?.model ||
            record?.identification?.recommendedModel ||
            record?.recommendedModel;
          if (recModel) {
            setVideoModel(recModel);
          }

          const recDuration =
            record?.inputs?.duration ||
            record?.identification?.recommendedDurationSeconds ||
            record?.recommendedDurationSeconds;
          if (recDuration) {
            const durNum = parseInt(String(recDuration).replace(/\D/g, ''), 10);
            if (durNum) {
              setVideoDuration(`${durNum}s`);
              setDurationInputText(String(durNum));
            }
          }

          const recAspect =
            record?.inputs?.aspectRatio ||
            record?.identification?.recommendedAspectRatio ||
            record?.recommendedAspectRatio;
          if (recAspect) {
            setAspectRatio(recAspect);
          }

          const recReason =
            record?.identification?.recommendationReason ||
            record?.recommendationReason ||
            record?.reason ||
            '';
          if (recReason) {
            setRecommendationReason(recReason);
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

    // Supported platform URLs (YouTube, Instagram, Facebook, TikTok, Twitter, Pinterest)
    if (getYouTubeVideoId(url) || isResolvablePlatformUrl(url)) {
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
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remainingSlots = 3 - productImages.length;
    if (remainingSlots <= 0) {
      setErrors((prev) => ({ ...prev, productImages: 'Maximum 3 images allowed.' }));
      e.target.value = '';
      return;
    }

    const validImageFiles = files.filter((f) => f.type && f.type.startsWith('image/'));
    const invalidCount = files.length - validImageFiles.length;

    if (validImageFiles.length === 0) {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Invalid image source. Please select valid image files.',
      }));
      e.target.value = '';
      return;
    }

    const filesToAdd = validImageFiles.slice(0, remainingSlots);

    if (validImageFiles.length > remainingSlots) {
      setErrors((prev) => ({
        ...prev,
        productImages: `Only ${remainingSlots} image${remainingSlots > 1 ? 's' : ''} added. Maximum 3 images allowed in total.`,
      }));
    } else if (invalidCount > 0) {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Some non-image files were skipped.',
      }));
    } else {
      setErrors((prev) => ({ ...prev, productImages: '' }));
    }

    const newImages = filesToAdd.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setProductImages((prev) => [...prev, ...newImages]);
    e.target.value = '';
  };

  const handleAddProductUrl = (url) => {
    if (!url || typeof url !== 'string') return;
    const cleanUrl = extractCleanUrl(url);
    if (!cleanUrl) return;

    if (productImages.length >= 3) {
      setErrors((prev) => ({ ...prev, productImages: 'Maximum 3 images allowed.' }));
      return;
    }

    // Reject obvious video / social platform / document / non-image links immediately
    const isObviousNonImage =
      /\.(mp4|webm|mov|m4v|avi|mkv|flv|wmv|pdf|html|php|asp|txt|doc|docx)(\?.*)?$/i.test(cleanUrl) ||
      /(?:youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|vimeo\.com|dailymotion\.com|linkedin\.com|github\.com|medium\.com|dev\.to|prnt\.sc)/i.test(cleanUrl);

    if (isObviousNonImage) {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Invalid image source. Please enter a valid image URL or upload an image.',
      }));
      return;
    }

    // Direct image extension or data / blob URL
    if (isImageUrl(cleanUrl) || cleanUrl.startsWith('data:image/') || cleanUrl.startsWith('blob:')) {
      setProductImages((prev) => [...prev, { file: null, preview: cleanUrl }]);
      setProductUrlInput('');
      setErrors((prev) => ({ ...prev, productImages: '' }));
      return;
    }

    // Dynamic URL probe: verify with Image loader
    const img = new Image();
    img.onload = () => {
      setProductImages((prev) => [...prev, { file: null, preview: cleanUrl }]);
      setProductUrlInput('');
      setErrors((prev) => ({ ...prev, productImages: '' }));
    };
    img.onerror = () => {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Invalid image source. Please enter a valid image URL or upload an image.',
      }));
    };
    img.src = cleanUrl;
  };

  const handlePasteProductImage = (e) => {
    if (productImages.length >= 3) {
      setErrors((prev) => ({ ...prev, productImages: 'Maximum 3 images allowed.' }));
      return;
    }
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            setProductImages((prev) => [...prev, { file, preview: URL.createObjectURL(file) }]);
            setProductUrlInput('');
            setErrors((prev) => ({ ...prev, productImages: '' }));
            return;
          }
        }
      }
    }
    const pastedText = e.clipboardData?.getData('text');
    if (pastedText && pastedText.trim()) {
      e.preventDefault(); // Prevent browser native concatenation / double paste
      const cleanUrl = extractCleanUrl(pastedText);
      setProductUrlInput(cleanUrl); // Replace with recent link
      handleAddProductUrl(cleanUrl);
    }
  };

  const removeProductImage = (index) => {
    setProductImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Check form validity (Source video <= 60s mandatory, must be valid video source, Product images 1-3 valid)
  const isFormValid = useMemo(() => {
    const currentVideoSource = sourceVideoUrl || galleryVideoUrl;
    const isSourceVideoValid =
      Boolean(currentVideoSource) &&
      !errors.sourceVideo &&
      !previewVideoError &&
      !isImageUrl(currentVideoSource) &&
      (sourceDuration === null || sourceDuration <= 60);

    const isProductImagesValid =
      productImages.length >= 1 &&
      productImages.length <= 3;

    return Boolean(
      isSourceVideoValid &&
      isProductImagesValid &&
      videoModel &&
      (selectedVideoDuration || videoDuration) &&
      aspectRatio
    );
  }, [sourceVideoUrl, galleryVideoUrl, errors.sourceVideo, previewVideoError, sourceDuration, productImages, videoModel, selectedVideoDuration, videoDuration, aspectRatio]);

  const handleTryAgain = () => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    setAnalysisError(null);
    setUserSafeError(null);
    setAnalysisResult(null);
    setGeneratedVideoUrl(null);
    setGenerateError(null);
    setRecommendationReason('');
    handleStartAnalyze();
  };

  const handleGoBackToForm = () => {
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
    setIsGenerating(false);
    setGeneratedVideoUrl(null);
    setGenerateError(null);
    setRecommendationReason('');
    setCurrentStep('input');
  };

  const handleResetAnalysis = () => {
    handleTryAgain();
  };

  const handleGenerate = async () => {
    if (!analysisSessionId || isGenerating) return;

    try {
      setIsGenerating(true);
      setGenerateError(null);

      const targetDurationNum = parseInt(selectedVideoDuration || videoDuration, 10) || 8;
      const payload = {
        sessionId: analysisSessionId,
        inputs: {
          targetDurationSeconds: targetDurationNum,
          aspectRatio: aspectRatio || '9:16',
          brandName: brandName || '',
          productBrandName: brandName || '',
          visualDescription: editableVisualDescription || '',
          additionalInstructions: additionalInfo || '',
          model: videoModel || 'google-omni',
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

  if (currentStep === 'input') {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden">
        <div
          onPaste={handlePrefillPaste}
          className="w-full max-w-[560px] rounded-[32px] border border-[#DDD7CD] bg-[#FCFAF7] p-8 shadow-none backdrop-blur-xl sm:p-10 dark:border-white/10 dark:bg-[#18181B] dark:shadow-none"
        >
          {/* Header */}
          <div className="relative mb-6 flex items-center justify-center gap-3 text-gray-900 dark:text-white sm:mb-8">
            <Clapperboard className="h-6 w-6 text-gray-900 dark:text-white" />
            <h2 className="text-xl font-semibold tracking-tight">Re Create Ad</h2>
            <button
              onClick={onClose}
              type="button"
              className="absolute -top-2 -right-4 rounded-full p-2 text-gray-500 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="flex flex-col gap-5">
            {/* 1. Source Video URL / Gallery video */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700 dark:text-white/90">
                Source Video URL / Gallery video <span className="text-red-500">*</span>
              </label>

              <div
                className={`flex items-center gap-2 rounded-full border bg-[#F6F2EC] px-1 py-1 text-xs text-zinc-600 transition dark:bg-white/[0.03] dark:text-[#afafaf] ${
                  prefillError
                    ? 'border-red-500'
                    : 'border-[#DDD7CD] dark:border-white/10'
                }`}
              >
                {sourceVideoFile ? (
                  <div className="flex flex-1 items-center justify-between min-w-0 pr-2 pl-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <Video className="h-4 w-4 text-zinc-500 dark:text-[#909294] shrink-0" />
                      <span
                        className="truncate text-xs font-medium text-zinc-800 dark:text-white"
                        title={sourceVideoFile.name}
                      >
                        {sourceVideoFile.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSourceVideoFile(null);
                        setPrefillUrl('');
                        setSourceVideoUrl('');
                        setGalleryVideoUrl('');
                        uploadedS3UrlRef.current = '';
                        lastUploadedFileRef.current = null;
                        lastPrefilledSourceRef.current = '';
                        setPrefillError('');
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0 cursor-pointer mr-1"
                      title="Clear selected video"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-between min-w-0">
                    <input
                      type="text"
                      placeholder="Paste video URL or upload..."
                      value={prefillUrl}
                      onPaste={handlePrefillPaste}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPrefillUrl(val);
                        setSourceVideoUrl(val.trim());
                        setGalleryVideoUrl('');
                        setPrefillError('');
                        if (sourceVideoFile) {
                          setSourceVideoFile(null);
                        }
                        if (val !== lastPrefilledSourceRef.current) {
                          uploadedS3UrlRef.current = '';
                          lastUploadedFileRef.current = null;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && prefillUrl?.trim() && !isAnalyzing) {
                          handleStartAnalyze();
                        }
                      }}
                      disabled={isAnalyzing}
                      className="w-full rounded-full bg-transparent pr-4 pl-5 py-2.5 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none dark:text-white dark:placeholder:text-white/30 disabled:opacity-50"
                    />
                    {prefillUrl ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPrefillUrl('');
                          setSourceVideoUrl('');
                          setGalleryVideoUrl('');
                          setSourceVideoFile(null);
                          uploadedS3UrlRef.current = '';
                          lastUploadedFileRef.current = null;
                          lastPrefilledSourceRef.current = '';
                          setPrefillError('');
                        }}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0 cursor-pointer mr-2"
                        title="Clear video URL"
                        aria-label="Clear video URL"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                )}

                <label
                  htmlFor="prefill-video-file-upload"
                  className="flex cursor-pointer items-center gap-1 rounded-full bg-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-800 transition hover:bg-zinc-300 dark:bg-white/10 dark:text-white dark:hover:bg-white/15 shrink-0"
                >
                  <CloudUpload className="h-3.5 w-3.5 text-current" />
                  <span className="whitespace-nowrap">Upload Video</span>
                </label>
                <input
                  id="prefill-video-file-upload"
                  type="file"
                  className="hidden"
                  accept="video/*"
                  onChange={handlePrefillVideoUpload}
                />
              </div>

              {prefillError && (
                <p className="mt-1 text-xs text-red-500 dark:text-red-400">{prefillError}</p>
              )}
            </div>

            {/* 2. Product (1-3 images) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-white/90">
                  Product Images <span className="text-red-500">*</span>
                </label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {productImages.length}/3 images
                </span>
              </div>

              <div
                onPaste={handlePasteProductImage}
                className="flex items-center gap-2 rounded-full border border-[#DDD7CD] bg-[#F6F2EC] px-1 py-1 text-xs text-zinc-600 transition dark:border-white/10 dark:bg-white/[0.03] dark:text-[#afafaf]"
              >
                <div className="flex flex-1 items-center justify-between min-w-0">
                  <input
                    value={productUrlInput}
                    onChange={(e) => {
                      const clean = extractCleanUrl(e.target.value);
                      setProductUrlInput(clean);
                      if (!clean) {
                        setErrors((prev) => ({ ...prev, productImages: '' }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && productUrlInput) {
                        e.preventDefault();
                        handleAddProductUrl(productUrlInput);
                      }
                    }}
                    disabled={productImages.length >= 3}
                    className="w-full rounded-full bg-transparent pr-4 pl-5 py-2.5 text-xs text-zinc-800 placeholder:text-zinc-500 focus:outline-none dark:text-white dark:placeholder:text-white/30 disabled:opacity-50"
                    placeholder={
                      productImages.length >= 3
                        ? 'Maximum 3 images added'
                        : 'Paste product image URL & press Enter'
                    }
                  />
                  {productUrlInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProductUrlInput('');
                        setErrors((prev) => ({ ...prev, productImages: '' }));
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0 cursor-pointer mr-2"
                      title="Clear product URL"
                      aria-label="Clear product URL"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                <label
                  htmlFor="input-product-image-file"
                  className={`flex items-center gap-1 rounded-full px-3.5 py-2 text-xs font-medium shrink-0 ${
                    productImages.length >= 3
                      ? 'cursor-not-allowed bg-zinc-200 text-zinc-400 dark:bg-white/5 dark:text-zinc-500'
                      : 'cursor-pointer bg-zinc-200 text-zinc-800 hover:bg-zinc-300 dark:bg-white/10 dark:text-white dark:hover:bg-white/15'
                  }`}
                >
                  <CloudUpload className="h-3.5 w-3.5 text-current" />
                  <span className="whitespace-nowrap">Upload Image</span>
                </label>
                <input
                  id="input-product-image-file"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  multiple
                  disabled={productImages.length >= 3}
                  onChange={handleProductImageUpload}
                />
              </div>

              {errors.productImages && (
                <span className="text-xs font-medium text-red-500">{errors.productImages}</span>
              )}

              {productImages.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {productImages.map((img, index) => (
                    <div
                      key={index}
                      className="group relative h-14 w-14 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 shadow-sm"
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
                        className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition duration-200 group-hover:opacity-100 cursor-pointer"
                        onClick={() => removeProductImage(index)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="mt-8 flex justify-end gap-3 sm:mt-10">
            <button
              type="button"
              onClick={handleStartAnalyze}
              disabled={
                (!prefillUrl?.trim() && !sourceVideoFile && !sourceVideoUrl) ||
                productImages.length === 0 ||
                isAnalyzing
              }
              className={`rounded-full px-8 py-2.5 text-sm font-bold shadow-lg transition-all ${
                (!prefillUrl?.trim() && !sourceVideoFile && !sourceVideoUrl) ||
                productImages.length === 0 ||
                isAnalyzing
                  ? 'bg-zinc-300 text-zinc-500 dark:bg-white/10 dark:text-white/30 cursor-not-allowed pointer-events-none'
                  : 'bg-gray-900 text-white dark:bg-white dark:text-black hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] cursor-pointer'
              }`}
            >
              {isAnalyzing ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                'Continue'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full items-start gap-2">
      {/* Top Header Action: Change Video Button outside the card */}
      <div className="w-full flex items-center justify-start pl-1">
        <button
          type="button"
          onClick={() => {
            if (timeoutTimerRef.current) {
              clearTimeout(timeoutTimerRef.current);
              timeoutTimerRef.current = null;
            }
            setCurrentStep('input');
          }}
          className="flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition active:scale-95 cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>Change Video</span>
        </button>
      </div>

      {/* Main Unified Workspace Card */}
      <div className="relative flex flex-col justify-center w-full overflow-hidden rounded-[28px] border border-black/5 dark:border-white/10 bg-white/95 dark:bg-[#18181B] shadow-2xl p-6 sm:p-7 2xl:p-8">
        {/* Top Right Close Button */}
        <button
          onClick={onClose}
          type="button"
          className="absolute top-4 right-4 z-30 rounded-full p-2 text-zinc-500 transition hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 w-full gap-7 lg:gap-9 items-center justify-center my-auto overflow-hidden">
          {/* Left side — Video Preview Canvas (Borderless, Sleek, Symmetrically Centered) */}
          <div className="relative flex items-center justify-center w-full my-auto overflow-hidden">
            {/* Aspect-Ratio Adapting Video Preview */}
            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-2xl lg:rounded-3xl bg-black/90 dark:bg-zinc-950 transition-all duration-300 ${
                aspectRatio === '9:16'
                  ? 'aspect-[9/16] h-[480px] 2xl:h-[520px] max-h-full w-auto'
                  : aspectRatio === '1:1'
                  ? 'aspect-square h-[420px] 2xl:h-[460px] max-h-full w-auto'
                  : 'aspect-video w-full max-h-[300px] 2xl:max-h-[340px]'
              }`}
            >
              {previewVideoError ? (
                <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-3 shadow-inner">
                    <Video className="h-6 w-6 text-zinc-400" />
                  </div>
                  <p className="text-sm font-semibold text-zinc-200 max-w-xs leading-relaxed">
                    Unable to preview this video
                  </p>
                  <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
                    We couldn't load a preview for this video. Please try another URL or upload the video directly.
                  </p>
                </div>
              ) : sourceType === 'direct-video' ? (
                <video
                  key={effectiveMediaUrl}
                  src={effectiveMediaUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  referrerPolicy="no-referrer"
                  onLoadedMetadata={(e) => validateSourceDuration(e.target.duration)}
                  onError={() => setPreviewVideoError(true)}
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              ) : sourceType === 'youtube' ? (
                <YouTubePreviewPlayer
                  key={youtubeId}
                  videoId={youtubeId}
                  onDurationChange={validateSourceDuration}
                />
              ) : sourceType === 'instagram' ? (
                <InstagramMetaEmbed
                  key={effectiveMediaUrl}
                  url={effectiveMediaUrl}
                />
              ) : sourceType === 'linkedin' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black p-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center">
                  <LinkedInEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" />
                </div>
              ) : sourceType === 'tiktok' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black p-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center">
                  <TikTokEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" />
                </div>
              ) : sourceType === 'facebook' ? (
                <FacebookMetaEmbed
                  key={effectiveMediaUrl}
                  url={effectiveMediaUrl}
                />
              ) : sourceType === 'twitter' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black p-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center">
                  <TwitterEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" />
                </div>
              ) : sourceType === 'pinterest' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black p-2 [&>div]:w-full [&>div]:flex [&>div]:justify-center">
                  <PinterestEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" />
                </div>
              ) : CLONE_YOUR_AD_DEMO_URL?.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                <video
                  src={CLONE_YOUR_AD_DEMO_URL}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              ) : (
                <img
                  src={CLONE_YOUR_AD_DEMO_URL}
                  alt="Re Create Ad Demo Preview"
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              )}
            </div>

            {/* Error overlay if video exceeds 60 seconds */}
            {sourceDuration > 60 && (
              <div className="absolute bottom-3 left-4 right-4 z-20 flex items-center gap-2 rounded-xl bg-red-600/90 p-2.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  Video is too long ({formatDuration(sourceDuration)}). Please select a video that is 60 seconds or less.
                </span>
              </div>
            )}
          </div>

          {/* Right side — Form Controls */}
          <div className="flex flex-col justify-center gap-3.5 2xl:gap-4 w-full text-zinc-900 dark:text-white">
            {/* Top Title */}
            <div>
              <h2 className="text-lg lg:text-xl font-bold uppercase tracking-wide text-zinc-900 dark:text-white">
                Re Create Ad
              </h2>
            </div>

            {/* ── ANALYSIS RESULT STATE (Photo 4) ─────────────────────────────── */}
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
                      Generated Re Create Ad Video
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
                    rows={3}
                    placeholder="Analysis visual description summary..."
                    className="max-h-28 w-full resize-none overflow-y-auto rounded-xl border border-black/10 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800 transition focus:border-[#15DCFF]/50 focus:outline-none focus:ring-1 focus:ring-[#15DCFF]/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
                  />
                </div>

                {/* Model & Duration (2 Columns) */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 items-start">
                  {/* Model */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1 justify-start">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      AI MODEL
                    </label>
                    <CommonDropdown
                      options={videoChatModels}
                      label="AI Model"
                      icon={SparkleDark}
                      type="b-roll"
                      className="w-full min-w-0 justify-between !h-7.5 md:!h-8 2xl:!h-9 !py-0 px-3 2xl:px-4 [&>div]:min-w-0 [&>div>span]:truncate"
                      value={videoChatModels.find((o) => o.value === videoModel)}
                      onChange={(val) => {
                        setVideoModel(val);
                        setErrors((prev) => ({ ...prev, videoModel: '' }));
                      }}
                    />
                  </div>

                  {/* Duration (Dropdown) */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1 justify-start">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      DURATION
                    </label>
                    <CommonDropdown
                      options={configuredDurationOptions}
                      label="Duration"
                      icon={TimerDarkLogo}
                      type="b-roll"
                      className="w-full min-w-0 justify-between !h-7.5 md:!h-8 2xl:!h-9 !py-0 px-3 2xl:px-4 [&>div]:min-w-0 [&>div>span]:truncate"
                      value={configuredDurationOptions.find((o) => o.value === selectedVideoDuration) || configuredDurationOptions[0]}
                      onChange={(val) => {
                        setVideoDuration(val);
                        setErrors((prev) => ({ ...prev, videoDuration: '' }));
                      }}
                    />
                  </div>
                </div>

                {/* Aspect Ratio (Full Width with wrapping so all options like Seedance 2.5 show fully) */}
                <div className="flex flex-col gap-1.5 justify-start">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    ASPECT RATIO
                    {isAspectRatioLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
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
                          className={`flex items-center justify-center gap-1.5 rounded-[50px] border px-3 py-1.5 text-[11px] md:text-xs transition font-medium cursor-pointer ${
                            isSelected
                              ? 'border-black/20 bg-black/10 font-semibold text-zinc-900 dark:border-white/30 dark:bg-white/15 dark:text-white'
                              : 'border-black/10 bg-transparent text-zinc-500 hover:text-zinc-900 hover:bg-black/5 dark:border-white/10 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5'
                          }`}
                          title={label}
                        >
                          <AspectRatioPreview
                            ratio={value}
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isSelected
                                ? 'text-zinc-900 dark:text-white'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                          />
                          <span className="whitespace-nowrap">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* AI Recommendation Reason (Display Text) */}
                {recommendationReason && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      REASON
                    </label>
                    <div className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300">
                      {recommendationReason}
                    </div>
                  </div>
                )}

                {/* Additional Instructions (Optional) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    ADDITIONAL INSTRUCTIONS (OPTIONAL)
                  </label>
                  <input
                    type="text"
                    value={additionalInfo}
                    onChange={(e) => setAdditionalInfo(e.target.value)}
                    placeholder="e.g. emphasize vibrant lighting, keep fast pace..."
                    className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-800 transition focus:border-[#15DCFF]/50 focus:outline-none focus:ring-1 focus:ring-[#15DCFF]/50 dark:border-white/10 dark:bg-white/5 dark:text-white"
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
                <div className="mt-1 flex items-center justify-end gap-3 pt-1">
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
                          type="button"
                          disabled={isGenerating || (hasEstimateInputs && !enough)}
                          onClick={handleGenerate}
                          className={`flex items-center gap-2 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-7 py-2.5 text-xs font-semibold text-white shadow-md transition hover:opacity-90 cursor-pointer ${isGenerating || (hasEstimateInputs && !enough) ? 'cursor-not-allowed opacity-70' : ''
                            }`}
                        >
                          {isGenerating && <Loader2 className="h-4 w-4 animate-spin" />}
                          {isGenerating ? 'Generating Video...' : 'Generate →'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : analysisState === 'analyzing' || isAnalyzing ? (
              /* ── AI STACKED CARD ANALYSIS UI (Photo 2) ────────────────────────── */
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
                          className={`flex items-center justify-between rounded-xl border p-3.5 shadow-xl backdrop-blur-md transition-colors ${isActive
                              ? 'border-[#15DCFF]/40 bg-zinc-900/90 text-white shadow-[#15DCFF]/10 dark:bg-[#18181b]/95'
                              : 'border-zinc-800/80 bg-zinc-900/60 text-zinc-400 dark:bg-[#18181b]/60'
                            }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isActive
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
              /* ── ANALYSIS FAILED STATE ─────────────────────────────────────── */
              <div className="my-auto flex flex-col items-center justify-center gap-4 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400">
                  <AlertTriangle className="h-6 w-6" />
                </div>

                <div className="flex max-w-sm flex-col items-center gap-1.5">
                  <h3 className="text-base font-bold text-zinc-900 2xl:text-lg dark:text-white">
                    Analysis Failed
                  </h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    We couldn't complete the analysis for this ad.
                  </p>
                  {userSafeError ? (
                    <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs leading-relaxed text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                      <span className="font-bold">Reason: </span>
                      {userSafeError}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      The analysis could not be completed. Please try again.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleTryAgain}
                  className="mt-2 flex items-center gap-2 rounded-full bg-gray-900 px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Try Again
                </button>
              </div>
            ) : analysisState === 'timeout' ? (
              /* ── ANALYSIS TIMEOUT STATE ───────────────────────────────────── */
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
                  className="mt-2 flex items-center gap-2 rounded-full bg-gray-900 px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 dark:bg-white dark:text-black cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Try Again
                </button>
              </div>
            ) : null}
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

export default CloneYourAdPage;

