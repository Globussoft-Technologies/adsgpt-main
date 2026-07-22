import { createSlice } from '@reduxjs/toolkit';

const getInitialActivePage = () => {
  const storedPage = sessionStorage.getItem('adVideoActivePage');
  return storedPage ? storedPage : 'home';
};

const getInitialMySpaceTab = () => {
  const stored = sessionStorage.getItem('mySpaceTab');
  return stored === 'videos' || stored === 'images' ? stored : 'images';
};

// Which image source the MySpace › Images tab is browsing:
//   'adCreative'  — Ad Studio's ImageGeneration store (default)
//   'adFactory'   — AdFactory images API
//   'aiAssistant' — AI Assistant (Sherry) generations, from /generated-media/library
const getInitialImageSource = () => {
  const stored = sessionStorage.getItem('mySpaceImageSource');
  return ['adCreative', 'adFactory', 'aiAssistant'].includes(stored)
    ? stored
    : 'adCreative';
};

const initialState = {
  activePage: getInitialActivePage(),
  mySpaceTab: getInitialMySpaceTab(), // 'images' | 'videos' — set before navigating to MySpace.
  mySpaceImageSource: getInitialImageSource(),
  savedCount: 0,
  showSavedFolder: false,
  isLoading: false,
  error: null,
  imageAndScript: null,
  clonePayload: null,
  // Bumped on every socket CloneImageScriptUpdate that carries an image, so the
  // retry flow has a reliable "socket arrived" signal even when the image value
  // is unchanged (e.g. failed → failed).
  cloneImageVersion: 0,
  allVideos: [],
  avatars: [],
  avatarsLoading: false,
  avatarsPagination: { page: 1, hasMore: false, total: 0 },
  recreateInputs: null,
  currentAvatarStep: 'options',
  currentCloneStep: 'upload',
  currentAIAdsStep: 'selection',
  aiAdsAnalysisData: null,
  aiAdsAnalysisLoading: false,
  aiAdsAnalysisError: null,
  aiAdsSceneData: null,
  aiAdsSceneLoading: false,
  aiAdsSceneError: null,
  aiAdsPrefillInputs: null,
  // Translate/Rewrite Step-1 preview scripts, keyed by sessionId:
  //   { [sessionId]: { scenes: [...], error: null } }
  // Populated by socket 'aiAdsTranslateScriptReady' / 'aiAdsTranslateScriptFailed';
  // read by RegenerateVoiceModal to render the editable script box.
  aiAdsTranslateScript: {},
  aiAdsVoicePreview: {},
};

