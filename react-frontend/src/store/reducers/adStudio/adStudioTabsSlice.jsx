import { createSlice } from '@reduxjs/toolkit';

// Bharath's request 2026-06-08: every session starts on the new Ad
// Creative surface (`adCreativeNew`, which occupies the "Ad Creative"
// slot in TopHeader after the [[project-hide-recipe-adlibrary-adcreativenew]]
// pass marked the legacy `adCreative` tab declaration with HIDE-MARK).
// localStorage is intentionally NOT read here — the landing tab is forced
// regardless of the user's last click — but `setActiveAdStudioTab` still
// writes to it because other consumers in the codebase grep for the key.
const initialState = {
  activeAdStudioTabId: localStorage.getItem('activeAdStudioTabId') || 'adCreativeNew',
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
