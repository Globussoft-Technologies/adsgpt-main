import CommonDropdown from '@/components/common/AdPrompt/CommonDropdown';
import UpgradeModal from '../UpgradeModal';
import { CloudUpload, LinkIcon, Loader2, Video, X, Clock, AlertCircle, AlertTriangle, Sparkles, RotateCcw, ArrowRight, CheckCircle2, Check, Cpu, Layers, Search, FileText, Minus, Plus, ChevronLeft, Clapperboard, ExternalLink, Eye } from 'lucide-react';
import SparkleDark from '@/assets/layouts/prompt/sparkle-dark.svg';
import TimerDarkLogo from '@/assets/layouts/prompt/advideo/timer.svg';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getSocket } from '@/store/reducers/socket/socketSlice';
import emitter from '@/utils/eventEmitter';
import { fetchModelCreditsAction } from '@/store/actions/adStudio/promptActions';
import { cloneAdAnalyzeAction, cloneAdGenerateAction, getVideoById } from '@/store/actions/adVideoNew/Advideoactions';
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
import {
  setRecreateInputs,
  setActivePage,
  setMySpaceTab,
  setActiveRecreateSession,
  updateActiveRecreateSession,
  clearActiveRecreateSession,
} from '@/store/reducers/adStudio/adVideoNewSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { estimateAdVideoCredits } from '@/utils/creditEstimator';

const SIGNUP_URL = import.meta.env.VITE_SIGNUP_URL;
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

// Default demo visual asset for Clone Your Ad (isolated for easy S3/CDN replacement)
const CLONE_YOUR_AD_DEMO_URL =
  'https://dqv0cqkoy5oj7.cloudfront.net/marketing_studio_video_preset/4dcc2a50-47de-46a1-b7e6-d5bd378bb5d1-91841e48382ec5af.mp4';

// 5 Sequential Checklist Steps for Analysis Progress (Matching Reference)
const ANALYSIS_CHECKLIST_STEPS = [
  { id: 'video', title: 'Reading the video', min: 0, max: 20 },
  { id: 'scenes', title: 'Detecting scenes and cuts', min: 20, max: 45 },
  { id: 'script', title: 'Extracting script and voiceover', min: 45, max: 70 },
  { id: 'hook', title: 'Identifying the hook and CTA', min: 70, max: 90 },
  { id: 'product', title: 'Matching scenes to your product', min: 90, max: 100 },
];



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

// Helper function to check if URL is a direct video link or blob/stream
const isDirectVideoUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:video/')) return true;
  return /\.(mp4|mov|webm|mkv|avi|m4v|3gp|flv|ogv|ts|wmv)(\?.*)?$/i.test(trimmed);
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

