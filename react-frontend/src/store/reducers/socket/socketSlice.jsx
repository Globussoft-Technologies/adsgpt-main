import getCookies from '@/utils/getCookies';
import { createSlice } from '@reduxjs/toolkit';
import { io } from 'socket.io-client';
import Cookies from 'js-cookie';
import { triggerLogout } from '@/utils/logout';
import emitter from '@/utils/eventEmitter';
import { GA4Events, setGA4User } from '@/utils/ga4';
import {
  clearBotTimeout,
  setLoading,
  setTyping,
  updateAdcopyBotConversation,
} from '../adStudio/adCopySlice';
import {
  clearCreativeBotTimeout,
  updateAdCreativeBotConversation,
} from '../adStudio/adCreativeSlice';
import { clearVideoBotTimeout, updateAdVideoBotConversation } from '../adStudio/adVideoSlice';
import {
  showNotification,
  showNotificationforadfactory,
  showNotificationForMyVideo,
  showNotificationForMyImage,
  showFailureNotification,
  showAssistantTurnNotification,
} from '@/utils/showNotification';
import {
  adAdsData,
  adAnalyticsData,
  adCtaData,
  adEngagementData,
  adGeoData,
  adPostOwnerData,
  clearAddieBotTimeout,
  setAddieLoading,
  setAddieTyping,
  setCurrentContext,
  setIsFreshUser,
  setSuggestionAds,
  updateAddieConversation,
} from '../adInsights/Addie/AddieChatBotSlice';
import { updateResults } from '../adFactoryNew/adFactoryNewSlice';
import {
  setCompletedNodes,
  setFormProgress,
  updateNodeEnabledStatus,
} from '../AdFactory/AdFactorySlice';
import {
  updateVideo,
  updateVideoPromptPercentage,
  updateGeneratedVideo,
  setAiAdsSceneData,
  setAiAdsSceneLoading,
  setAiAdsSceneError,
  patchAiAdsSceneImage,
  markAiAdsSceneImageFailed,
  setAiAdsSessionStatus,
  updateCloneImage,
  appendAiAdsVersion,
  setAiAdsRegenState,
  setAiAdsTranslateScript,
  setAiAdsTranslateScriptError,
  setAiAdsVoicePreview,
} from '../adStudio/adVideoNewSlice';
import { updateImage } from '../image/imageSlice';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';
import {
  mergeActivityFromSocket,
  applyAutomationStatsPatch,
} from '../adFactoryAutomation/adFactoryAutomationSlice';
import { fetchAutomationStats } from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import { IS_AUTOMATION_ENABLED } from '@/utils/featureFlags';

let socket = null;
// Landing Page Analyzer — per-session buffer of live events + result. Filled by
// the global socket handler below (attached at init), so a result page that
// mounts AFTER some events already fired can replay them instead of missing them.
const lpaBuffer = new Map(); // sessionId -> { events: [...], result: object|null }
export const getLpaSession = (sessionId) =>
  lpaBuffer.get(sessionId) || { events: [], result: null };
// Reset a session's buffer — used on Relaunch so the old completed result
// doesn't get replayed onto the fresh re-scan.
export const clearLpaSession = (sessionId) => {
  if (sessionId) lpaBuffer.set(sessionId, { events: [], result: null });
};

const notifiedVideoIds = new Set();
const notifiedSessionIds = new Set();
const notifiedImageIds = new Set();

const socketSlice = createSlice({
  name: 'socket',
  initialState: {
    connected: false,
    userData: {},
    credits: {},
    generetedAds: [],
    socketId: null,
    isGenerating: false,
  },
  reducers: {
    setConnected: (state, action) => {
      state.connected = action.payload;
    },
    setUserData: (state, action) => {
      state.userData = action.payload;
    },
    setCredits: (state, action) => {
      state.credits = { ...state.credits, ...action.payload };
    },
    setSocketId: (state, action) => {
      state.socketId = action.payload;
    },
    setGeneretedAds: (state, action) => {
      state.generetedAds.push(...action.payload);
    },
    setGeneretedAdsdraft: (state, action) => {
      state.generetedAds = action.payload;
    },
    setIsGenerating: (state, action) => {
      state.isGenerating = action.payload;
    },
    clearSocket: (state) => {
      state.connected = false;
      state.userData = {};
      state.credits = {};
      state.socketId = null;
    },
  },
});

