import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  prompt: '',
  brand_name: '',
  brand_description: '',
  selectedBrand: {},
  uploadedLogo: '',
  ad_title: '',
  ad_description: '',
  no_of_ads: 1,
  platform: '',
  cta: '',
  aspect_ratio: 'ASPECT_1_1',
  ad_image_url: '',
  user_image_url: '',
  model: 'ADSGPT-2.0',
  brand_logo: '',
  style_type: 'AUTO',
  color_palette: '',
  isListening: false,
  uploadedImages: [],
  video_type: '',
  video_preference: '',
  ad: {},
  video_duration: '4s',
  video_aspect_ratio: 'ASPECT_16_9',
  video_model: 'veo-3.1-fast',
  product_name: '',
  persona: '',
  isSuggestingPrompt: false,
  originalPrompt: '',
  improvedPrompt: '',
  isUsingImprovedPrompt: false,
  modelCredits: { imageModels: [], videoModels: [] },
};

const promptSlice = createSlice({
  name: 'prompt',
  initialState,
  reducers: {
    // 1. Set a single field
    setField: (state, action) => {
      const { key, value } = action.payload;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        state[key] = value;
      }
      if (key === 'video_model' && value === 'veo_4k') {
        state.video_duration = '8s';
      }
    },

    // 2. Set multiple fields at once
    setFields: (state, action) => {
      Object.entries(action.payload).forEach(([key, value]) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          state[key] = value;
        }
      });
    },

    // 3. Reset all fields back to initial state (preserve modelCredits — server reference data)
    resetPromptSlice: (state) => ({ ...initialState, modelCredits: state.modelCredits }),

    // 4. Add uploaded image
    addImage: (state, action) => {
      const { type, url } = action.payload;

      // find if an image with same type already exists
      const existingIndex = state.uploadedImages.findIndex((img) => img.type === type);

      if (existingIndex !== -1) {
        // replace existing
        state.uploadedImages[existingIndex] = action.payload;
      } else {
        // add new
        state.uploadedImages.push(action.payload);
      }

      // update user_image_url only if it's the uploaded type
      if (type === 'uploaded') {
        state.user_image_url = url;
      }
      if (type === 'ad') {
        state.ad_image_url = url;
        state.ad_title = action.payload?.title || '';
        state.ad_description = action?.payload?.description || '';
        state.ad = action.payload?.ad || {};
      }
    },

    // 5. Remove uploaded image by id
    removeImage: (state, action) => {
      const imageToRemove = state.uploadedImages.find((img) => img.id === action.payload);
      if (imageToRemove && state.user_image_url === imageToRemove.url) {
        state.user_image_url = ''; // Clear user_image_url if it matches the removed image
      }
      if (imageToRemove && state.ad_image_url === imageToRemove.url) {
        state.ad_image_url = ''; // Clear ad_image_url if it matches the removed image
        state.ad_title = '';
        state.ad_description = '';
        state.ad = {};
      }
      state.uploadedImages = state.uploadedImages.filter((img) => img.id !== action.payload);
    },

    //6. clear uploaded images
    clearUploadedImages: (state) => {
      state.uploadedImages = [];
      state.user_image_url = '';
      state.ad_image_url = '';
      state.ad_title = '';
      state.ad_description = '';
      state.ad = {};
    },

    // 7. Toggle between original and improved prompt
    togglePromptImprovement: (state) => {
      if (state.isUsingImprovedPrompt) {
        // Switch back to original
        state.prompt = state.originalPrompt;
        state.isUsingImprovedPrompt = false;
      } else if (state.improvedPrompt) {
        // Switch to improved
        state.originalPrompt = state.prompt;
        state.prompt = state.improvedPrompt;
        state.isUsingImprovedPrompt = true;
      }
    },
  },
});

// Selector factory (returns a selector function)
export const getAdCopyInputs = () => (state) => {
  return { ...state.prompt };
};

export const getAdCreativeInputs = () => (state) => {
  return { ...state.prompt };
};

export const { setField, setFields, resetPromptSlice, addImage, removeImage, clearUploadedImages,togglePromptImprovement } =
  promptSlice.actions;
export default promptSlice.reducer;