// Helper function to validate if input string is a genuine video link
const isValidVideoSourceUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Basic URL structure check
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('blob:') && !trimmed.startsWith('data:video/')) {
    return false;
  }

  // Reject image URLs explicitly
  if (isImageUrl(trimmed)) {
    return false;
  }

  // Direct video file formats or blob
  if (isDirectVideoUrl(trimmed)) {
    return true;
  }

  // YouTube
  if (getYouTubeVideoId(trimmed)) {
    return true;
  }

  // Supported social video platforms
  if (isResolvablePlatformUrl(trimmed)) {
    return true;
  }

  // Other known video hosting platforms
  if (
    /(?:dailymotion\.com|dai\.ly)/i.test(trimmed) ||
    /loom\.com\/share/i.test(trimmed) ||
    /streamable\.com/i.test(trimmed) ||
    /(?:twitch\.tv|clips\.twitch\.tv)/i.test(trimmed) ||
    /reddit\.com\/r\/.*\/comments\//i.test(trimmed) ||
    /(?:wistia\.com|wi\.st)/i.test(trimmed)
  ) {
    return true;
  }

  return false;
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
      className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden pointer-events-none [&_div]:w-full [&_div]:h-full [&_div]:flex [&_div]:items-center [&_div]:justify-center [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!min-w-full [&_iframe]:!min-h-full [&_iframe]:border-0 [&_iframe]:object-cover [&_iframe]:pointer-events-none"
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
          We can't show the preview
        </p>
        <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
          You can see this video on a different page.
        </p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20 hover:border-white/30 cursor-pointer active:scale-95"
          >
            <span>Open Video on Different Page</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
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
          We can't show the preview
        </p>
        <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
          You can see this video on a different page.
        </p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20 hover:border-white/30 cursor-pointer active:scale-95"
          >
            <span>Open Video on Different Page</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center"
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
          className={`w-full h-full border-0 object-cover ${isLoading ? 'hidden' : ''}`}
          style={{ border: 'none', overflow: 'hidden', width: '100%', height: '100%' }}
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



const CloneYourAdPage = ({ onClose, handleGenerate: onGenerateSuccess, onGenerate: onGenerateProp, registerBackHandler }) => {
  const { recreateInputs, activeRecreateSession } = useSelector((state) => state.adVideoNew || {});
  
  const savedSession = useMemo(() => {
    if (activeRecreateSession?.sessionId) return activeRecreateSession;
    try {
      const raw = sessionStorage.getItem('activeRecreateSession');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [activeRecreateSession]);

  const initialSessionInputs = savedSession?.inputs || {};

  const [sourceVideoUrl, setSourceVideoUrl] = useState(
    () => initialSessionInputs.sourceVideoUrl || recreateInputs?.sourceVideoUrl || ''
  );
  const [galleryVideoUrl, setGalleryVideoUrl] = useState(
    () => initialSessionInputs.galleryVideoUrl || recreateInputs?.galleryVideoUrl || ''
  );
  const [sourceVideoFile, setSourceVideoFile] = useState(null);
  const [localVideoBlobUrl, setLocalVideoBlobUrl] = useState('');
  const [sourceDuration, setSourceDuration] = useState(null); // Isolated source video length in seconds
  const [previewVideoError, setPreviewVideoError] = useState(false);
  const [productImages, setProductImages] = useState(() => {
    if (Array.isArray(initialSessionInputs.productImages) && initialSessionInputs.productImages.length > 0) {
      return initialSessionInputs.productImages;
    }
    if (Array.isArray(initialSessionInputs.productImageUrls) && initialSessionInputs.productImageUrls.length > 0) {
      return initialSessionInputs.productImageUrls.map((u) => ({
        preview: u,
        s3Url: u,
        url: u,
        name: 'Product Image',
      }));
    }
    return [];
  });
  const [productUrlInput, setProductUrlInput] = useState('');
  const [videoModel, setVideoModel] = useState(
    () => initialSessionInputs.model || ''
  );
  const [videoDuration, setVideoDuration] = useState(
    () => initialSessionInputs.duration || ''
  );
  const [aspectRatio, setAspectRatio] = useState(
    () => initialSessionInputs.aspectRatio || ''
  );
  const [detectedVideoAspectRatio, setDetectedVideoAspectRatio] = useState(
    () => initialSessionInputs.aspectRatio || ''
  );
  const [brandName, setBrandName] = useState(
    () => initialSessionInputs.brandName || ''
  );
  const [additionalInfo, setAdditionalInfo] = useState(
    () => initialSessionInputs.additionalInstructions || ''
  );
  const [recommendationReason, setRecommendationReason] = useState(
    () => savedSession?.recommendationReason || ''
  );

  // Step state: 'input' | 'workspace'
  const [currentStep, setCurrentStep] = useState(() => {
    // A template pre-fill (Ad Video home → DS video template, `prefillOnly`)
    // always starts on the input form — checked before the saved session,
    // because the user just picked a new template. See handleRecreate.
    if (recreateInputs?.prefillOnly) return 'input';
    if (savedSession?.sessionId) return 'workspace';
    if (
      recreateInputs?.sourceVideoUrl ||
      recreateInputs?.galleryVideoUrl ||
      recreateInputs?.videoSample
    ) {
      return 'workspace';
    }
    return 'input';
  });
  const [prefillUrl, setPrefillUrl] = useState(
    () =>
      initialSessionInputs.sourceVideoUrl ||
      initialSessionInputs.galleryVideoUrl ||
      initialSessionInputs.prefillUrl ||
      recreateInputs?.sourceVideoUrl ||
      recreateInputs?.galleryVideoUrl ||
      '');
  const [prefillError, setPrefillError] = useState('');

  // Analyze & Socket Async State: 'form' | 'analyzing' | 'success' | 'failed' | 'timeout'
  const [analysisState, setAnalysisState] = useState(() => {
    if (savedSession?.status === 'success') return 'success';
    if (savedSession?.status === 'failed') return 'failed';
    if (savedSession?.status === 'analyzing') return 'analyzing';
    return 'form';
  });
  const [isAnalyzing, setIsAnalyzing] = useState(
    () => savedSession?.status === 'analyzing'
  );
  const [analysisSessionId, setAnalysisSessionId] = useState(
    () => savedSession?.sessionId || null
  );
  const [analyzeProgress, setAnalyzeProgress] = useState(() => {
    if (savedSession?.status === 'success') return 100;
    const promptPct = savedSession?.promptPercentage ?? savedSession?.progress;
    if (typeof promptPct === 'number' && !isNaN(promptPct)) {
      return Math.min(100, Math.max(0, Math.round(promptPct)));
    }
    return 0;
  });
  const [analyzeStageText, setAnalyzeStageText] = useState('');
  const [analysisCards, setAnalysisCards] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(
    () => savedSession?.analysisResult || null
  );
  const [analysisError, setAnalysisError] = useState(null);
  const [userSafeError, setUserSafeError] = useState(null);
  const [editableVisualDescription, setEditableVisualDescription] = useState(
    () => savedSession?.analysisResult?.visualDescription || ''
  );

  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;

  const isAnalyzingRef = useRef(isAnalyzing);
  isAnalyzingRef.current = isAnalyzing;

  const analysisStateRef = useRef(analysisState);
  analysisStateRef.current = analysisState;

  const currentSessionIdRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  const uploadedS3UrlRef = useRef('');
  const lastUploadedFileRef = useRef(null);
  const lastPrefilledSourceRef = useRef('');
  const localVideoBlobUrlRef = useRef('');
  const preferredDurationRef = useRef(initialSessionInputs.duration || '');
  const preferredAspectRatioRef = useRef(initialSessionInputs.aspectRatio || '');
  const userSelectedAspectRatioRef = useRef(Boolean(initialSessionInputs.aspectRatio));
  const additionalInfoTextareaRef = useRef(null);
  const summaryTextareaRef = useRef(null);

  // Auto-resize Additional Instructions textarea and show scrollbar ONLY when content exceeds max-height
  useEffect(() => {
    const el = additionalInfoTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const scrollH = el.scrollHeight;
    if (!additionalInfo?.trim()) {
      el.style.height = '40px';
      el.style.overflowY = 'hidden';
    } else {
      const targetH = Math.min(Math.max(scrollH, 40), 96);
      el.style.height = `${targetH}px`;
      el.style.overflowY = scrollH > 96 ? 'auto' : 'hidden';
    }
  }, [additionalInfo, analysisState]);

  // Auto-resize Summary textarea
  useEffect(() => {
    const el = summaryTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const scrollH = el.scrollHeight;
    const targetH = Math.min(Math.max(scrollH, 56), 100);
    el.style.height = `${targetH}px`;
    el.style.overflowY = scrollH > 100 ? 'auto' : 'hidden';
  }, [editableVisualDescription, analysisState]);

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
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setLightboxOpen(false);
      } else if (e.key === 'ArrowLeft') {
        setLightboxIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setLightboxIndex((prev) => Math.min(lightboxImages.length - 1, prev + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, lightboxImages.length]);

  const { connected, userData, credits } = useSelector((state) => state.socket);
  const { modelCredits } = useSelector((state) => state.prompt || {});
  const availableCredits = (credits?.totalCredits || 0) - (credits?.creditsUsed || 0);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
  }, [dispatch]);

  const detectVideoFileRatio = (fileOrBlob) => {
    try {
      const tempVid = document.createElement('video');
      tempVid.preload = 'metadata';
      const isFile = typeof fileOrBlob !== 'string';
      const url = isFile ? URL.createObjectURL(fileOrBlob) : fileOrBlob;
      tempVid.src = url;
      tempVid.onloadedmetadata = () => {
        if (isFile) {
          URL.revokeObjectURL(url);
        }
        const w = tempVid.videoWidth;
        const h = tempVid.videoHeight;
        if (w && h) {
          const ratio = w / h;
          let detectedRatio = '9:16';
          if (ratio > 2.0) detectedRatio = '21:9';
          else if (ratio > 1.45) detectedRatio = '16:9';
          else if (ratio > 1.15) detectedRatio = '4:3';
          else if (ratio > 0.85) detectedRatio = '1:1';
          else if (ratio > 0.65) detectedRatio = '3:4';
          else detectedRatio = '9:16';

          setDetectedVideoAspectRatio(detectedRatio);
          if (!userSelectedAspectRatioRef.current) {
            preferredAspectRatioRef.current = detectedRatio;
            setAspectRatio(detectedRatio);
          }
        }
        if (tempVid.duration) {
          validateSourceDuration(tempVid.duration);
        }
      };
    } catch (e) {
      console.warn('[CloneYourAd] Could not detect video ratio:', e);
    }
  };

  const handleVideoMetadataLoaded = (e) => {
    const video = e.target;
    if (!video) return;
    if (video.duration) {
      validateSourceDuration(video.duration);
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      const ratio = w / h;
      let detectedRatio = '9:16';
      if (ratio > 2.0) detectedRatio = '21:9';
      else if (ratio > 1.45) detectedRatio = '16:9';
      else if (ratio > 1.15) detectedRatio = '4:3';
      else if (ratio > 0.85) detectedRatio = '1:1';
      else if (ratio > 0.65) detectedRatio = '3:4';
      else detectedRatio = '9:16';

      setDetectedVideoAspectRatio(detectedRatio);
      if (!userSelectedAspectRatioRef.current) {
        preferredAspectRatioRef.current = detectedRatio;
        setAspectRatio(detectedRatio);
      }
    }
  };

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

    if (localVideoBlobUrlRef.current) {
      URL.revokeObjectURL(localVideoBlobUrlRef.current);
    }
    const blobUrl = URL.createObjectURL(file);
    localVideoBlobUrlRef.current = blobUrl;
    setLocalVideoBlobUrl(blobUrl);

    setSourceVideoFile(file);
    setPrefillUrl(file.name);
    setSourceVideoUrl('');
    setGalleryVideoUrl('');
    setPreviewVideoError(false);
    setPrefillError('');
    detectVideoFileRatio(file);
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

            if (localVideoBlobUrlRef.current) {
              URL.revokeObjectURL(localVideoBlobUrlRef.current);
            }
            const blobUrl = URL.createObjectURL(file);
            localVideoBlobUrlRef.current = blobUrl;
            setLocalVideoBlobUrl(blobUrl);

            setSourceVideoFile(file);
            setPrefillUrl(file.name);
            setSourceVideoUrl('');
            setGalleryVideoUrl('');
            setPreviewVideoError(false);
            setPrefillError('');
            detectVideoFileRatio(file);
            return;
          }
        }
      }
    }

    const pastedText = e.clipboardData?.getData('text')?.trim();
    if (pastedText) {
      e.preventDefault();
      if (localVideoBlobUrlRef.current) {
        URL.revokeObjectURL(localVideoBlobUrlRef.current);
        localVideoBlobUrlRef.current = '';
        setLocalVideoBlobUrl('');
      }
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
      setPreviewVideoError(false);
      if (cleanUrl && !isValidVideoSourceUrl(cleanUrl)) {
        setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
      } else {
        setPrefillError('');
      }
    }
  };

  const handleStartAnalyze = async () => {
    const trimmed = (prefillUrl || '').trim();
    if (!sourceVideoFile) {
      if (!trimmed) {
        setPrefillError('Please enter a video URL or upload a video.');
        return;
      }
      if (!isValidVideoSourceUrl(trimmed)) {
        setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
        return;
      }
    }
    if (productImages.length === 0) {
      setErrors((prev) => ({
        ...prev,
        productImages: 'Please provide at least 1 product image.',
      }));
      return;
    }

    try {
      userSelectedAspectRatioRef.current = false;
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
        const finalProductObjects = (
          finalProductImageUrls.length > 0 ? finalProductImageUrls : productImages
        ).map((img) => {
          const url = typeof img === 'string' ? img : img.s3Url || img.preview || img.url || '';
          return {
            preview: url,
            s3Url: url,
            url: url,
            name: typeof img === 'object' && img.name ? img.name : 'Product Image',
          };
        });

        const sessionPayload = {
          sessionId: res.sessionId,
          status: 'analyzing',
          progress: 0,
          promptPercentage: 0,
          inputs: {
            sourceVideoUrl: finalSourceVidUrl,
            prefillUrl: finalSourceVidUrl || finalGalleryVidUrl || (sourceVideoFile ? sourceVideoFile.name : ''),
            galleryVideoUrl: finalGalleryVidUrl,
            productImages: finalProductObjects,
            productImageUrls: finalProductImageUrls,
            brandName: brandName || '',
            additionalInstructions: additionalInfo || '',
            model: defaultModel,
            targetDurationSeconds: defaultDuration,
            aspectRatio: defaultAspectRatio,
          },
        };

        dispatch(setActiveRecreateSession(sessionPayload));
        try {
          sessionStorage.setItem('activeRecreateSession', JSON.stringify(sessionPayload));
        } catch (err) {
          void err;
        }
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

  // Global Enter keyboard shortcut for the initial modal step ("Analyze reference ad")
  useEffect(() => {
    if (currentStep !== 'input') return;

    const handleGlobalKeyDown = (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;

      // If user is currently typing text in product-image-url-input, let the input's handler add the URL first
      const activeEl = document.activeElement;
      if (activeEl?.id === 'product-image-url-input' && productUrlInput?.trim()) {
        return;
      }

      // If user is in reference-video-url-input and URL is invalid, display error
      if (activeEl?.id === 'reference-video-url-input' && prefillUrl?.trim() && !isValidVideoSourceUrl(prefillUrl.trim())) {
        e.preventDefault();
        setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
        return;
      }

      const isVideoValid = Boolean(sourceVideoFile || (prefillUrl?.trim() && isValidVideoSourceUrl(prefillUrl.trim())));
      const isFormReady = Boolean(isVideoValid && productImages.length > 0 && !prefillError && !isAnalyzing);

      if (isFormReady) {
        e.preventDefault();
        handleStartAnalyze();
      } else {
        // If missing required fields, provide instant feedback
        if (!isVideoValid && !sourceVideoFile) {
          if (!prefillUrl?.trim()) {
            setPrefillError('Please enter a video URL or upload a video.');
          } else {
            setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
          }
        } else if (productImages.length === 0) {
          setErrors((prev) => ({
            ...prev,
            productImages: 'Please provide at least 1 product image.',
          }));
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [currentStep, sourceVideoFile, prefillUrl, productImages, productUrlInput, prefillError, isAnalyzing]);

  // Handle Recreate flow from MySpace video cards
  const handleRecreate = (inputs) => {
    if (!inputs) return;

    // ── Template pre-fill (Ad Video home → DS video template card) ──────────
    // Only puts the template's video in the reference-video field and stays on
    // the input form, so the user still adds product images and runs Analyze.
    // The history-recreate path below jumps to 'workspace' with the analysis
    // marked done, which is wrong for a fresh template. Dispatched by
    // AdVideoHomeNew as setRecreateInputs({ prefillOnly: true, sourceVideoUrl }).
    if (inputs.prefillOnly) {
      const url = String(inputs.sourceVideoUrl || '').trim();
      if (url) {
        uploadedS3UrlRef.current = '';
        lastUploadedFileRef.current = null;
        lastPrefilledSourceRef.current = url;
        setSourceVideoFile(null);
        setSourceVideoUrl(url);
        setGalleryVideoUrl('');
        setPrefillUrl(url);
        setPrefillError('');
        setPreviewVideoError(false);
      }
      setCurrentStep('input');
      dispatch(setRecreateInputs(null));
      return;
    }

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
      const rawM = String(inputs.model).toLowerCase();
      const matched = surfaceModels.find(
        (m) =>
          m.canonical?.toLowerCase() === rawM ||
          m.label?.toLowerCase() === rawM ||
          m.value?.toLowerCase() === rawM
      );
      setVideoModel(matched ? matched.canonical : inputs.model);
    }

    if (inputs.duration || inputs.targetDurationSeconds) {
      const rawDur = String(inputs.duration || inputs.targetDurationSeconds);
      const durNum = parseInt(rawDur, 10) || 8;
      const durStr = `${durNum}s`;
      preferredDurationRef.current = durStr;
      setVideoDuration(durStr);
      setDurationInputText(String(durNum));
      setErrors((prev) => ({ ...prev, videoDuration: '' }));
    }

    if (inputs.aspectRatio) {
      preferredAspectRatioRef.current = inputs.aspectRatio;
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

  const doStepBack = () => {
    // If analysis is actively in progress, prevent going back / terminating during analysis
    if (
      isAnalyzingRef.current ||
      analysisStateRef.current === 'analyzing' ||
      isAnalyzing ||
      analysisState === 'analyzing'
    ) {
      return false;
    }

    if (
      currentStepRef.current === 'workspace' ||
      analysisStateRef.current === 'success' ||
      analysisStateRef.current === 'failed' ||
      analysisStateRef.current === 'timeout'
    ) {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      setIsAnalyzing(false);
      setAnalysisState('form');
      setAnalyzeProgress(0);
      setAnalyzeStageText('');
      setAnalysisCards([]);
      setAnalysisResult(null);
      setAnalysisError(null);
      setUserSafeError(null);
      setGenerateError(null);
      setGeneratedVideoUrl(null);
      setRecommendationReason('');
      setAnalysisSessionId(null);
      currentSessionIdRef.current = null;
      userSelectedAspectRatioRef.current = false;

      // Full termination: Clear stored session from Redux & storage so the previous analysis is terminated and never restored on refresh
      dispatch(clearActiveRecreateSession());
      try {
        sessionStorage.removeItem('activeRecreateSession');
        localStorage.removeItem('activeRecreateSession');
      } catch (err) {
        void err;
      }

      const existingVideoSource =
        prefillUrl ||
        sourceVideoUrl ||
        galleryVideoUrl ||
        (sourceVideoFile ? sourceVideoFile.name : '') ||
        '';
      if (existingVideoSource) {
        setPrefillUrl(existingVideoSource);
        lastPrefilledSourceRef.current = existingVideoSource;
      }

      setCurrentStep('input');
      return true;
    }
    return false;
  };

  // Register direct back handler to parent AdVideoLayout
  useEffect(() => {
    if (typeof registerBackHandler === 'function') {
      registerBackHandler(doStepBack);
    }
    return () => {
      if (typeof registerBackHandler === 'function') {
        registerBackHandler(null);
      }
    };
  }, [registerBackHandler]);

  // Handle back navigation from top-left "< Recreate Ad" button via event emitter as backup
  useEffect(() => {
    const handleRecreateAdBack = (callback) => {
      const handled = doStepBack();
      if (typeof callback === 'function') callback(handled);
    };

    emitter.on('clone-ad:back', handleRecreateAdBack);
    return () => {
      emitter.off('clone-ad:back', handleRecreateAdBack);
    };
  }, []);

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
    const durStr = `${nextVal}s`;
    preferredDurationRef.current = durStr;
    setVideoDuration(durStr);
    setDurationInputText(String(nextVal));
    setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
  };

  const handleIncreaseDuration = () => {
    const next = numericDurations.find((n) => n > currentDurationNumber);
    const nextVal = next !== undefined ? next : Math.min(maxDuration, currentDurationNumber + durationStep);
    const durStr = `${nextVal}s`;
    preferredDurationRef.current = durStr;
    setVideoDuration(durStr);
    setDurationInputText(String(nextVal));
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
      const durStr = `${parsed}s`;
      preferredDurationRef.current = durStr;
      setVideoDuration(durStr);
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

    const durStr = `${closest}s`;
    preferredDurationRef.current = durStr;
    setVideoDuration(durStr);
    setDurationInputText(String(closest));
    setErrors((prevErr) => ({ ...prevErr, videoDuration: '' }));
  };

  // Auto-select first available model from DB when surface models load if not already set
  useEffect(() => {
    if (videoChatModels.length === 0) return;
    if (!videoModel) {
      const defaultVideoModel = initialSessionInputs.model || getFirstAvailableVideoModel(videoChatModels, userData);
      if (defaultVideoModel) setVideoModel(defaultVideoModel);
    }
  }, [userData, videoChatModels, videoModel, initialSessionInputs.model]);

  // Auto-select duration when model or surface data changes:
  // - If the preferred duration is supported by the new model, keep it.
  // - If the preferred duration exceeds the new model's max duration (e.g. 28s on Omni whose max is 10s),
  //   cap it to the model's highest duration (10s), while keeping preferredDurationRef intact so
  //   switching back to Seedance restores the original (28s).
  // - If below min duration, clamp to the model's min duration.
  useEffect(() => {
    if (!configuredDurationOptions || configuredDurationOptions.length === 0) return;

    const availableDurations = configuredDurationOptions
      .map((opt) => parseInt(opt.value, 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (availableDurations.length === 0) return;

    const minD = availableDurations[0];
    const maxD = availableDurations[availableDurations.length - 1];

    if (!preferredDurationRef.current && videoDuration) {
      preferredDurationRef.current = videoDuration;
    }

    const targetStr = preferredDurationRef.current || videoDuration;
    const targetNum = parseInt(targetStr, 10);

    let resolvedDurationStr = '';

    if (Number.isFinite(targetNum) && targetNum > 0) {
      if (configuredDurationOptions.some((o) => parseInt(o.value, 10) === targetNum)) {
        resolvedDurationStr = `${targetNum}s`;
      } else if (targetNum > maxD) {
        // Capped to the model's highest duration (e.g. 10s for Omni)
        resolvedDurationStr = `${maxD}s`;
      } else if (targetNum < minD) {
        resolvedDurationStr = `${minD}s`;
      } else {
        const closest = availableDurations.reduce((prev, curr) =>
          Math.abs(curr - targetNum) < Math.abs(prev - targetNum) ? curr : prev
        , minD);
        resolvedDurationStr = `${closest}s`;
      }
    } else {
      resolvedDurationStr = configuredDurationOptions[0].value;
    }

    if (resolvedDurationStr && resolvedDurationStr !== videoDuration) {
      setVideoDuration(resolvedDurationStr);
      setDurationInputText(String(parseInt(resolvedDurationStr, 10) || ''));
    }
  }, [configuredDurationOptions, videoDuration]);

  // Auto-select aspect ratio when model or surface data changes:
  // - If user manually clicked an aspect ratio, keep preferredAspectRatioRef.
  // - Otherwise, default to the detected video ratio (e.g. 16:9 for landscape videos, 9:16 for vertical).
  useEffect(() => {
    if (isAspectRatioLoading || !aspectRatioOptions.length) return;

    const targetRatio = userSelectedAspectRatioRef.current
      ? (preferredAspectRatioRef.current || aspectRatio)
      : (detectedVideoAspectRatio || preferredAspectRatioRef.current || aspectRatio);

    let resolvedRatio = '';
    if (targetRatio && aspectRatioOptions.some((opt) => opt.value === targetRatio)) {
      resolvedRatio = targetRatio;
    } else if (detectedVideoAspectRatio && aspectRatioOptions.some((opt) => opt.value === detectedVideoAspectRatio)) {
      resolvedRatio = detectedVideoAspectRatio;
    } else {
      resolvedRatio = aspectRatioOptions[0].value;
    }

    if (resolvedRatio && resolvedRatio !== aspectRatio) {
      setAspectRatio(resolvedRatio);
    }
  }, [aspectRatio, aspectRatioOptions, isAspectRatioLoading, detectedVideoAspectRatio]);

  const effectiveMediaUrl = useMemo(
    () => localVideoBlobUrl || sourceVideoUrl || galleryVideoUrl || (sourceVideoFile ? URL.createObjectURL(sourceVideoFile) : '') || '',
    [localVideoBlobUrl, sourceVideoUrl, galleryVideoUrl, sourceVideoFile]
  );

  // Detect social platforms directly on frontend using react-social-media-embed
  const youtubeId = useMemo(() => getYouTubeVideoId(effectiveMediaUrl), [effectiveMediaUrl]);
  const isImage = useMemo(() => isImageUrl(effectiveMediaUrl), [effectiveMediaUrl]);
  const isInstagram = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:instagram\.com|instagr\.am)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isLinkedIn = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:linkedin\.com|lnkd\.in)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isTikTok = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /tiktok\.com/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isFacebook = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:facebook\.com|fb\.watch)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isTwitter = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:twitter\.com|x\.com)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);
  const isPinterest = useMemo(() => Boolean(effectiveMediaUrl && !isImage && /(?:pinterest\.com|pin\.it)/i.test(effectiveMediaUrl.trim())), [effectiveMediaUrl, isImage]);

  const isDirectVideo = useMemo(() => {
    if (!effectiveMediaUrl || isImage) return false;
    return (
      effectiveMediaUrl.startsWith('blob:') ||
      effectiveMediaUrl.startsWith('data:') ||
      Boolean(galleryVideoUrl) ||
      Boolean(localVideoBlobUrl) ||
      Boolean(sourceVideoFile) ||
      /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(effectiveMediaUrl) ||
      Boolean(
        !youtubeId &&
        !isInstagram &&
        !isLinkedIn &&
        !isTikTok &&
        !isFacebook &&
        !isTwitter &&
        !isPinterest &&
        (effectiveMediaUrl.startsWith('http://') || effectiveMediaUrl.startsWith('https://'))
      )
    );
  }, [effectiveMediaUrl, isImage, galleryVideoUrl, localVideoBlobUrl, sourceVideoFile, youtubeId, isInstagram, isLinkedIn, isTikTok, isFacebook, isTwitter, isPinterest]);

  const sourceType = useMemo(() => {
    if (previewVideoError) return 'error';
    if (!effectiveMediaUrl && !sourceVideoFile) return 'default';
    if (youtubeId) return 'youtube';
    if (isInstagram) return 'instagram';
    if (isLinkedIn) return 'linkedin';
    if (isTikTok) return 'tiktok';
    if (isFacebook) return 'facebook';
    if (isTwitter) return 'twitter';
    if (isPinterest) return 'pinterest';
    if (isDirectVideo) return 'direct-video';
    return 'default';
  }, [effectiveMediaUrl, sourceVideoFile, previewVideoError, isDirectVideo, youtubeId, isInstagram, isLinkedIn, isTikTok, isFacebook, isTwitter, isPinterest]);

  useEffect(() => {
    dispatch(fetchModelCreditsAction());
    return () => {
      if (localVideoBlobUrlRef.current) {
        URL.revokeObjectURL(localVideoBlobUrlRef.current);
        localVideoBlobUrlRef.current = '';
      }
    };
  }, [dispatch]);

  // Ground-truth active session sync on mount & reconnect
  useEffect(() => {
    const activeSid = savedSession?.sessionId || analysisSessionId;
    if (!activeSid) return;

    let isMounted = true;
    currentSessionIdRef.current = activeSid;

    dispatch(getVideoById(activeSid))
      .then((res) => {
        if (!isMounted || !res?.data) return;
        const record = res.data;
        console.log('[CloneYourAd] Synced active session record from DB:', record);

        if (record.inputs) {
          if (record.inputs.galleryVideoUrl && !galleryVideoUrl) {
            setGalleryVideoUrl(record.inputs.galleryVideoUrl);
          }
          if (record.inputs.sourceVideoUrl && !sourceVideoUrl) {
            setSourceVideoUrl(record.inputs.sourceVideoUrl);
          }
          if (record.inputs.productImageUrls?.length && productImages.length === 0) {
            setProductImages(
              record.inputs.productImageUrls.map((u) => ({
                preview: u,
                s3Url: u,
                url: u,
                name: 'Product Image',
              }))
            );
          }
        }

        if (record.identification) {
          setAnalysisResult(record.identification);
          setAnalyzeProgress(100);
          setAnalysisState('success');
          setIsAnalyzing(false);
          setAnalysisError(null);
          setUserSafeError(null);

          const detectedBrand =
            record.identification?.productBrandName ||
            record.identification?.brandName ||
            record.inputs?.productBrandName ||
            record.inputs?.brandName;
          if (detectedBrand && !brandName && !initialSessionInputs.brandName) {
            setBrandName(detectedBrand);
          }

          const recModel = record.identification?.recommendedModel || record.inputs?.model;
          if (recModel && !videoModel && !initialSessionInputs.model) {
            setVideoModel(recModel);
          }

          const recDuration = record.identification?.recommendedDurationSeconds || record.inputs?.duration;
          if (recDuration && !videoDuration && !initialSessionInputs.duration) {
            const durNum = parseInt(String(recDuration).replace(/\D/g, ''), 10);
            if (durNum) {
              const durStr = `${durNum}s`;
              preferredDurationRef.current = durStr;
              setVideoDuration(durStr);
              setDurationInputText(String(durNum));
            }
          }

          const recAspect = record.identification?.recommendedAspectRatio || record.inputs?.aspectRatio;
          if (recAspect && !aspectRatio && !initialSessionInputs.aspectRatio && !userSelectedAspectRatioRef.current) {
            preferredAspectRatioRef.current = recAspect;
            setAspectRatio(recAspect);
          }

          const updated = {
            sessionId: activeSid,
            status: 'success',
            progress: 100,
            analysisResult: record.identification,
          };
          dispatch(updateActiveRecreateSession(updated));
          try {
            const raw = sessionStorage.getItem('activeRecreateSession');
            const prev = raw ? JSON.parse(raw) : {};
            sessionStorage.setItem('activeRecreateSession', JSON.stringify({ ...prev, ...updated }));
          } catch (err) {
            void err;
          }
        } else if (record.status === 'failed') {
          setAnalysisState('failed');
          setIsAnalyzing(false);
          dispatch(updateActiveRecreateSession({ sessionId: activeSid, status: 'failed' }));
        } else {
          // Still analyzing in backend
          setAnalysisState('analyzing');
          setIsAnalyzing(true);
        }
      })
      .catch((err) => {
        console.warn('[CloneYourAd] Could not sync active session status from DB:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [savedSession?.sessionId, analysisSessionId, dispatch]);

  // Sync state when activeRecreateSession is updated by the global socket handler
  useEffect(() => {
    const session = savedSession;
    if (!session?.sessionId) return;
    if (
      currentSessionIdRef.current &&
      String(session.sessionId) !== String(currentSessionIdRef.current)
    ) {
      return;
    }

    if (session.status === 'success' && session.analysisResult) {
      setAnalysisResult(session.analysisResult);
      setAnalyzeProgress(100);
      setAnalysisState('success');
      setIsAnalyzing(false);
      setAnalysisError(null);
      setUserSafeError(null);
    } else if (session.status === 'failed') {
      setAnalysisState('failed');
      setIsAnalyzing(false);
      if (session.error) {
        setAnalysisError(session.error);
        setUserSafeError(getSanitizedErrorMessage(session.error));
      }
    }
  }, [savedSession]);

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

      dispatch(
        updateActiveRecreateSession({
          sessionId: incomingId || currentSessionIdRef.current,
          status: 'success',
          progress: 100,
          analysisResult: identification,
        })
      );

      // Auto-populate detected brand name if returned by DS and not already set
      const detectedBrand =
        data?.productBrandName ||
        data?.brandName ||
        data?.inputs?.productBrandName ||
        data?.inputs?.brandName ||
        identification?.productBrandName ||
        identification?.brandName;
      if (detectedBrand && !brandName && !initialSessionInputs.brandName) {
        setBrandName(detectedBrand);
      }

      // Auto-populate recommended model, duration, and aspect ratio from analysis if not set by user
      const recModel =
        data?.recommendedModel ||
        data?.inputs?.model ||
        identification?.recommendedModel;
      if (recModel && !videoModel && !initialSessionInputs.model) {
        setVideoModel(recModel);
      }

      const recDuration =
        data?.recommendedDurationSeconds ||
        data?.inputs?.duration ||
        identification?.recommendedDurationSeconds;
      if (recDuration && !videoDuration && !initialSessionInputs.duration) {
        const durNum = parseInt(String(recDuration).replace(/\D/g, ''), 10);
        if (durNum) {
          const durStr = `${durNum}s`;
          preferredDurationRef.current = durStr;
          setVideoDuration(durStr);
          setDurationInputText(String(durNum));
        }
      }

      const recAspect =
        data?.recommendedAspectRatio ||
        data?.inputs?.aspectRatio ||
        identification?.recommendedAspectRatio;
      if (recAspect && !aspectRatio && !initialSessionInputs.aspectRatio && !userSelectedAspectRatioRef.current) {
        preferredAspectRatioRef.current = recAspect;
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
        const pct =
          typeof progressData?.promptPercentage === 'number'
            ? progressData.promptPercentage
            : typeof progressData?.percentage === 'number'
            ? progressData.percentage
            : typeof progressData?.progress === 'number'
            ? progressData.progress
            : null;
        if (pct !== null && !isNaN(pct)) {
          const roundedPct = Math.min(100, Math.max(0, Math.round(pct)));
          setAnalyzeProgress(roundedPct);
          dispatch(
            updateActiveRecreateSession({
              sessionId: currentSessionIdRef.current,
              progress: roundedPct,
              promptPercentage: roundedPct,
            })
          );
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

  // Persist user adjustments (model, duration, aspect ratio, brand, instructions, summary) so navigating away & returning preserves user selections
  useEffect(() => {
    if (analysisState !== 'success' && !analysisResult) return;
    const sid = analysisSessionId || savedSession?.sessionId;
    if (!sid) return;

    dispatch(
      updateActiveRecreateSession({
        sessionId: sid,
        status: 'success',
        inputs: {
          brandName,
          model: videoModel,
          duration: videoDuration,
          aspectRatio,
          additionalInstructions: additionalInfo,
          visualDescription: editableVisualDescription,
        },
      })
    );
  }, [
    videoModel,
    videoDuration,
    aspectRatio,
    brandName,
    additionalInfo,
    editableVisualDescription,
    analysisState,
    analysisResult,
    analysisSessionId,
    savedSession?.sessionId,
    dispatch,
  ]);

  // Background Safety Timeout for Analysis
  useEffect(() => {
    if (analysisState !== 'analyzing' || !analysisSessionId) return;

    const startedAt = savedSession?.startedAt || Date.now();
    const elapsedMs = Date.now() - startedAt;
    const remainingTimeoutMs = Math.max(1000, 150000 - elapsedMs);

    if (elapsedMs >= 150000) {
      console.warn('[CloneYourAd] Analysis safety timeout already elapsed on mount.');
      setAnalysisState('timeout');
      setIsAnalyzing(false);
      return;
    }

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
    }

    timeoutTimerRef.current = setTimeout(() => {
      console.warn('[CloneYourAd] Analysis safety timeout reached. Transitioning to timeout state.');
      setAnalysisState('timeout');
      setIsAnalyzing(false);
    }, remainingTimeoutMs);

    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [analysisState, analysisSessionId, savedSession?.startedAt]);

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
        const pollPct =
          typeof record?.promptPercentage === 'number'
            ? record.promptPercentage
            : typeof record?.percentage === 'number'
            ? record.percentage
            : typeof record?.progress === 'number'
            ? record.progress
            : null;
        if (pollPct !== null && !isNaN(pollPct)) {
          const roundedPct = Math.min(100, Math.max(0, Math.round(pollPct)));
          setAnalyzeProgress(roundedPct);
          dispatch(
            updateActiveRecreateSession({
              sessionId: analysisSessionId,
              progress: roundedPct,
              promptPercentage: roundedPct,
            })
          );
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
              const durStr = `${durNum}s`;
              preferredDurationRef.current = durStr;
              setVideoDuration(durStr);
              setDurationInputText(String(durNum));
            }
          }

          const recAspect =
            record?.inputs?.aspectRatio ||
            record?.identification?.recommendedAspectRatio ||
            record?.recommendedAspectRatio;
          if (recAspect) {
            if (!preferredAspectRatioRef.current) {
              preferredAspectRatioRef.current = recAspect;
            }
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

    // YouTube check: detect standard 16:9 vs Shorts 9:16
    const ytId = getYouTubeVideoId(url);
    if (ytId) {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
      setPreviewVideoError(false);
      const isShorts = url.includes('/shorts/');
      const ytRatio = isShorts ? '9:16' : '16:9';
      setDetectedVideoAspectRatio(ytRatio);
      if (!userSelectedAspectRatioRef.current) {
        preferredAspectRatioRef.current = ytRatio;
        setAspectRatio(ytRatio);
      }
      return;
    }

    // Supported platform URLs (Instagram, Facebook, TikTok, Twitter, Pinterest)
    if (isResolvablePlatformUrl(url)) {
      setErrors((prev) => ({ ...prev, sourceVideo: '' }));
      setPreviewVideoError(false);
      return;
    }

    // Direct / external URL probe: Check if URL resolves to an image or video
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
      tempVid.preload = 'metadata';
      tempVid.src = url;
      tempVid.onloadedmetadata = () => {
        validateSourceDuration(tempVid.duration);
        const w = tempVid.videoWidth;
        const h = tempVid.videoHeight;
        if (w && h) {
          const ratio = w / h;
          let detectedRatio = '9:16';
          if (ratio > 2.0) detectedRatio = '21:9';
          else if (ratio > 1.45) detectedRatio = '16:9';
          else if (ratio > 1.15) detectedRatio = '4:3';
          else if (ratio > 0.85) detectedRatio = '1:1';
          else if (ratio > 0.65) detectedRatio = '3:4';
          else detectedRatio = '9:16';

          setDetectedVideoAspectRatio(detectedRatio);
          if (!userSelectedAspectRatioRef.current) {
            preferredAspectRatioRef.current = detectedRatio;
            setAspectRatio(detectedRatio);
          }
        }
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
            if (localVideoBlobUrlRef.current) {
              URL.revokeObjectURL(localVideoBlobUrlRef.current);
            }
            const url = URL.createObjectURL(file);
            localVideoBlobUrlRef.current = url;
            setLocalVideoBlobUrl(url);
            setSourceVideoUrl('');
            setGalleryVideoUrl('');
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
      if (localVideoBlobUrlRef.current) {
        URL.revokeObjectURL(localVideoBlobUrlRef.current);
        localVideoBlobUrlRef.current = '';
        setLocalVideoBlobUrl('');
      }
      const cleanUrl = extractCleanUrl(pastedText);
      setSourceVideoUrl(cleanUrl);
      setGalleryVideoUrl('');
      setSourceVideoFile(null);
      setSourceDuration(null);
      setPreviewVideoError(false);

      validateSourceUrl(cleanUrl);
    }
  };

  const handleUrlInputChange = (e) => {
    const rawVal = e.target.value;
    if (localVideoBlobUrlRef.current) {
      URL.revokeObjectURL(localVideoBlobUrlRef.current);
      localVideoBlobUrlRef.current = '';
      setLocalVideoBlobUrl('');
    }
    const cleanUrl = extractCleanUrl(rawVal);
    setSourceVideoUrl(cleanUrl);
    setGalleryVideoUrl('');
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

    if (localVideoBlobUrlRef.current) {
      URL.revokeObjectURL(localVideoBlobUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    localVideoBlobUrlRef.current = url;
    setLocalVideoBlobUrl(url);
    setSourceVideoUrl('');
    setGalleryVideoUrl('');
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
    if (localVideoBlobUrlRef.current) {
      URL.revokeObjectURL(localVideoBlobUrlRef.current);
      localVideoBlobUrlRef.current = '';
      setLocalVideoBlobUrl('');
    }
    setSourceVideoUrl('');
    setGalleryVideoUrl('');
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
    currentSessionIdRef.current = null;
    setAnalysisSessionId(null);
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
    userSelectedAspectRatioRef.current = false;

    const existingVideoSource =
      prefillUrl ||
      sourceVideoUrl ||
      galleryVideoUrl ||
      (sourceVideoFile ? sourceVideoFile.name : '') ||
      '';
    if (existingVideoSource) {
      setPrefillUrl(existingVideoSource);
      lastPrefilledSourceRef.current = existingVideoSource;
    }

    setCurrentStep('input');
    dispatch(clearActiveRecreateSession());
  };

  const handleModalClose = () => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    currentSessionIdRef.current = null;
    setAnalysisSessionId(null);
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
    userSelectedAspectRatioRef.current = false;
    setCurrentStep('input');
    dispatch(clearActiveRecreateSession());
    try {
      sessionStorage.removeItem('activeRecreateSession');
      localStorage.removeItem('activeRecreateSession');
    } catch (err) {
      void err;
    }

    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const handleResetAnalysis = () => {
    handleTryAgain();
  };

  const handleGenerate = async () => {
    const effectiveSessionId =
      analysisSessionId ||
      currentSessionIdRef.current ||
      savedSession?.sessionId ||
      recreateInputs?.sessionId ||
      recreateInputs?._id;

    if (!effectiveSessionId || isGenerating) return;

    try {
      setIsGenerating(true);
      setGenerateError(null);

      const finalProductImageUrls = (productImages || [])
        .map((img) => (typeof img === 'string' ? img : img?.s3Url || img?.preview || img?.url || ''))
        .filter(Boolean);

      const targetDurationNum = parseInt(selectedVideoDuration || videoDuration, 10) || 8;
      const payload = {
        sessionId: effectiveSessionId,
        inputs: {
          productImageUrls: finalProductImageUrls,
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
      dispatch(clearActiveRecreateSession());

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

      let errorMsg = 'Failed to start video generation';
      const raw = err.response?.data?.error || err.response?.data?.message || err.response?.data?.detail || err.message;
      if (typeof raw === 'string') {
        errorMsg = raw;
      } else if (Array.isArray(raw)) {
        errorMsg = raw
          .map((d) => (typeof d === 'string' ? d : d?.msg || d?.message || JSON.stringify(d)))
          .join('; ');
      } else if (raw && typeof raw === 'object') {
        errorMsg = raw.msg || raw.message || JSON.stringify(raw);
      }
      setGenerateError(errorMsg);
    }
  };

const renderLightboxModal = () => {
  if (!lightboxOpen || typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={() => setLightboxOpen(false)}
        className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6"
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex flex-col items-center justify-center max-h-[85vh] max-w-[90vw]"
        >
          {/* Close Button positioned directly on the top-right corner of the preview image */}
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute -top-3 -right-3 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 shadow-xl border border-white/20 transition-transform active:scale-95 cursor-pointer backdrop-blur-md"
            title="Close preview"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Main Image Container displaying natural image dimensions without extra dark boxes */}
          <div className="relative flex items-center justify-center">
            {/* Previous Button (if multiple images) */}
            {lightboxImages.length > 1 && lightboxIndex > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => Math.max(0, prev - 1));
                }}
                className="absolute -left-4 sm:-left-12 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 shadow-md backdrop-blur-md transition hover:scale-105 active:scale-95 cursor-pointer"
                title="Previous image"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            <img
              src={lightboxImages[lightboxIndex] || lightboxImage}
              alt="Product Preview"
              className="h-auto max-h-[78vh] w-auto max-w-[85vw] rounded-2xl object-contain shadow-2xl select-none"
            />

            {/* Next Button (if multiple images) */}
            {lightboxImages.length > 1 && lightboxIndex < lightboxImages.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => Math.min(lightboxImages.length - 1, prev + 1));
                }}
                className="absolute -right-4 sm:-right-12 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 shadow-md backdrop-blur-md transition hover:scale-105 active:scale-95 cursor-pointer"
                title="Next image"
                aria-label="Next image"
              >
                <ChevronLeft className="h-5 w-5 rotate-180" />
              </button>
            )}
          </div>

          {/* Thumbnails strip (if multiple images) */}
          {lightboxImages.length > 1 && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-black/60 px-3 py-1.5 backdrop-blur-md border border-white/10 shadow-lg">
              {lightboxImages.map((img, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex(idx);
                  }}
                  className={`relative h-10 w-10 overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
                    idx === lightboxIndex
                      ? 'border-[#5D5FEF] scale-105 shadow-md ring-2 ring-[#5D5FEF]/40'
                      : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={img} alt={`Thumb ${idx + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

  if (currentStep === 'input') {
    const isVideoValid = Boolean(sourceVideoFile || (prefillUrl?.trim() && isValidVideoSourceUrl(prefillUrl)));
    const isFormReady = Boolean(isVideoValid && productImages.length > 0 && !prefillError);

    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden">
        <div
          onPaste={handlePrefillPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.target?.id === 'product-image-url-input' && productUrlInput?.trim()) {
                return;
              }
              if (e.target?.id === 'reference-video-url-input' && prefillUrl?.trim() && !isValidVideoSourceUrl(prefillUrl)) {
                e.preventDefault();
                setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
                return;
              }
              if (isFormReady) {
                e.preventDefault();
                handleStartAnalyze();
              }
            }
          }}
          className="advideo-recreate-card relative w-full max-w-[560px] rounded-[24px] border border-[var(--ws-border)] bg-[var(--ws-surface)] p-6 shadow-[var(--ws-shadow-md)] sm:p-8 dark:border-white/10 dark:bg-[#18181B] dark:shadow-none"
        >
          {/* Close button */}
          <button
            onClick={handleModalClose}
            type="button"
            className="absolute top-6 right-6 rounded-full p-1 text-zinc-400 transition hover:bg-black/5 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Header */}
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center gap-2.5 text-zinc-900 dark:text-white">
              <Clapperboard className="h-6 w-6 text-zinc-900 dark:text-white" />
              <h2 className="text-xl font-bold tracking-tight">Recreate Ad</h2>
            </div>
            <p className="mt-2 text-xs sm:text-[13px] text-zinc-500 dark:text-zinc-400">
              Turn any winning ad into a new one for your product.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-5">
            {/* 1. Reference ad video */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                Reference ad video<span className="text-[#5D5FEF] dark:text-indigo-400 ml-0.5">*</span>
              </label>
              <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400">
                The ad whose style, pacing and structure you want to copy.
              </p>

              <div
                className={`advideo-recreate-field mt-1 flex items-center gap-2 rounded-[12px] border bg-[var(--advideo-control-surface)] dark:bg-zinc-900/80 p-1.5 text-xs text-zinc-600 transition dark:text-[#afafaf] ${
                  prefillError
                    ? 'border-red-500 ring-1 ring-red-500/30'
                    : 'border-[var(--ws-border)] dark:border-white/10 focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:focus-within:border-[#6366F1] dark:focus-within:ring-1 dark:focus-within:ring-[#6366F1]'
                }`}
              >
                {sourceVideoFile ? (
                  <div className="flex flex-1 items-center justify-between min-w-0 pr-2 pl-3 py-1">
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <Video className="h-4 w-4 text-[#5D5FEF] dark:text-indigo-400 shrink-0" />
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
                        if (localVideoBlobUrlRef.current) {
                          URL.revokeObjectURL(localVideoBlobUrlRef.current);
                          localVideoBlobUrlRef.current = '';
                          setLocalVideoBlobUrl('');
                        }
                        setSourceVideoFile(null);
                        setPrefillUrl('');
                        setSourceVideoUrl('');
                        setGalleryVideoUrl('');
                        uploadedS3UrlRef.current = '';
                        lastUploadedFileRef.current = null;
                        lastPrefilledSourceRef.current = '';
                        setPreviewVideoError(false);
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
                      id="reference-video-url-input"
                      type="text"
                      placeholder="Paste a video link or upload from your device"
                      value={prefillUrl}
                      onPaste={handlePrefillPaste}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (localVideoBlobUrlRef.current) {
                          URL.revokeObjectURL(localVideoBlobUrlRef.current);
                          localVideoBlobUrlRef.current = '';
                          setLocalVideoBlobUrl('');
                        }
                        setPrefillUrl(val);
                        setSourceVideoUrl(val.trim());
                        setGalleryVideoUrl('');
                        setPreviewVideoError(false);
                        if (sourceVideoFile) {
                          setSourceVideoFile(null);
                        }
                        if (val !== lastPrefilledSourceRef.current) {
                          uploadedS3UrlRef.current = '';
                          lastUploadedFileRef.current = null;
                        }
                        if (val.trim()) {
                          if (!isValidVideoSourceUrl(val.trim())) {
                            setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
                          } else {
                            setPrefillError('');
                          }
                        } else {
                          setPrefillError('');
                        }
                      }}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && !isValidVideoSourceUrl(val)) {
                          setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = prefillUrl?.trim();
                          if (!val && !sourceVideoFile) {
                            setPrefillError('Please enter a video URL or upload a video.');
                            return;
                          }
                          if (val && !isValidVideoSourceUrl(val)) {
                            setPrefillError('Please enter a valid video link (YouTube, Instagram, Facebook, TikTok, etc.) or upload a video file.');
                            return;
                          }
                          if (productImages.length === 0) {
                            setErrors((prev) => ({
                              ...prev,
                              productImages: 'Please provide at least 1 product image.',
                            }));
                            document.getElementById('product-image-url-input')?.focus();
                            return;
                          }
                          handleStartAnalyze();
                        }
                      }}
                      className="w-full bg-transparent px-3 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-white/30"
                    />
                    {prefillUrl ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (localVideoBlobUrlRef.current) {
                            URL.revokeObjectURL(localVideoBlobUrlRef.current);
                            localVideoBlobUrlRef.current = '';
                            setLocalVideoBlobUrl('');
                          }
                          setPrefillUrl('');
                          setSourceVideoUrl('');
                          setGalleryVideoUrl('');
                          setSourceVideoFile(null);
                          uploadedS3UrlRef.current = '';
                          lastUploadedFileRef.current = null;
                          lastPrefilledSourceRef.current = '';
                          setPreviewVideoError(false);
                          setPrefillError('');
                        }}
                        className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0 cursor-pointer mr-1"
                        title="Clear video URL"
                        aria-label="Clear video URL"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <LinkIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0 mx-1" />
                  </div>
                )}

                <label
                  htmlFor="prefill-video-file-upload"
                  title="Upload video from device"
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#5D5FEF] shadow-xs transition dark:bg-white/10 dark:text-indigo-300 dark:hover:bg-white/15 shrink-0"
                >
                  <CloudUpload className="h-4 w-4 text-[#5D5FEF] dark:text-indigo-300" />
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
                <p className="mt-1 text-xs font-medium text-red-500 dark:text-red-400">{prefillError}</p>
              )}
            </div>

            {/* 2. Your product images */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                  Your product images<span className="text-[#5D5FEF] dark:text-indigo-400 ml-0.5">*</span>
                </label>
                <span className="text-[11px] sm:text-xs text-zinc-400 dark:text-zinc-500">
                  {productImages.length} of 3 added
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400">
                Add up to 3 clear photos of the product you want featured.
              </p>

              <div
                onPaste={handlePasteProductImage}
                className={`advideo-recreate-field mt-1 flex items-center gap-2 rounded-[12px] border bg-[var(--advideo-control-surface)] dark:bg-zinc-900/80 p-1.5 text-xs text-zinc-600 transition dark:text-[#afafaf] ${
                  errors.productImages
                    ? 'border-red-500 ring-1 ring-red-500/30'
                    : 'border-[var(--ws-border)] dark:border-white/10 focus-within:border-[#5867EB] focus-within:ring-[3px] focus-within:ring-[#5867EB]/16 dark:focus-within:border-[#6366F1] dark:focus-within:ring-1 dark:focus-within:ring-[#6366F1]'
                }`}
              >
                <div className="flex flex-1 items-center justify-between min-w-0">
                  <input
                    id="product-image-url-input"
                    value={productUrlInput}
                    onChange={(e) => {
                      const clean = extractCleanUrl(e.target.value);
                      setProductUrlInput(clean);
                      if (!clean) {
                        setErrors((prev) => ({ ...prev, productImages: '' }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (productUrlInput?.trim()) {
                          e.preventDefault();
                          handleAddProductUrl(productUrlInput);
                        } else {
                          if (isFormReady) {
                            e.preventDefault();
                            handleStartAnalyze();
                          }
                        }
                      }
                    }}
                    disabled={productImages.length >= 3}
                    className="w-full bg-transparent px-3 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-white/30 disabled:opacity-50"
                    placeholder={
                      productImages.length >= 3
                        ? 'Maximum 3 images added'
                        : 'Paste an image link and press Enter'
                    }
                  />
                  {productUrlInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProductUrlInput('');
                        setErrors((prev) => ({ ...prev, productImages: '' }));
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white shrink-0 cursor-pointer mr-1"
                      title="Clear product URL"
                      aria-label="Clear product URL"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <LinkIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-500 shrink-0 mx-1" />
                </div>

                <label
                  htmlFor="input-product-image-file"
                  title="Upload image from device"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 shadow-xs transition ${
                    productImages.length >= 3
                      ? 'cursor-not-allowed bg-zinc-100 text-zinc-400 dark:border-white/5 dark:bg-white/5 dark:text-zinc-500'
                      : 'cursor-pointer bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#5D5FEF] dark:bg-white/10 dark:text-indigo-300 dark:hover:bg-white/15'
                  }`}
                >
                  <CloudUpload className="h-4 w-4 text-[#5D5FEF] dark:text-indigo-300" />
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {productImages.map((img, index) => {
                    const previewSrc = typeof img === 'string' ? img : img?.preview || img?.url || img?.s3Url || '';
                    return (
                      <div
                        key={index}
                        onClick={() => {
                          const previews = productImages
                            .map((i) => (typeof i === 'string' ? i : i?.preview || i?.url || i?.s3Url || ''))
                            .filter(Boolean);
                          setLightboxImages(previews);
                          setLightboxIndex(index);
                          setLightboxImage(previewSrc);
                          setLightboxOpen(true);
                        }}
                        title="Click to preview image"
                        className="group relative h-14 w-14 cursor-pointer overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10 shadow-xs transition-all duration-200 hover:scale-105 hover:border-[#5D5FEF] dark:hover:border-[#6366F1] bg-zinc-100 dark:bg-zinc-800"
                      >
                        <img
                          src={previewSrc}
                          alt={`Product ${index + 1}`}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-110 select-none"
                        />
                        {/* Hover Overlay with Eye Preview Icon */}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <Eye className="h-4 w-4 text-white drop-shadow-md" />
                        </div>
                        {/* Delete Button with StopPropagation */}
                        <button
                          type="button"
                          className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 cursor-pointer hover:bg-red-600 hover:scale-110 active:scale-95"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProductImage(index);
                          }}
                          title="Remove image"
                          aria-label="Remove image"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 flex items-center justify-between border-t border-[var(--ws-border)] pt-4 dark:border-white/10">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Takes about 1–2 minutes
            </span>
            <button
              type="button"
              onClick={handleStartAnalyze}
              disabled={!isFormReady}
              className={`flex items-center gap-1.5 rounded-lg px-4.5 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition-all ${
                !isFormReady
                  ? 'bg-[#5D5FEF]/40 dark:bg-[#6366F1]/40 text-white/70 cursor-not-allowed pointer-events-none'
                  : 'bg-[#5D5FEF] hover:bg-[#4E51DF] dark:bg-[#6366F1] dark:hover:bg-[#4F46E5] active:scale-[0.98] cursor-pointer'
              }`}
            >
              <span>Analyze reference ad</span>
              <span className="text-sm font-bold">→</span>
            </button>
          </div>
        </div>
        {renderLightboxModal()}
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
  }

  const isCompactWorkspace =
    isAnalyzing ||
    analysisState === 'analyzing' ||
    analysisState === 'failed' ||
    analysisState === 'timeout';

  const activeAspect = (isAnalyzing || analysisState === 'analyzing')
    ? (detectedVideoAspectRatio || aspectRatio || '16:9')
    : (aspectRatio || detectedVideoAspectRatio || '9:16');

  const effectiveRatio = activeAspect;
  const isHorizontalVideo = effectiveRatio === '16:9' || effectiveRatio === '21:9' || effectiveRatio === '4:3';
  const isVerticalVideo = effectiveRatio === '9:16' || effectiveRatio === '3:4';

  const containerMaxWidthClass = isCompactWorkspace
    ? isVerticalVideo
      ? 'max-w-[700px] sm:max-w-[740px] lg:max-w-[780px]'
      : 'max-w-[840px] lg:max-w-[920px] 2xl:max-w-[960px]'
    : 'max-w-[860px] lg:max-w-[940px] 2xl:max-w-[1000px]';

  const cardHeightAndPaddingClass = isCompactWorkspace && isHorizontalVideo
    ? 'min-h-[390px] sm:min-h-[430px] lg:min-h-[460px] py-6 sm:py-7 lg:py-8 px-5 sm:px-6 lg:px-7'
    : 'py-4.5 sm:py-5 px-5 sm:px-6 lg:px-7';

  const durationErrorMsg =
    errors.sourceVideo ||
    (sourceDuration > 60
      ? `Video is too long (${formatDuration(sourceDuration)}). Please select a video that is 60 seconds or less.`
      : '');

  const isAnalyzingActive = isAnalyzing || analysisState === 'analyzing';

  return (
    <div className={`flex flex-col w-full ${containerMaxWidthClass} items-start gap-0 my-auto mx-auto transition-all duration-300`}>
      {/* Top Left Back Chevron Button positioned directly above the analyze form / workspace card */}
      <button
        onClick={isAnalyzingActive ? undefined : doStepBack}
        type="button"
        disabled={isAnalyzingActive}
        className={`-ml-1.5 flex items-center justify-center p-0 leading-none transition-all ${
          isAnalyzingActive
            ? 'opacity-30 cursor-not-allowed text-zinc-400 dark:text-zinc-600'
            : 'text-zinc-700 dark:text-zinc-200 hover:text-black dark:hover:text-white cursor-pointer active:scale-95'
        }`}
        title={isAnalyzingActive ? 'Analysis in progress...' : 'Go back to change input'}
        aria-label={isAnalyzingActive ? 'Analysis in progress...' : 'Go back to change input'}
        aria-disabled={isAnalyzingActive}
      >
        <ChevronLeft className="h-6 w-6 2xl:h-7 2xl:w-7" />
      </button>

      {/* Main Unified Workspace Card */}
      <div className={`relative flex flex-col justify-center w-full overflow-hidden rounded-[28px] border border-black/5 dark:border-white/10 bg-white/95 dark:bg-[#18181B] shadow-2xl ${cardHeightAndPaddingClass} transition-all duration-300`}>
        {/* Top Right Close Button */}
        <button
          onClick={handleModalClose}
          type="button"
          className="absolute top-4 right-4 z-30 rounded-full p-2 text-zinc-500 transition hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] w-full gap-5 sm:gap-6 lg:gap-7 items-stretch justify-center my-auto overflow-hidden">
          {/* Left side — Video Preview Canvas (Borderless, Sleek, Symmetrically Centered) */}
          <div className="relative flex flex-col items-center justify-center shrink-0 h-full overflow-hidden">
            {/* Aspect-Ratio Adapting Video Preview */}
            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-2xl lg:rounded-3xl bg-black/90 dark:bg-zinc-950 transition-all duration-300 shadow-sm ${
                isCompactWorkspace
                  ? activeAspect === '16:9'
                    ? 'aspect-video w-[350px] sm:w-[410px] lg:w-[450px] 2xl:w-[480px] max-w-full h-auto'
                    : activeAspect === '21:9'
                    ? 'aspect-[21/9] w-[350px] sm:w-[410px] lg:w-[460px] 2xl:w-[490px] max-w-full h-auto'
                    : activeAspect === '4:3'
                    ? 'aspect-[4/3] w-[320px] sm:w-[370px] lg:w-[410px] max-w-full h-auto'
                    : activeAspect === '1:1'
                    ? 'aspect-square h-full max-h-[440px] lg:max-h-[470px] w-auto'
                    : activeAspect === '3:4'
                    ? 'aspect-[3/4] h-full min-h-[420px] lg:min-h-[450px] 2xl:min-h-[480px] max-h-[66vh] w-auto'
                    : 'aspect-[9/16] h-full min-h-[420px] lg:min-h-[460px] 2xl:min-h-[490px] max-h-[64vh] w-auto'
                  : activeAspect === '16:9'
                  ? 'aspect-video w-[330px] sm:w-[380px] lg:w-[420px] 2xl:w-[460px] max-w-full h-auto'
                  : activeAspect === '21:9'
                  ? 'aspect-[21/9] w-[330px] sm:w-[380px] lg:w-[430px] 2xl:w-[470px] max-w-full h-auto'
                  : activeAspect === '4:3'
                  ? 'aspect-[4/3] w-[310px] sm:w-[350px] lg:w-[390px] max-w-full h-auto'
                  : activeAspect === '1:1'
                  ? 'aspect-square h-full max-h-[450px] lg:max-h-[480px] w-auto'
                  : activeAspect === '3:4'
                  ? 'aspect-[3/4] h-full min-h-[430px] lg:min-h-[460px] 2xl:min-h-[490px] max-h-[68vh] w-auto'
                  : 'aspect-[9/16] h-full min-h-[450px] lg:min-h-[480px] 2xl:min-h-[510px] max-h-[68vh] w-auto'
              }`}
            >
              {previewVideoError ? (
                <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 mb-3 shadow-inner">
                    <Video className="h-6 w-6 text-zinc-400" />
                  </div>
                  <p className="text-sm font-semibold text-zinc-200 max-w-xs leading-relaxed">
                    We can't show the preview
                  </p>
                  <p className="text-xs text-zinc-400 max-w-xs mt-1.5 leading-normal">
                    You can see this video on a different page.
                  </p>
                  {effectiveMediaUrl && (
                    <a
                      href={effectiveMediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3.5 inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20 hover:border-white/30 cursor-pointer active:scale-95"
                    >
                      <span>Open Video on Different Page</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ) : sourceType === 'direct-video' ? (
                <video
                  ref={(el) => {
                    if (el) {
                      el.muted = true;
                      el.defaultMuted = true;
                      if (el.paused) {
                        const p = el.play();
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                      }
                    }
                  }}
                  key={effectiveMediaUrl}
                  src={effectiveMediaUrl}
                  autoPlay
                  muted
                  defaultMuted
                  loop
                  playsInline
                  preload="auto"
                  referrerPolicy="no-referrer"
                  onLoadedMetadata={(e) => {
                    handleVideoMetadataLoaded(e);
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
                  onLoadedData={(e) => {
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
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
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!min-w-full [&_iframe]:!min-h-full [&_iframe]:object-cover [&_iframe]:border-0">
                  <LinkedInEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" height="100%" />
                </div>
              ) : sourceType === 'tiktok' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!min-w-full [&_iframe]:!min-h-full [&_iframe]:object-cover [&_iframe]:border-0">
                  <TikTokEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" height="100%" />
                </div>
              ) : sourceType === 'facebook' ? (
                <FacebookMetaEmbed
                  key={effectiveMediaUrl}
                  url={effectiveMediaUrl}
                />
              ) : sourceType === 'twitter' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!min-w-full [&_iframe]:!min-h-full [&_iframe]:object-cover [&_iframe]:border-0">
                  <TwitterEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" height="100%" />
                </div>
              ) : sourceType === 'pinterest' ? (
                <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden p-0 [&>div]:w-full [&>div]:h-full [&>div]:flex [&>div]:justify-center [&_iframe]:!w-full [&_iframe]:!h-full [&_iframe]:!min-w-full [&_iframe]:!min-h-full [&_iframe]:object-cover [&_iframe]:border-0">
                  <PinterestEmbed key={effectiveMediaUrl} url={effectiveMediaUrl} width="100%" height="100%" />
                </div>
              ) : effectiveMediaUrl ? (
                <video
                  ref={(el) => {
                    if (el) {
                      el.muted = true;
                      el.defaultMuted = true;
                      if (el.paused) {
                        const p = el.play();
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                      }
                    }
                  }}
                  key={effectiveMediaUrl}
                  src={effectiveMediaUrl}
                  autoPlay
                  muted
                  defaultMuted
                  loop
                  playsInline
                  preload="auto"
                  referrerPolicy="no-referrer"
                  onLoadedMetadata={(e) => {
                    handleVideoMetadataLoaded(e);
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
                  onLoadedData={(e) => {
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
                  onCanPlay={(e) => {
                    const v = e.currentTarget;
                    v.muted = true;
                    if (v.paused) v.play().catch(() => {});
                  }}
                  onError={() => setPreviewVideoError(true)}
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              ) : CLONE_YOUR_AD_DEMO_URL?.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                <video
                  ref={(el) => {
                    if (el) {
                      el.muted = true;
                      el.defaultMuted = true;
                      if (el.paused) {
                        const p = el.play();
                        if (p && typeof p.catch === 'function') p.catch(() => {});
                      }
                    }
                  }}
                  src={CLONE_YOUR_AD_DEMO_URL}
                  autoPlay
                  muted
                  defaultMuted
                  loop
                  playsInline
                  preload="auto"
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              ) : (
                <img
                  src={CLONE_YOUR_AD_DEMO_URL}
                  alt="Recreate Ad Demo Preview"
                  className="absolute inset-0 z-0 h-full w-full object-cover bg-black"
                />
              )}

              {/* Message at the bottom downward of the video preview section (Yellow Box location) */}
              {effectiveMediaUrl && (previewVideoError || (!sourceVideoFile && sourceType !== 'youtube' && !isDirectVideo)) && (
                <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-col items-center justify-center gap-1 rounded-2xl border border-white/15 bg-black/85 px-3 py-2 text-center text-[11px] text-zinc-300 backdrop-blur-md shadow-xl">
                  <span className="text-zinc-300 text-xs font-medium">Can't see the preview?</span>
                  <a
                    href={effectiveMediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#15DCFF] hover:underline cursor-pointer"
                  >
                    <span>You can see it on a different page</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {/* Scanning Row Line Laser Effect during Analysis */}
              {(isAnalyzing || analysisState === 'analyzing') && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden z-20 rounded-2xl lg:rounded-3xl">
                  <motion.div
                    initial={{ top: '-15%' }}
                    animate={{ top: ['-15%', '105%'] }}
                    transition={{
                      repeat: Infinity,
                      duration: 2.6,
                      ease: 'linear',
                    }}
                    className="absolute left-0 right-0 h-16 bg-gradient-to-b from-transparent via-[#C084FC]/35 to-transparent border-b-2 border-[#A855F7] shadow-[0_4px_28px_rgba(168,85,247,0.7)]"
                  />
                </div>
              )}
            </div>

            {/* Downwards of video preview: image preview what the user provided */}
            {productImages.length > 0 && (
              <div className="mt-3 flex items-center gap-2.5 self-start pl-1">
                <div className="flex items-center gap-1.5">
                  {productImages.map((img, idx) => {
                    const previewSrc = typeof img === 'string' ? img : img?.preview || img?.url || img?.s3Url || '';
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          const allPreviews = productImages
                            .map((i) => (typeof i === 'string' ? i : i?.preview || i?.url || i?.s3Url || ''))
                            .filter(Boolean);
                          setLightboxImages(allPreviews);
                          setLightboxIndex(idx);
                          setLightboxImage(previewSrc);
                          setLightboxOpen(true);
                        }}
                        title="Click to preview image"
                        className="group/thumb relative h-8 w-8 cursor-pointer overflow-hidden rounded-lg border border-black/10 transition-all duration-200 hover:scale-105 hover:border-[#5D5FEF] dark:border-white/10 dark:hover:border-[#6366F1] shadow-xs bg-zinc-100 dark:bg-zinc-800"
                      >
                        <img
                          src={previewSrc}
                          alt={`Product ${idx + 1}`}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover/thumb:scale-110 select-none"
                        />
                        {/* Hover Overlay with Eye Preview Icon */}
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
                          <Eye className="h-3.5 w-3.5 text-white drop-shadow-md" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Your product · {productImages.length} image{productImages.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Right side — Form Controls */}
          <div className="flex flex-col justify-between gap-2.5 sm:gap-3 w-full min-w-0 max-h-[80vh] overflow-y-auto pr-1 text-zinc-900 dark:text-white">
            {/* Top Title - Only shown on Success / Result workspace form */}
            {(analysisState === 'success' || analysisResult) && !isAnalyzing && analysisState !== 'analyzing' && analysisState !== 'failed' && analysisState !== 'timeout' && (
              <div className="text-left">
                <h2 className="text-base sm:text-lg lg:text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
                  Recreate Ad
                </h2>
              </div>
            )}

            {/* ── ANALYSIS RESULT STATE (Photo 4) ─────────────────────────────── */}
            {analysisState === 'success' || analysisResult ? (
              <div className="flex flex-col gap-2.5 pt-0.5">
                {/* Header Banner - Subtle indigo/blue matching Generate button theme with Accuracy pill */}
                <div className="flex items-center justify-between rounded-lg border border-[#5D5FEF]/20 bg-[#EEF2FF] px-3 py-2 text-[#5D5FEF] dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-300">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5D5FEF] dark:bg-[#6366F1] text-white shadow-xs">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[#5D5FEF] dark:text-indigo-400">
                        ANALYSIS COMPLETE
                      </h3>
                      <p className="text-[11px] text-[#5D5FEF]/80 dark:text-indigo-300/80">
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
                      <div className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300">
                        Accuracy: {accText}
                      </div>
                    );
                  })()}
                </div>

                {/* Generation Output Video (If generated) */}
                {generatedVideoUrl && (
                  <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 dark:border-white/10 dark:bg-white/5">
                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Generated Recreate Ad Video
                    </span>
                    <video
                      src={generatedVideoUrl}
                      controls
                      autoPlay
                      className="max-h-48 w-full rounded-lg object-cover"
                    />
                  </div>
                )}

                {generateError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-500">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      {typeof generateError === 'string'
                        ? generateError
                        : (generateError?.message || generateError?.msg || JSON.stringify(generateError))}
                    </span>
                  </div>
                )}

                {/* Brand / Product (Editable Input) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                    Brand / Product
                  </label>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="Enter brand or product name"
                    className="h-10 w-full rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 px-3.5 py-2 text-xs sm:text-[13px] font-medium text-zinc-800 placeholder:text-zinc-400 dark:text-white dark:placeholder:text-white/30 transition-all shadow-xs focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] dark:focus:border-[#6366F1] dark:focus:ring-[#6366F1]"
                  />
                </div>

                {/* Analysis Summary (Editable Textarea) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                    Analysis Summary
                  </label>
                  <textarea
                    ref={summaryTextareaRef}
                    value={editableVisualDescription}
                    onChange={(e) => setEditableVisualDescription(e.target.value)}
                    rows={2}
                    placeholder="Analysis visual description summary..."
                    className="min-h-[56px] max-h-28 w-full resize-none overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed text-zinc-800 placeholder:text-zinc-400 dark:text-zinc-200 dark:placeholder:text-white/30 transition-all shadow-xs focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] dark:focus:border-[#6366F1] dark:focus:ring-[#6366F1]"
                  />
                </div>

                {/* Model & Duration (2 Columns) */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 items-start">
                  {/* Model */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 justify-start">
                    <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                      AI Model
                    </label>
                    <CommonDropdown
                      options={videoChatModels}
                      label="AI Model"
                      icon={SparkleDark}
                      triggerVariant="recreate-field"
                      className="w-full min-w-0 justify-between !h-10 !py-0 px-3.5 [&>div]:min-w-0 [&>div>span]:truncate !rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 shadow-xs focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] data-[state=open]:border-[#5D5FEF] data-[state=open]:ring-1 data-[state=open]:ring-[#5D5FEF] dark:focus:border-[#6366F1] dark:focus:ring-[#6366F1] dark:data-[state=open]:border-[#6366F1] transition-all"
                      value={videoChatModels.find((o) => o.value === videoModel)}
                      onChange={(val) => {
                        setVideoModel(val);
                        setErrors((prev) => ({ ...prev, videoModel: '' }));
                      }}
                    />
                  </div>

                  {/* Duration (Dropdown) */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 justify-start">
                    <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                      Duration
                    </label>
                    <CommonDropdown
                      options={configuredDurationOptions}
                      label="Duration"
                      icon={TimerDarkLogo}
                      triggerVariant="recreate-field"
                      className="w-full min-w-0 justify-between !h-10 !py-0 px-3.5 [&>div]:min-w-0 [&>div>span]:truncate !rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 shadow-xs focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] data-[state=open]:border-[#5D5FEF] data-[state=open]:ring-1 data-[state=open]:ring-[#5D5FEF] dark:focus:border-[#6366F1] dark:focus:ring-[#6366F1] dark:data-[state=open]:border-[#6366F1] transition-all"
                      value={configuredDurationOptions.find((o) => o.value === selectedVideoDuration) || configuredDurationOptions[0]}
                      onChange={(val) => {
                        preferredDurationRef.current = val;
                        setVideoDuration(val);
                        setDurationInputText(String(parseInt(val, 10) || ''));
                        setErrors((prev) => ({ ...prev, videoDuration: '' }));
                      }}
                    />
                  </div>
                </div>

                {/* Aspect Ratio (Subtle Rounded Buttons) */}
                <div className="flex flex-col gap-1.5 justify-start">
                  <label className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                    Aspect Ratio
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
                            userSelectedAspectRatioRef.current = true;
                            preferredAspectRatioRef.current = value;
                            setAspectRatio(value);
                            setErrors((prev) => ({ ...prev, aspectRatio: '' }));
                          }}
                          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs sm:text-[13px] transition font-medium cursor-pointer shadow-xs ${
                            isSelected
                              ? 'border-[#5D5FEF] bg-[#EEF2FF] font-semibold text-[#5D5FEF] dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-300 ring-1 ring-[#5D5FEF]/30'
                              : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5'
                          }`}
                          title={label}
                        >
                          <AspectRatioPreview
                            ratio={value}
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isSelected
                                ? 'text-[#5D5FEF] dark:text-indigo-300'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                          />
                          <span className="whitespace-nowrap">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Additional Instructions (Optional) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-zinc-800 dark:text-white/90">
                    Additional Instructions (Optional)
                  </label>
                  <textarea
                    ref={additionalInfoTextareaRef}
                    value={additionalInfo}
                    onChange={(e) => setAdditionalInfo(e.target.value)}
                    rows={1}
                    placeholder="e.g. emphasize vibrant lighting, keep fast pace..."
                    className="h-10 min-h-[40px] max-h-24 w-full resize-none overflow-hidden rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/80 px-3.5 py-2 text-xs sm:text-[13px] leading-relaxed text-zinc-800 placeholder:text-zinc-400 dark:text-white dark:placeholder:text-white/30 transition-all shadow-xs focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF] dark:focus:border-[#6366F1] dark:focus:ring-[#6366F1]"
                  />
                </div>

                {/* Small Disclaimer */}
                <div className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: '#F5C451' }}>
                  <AlertTriangle className="h-3 w-3 shrink-0" style={{ color: '#F5C451' }} />
                  <span style={{ color: '#F5C451' }}>
                    ! AI can make mistakes. Please review the details carefully before proceeding.
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="mt-0.5 flex items-center justify-end gap-2.5 pt-1 shrink-0">
                  {(() => {
                    const selectedModel =
                      videoChatModels.find((model) => model.value === videoModel) ||
                      videoChatModels.find(
                        (model) =>
                          model.value?.toLowerCase() === (videoModel || '').toLowerCase() ||
                          model.label?.toLowerCase() === (videoModel || '').toLowerCase() ||
                          model.canonical?.toLowerCase() === (videoModel || '').toLowerCase()
                      ) ||
                      videoChatModels[0];
                    const effectiveDur = selectedVideoDuration || videoDuration || '8s';
                    const hasEstimateInputs = Boolean(videoModel && effectiveDur);
                    const est = hasEstimateInputs
                      ? estimateAdVideoCredits({
                        video_model: videoModel,
                        video_duration: effectiveDur,
                        no_of_ads: 1,
                        modelCredits,
                        creditsPerSecond: selectedModel?.creditsPerSecond || creditsPerSecond,
                      })
                      : 0;
                    const enough = hasEstimateInputs ? availableCredits >= est : true;
                    const isBtnDisabled = isGenerating || (hasEstimateInputs && !enough);
                    return (
                      <div className="flex items-center gap-2">
                        {hasEstimateInputs && enough ? (
                          <ShadcnTooltip
                            label={`Will use : ${est} credits, ${availableCredits - est} left after`}
                          >
                            <span className="rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 shadow-xs">
                              ~{est} credits
                            </span>
                          </ShadcnTooltip>
                        ) : hasEstimateInputs ? (
                          <span className="rounded-lg border border-red-500 bg-red-500 px-3.5 py-2 text-xs font-medium text-white">
                            Not enough credits — need {est}, you have {availableCredits}
                          </span>
                        ) : null}

                        <button
                          type="button"
                          disabled={isBtnDisabled}
                          onClick={handleGenerate}
                          className={`flex items-center gap-2 rounded-lg px-5 py-2 text-xs sm:text-[13px] font-bold transition-all ${
                            isBtnDisabled
                              ? 'bg-[#5D5FEF]/40 dark:bg-[#6366F1]/40 text-white/70 shadow-none cursor-not-allowed pointer-events-none'
                              : 'bg-[#5D5FEF] hover:bg-[#4E51DF] dark:bg-[#6366F1] dark:hover:bg-[#4F46E5] text-white shadow-md shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                          }`}
                        >
                          {isGenerating && <Loader2 className="h-4 w-4 animate-spin" />}
                          {isGenerating ? 'Generating...' : 'Generate'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : analysisState === 'analyzing' || isAnalyzing ? (
              /* ── NEW ANALYSIS VIEW (Matching Photo 2 Reference) ──────────────── */
              <div className={`flex flex-col justify-center ${isHorizontalVideo ? 'gap-6 sm:gap-7 py-4 sm:py-6' : 'gap-5 sm:gap-6 py-4'} px-2 sm:px-4 text-left h-full my-auto ${isVerticalVideo ? 'max-w-[340px] sm:max-w-[370px]' : 'max-w-md lg:max-w-lg'}`}>
                {/* Duration warning if video is too long */}
                {durationErrorMsg && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-500/10 dark:bg-red-500/15 px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 max-w-md shadow-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span>{durationErrorMsg}</span>
                  </div>
                )}

                {/* Header */}
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                    Analyzing your reference ad
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                    We're breaking the ad down so we can rebuild it around your product.
                  </p>
                </div>

                {/* 5 Analysis Steps Checklist with Continuous Top-to-Bottom Blinking Wave */}
                <div className="flex flex-col gap-4 py-2">
                  {ANALYSIS_CHECKLIST_STEPS.map((step, idx) => {
                    return (
                      <div key={step.id || idx} className="flex items-center gap-3">
                        <motion.div
                          animate={{
                            opacity: [0.35, 1, 0.35],
                            scale: [0.93, 1.05, 0.93],
                            boxShadow: [
                              '0 0 0px rgba(16,185,129,0)',
                              '0 0 10px rgba(16,185,129,0.5)',
                              '0 0 0px rgba(16,185,129,0)',
                            ],
                          }}
                          transition={{
                            duration: 1.8,
                            repeat: Infinity,
                            delay: idx * 0.3,
                            ease: 'easeInOut',
                          }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#10B981] text-white shadow-xs"
                        >
                          <Check className="h-3 w-3 stroke-[3] text-white" />
                        </motion.div>
                        <motion.span
                          animate={{
                            opacity: [0.65, 1, 0.65],
                          }}
                          transition={{
                            duration: 1.8,
                            repeat: Infinity,
                            delay: idx * 0.3,
                            ease: 'easeInOut',
                          }}
                          className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-white"
                        >
                          {step.title}
                        </motion.span>
                      </div>
                    );
                  })}
                </div>

                {/* Progress Bar & Percentage */}
                <div className="flex flex-col gap-2 pt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#5D5FEF] dark:bg-[#6366F1] transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, analyzeProgress))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                    <span>{analyzeProgress}% complete</span>
                    <span>{analyzeProgress >= 100 ? 'Done' : ''}</span>
                  </div>
                </div>

                {/* Run in Background Notice & Action Button */}
                <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t border-black/5 dark:border-white/5">
                  <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 leading-normal">
                    You can leave this page. We'll save the result to this page.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof onClose === 'function') {
                        onClose();
                      }
                    }}
                    className="shrink-0 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-800/90 px-3.5 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 shadow-xs transition hover:bg-zinc-50 dark:hover:bg-white/10 hover:border-zinc-300 dark:hover:border-white/20 active:scale-95 cursor-pointer"
                  >
                    Run in background
                  </button>
                </div>
              </div>
            ) : analysisState === 'failed' ? (
              /* ── ANALYSIS FAILED STATE ─────────────────────────────────────── */
              <div className="my-auto flex flex-col items-center justify-center gap-5 py-8 px-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400">
                  <AlertTriangle className="h-7 w-7" />
                </div>

                <div className="flex max-w-md flex-col items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-bold text-zinc-900 2xl:text-2xl dark:text-white">
                    Analysis Failed
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">
                    We couldn't complete the analysis for this ad.
                  </p>
                  {userSafeError ? (
                    <div className="mt-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-left text-xs leading-relaxed text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
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
                  className="mt-2 flex items-center gap-2 rounded-lg bg-[#5D5FEF] hover:bg-[#4E51DF] dark:bg-[#6366F1] dark:hover:bg-[#4F46E5] text-white px-5 py-2 text-xs sm:text-[13px] font-semibold shadow-md shadow-indigo-500/20 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" />
                  Try Again
                </button>

                {/* Duration warning downwards of the try again button */}
                {durationErrorMsg && (
                  <div className="mt-1 flex items-center gap-2 rounded-xl bg-red-500/10 dark:bg-red-500/15 px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 max-w-md shadow-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span>{durationErrorMsg}</span>
                  </div>
                )}
              </div>
            ) : analysisState === 'timeout' ? (
              /* ── ANALYSIS TIMEOUT STATE ───────────────────────────────────── */
              <div className="my-auto flex flex-col items-center justify-center gap-5 py-8 px-4 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-blue-500 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-400">
                  <Clock className="h-7 w-7" />
                </div>

                <div className="flex max-w-md flex-col items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-bold text-zinc-900 2xl:text-2xl dark:text-white">
                    Analysis is taking longer than expected
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
                    We couldn't get the analysis result in time. Please check your connection and try again.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleTryAgain}
                  className="mt-2 flex items-center gap-2 rounded-lg bg-[#5D5FEF] hover:bg-[#4E51DF] dark:bg-[#6366F1] dark:hover:bg-[#4F46E5] text-white px-5 py-2 text-xs sm:text-[13px] font-semibold shadow-md shadow-indigo-500/20 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" />
                  Try Again
                </button>

                {/* Duration warning downwards of the try again button */}
                {durationErrorMsg && (
                  <div className="mt-1 flex items-center gap-2 rounded-xl bg-red-500/10 dark:bg-red-500/15 px-4 py-2 text-xs font-medium text-red-600 dark:text-red-400 max-w-md shadow-xs">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span>{durationErrorMsg}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {renderLightboxModal()}
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