const adVideoNewSlice = createSlice({
  name: 'adVideoNew',
  initialState,
  reducers: {
    resetAdVideoNewSlice: () => ({ ...initialState, activePage: 'home' }),
    setActivePage: (state, action) => {
      state.activePage = action.payload;
    },
    setMySpaceTab: (state, action) => {
      state.mySpaceTab = action.payload;
      // Persist so a page refresh in MySpace > Videos doesn't pop the user
      // back to the Images tab.
      try {
        sessionStorage.setItem('mySpaceTab', action.payload);
      } catch {
        /* sessionStorage may be disabled — best-effort persistence */
      }
    },
    setMySpaceImageSource: (state, action) => {
      state.mySpaceImageSource = action.payload;
      // Persist so a deep-link (e.g. the AI Assistant "View more" button) and a
      // subsequent refresh keep showing the chosen source.
      try {
        sessionStorage.setItem('mySpaceImageSource', action.payload);
      } catch {
        /* best-effort */
      }
    },
    // incrementSavedCount: (state) => {
    //   state.savedCount += 1;
    // },
    setSavedCount: (state, action) => {
      state.savedCount = action.payload;
    },
    showSavedFolder: (state) => {
      state.showSavedFolder = true;
    },
    setLoading: (state, action) => {
      state.isLoading = action.payload;
    },
    setError: (state, action) => {
      state.error = action.payload;
    },
    setImageAndScript: (state, action) => {
      state.imageAndScript = action.payload;
    },
    setClonePayload: (state, action) => {
      state.clonePayload = action.payload;
    },
    setAllVideos: (state, action) => {
      state.allVideos = action.payload;
    },
    setAvatars: (state, action) => {
      state.avatars = action.payload;
    },
    // Append the next page for infinite scroll, de-duping by id so an
    // overlapping/double-fired page never inserts the same avatar twice.
    appendAvatars: (state, action) => {
      const seen = new Set(state.avatars.map((a) => a._id || a.id || a.avatar_id));
      const incoming = (action.payload || []).filter(
        (a) => !seen.has(a._id || a.id || a.avatar_id)
      );
      state.avatars = [...state.avatars, ...incoming];
    },
    setAvatarsPagination: (state, action) => {
      state.avatarsPagination = { ...state.avatarsPagination, ...action.payload };
    },
    setAvatarsLoading: (state, action) => {
      state.avatarsLoading = action.payload;
    },

    updateVideoPromptPercentage: (state, action) => {
      const { id, promptPercentage } = action.payload;

      const video = state.allVideos.find((v) => v._id === id);

      if (video) {
        video.promptPercentage = promptPercentage;
      }
    },

    updateVideo: (state, action) => {
      const videoData = action.payload.video || action.payload;
      if (!videoData?._id) return;

      // Derive real status from the payload — don't blindly mark as completed
      const hasUrl = videoData?.url || videoData?.results?.[0]?.url;
      const resolvedStatus = videoData?.status || (hasUrl ? 'completed' : 'failed');

      const index = state.allVideos.findIndex((v) => v._id === videoData._id);

      if (index !== -1) {
        state.allVideos[index] = {
          ...state.allVideos[index],
          ...videoData,
          status: resolvedStatus,
        };
      } else {
        state.allVideos.unshift({
          ...videoData,
          status: resolvedStatus,
        });
      }
    },
    updateGeneratedVideo: (state, action) => {
      const payload = action.payload;
      const extra = {};
      if (payload.generatedImage === 'failed') extra.imageError = payload.error;
      if (payload.generatedScript === 'failed') extra.scriptError = payload.error;
      if (state.imageAndScript?.data?._id === payload._id) {
        state.imageAndScript.data = { ...state.imageAndScript.data, ...payload, ...extra };
      } else if (state.imageAndScript?._id === payload._id) {
        state.imageAndScript = { ...state.imageAndScript, ...payload, ...extra };
      } else if (state.imageAndScript?.data) {
        state.imageAndScript.data = { ...state.imageAndScript.data, ...payload, ...extra };
      } else if (state.imageAndScript) {
        state.imageAndScript = { ...state.imageAndScript, ...payload, ...extra };
      }
    },
    updateCloneImage: (state, action) => {
      const { sessionId, _id, generatedImage, error } = action.payload;
      // Always bump so the retry spinner can detect the socket response even
      // when generatedImage stays 'failed' between attempts.
      state.cloneImageVersion += 1;
      const id = sessionId || _id;
      const target =
        state.imageAndScript?.data?._id === id
          ? state.imageAndScript.data
          : state.imageAndScript?._id === id
            ? state.imageAndScript
            : state.imageAndScript?.data ?? state.imageAndScript;
      if (!target) return;
      if (generatedImage && generatedImage !== 'failed') {
        target.generatedImage = generatedImage;
        target.imageError = null;
      } else {
        target.generatedImage = 'failed';
        target.imageError = error || null;
      }
    },
    setRecreateInputs: (state, action) => {
      state.recreateInputs = action.payload;
    },
    setAvatarStep: (state, action) => {
      state.currentAvatarStep = action.payload;
    },
    setCloneStep: (state, action) => {
      state.currentCloneStep = action.payload;
    },
    setAIAdsStep: (state, action) => {
      state.currentAIAdsStep = action.payload;
    },
    setAiAdsAnalysisData: (state, action) => {
      state.aiAdsAnalysisData = action.payload;
    },
    setAiAdsAnalysisLoading: (state, action) => {
      state.aiAdsAnalysisLoading = action.payload;
    },
    setAiAdsAnalysisError: (state, action) => {
      state.aiAdsAnalysisError = action.payload;
    },
    setAiAdsSceneData: (state, action) => {
      state.aiAdsSceneData = action.payload;
    },
    setAiAdsSceneLoading: (state, action) => {
      state.aiAdsSceneLoading = action.payload;
    },
    setAiAdsSceneError: (state, action) => {
      state.aiAdsSceneError = action.payload;
      state.aiAdsSceneLoading = false;
    },
    setAiAdsPrefillInputs: (state, action) => {
      state.aiAdsPrefillInputs = action.payload;
    },
    // Patch one scene's frame image by segmentNumber (image partial/complete callbacks)
    patchAiAdsSceneImage: (state, action) => {
      const { segmentNumber, frameImageUrl } = action.payload;
      if (!state.aiAdsSceneData) return;
      const updateScene = (scenes) => {
        if (!Array.isArray(scenes)) return false;
        const idx = scenes.findIndex((s) => s.segmentNumber === segmentNumber);
        if (idx < 0) return false;
        scenes[idx].frameImageUrl = frameImageUrl;
        scenes[idx].imageFailed = false;
        scenes[idx].imageError = null;
        return true;
      };
      updateScene(state.aiAdsSceneData.scenes) ||
        updateScene(state.aiAdsSceneData.data?.scenes);
    },
    // Mark one scene's image as failed (partial_error callback)
    markAiAdsSceneImageFailed: (state, action) => {
      const { segmentNumber, error } = action.payload;
      if (!state.aiAdsSceneData) return;
      const updateScene = (scenes) => {
        if (!Array.isArray(scenes)) return false;
        const idx = scenes.findIndex((s) => s.segmentNumber === segmentNumber);
        if (idx < 0) return false;
        scenes[idx].imageFailed = true;
        scenes[idx].imageError = error || 'Image generation failed';
        return true;
      };
      updateScene(state.aiAdsSceneData.scenes) ||
        updateScene(state.aiAdsSceneData.data?.scenes);
    },
    // ── AI Ads voice-regenerate / version switching (My Space card) ──────────
    // Per-item client fields on allVideos: regenState ('idle'|'processing'|
    // 'failed') drives the overlay while a regen runs; previewVersion is the
    // freshly generated index shown but NOT yet committed. The committed pointer
    // is item.version (from the server). Card shows previewVersion ?? version.
    setAiAdsRegenState: (state, action) => {
      const { sessionId, regenState } = action.payload;
      const v = state.allVideos.find((x) => x._id === sessionId);
      if (v) v.regenState = regenState;
    },
    // Socket 'aiAdsVoiceReady' — append the new version and preview it.
    appendAiAdsVersion: (state, action) => {
      const { sessionId, index, result } = action.payload;
      const v = state.allVideos.find((x) => x._id === sessionId);
      if (!v || !result) return;
      if (!Array.isArray(v.results)) v.results = [];
      // Idempotent against duplicate socket deliveries.
      if (index != null && v.results[index]) v.results[index] = result;
      else v.results.push(result);
      v.regenState = 'idle';
      v.previewVersion = index != null ? index : v.results.length - 1;
    },
    // select-version success — commit the pointer, clear the preview marker.
    setAiAdsVersion: (state, action) => {
      const { sessionId, version } = action.payload;
      const v = state.allVideos.find((x) => x._id === sessionId);
      if (!v) return;
      v.version = version;
      v.previewVersion = null;
    },
    // Preview a version locally without committing (switcher browsing).
    setAiAdsPreviewVersion: (state, action) => {
      const { sessionId, previewVersion } = action.payload;
      const v = state.allVideos.find((x) => x._id === sessionId);
      if (v) v.previewVersion = previewVersion;
    },
    // Flip session-level status (e.g. "processing" → "completed")
    setAiAdsSessionStatus: (state, action) => {
      if (!state.aiAdsSceneData) return;
      if (state.aiAdsSceneData.data) {
        state.aiAdsSceneData.data.status = action.payload;
      } else {
        state.aiAdsSceneData.status = action.payload;
      }
    },
        setAiAdsVoicePreview: (state, action) => {
      const { sessionId, preview, error } = action.payload;
      if (!sessionId) return;
      state.aiAdsVoicePreview[sessionId] = { preview: preview || null, error: error || null };
    },
    clearAiAdsVoicePreview: (state, action) => {
      const { sessionId } = action.payload || {};
      if (sessionId) delete state.aiAdsVoicePreview[sessionId];
    },
// Socket 'aiAdsTranslateScriptReady' — store the previewed script for a
    // session so the modal can render it (editable). Keyed by sessionId.
    setAiAdsTranslateScript: (state, action) => {
      const { sessionId, scenes } = action.payload;
      if (!sessionId) return;
      state.aiAdsTranslateScript[sessionId] = { scenes: scenes || [], error: null };
    },
    // Socket 'aiAdsTranslateScriptFailed' — record the failure so the modal
    // can surface it and let the user retry.
    setAiAdsTranslateScriptError: (state, action) => {
      const { sessionId, error } = action.payload;
      if (!sessionId) return;
      state.aiAdsTranslateScript[sessionId] = { scenes: null, error: error || 'Failed' };
    },
    // Clear a session's preview script (on modal close / mode switch / re-preview).
    clearAiAdsTranslateScript: (state, action) => {
      const { sessionId } = action.payload || {};
      if (sessionId) delete state.aiAdsTranslateScript[sessionId];
    },
  },
});

