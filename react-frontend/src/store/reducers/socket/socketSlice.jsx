import getCookies from '@/utils/getCookies';
import { createSlice } from '@reduxjs/toolkit';
import { io } from 'socket.io-client';
import Cookies from 'js-cookie';
import { triggerLogout } from '@/utils/logout';
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
} from '../adStudio/adVideoNewSlice';
import { updateImage } from '../image/imageSlice';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';

let socket = null;
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
    socket = io(url, {
      auth: {
        token: getCookies(),
      },
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

    socket.on(getCookies(), (data) => {
      if (data?.user_id) {
        Cookies.set('user_name', data.user_name, { expires: 1, path: '/' });
        Cookies.set('user_email', data.user_email, { expires: 1, path: '/' });
        dispatch(setUserData(data));
      }
    });

    socket.on('credits', (data) => {
      dispatch(setCredits(data));
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
      }
    });

    socket.on('adCreativeResponse', (data) => {
      const { adHistory } = getState();
      const sessionId = adHistory?.acs2;

      dispatch(clearCreativeBotTimeout(data?.chatId));
      dispatch(updateAdCreativeBotConversation(data));

      const hasSuccessfulImages = data?.images?.some((img) => {
        const url = img?.base_image_with_logo || img;
        const isInvalid =
          url === 'failed' ||
          url === '400' ||
          url === 'planExpired' ||
          url === 'insufficientCredits';
        return url && !isInvalid;
      });

      if (
        data?.sessionId &&
        data?.type === 'image' &&
        hasSuccessfulImages &&
        !notifiedSessionIds.has(data?.chatId)
      ) {
        notifiedSessionIds.add(data?.chatId);
        showNotification(data?.sessionId, data?.type, dispatch);
      } else if (
        data?.sessionId &&
        data?.type === 'image' &&
        !hasSuccessfulImages &&
        data?.images?.length > 0 &&
        !notifiedSessionIds.has(data?.chatId)
      ) {
        notifiedSessionIds.add(data?.chatId);
        const reason = data.images[0]?.base_image_with_logo || data.images[0];
        showFailureNotification('image', reason);
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

      if (hasVideoUrl && videoId && !notifiedVideoIds.has(videoId)) {
        notifiedVideoIds.add(videoId);
        showNotificationForMyVideo(dispatch);
      } else if (!hasVideoUrl && videoId && !notifiedVideoIds.has(videoId)) {
        notifiedVideoIds.add(videoId);
        showFailureNotification('video', url);
      }
    });

    socket.on('imageScriptUpdate', (data) => {
      console.log('Image and Script update:', data);
      dispatch(updateGeneratedVideo(data));
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

      if (hasUrl && imageId && !notifiedImageIds.has(imageId)) {
        notifiedImageIds.add(imageId);
        // Use the image-specific notification — the video one fired the
        // wrong toast ("Video Generation Complete") on AdCreative runs.
        showNotificationForMyImage(dispatch);
      } else if (!hasUrl && imageId && !notifiedImageIds.has(imageId)) {
        notifiedImageIds.add(imageId);
        showFailureNotification('image', url);
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
        dispatch(setAiAdsSceneData({
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
        }
        dispatch(setAiAdsSceneLoading(false));
        return;
      }

      // Regen callback (or legacy full-payload) — merge by segmentNumber
      const { adVideoNew } = getState();
      const existingScenes = adVideoNew?.aiAdsSceneData?.scenes || adVideoNew?.aiAdsSceneData?.data?.scenes || [];
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

      dispatch(setAiAdsSceneData({
        ...(data?.data || data),
        scenes: mergedScenes,
      }));
      dispatch(setAiAdsSceneLoading(false));
    });

    socket.on('aiAdsvideoReady', (data) => {
      console.log("Ai Ads video update: ", data);
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

    socket.on('aiAdsVideoFailed', (data) => {
      console.error('AI Ads video failed:', data);
      const isVoiceFailure = data?.event === 'voiceFailed';
      const message = isVoiceFailure
        ? (data?.error || 'Voice generation failed')
        : (data?.error || 'Video generation failed');
      showFailureNotification('video', message);
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
