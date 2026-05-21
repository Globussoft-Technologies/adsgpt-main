import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isEditorOpen: false,
  isOldEditorOpen: false,
  baseImage: '',
  logoImage: '',
  baseWithLogoImage: '',
  campaignId: '',
  historyId: '',
  contextType: '',
  botId: '',
  adIndex: 0,
  editorImage: '',
  editorLogo: '',
};

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    setEditorField: (state, action) => {
      const { key, value } = action.payload;
      if (Object.prototype.hasOwnProperty.call(state, key)) {
        state[key] = value;
      }
    },
    setEditorFields: (state, action) => {
      Object.entries(action.payload).forEach(([key, value]) => {
        if (Object.prototype.hasOwnProperty.call(state, key)) {
          state[key] = value;
        }
      });
    },
    resetEditorSlice: () => ({ ...initialState }),
  },
});

export const { resetEditorSlice, setEditorField, setEditorFields } = editorSlice.actions;

export default editorSlice.reducer;