export const {
  setActivePage,
  setMySpaceTab,
  setMySpaceImageSource,
  incrementSavedCount,
  setSavedCount,
  setLoading,
  setError,
  setImageAndScript,
  setClonePayload,
  updateCloneImage,
  setAllVideos,
  showSavedFolder,
  updateVideoPromptPercentage,
  updateVideo,
  updateGeneratedVideo,
  resetAdVideoNewSlice,
  setAvatars,
  appendAvatars,
  setAvatarsPagination,
  setAvatarsLoading,
  setRecreateInputs,
  setAvatarStep,
  setCloneStep,
  setAIAdsStep,
  setAiAdsAnalysisData,
  setAiAdsAnalysisLoading,
  setAiAdsAnalysisError,
  setAiAdsSceneData,
  setAiAdsSceneLoading,
  setAiAdsSceneError,
  setAiAdsPrefillInputs,
  patchAiAdsSceneImage,
  markAiAdsSceneImageFailed,
  setAiAdsSessionStatus,
  setAiAdsRegenState,
  appendAiAdsVersion,
  setAiAdsVersion,
  setAiAdsPreviewVersion,
  setAiAdsTranslateScript,
  setAiAdsTranslateScriptError,
  clearAiAdsTranslateScript,
  setAiAdsVoicePreview,
  clearAiAdsVoicePreview,
} = adVideoNewSlice.actions;

export default adVideoNewSlice.reducer;
