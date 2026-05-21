import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  prompt: '',
  isListening: false,
};

const promptSlice = createSlice({
  name: 'addiePrompt',
  initialState,
  reducers: {
    // 1. Set a single field
    setAddieField: (state, action) => {
      const { key, value } = action.payload;
      if (key && Object.prototype.hasOwnProperty.call(state, key)) {
        state[key] = value;
      }
    },

    // 2. Set multiple fields at once
    setAddieFields: (state, action) => {
      const payload = action.payload ?? {};
      Object.entries(payload).forEach(([key, value]) => {
        if (key && Object.prototype.hasOwnProperty.call(state, key)) {
          state[key] = value;
        }
      });
    },

    // 3. Reset all fields back to initial state
    resetAddiePromptSlice: () => ({ ...initialState }),
  },
});

// Selector factory (returns a selector function)
export const getAddieInputs = () => (state) => {
  return { ...state?.prompt };
};

export const { setAddieField, setAddieFields, resetAddiePromptSlice } = promptSlice.actions;
export default promptSlice.reducer;
