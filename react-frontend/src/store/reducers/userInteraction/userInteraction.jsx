import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  currentSessionId: null,
};

const userInteractionSlice = createSlice({
  name: 'userInteractions',
  initialState,
  reducers: {
    setCurrentSeesionId: (state, action) => {
      state.currentSessionId = action.payload;
      //   localStorage.setItem('activeAdStudioTabId', action.payload);
    },
  },
});

export const { setCurrentSeesionId } = userInteractionSlice.actions;
export default userInteractionSlice.reducer;
