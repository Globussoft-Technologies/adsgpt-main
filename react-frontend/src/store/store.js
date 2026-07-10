import { configureStore } from '@reduxjs/toolkit';
import themeSlice from '@/store/reducers/theme/themeSlice';
import adStudioTabsReducer from '@/store/reducers/adStudio/adStudioTabsSlice';
import brandIQReducer from '@/store/reducers/brandIQ/brandIQTabsSlice';
import socketReducer, { initSocket } from '@/store/reducers/socket/socketSlice';
import adCopyReducer from '@/store/reducers/adStudio/adCopySlice';
import promptReducer from '@/store/reducers/adStudio/promptSlice';
import addiePromptReducer from '@/store/reducers/adInsights/Addie/addiePromptSlice';
import adHistoryReducer from '@/store/reducers/adStudio/adHistorySlice';
import adCreativeReducer from '@/store/reducers/adStudio/adCreativeSlice';
import addieReducer from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import adVideoReducer from '@/store/reducers/adStudio/adVideoSlice';
import adVideoNewReducer from '@/store/reducers/adStudio/adVideoNewSlice';
import editorReducer from '@/store/reducers/adStudio/editorSlice';
import tourGuideReducer from '@/store/reducers/tourGuide/tourGuideSlice';
import addieHistoryreducer from '@/store/reducers/adInsights/Addie/addieHistorySlice';
import userInteractionSlice from '@/store/reducers/userInteraction/userInteraction.jsx';
import adFactorySlice from '@/store/reducers/AdFactory/AdFactorySlice';
import adFactoryNewSlice from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import adFactoryAutomationSlice from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';
import modelCreditsSlice from '@/store/reducers/modelCredits/modelCreditsSlice';
import adCreativeConfigSlice from '@/store/reducers/adCreativeConfig/adCreativeConfigSlice';
import usageSlice from '@/store/reducers/profile/usageSlice';
import competitorSearchReducer from '@/store/reducers/feature/competitorSearchSlice';
import imageReducer from '@/store/reducers/image/imageSlice';
import aiAssistantReducer from '@/store/reducers/aiAssistant/aiAssistantSlice';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL;

// Load state from sessionStorage
const loadState = () => {
  try {
    const serializedState = sessionStorage.getItem('promptState');
    if (serializedState === null) return undefined;
    return JSON.parse(serializedState);
  } catch (e) {
    console.error('Failed to load state:', e);
    return undefined;
  }
};

// Save state to sessionStorage
const saveState = (state) => {
  try {
    const serializedState = JSON.stringify(state.prompt); // only store prompt slice
    sessionStorage.setItem('promptState', serializedState);
  } catch (e) {
    console.error('Failed to save state:', e);
  }
};

const store = configureStore({
  reducer: {
    theme: themeSlice,
    adStudioTabs: adStudioTabsReducer,
    brandIQTabs: brandIQReducer,
    socket: socketReducer,
    adCopy: adCopyReducer,
    prompt: promptReducer,
    adHistory: adHistoryReducer,
    adCreative: adCreativeReducer,
    addie: addieReducer,
    addiePrompt: addiePromptReducer,
    adVideo: adVideoReducer,
    adVideoNew: adVideoNewReducer,
    editor: editorReducer,
    tourGuide: tourGuideReducer,
    addieHistory: addieHistoryreducer,
    userInteractions: userInteractionSlice,
    adFactory: adFactorySlice,
    adFactoryNew: adFactoryNewSlice,
    adFactoryAutomation: adFactoryAutomationSlice,
    modelCredits: modelCreditsSlice,
    adCreativeConfig: adCreativeConfigSlice,
    usage: usageSlice,
    competitorSearch: competitorSearchReducer,
    image: imageReducer,
    aiAssistant: aiAssistantReducer,
  },
  preloadedState: {
    prompt: loadState() || undefined,
  },
});

// Subscribe to store updates
store.subscribe(() => {
  saveState(store.getState());
});

// store.dispatch(initSocket(SOCKET_URL));

export default store;
