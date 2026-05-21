import { createSlice } from '@reduxjs/toolkit';

const getInitialActivePage = () => {
  const storedPage = sessionStorage.getItem('adVideoActivePage');
  return storedPage ? storedPage : 'home';
};

const getInitialMySpaceTab = () => {
  const stored = sessionStorage.getItem('mySpaceTab');
  return stored === 'videos' || stored === 'images' ? stored : 'images';
};

const initialState = {
  activePage: getInitialActivePage(),
  mySpaceTab: getInitialMySpaceTab(), // 'images' | 'videos' — set before navigating to MySpace.
  savedCount: 0,
  showSavedFolder: false,
  isLoading: false,
  error: null,
  imageAndScript: null,
  allVideos: [],
  avatars: [],
  avatarsLoading: false,
  recreateInputs: null,
  currentAvatarStep: 'options',
  currentAIAdsStep: 'selection',
  aiAdsAnalysisData: null,
  aiAdsAnalysisLoading: false,
  aiAdsAnalysisError: null,
  aiAdsSceneData: null,
  aiAdsSceneLoading: false,
  aiAdsSceneError: null,
  aiAdsPrefillInputs: null,
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
    setAllVideos: (state, action) => {
      state.allVideos = action.payload;
    },
    setAvatars: (state, action) => {
      state.avatars = action.payload;
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
      if (
        state.imageAndScript &&
        state.imageAndScript.data &&
        state.imageAndScript.data._id === action.payload._id
      ) {
        state.imageAndScript.data = { ...state.imageAndScript.data, ...action.payload };
      } else if (state.imageAndScript && state.imageAndScript._id === action.payload._id) {
        state.imageAndScript = { ...state.imageAndScript, ...action.payload };
      }
    },
    setRecreateInputs: (state, action) => {
      state.recreateInputs = action.payload;
    },
    setAvatarStep: (state, action) => {
      state.currentAvatarStep = action.payload;
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
    // Flip session-level status (e.g. "processing" → "completed")
    setAiAdsSessionStatus: (state, action) => {
      if (!state.aiAdsSceneData) return;
      if (state.aiAdsSceneData.data) {
        state.aiAdsSceneData.data.status = action.payload;
      } else {
        state.aiAdsSceneData.status = action.payload;
      }
    },
  },
});

export const {
  setActivePage,
  setMySpaceTab,
  incrementSavedCount,
  setSavedCount,
  setLoading,
  setError,
  setImageAndScript,
  setAllVideos,
  showSavedFolder,
  updateVideoPromptPercentage,
  updateVideo,
  updateGeneratedVideo,
  resetAdVideoNewSlice,
  setAvatars,
  setAvatarsLoading,
  setRecreateInputs,
  setAvatarStep,
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
} = adVideoNewSlice.actions;

export default adVideoNewSlice.reducer;
