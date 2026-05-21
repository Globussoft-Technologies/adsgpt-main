import { checkUserExists } from '@/store/actions/tourGuide/tourGuideActions';
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  userExists: false,
  showTour: false,
  loading: true,
  tourStep: 0,
};

const tourGuideSlice = createSlice({
  name: 'tourGuide',
  initialState,
  reducers: {
    setShowTour: (state, action) => {
      state.showTour = action.payload;
    },
    setTourStep: (state, action) => {
      state.tourStep = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkUserExists.pending, (state) => {
        state.loading = true;
      })
      .addCase(checkUserExists.fulfilled, (state, action) => {
        state.userExists = action.payload;
        // state.showTour = !action.payload;
        state.loading = false;
      })
      .addCase(checkUserExists.rejected, (state) => {
        state.loading = false;
      });
  },
});

export const { setShowTour, setTourStep } = tourGuideSlice.actions;
export default tourGuideSlice.reducer;