export const {
  setConnected,
  setUserData,
  setCredits,
  setSocketId,
  setGeneretedAds,
  setGeneretedAdsdraft,
  clearSocket,
  setIsGenerating,
} = socketSlice.actions;
export default socketSlice.reducer;

// ---- socket init (side effect in slice) ----
export const initSocket = (url) => (dispatch, getState) => {
  if (!socket) {
    // socket = io("https://h9pxq91j-7000.inc1.devtunnels.ms", {
    socket = io(url, {
      auth: {
        token: getCookies(),
      },
      withCredentials: true,
    });

    socket.on('connect', () => {
      dispatch(setConnected(true));
      dispatch(setSocketId(socket.id));
    });

    socket.on('disconnect', () => {
      dispatch(setConnected(false));
      dispatch(setSocketId(null));
    });

    socket.on('connect_error', (err) => {
      console.error('❌ Connection error:', err.message);
      dispatch(setConnected(false));
      if (err?.message === 'Authentication error') {
        triggerLogout();
      } else {
        // refresh token before retry
        socket.auth = { token: getCookies() };
      }
    });

    const handleAuthenticatedSession = (data) => {
      if (data?.user_id) {
        Cookies.set('user_id', data.user_id, { expires: 1, path: '/', secure: window.location.protocol === 'https:', sameSite: 'strict' });
        Cookies.set('user_name', data.user_name, { expires: 1, path: '/', secure: window.location.protocol === 'https:', sameSite: 'strict' });
        Cookies.set('user_email', data.user_email, { expires: 1, path: '/', secure: window.location.protocol === 'https:', sameSite: 'strict' });
        setGA4User(data.user_id, data.user_name);
        dispatch(setUserData(data));
      }
    };

    socket.on('session', handleAuthenticatedSession);
    const legacyToken = getCookies();
    if (legacyToken) socket.on(legacyToken, handleAuthenticatedSession);

    socket.on('credits', (data) => {
      dispatch(setCredits(data));
    });

    // Landing Page Analyzer live stream. Buffer per session (timing-safe) and
    // relay to the open result page via the app emitter. The backend emits this
    // to the user's room for both progress events (type:'event') and the final
    // report (type:'result').
    socket.on('landingPageAnalysisEvent', (data) => {
      if (data?.sessionId) {
        const buf = lpaBuffer.get(data.sessionId) || { events: [], result: null };
        if (data.type === 'event' && data.lastEvent) {
          buf.events = [...buf.events, { ...data.lastEvent, _t: Date.now() }];
        } else if (data.type === 'result') {
          buf.result = data.result;
        }
        lpaBuffer.set(data.sessionId, buf);
      }
      emitter.emit('lpa:socket', data);
    });

    // An AI Assistant turn that finished after its browser had already left
    // (New Chat / closed tab mid-generation). The turn kept running server-side
    // and its result is persisted — this is the only thing that tells the user.
    socket.on('assistantTurnCompleted', (data) => {
      if (!data?.conversationId) return;
      // Always let the open chat refresh itself.
      emitter.emit('assistant:turnCompleted', data);
      // Only interrupt with an OS notification when the user isn't already
      // watching this happen: the tab is hidden/blurred, they're on another
      // page, or the turn finished after they navigated away entirely.
      const onThisConversation =
        window.location.pathname.startsWith('/assistant') &&
        document.visibilityState === 'visible' &&
        document.hasFocus();
      if (data.detached || !onThisConversation) {
        showAssistantTurnNotification(data.conversationId, Number(data.imageCount) || 0);
      }
    });

    socket.on(`chatResponse`, (data) => {
      dispatch(clearAddieBotTimeout(data?.chatId));
      dispatch(setAddieLoading(false));
      dispatch(updateAddieConversation(data));
      if (data?.isFinalResponse) {
        dispatch(setIsFreshUser(false));
        dispatch(setAddieTyping(false));
        dispatch(setSuggestionAds(data?.chatAdsData));
      }
    });

    socket.on(`analyticsChartTop`, (data) => {
      if (
        data?.analyticsChart?.chartData &&
        Array.isArray(data?.analyticsChart?.chartData) &&
        data?.analyticsChart?.chartData.length > 0
      ) {
        dispatch(adAnalyticsData(data));
      }
    });

    socket.on(`analyticsChartBottom`, (data) => {
      if (
        data?.analyticsChart &&
        Array.isArray(data?.analyticsChart) &&
        data?.analyticsChart?.length > 0
      ) {
        dispatch(adEngagementData(data?.analyticsChart?.find((e) => e.chartType === 'pieChart')));
        dispatch(adPostOwnerData(data?.analyticsChart?.find((e) => e.chartType === 'barChart1')));
        dispatch(adCtaData(data?.analyticsChart?.find((e) => e.chartType === 'barChart2')));
        dispatch(adGeoData(data?.analyticsChart?.find((e) => e.chartType === 'worldMap')));
      }
    });

    socket?.on(`adsData`, (data) => {
      if (data?.adsData && Array.isArray(data?.adsData) && data?.adsData?.length > 0) {
        const filteredAds = data?.adsData?.filter(
          (ad) =>
            !ad?.postImage?.includes('pasimages') &&
            !ad?.postImage?.includes('pasvideos') &&
            !ad?.thumbnail_url?.includes('pasimages') &&
            !ad?.thumbnail_url?.includes('PowerAdspy-Dev')
        );
        dispatch(adAdsData(filteredAds));
      }
    });

    socket?.on(`currentContext`, (data) => {
      dispatch(setCurrentContext(data));
    });

    socket?.on(`adFactoryResponse`, (data) => {
      // Relay to the app event bus so non-workflow views (e.g. the My Space →
      // AdFactory gallery) can react without binding their own socket listener.
      emitter.emit('adfactory:imageResult', data);
      if (data?.result && data?.result?.length > 0 && data?.type === 'image') {
        dispatch(updateResults(data));
        const { adFactoryNew } = getState();
        const currentCampaignId = adFactoryNew?.activeCampainId;

        const hasSuccessfulResults = data?.result?.some((item) => item?.status === 200);

        if (hasSuccessfulResults) {
          dispatch(setCompletedNodes('image-generation'));
          dispatch(setFormProgress({ nodeId: 'image-generation', progress: 100 }));
          showNotificationforadfactory('image', dispatch, currentCampaignId);
        } else if (data?.result?.length > 0) {
          const reason = data?.result?.[0]?.message || 'generation failed';
          showFailureNotification('image', reason);
        }
        dispatch(updateNodeEnabledStatus());
      } else if (data?.result && data?.result?.length > 0 && data?.type === 'text') {
        dispatch(updateResults(data));
        const { adFactoryNew } = getState();
        const currentCampaignId = adFactoryNew?.activeCampainId;

        // Only mark as completed if results have successful status (200)
        const hasSuccessfulResults = data?.result?.some((item) => item?.status === 200);
        if (hasSuccessfulResults) {
          dispatch(setCompletedNodes('text-generation'));
          dispatch(setFormProgress({ nodeId: 'text-generation', progress: 100 }));
          showNotificationforadfactory('text', dispatch, currentCampaignId);
        } else if (data?.result?.length > 0) {
          const reason = data?.result?.[0]?.message || 'generation failed';
          showFailureNotification('text', reason);
        }
        dispatch(updateNodeEnabledStatus());
      } else if (data?.result && data?.result?.length > 0 && data?.type === 'video') {
        dispatch(updateResults(data));
        // Only mark as completed if results have successful status (200)
        const hasSuccessfulResults = data?.result?.some((item) => item?.status === 200);
        if (hasSuccessfulResults) {
          dispatch(setCompletedNodes('video-generation'));
          dispatch(setFormProgress({ nodeId: 'text-generation', progress: 100 }));
        }
        dispatch(updateNodeEnabledStatus());
      }
    });
    socket.on('adCopyResponse', (data) => {
      dispatch(clearBotTimeout(data?.chatId));
      dispatch(setLoading(false));
      dispatch(updateAdcopyBotConversation(data));
      if (data?.isLastChunk) {
        dispatch(setTyping(false));
        GA4Events.adCopyGenerated({ source: 'adcopy_chat', success: true });
      }
    });

    socket.on('adCreativeResponse', (data) => {
      const { adHistory } = getState();
      const sessionId = adHistory?.acs2;

      dispatch(clearCreativeBotTimeout(data?.chatId));
      dispatch(updateAdCreativeBotConversation(data));

      const hasSuccessfulImages = data?.images?.some((img) => {
        const url = typeof img === 'string' ? img : (img?.base_image_with_logo || img?.base_image || img?.data || img);
        const isInvalid =
          !url ||
          url === 'failed' ||
          url === '400' ||
          url === 'planExpired' ||
          url === 'insufficientCredits';
        return !isInvalid;
      });

      const isImageType = data?.type ? data?.type !== 'video' : Boolean(data?.images);
      const effectiveSessionId = data?.sessionId || data?.session_id || sessionId;
      const responseId = data?.chatId || data?.chat_id || data?.request_payload?.chatId || effectiveSessionId;

      const rawVariant =
        data?.variant ||
        data?.imageType ||
        data?.request_payload?.type ||
        data?.request_payload?.variant ||
        (data?.type && data?.type !== 'image' && data?.type !== 'video' ? data?.type : '') ||
        'ai_creatives';
      const creativeVariant = String(rawVariant).toLowerCase();

      if (
        effectiveSessionId &&
        isImageType &&
        hasSuccessfulImages &&
        responseId &&
        !notifiedSessionIds.has(responseId)
      ) {
        notifiedSessionIds.add(responseId);
        showNotification(effectiveSessionId, 'image', dispatch);
        if (creativeVariant === 'lifestyle' || creativeVariant === 'lifestyle_ad') {
          GA4Events.adCreativeLifestyleAdGenerated({ source: 'lifestyle_ad_studio', success: true });
        } else if (creativeVariant === 'product_shot') {
          GA4Events.adCreativeProductShotGenerated({ source: 'product_shot_studio', success: true });
        } else if (creativeVariant === 'brand_awareness') {
          GA4Events.adCreativeBrandAwarenessGenerated({ source: 'brand_awareness_studio', success: true });
        } else if (creativeVariant === 'apps_saas') {
          GA4Events.adCreativeAppsSaasGenerated({ source: 'apps_saas_studio', success: true });
        } else {
          GA4Events.adCreativeAICreativesGenerated({ source: 'ai_creatives_studio', success: true });
        }
      } else if (
        (effectiveSessionId || responseId) &&
        isImageType &&
        !hasSuccessfulImages &&
        responseId &&
        !notifiedSessionIds.has(responseId)
      ) {
        notifiedSessionIds.add(responseId);
        const reason =
          data?.images?.[0]
            ? typeof data.images[0] === 'string'
              ? data.images[0]
              : data.images[0]?.base_image_with_logo || data.images[0]?.base_image || 'generation failed'
            : data?.error || data?.message || 'generation failed';
        showFailureNotification('image', reason);
        if (creativeVariant === 'lifestyle' || creativeVariant === 'lifestyle_ad') {
          GA4Events.adCreativeLifestyleAdFailed({ source: 'lifestyle_ad_studio', success: false });
        } else if (creativeVariant === 'product_shot') {
          GA4Events.adCreativeProductShotFailed({ source: 'product_shot_studio', success: false });
        } else if (creativeVariant === 'brand_awareness') {
          GA4Events.adCreativeBrandAwarenessFailed({ source: 'brand_awareness_studio', success: false });
        } else if (creativeVariant === 'apps_saas') {
          GA4Events.adCreativeAppsSaasFailed({ source: 'apps_saas_studio', success: false });
        } else {
          GA4Events.adCreativeAICreativesFailure({ source: 'ai_creatives_studio', success: false });
        }
      }
    });

    socket.on('adCreativeVideoResponse', (data) => {
      const { adHistory } = getState();
      const sessionId = adHistory?.avs3;
      dispatch(clearVideoBotTimeout(data?.session?.chatId));
      dispatch(updateAdVideoBotConversation(data));

      if (
        data?.session?.sessionId &&
        (data?.session?.sessionId !== sessionId ||
          (data?.session?.sessionId === sessionId && document.hidden)) &&
        data?.queryResult?.type === 'video'
      ) {
        const sid = data?.session?.sessionId;
        const cid = data?.session?.chatId;
        const hasCompletedVideo = data?.queryResult?.videoUrl?.some(
          (url) => url && url !== 'failed' && url !== '400'
        );
        if (hasCompletedVideo && !notifiedSessionIds.has(cid)) {
          notifiedSessionIds.add(cid);
          showNotification(sid, data?.queryResult?.type, dispatch);
        } else if (!hasCompletedVideo && !notifiedSessionIds.has(cid)) {
          notifiedSessionIds.add(cid);
          const reason = data?.queryResult?.videoUrl?.[0] || 'generation failed';
          showFailureNotification('video', reason);
        }
      }
    });

    socket.on('videoProgress', (progressData) => {
      console.log('Video progress update:', progressData);
      if (progressData?._id && progressData?.promptPercentage) {
        dispatch(
          updateVideoPromptPercentage({
            id: progressData?._id,
            promptPercentage: progressData?.promptPercentage,
          })
        );
      }
    });

    socket.on('videoCreated', (completedData) => {
      console.log("videoCreated", completedData);
      dispatch(updateVideo(completedData));
      dispatch(fetchProcessingCount());
      // _id is at top-level, not inside video object
      const videoId = completedData?._id || completedData?.video?._id;
      // URL is directly at video.url, not in results[0].url
      const url = completedData?.video?.url || completedData?.video?.results?.[0]?.url;
      const hasVideoUrl = url && url !== 'failed' && url !== '400' && url !== 'planExpired';

      const vType = completedData?.video?.inputs?.type || completedData?.video?.type;
      if (hasVideoUrl && videoId && !notifiedVideoIds.has(videoId)) {
        notifiedVideoIds.add(videoId);
        showNotificationForMyVideo(dispatch);
        if (vType === 'ai_ads') {
          GA4Events.adVideoAIAdsGenerated({ source: 'ai_ads_studio', success: true });
        } else if (vType === 'broll') {
          GA4Events.adVideoProductBrollsGenerated({ source: 'product_brolls_studio', success: true });
        } else if (vType === 'clone') {
          GA4Events.adVideoCloneYourselfGenerated({ source: 'clone_yourself_studio', success: true });
        } else if (vType === 'avatar') {
          GA4Events.adVideoAIAvatarsGenerated({ source: 'ai_avatars_studio', success: true });
        } else {
          GA4Events.adVideoAIUGCAdsGenerated({ source: 'ai_ugc_ads_studio', success: true });
        }
      } else if (!hasVideoUrl && videoId && !notifiedVideoIds.has(videoId)) {
        notifiedVideoIds.add(videoId);
        showFailureNotification('video', url);
        if (vType === 'ai_ads') {
          GA4Events.adVideoAIAdsFailed({ source: 'ai_ads_studio', success: false });
        } else if (vType === 'broll') {
          GA4Events.adVideoProductBrollsFailed({ source: 'product_brolls_studio', success: false });
        } else if (vType === 'clone') {
          GA4Events.adVideoCloneYourselfFailed({ source: 'clone_yourself_studio', success: false });
        } else if (vType === 'avatar') {
          GA4Events.adVideoAIAvatarsFailed({ source: 'ai_avatars_studio', success: false });
        } else {
          GA4Events.adVideoAIUGCAdsFailed({ source: 'ai_ugc_ads_studio', success: false });
        }
      }
    });

    socket.on('imageScriptUpdate', (data) => {
      console.log('Image and Script update:', data);
      dispatch(updateGeneratedVideo(data));
    });

    socket.on('CloneImageScriptUpdate', (data) => {
      console.log('Clone image/script update:', data);
      if (data?.generatedImage !== undefined) {
        // Image update — normalize S3 path and update clone image state
        const S3 = import.meta.env.VITE_S3_BASE_URL || '';
        const img = data.generatedImage;
        const normalized = {
          ...data,
          generatedImage:
            img && img !== 'failed' && !img.startsWith('http') ? `${S3}${img}` : img,
        };
        dispatch(updateCloneImage(normalized));
      } else {
        // Script update — merge into imageAndScript via updateGeneratedVideo
        dispatch(updateGeneratedVideo(data));
      }
    });


    // AdCreative image generation completion. Mirrors the videoCreated
    // shape — the slice's updateImage reducer normalises the URL and
    // upserts into history + reflects into `current` if it matches.
    socket.on('imageCreated', (completedData) => {
      console.log('imageCreated', completedData);
      dispatch(updateImage(completedData));
      const imageId = completedData?._id || completedData?.image?._id;
      const url =
        completedData?.image?.url ||
        completedData?.image?._doc?.results?.[0]?.generatedImageUrl ||
        completedData?.image?.results?.[0]?.generatedImageUrl;
      const hasUrl = url && url !== 'failed' && url !== '400' && url !== 'planExpired';

      const imgType = completedData?.image?.inputs?.type || completedData?.image?._doc?.inputs?.type;
      if (hasUrl && imageId && !notifiedImageIds.has(imageId)) {
        notifiedImageIds.add(imageId);
        showNotificationForMyImage(dispatch);
        if (imgType === 'recreate_ads') {
          GA4Events.adLibraryRecreateGenerated({ source: 'ad_library_recreate_studio', success: true });
        } else if (imgType === 'product_shot') {
          GA4Events.adCreativeProductShotGenerated({ source: 'product_shot_studio', success: true });
        }
      } else if (!hasUrl && imageId && !notifiedImageIds.has(imageId)) {
        notifiedImageIds.add(imageId);
        showFailureNotification('image', url);
        if (imgType === 'recreate_ads') {
          GA4Events.adLibraryRecreateFailed({ source: 'ad_library_recreate_studio', success: false });
        } else if (imgType === 'product_shot') {
          GA4Events.adCreativeProductShotFailed({ source: 'product_shot_studio', success: false });
        }
      }
    });

    socket.on('aiAdsScenesReady', (data) => {
      console.log("Ai Ads update: ", data);
      const event = data?.event;

      // Scenario 1: text callback — all scenes arrive, no images yet
      if (event === 'text') {
        const incomingScenes = data?.scenes || [];
        const scenes = incomingScenes.map((s) => ({
          ...s,
          frameImageUrl: s.frameImageUrl ?? null,
          imageFailed: false,
          imageError: null,
        }));
        // Preserve existing top-level fields (_id, status, inputs, etc.) — the
        // socket payload only carries sessionId/event/scenes, so spreading it
        // alone would wipe _id and break URL/Generate after Back→Next cycles.
        const existing = getState()?.adVideoNew?.aiAdsSceneData || {};
        dispatch(setAiAdsSceneData({
          ...existing,
          ...(data?.data || data),
          scenes,
          status: 'processing',
        }));
        dispatch(setAiAdsSceneLoading(false));
        return;
      }

      // Scenarios 2 & 3: per-image patch (partial or complete).
      // Also fires for regen-success callbacks — we must reset isLoading so the
      // component's useEffect clears regeneratingMap and the scene's regen
      // loader stops spinning.
      if (event === 'imagePartial' || event === 'imageComplete') {
        dispatch(patchAiAdsSceneImage({
          segmentNumber: data.segmentNumber,
          frameImageUrl: data.frameImageUrl,
        }));
        if (event === 'imageComplete') {
          dispatch(setAiAdsSessionStatus('completed'));
          dispatch(setAiAdsSceneLoading(false));
        }
        return;
      }

      // Regen callback (or legacy full-payload) — merge by segmentNumber
      const { adVideoNew } = getState();
      const existingAiAdsData = adVideoNew?.aiAdsSceneData || {};
      const existingScenes = existingAiAdsData?.data?.scenes || existingAiAdsData?.scenes || [];
      const incomingScenes = data?.scenes || data?.data?.scenes || [];

      const mergedScenes = existingScenes.length > 0
        ? existingScenes.map((existing) => {
            const updated = incomingScenes.find((s) => s.segmentNumber === existing.segmentNumber);
            if (!updated) return existing;
            return {
              ...existing,
              ...updated,
              frameImageUrl: updated.frameImageUrl || existing.frameImageUrl || '',
              imageFailed: false,
              imageError: null,
            };
          })
        : incomingScenes.map((newScene) => ({
            ...newScene,
            frameImageUrl: newScene.frameImageUrl || '',
          }));

      // Preserve existing _id, status, inputs, etc. — regen socket payload
      // only carries sessionId/event/scenes, so spreading it alone would wipe
      // _id and break URL/Generate flow after Back→Next.
      const nextAiAdsData = {
        ...existingAiAdsData,
        ...(data?.data || data),
        scenes: mergedScenes,
      };
      if (existingAiAdsData?.data) {
        nextAiAdsData.data = {
          ...existingAiAdsData.data,
          ...((data?.data && data.data) || {}),
          scenes: mergedScenes,
        };
      }
      dispatch(setAiAdsSceneData(nextAiAdsData));
      dispatch(setAiAdsSceneLoading(false));
    });

    socket.on('aiAdsvideoReady', (data) => {
      console.log("Ai Ads video update: ", data);
    });

    // Voice-regenerate finished — a new version is appended and previewed on the
    // My Space card. Payload: { sessionId, index, regenType, totalDuration, result }.
    socket.on('aiAdsVoiceReady', (data) => {
      if (!data?.sessionId || !data?.result) return;
      dispatch(appendAiAdsVersion({
        sessionId: data.sessionId,
        index: data.index,
        result: data.result,
      }));
    });

        socket.on('audio-result', (data) => {
      if (!data?.sessionId) return;
      dispatch(setAiAdsRegenState({ sessionId: data.sessionId, regenState: 'idle' }));
      dispatch(setAiAdsVoicePreview({ sessionId: data.sessionId, preview: data.preview, error: data.error || null }));
    });
// Voice-regenerate failed — clear the overlay (so the user can retry) + toast.
    socket.on('aiAdsVoiceFailed', (data) => {
      console.error('AI Ads voice regen failed:', data);
      if (data?.sessionId) {
        dispatch(setAiAdsRegenState({ sessionId: data.sessionId, regenState: 'idle' }));
      }
      showFailureNotification('video', data?.error || 'Voice regeneration failed');
    });

    // Translate/Rewrite Step-1 preview: the new script arrived. Store it so the
    // RegenerateVoiceModal can render the editable script box. Does NOT touch
    // the committed video (backend only forwards the script for a preview).
    socket.on('aiAdsTranslateScriptReady', (data) => {
      if (!data?.sessionId) return;
      dispatch(setAiAdsTranslateScript({
        sessionId: data.sessionId,
        scenes: data.scenes || [],
      }));
    });

    // Translate/Rewrite Step-1 preview failed — modal surfaces it + lets retry.
    socket.on('aiAdsTranslateScriptFailed', (data) => {
      console.error('AI Ads translate script preview failed:', data);
      if (!data?.sessionId) return;
      dispatch(setAiAdsTranslateScriptError({
        sessionId: data.sessionId,
        error: data.error || 'Failed to generate the script.',
      }));
    });

    socket.on('aiAdsScenesFailed', (data) => {
      console.error('AI Ads scenes failed:', data);
      const event = data?.event;

      // Scenario 4: one scene's image failed — session continues
      if (event === 'sceneImageFailed') {
        dispatch(markAiAdsSceneImageFailed({
          segmentNumber: data.segmentNumber,
          error: data.error || 'Image generation failed for this scene',
        }));
        dispatch(setAiAdsSceneLoading(false));
        return;
      }

      // Scenario 5: full pipeline crash (or legacy failure)
      dispatch(setAiAdsSceneError(data?.error || 'Generation failed'));
    });

    // Regen failure on a scene that already had a working image. Backend
    // preserves the old image in DB (does NOT set imageFailed); we just
    // toast the error and clear the loading state so the user keeps seeing
    // the previous image and can try again.
    socket.on('aiAdsSceneRegenFailed', (data) => {
      console.error('AI Ads scene regen failed (preserving old image):', data);
      showFailureNotification(
        'image',
        data?.error || 'Failed to regenerate this scene. Previous image kept.'
      );
      dispatch(setAiAdsSceneLoading(false));
    });

    socket.on('aiAdsVideoFailed', (data) => {
      console.error('AI Ads video failed:', data);
      const isVoiceFailure = data?.event === 'voiceFailed';
      const message = isVoiceFailure
        ? (data?.error || 'Voice generation failed')
        : (data?.error || 'Video generation failed');
      showFailureNotification('video', message);
    });

    // AdFactory Autopilot — one terminal event per cycle, fired after the
    // generated ad has been posted to Meta and persisted to history.
    //
    // Payload shape observed in the wild (matches AUTOPILOT_SOCKET_EVENTS.md):
    //   { success: true,
    //     campaign: { _id, campaignId, campaignName, status },
    //     generationHealth: {...},
    //     platforms: { meta: { config: {...} } },
    //     data: [ { runId, status, ...generationSummary, creatives[] } ] }
    //
    // jobId on the payload is used only as a reverse-lookup hint to resolve
    // the AdFactory campaignId when the event doesn't carry an explicit
    // `campaign.campaignId`. The activity cache itself is keyed by
    // campaignId — one campaign can span multiple jobs (e.g. completed →
    // re-activated creates a new job) and the trace stays continuous.
    if (IS_AUTOMATION_ENABLED) socket.on('adsFactory:runComplete', (data) => {
      // jobId on the payload is still used for the reverse-lookup fallback
      // — older event shapes may not carry an explicit campaignId. The
      // activity cache itself is now keyed by AdsGPT campaignId (one
      // campaign can span multiple jobs over its lifetime).
      const jobId =
        data?.jobId ||
        data?.campaign?._id ||
        data?.data?.[0]?.jobId;

      // Resolve campaignId. Prefer an explicit field on the payload; fall
      // back to reverse-lookup against configsByCampaign via jobId.
      // `campaign.campaignId` is sometimes aliased to the jobId (same Mongo
      // ObjectId), so reject that shape and use the reverse lookup.
      const configs = getState().adFactoryAutomation?.configsByCampaign || {};
      const rawCampaignId = data?.campaign?.campaignId || null;
      let campaignId = rawCampaignId && rawCampaignId !== jobId ? rawCampaignId : null;
      if (!campaignId && jobId) {
        for (const [cid, entry] of Object.entries(configs)) {
          if (entry?.jobId === jobId) {
            campaignId = cid;
            break;
          }
        }
      }

      if (!campaignId) {
        console.warn('adsFactory:runComplete could not resolve campaignId', data);
        return;
      }

      // Merge first — modal may or may not be open, but the bucket stays
      // warm so the next open is instant. Keyed by campaignId now.
      dispatch(mergeActivityFromSocket({ campaignId, payload: data }));

      {
        // Eager stats patch built straight from the socket payload — the
        // event already carries every field the AutomationActiveNode reads,
        // so the canvas updates in the same tick as the event without
        // waiting on the HTTP roundtrip below. Field mapping:
        //   generated → generationHealth.totalCreativesAssembled (cumulative)
        //   posted    → generationHealth.totalCreativesPosted    (cumulative)
        //   lastRunAt → data[0].completedAt (the run that just finished)
        //   nextRunAt → data[0].generationSummary.nextRunAt
        //               (mirrored onto stats.schedule so the countdown
        //               selector — which reads stats.schedule.nextRunAt —
        //               picks it up; the existing schedule object is
        //               spread in so frequency/timezone aren't clobbered
        //               by the shallow merge inside applyAutomationStatsPatch.)
        const gh = data?.generationHealth || {};
        const latestRun = Array.isArray(data?.data) ? data.data[0] : null;
        const nextRunAt = latestRun?.generationSummary?.nextRunAt || null;
        const lastRunAt = latestRun?.completedAt || null;
        const existingSchedule =
          configs?.[campaignId]?.stats?.schedule || {};

        dispatch(
          applyAutomationStatsPatch({
            campaignId,
            stats: {
              generated:
                Number(gh.totalCreativesAssembled ?? gh.totalImagesGenerated) ||
                0,
              posted: Number(gh.totalCreativesPosted) || 0,
              lastRunAt,
              nextRunAt,
              schedule: { ...existingSchedule, nextRunAt, lastRunAt },
            },
          }),
        );

        // HTTP backstop — reconciles any field the socket payload doesn't
        // carry (or a server shape drift). UI is already up-to-date from
        // the patch above; this just keeps Redux honest.
        dispatch(fetchAutomationStats(campaignId));
      }
      // If no campaignId could be resolved (cold tab, entry never
      // hydrated), we still merged the activity — countdown will catch
      // up on the next AdFactoryWorkflow mount via fetchAutomation.
    });
  }
};

export const closeSocket = () => (dispatch) => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  dispatch(clearSocket());
};

// Getter for using the raw socket instance (emit/on)
export const getSocket = () => socket;
