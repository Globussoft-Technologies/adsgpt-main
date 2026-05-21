import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  activeAdStudioTabId: localStorage.getItem('activeAdStudioTabId') || 'adCreative',
  adCreativeNewActivePage: 'home',
};

const adStudioTabsSlice = createSlice({
  name: 'adStudioTabs',
  initialState,
  reducers: {
    setActiveAdStudioTab: (state, action) => {
      state.activeAdStudioTabId = action.payload; // payload = "adCopy" | "adCreative" | "adVideo"
      localStorage.setItem('activeAdStudioTabId', action.payload);
    },
    setAdCreativeNewActivePage: (state, action) => {
      state.adCreativeNewActivePage = action.payload; // 'home' | 'lifestyle' | 'product-shot' | 'apps-saas' | 'brand-awareness' | 'ai-creatives'
    },
  },
});

export const { setActiveAdStudioTab, setAdCreativeNewActivePage } = adStudioTabsSlice.actions;
export default adStudioTabsSlice.reducer;
