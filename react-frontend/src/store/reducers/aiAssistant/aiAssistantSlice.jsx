import { createSlice, nanoid } from '@reduxjs/toolkit';

const SESSION_KEY = 'aia1';
const ENABLED_TOOLS_KEY = 'aia1_enabled_tools';

// Names MUST match the package names the Agent registers in chat.py
// `_TOOL_PACKAGES`. The Agent uses the same keys to expand each toggle into
// the full tool list for the system-message hint.
//
// Video generation is disabled behind a flag ("as of now") — the Video chip is
// hidden unless VITE_VIDEO_ENABLED === 'true', mirroring the backend's
// AGENTIC_VIDEO_ENABLED flag. Keep both in sync when restoring video.
const VIDEO_ENABLED = import.meta.env.VITE_VIDEO_ENABLED === 'true';

export const TOGGLEABLE_TOOLS = [
  'searchTheWeb',
  'searchTheAdLibrary',
  'adCopyGenerator',
  'adCreativeGenerator',
  ...(VIDEO_ENABLED ? ['adVideoGenerator'] : []),
];

const loadSessionId = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null;
  }
};

const persistSessionId = (id) => {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};

const loadEnabledTools = () => {
  try {
    const raw = sessionStorage.getItem(ENABLED_TOOLS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t) => TOGGLEABLE_TOOLS.includes(t));
  } catch {
    return [];
  }
};

const persistEnabledTools = (tools) => {
  try {
    sessionStorage.setItem(ENABLED_TOOLS_KEY, JSON.stringify(tools || []));
  } catch {
    /* ignore */
  }
};

const initialState = {
  sessionId: loadSessionId(),
  messages: [],
  pending: false,
  pendingActiveLabel: null,
  pendingDoneLabels: [],
  completedLabel: null,
  conversations: [],
  conversationsLoading: false,
  error: null,
  // Bumped by `startNewSession` and `loadConversation`. ChatInterface watches it
  // and aborts the in-flight SSE controller, so an orphaned `done` event from a
  // previous turn cannot revive the dead session.
  abortRequestId: 0,
  // Per-conversation tool toggles. Persisted to sessionStorage so a page
  // refresh keeps the user's selection.
  enabledTools: loadEnabledTools(),
};

const aiAssistantSlice = createSlice({
  name: 'aiAssistant',
  initialState,
  reducers: {
    setSessionId: (state, action) => {
      state.sessionId = action.payload || null;
      persistSessionId(state.sessionId);
    },
    startNewSession: (state) => {
      state.sessionId = null;
      state.messages = [];
      state.pending = false;
      state.pendingActiveLabel = null;
      state.pendingDoneLabels = [];
      state.completedLabel = null;
      state.error = null;
      state.abortRequestId += 1;
      persistSessionId(null);
    },
    pushUserMessage: {
      reducer: (state, action) => {
        state.messages.push(action.payload);
        state.error = null;
      },
      prepare: ({ text, attachments, quote }) => ({
        payload: {
          id: nanoid(),
          role: 'user',
          text,
          attachments: attachments || [],
          quote: quote || null,
        },
      }),
    },
    startAssistantStream: {
      reducer: (state, action) => {
        state.messages.push(action.payload);
        state.pending = true;
        state.pendingActiveLabel = 'Thinking...';
        state.pendingDoneLabels = [];
        state.completedLabel = null;
        state.error = null;
      },
      prepare: () => ({
        payload: {
          id: nanoid(),
          role: 'assistant',
          text: '',
          steps: [],
          images: [],
          competitorAds: [],
          storyboard: null,
          adCreative: null,
          choiceForm: null,
          choiceFormResult: null,
          conceptCards: null,
          conceptResult: null,
          complete: false,
        },
      }),
    },
    appendAssistantText: (state, action) => {
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.text += action.payload || '';
      }
    },
    pushStep: (state, action) => {
      const label = action.payload;
      if (!label) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        if (msg.steps[msg.steps.length - 1] !== label) msg.steps.push(label);
      }
      if (state.pendingActiveLabel && state.pendingActiveLabel !== 'Thinking...') {
        state.pendingDoneLabels.push(state.pendingActiveLabel);
      } else if (state.pendingActiveLabel === 'Thinking...') {
        // first real step replaces the placeholder
      }
      state.pendingActiveLabel = label;
    },
    attachAssistantImage: (state, action) => {
      const url = action.payload;
      if (!url) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant' && !msg.images.includes(url)) {
        msg.images.push(url);
      }
    },
    attachAssistantAds: (state, action) => {
      const ads = action.payload;
      if (!Array.isArray(ads) || ads.length === 0) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.competitorAds = ads;
      }
    },
    attachAssistantAdCreative: (state, action) => {
      const pack = action.payload;
      if (!pack || !Array.isArray(pack.variants) || pack.variants.length === 0) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.adCreative = pack;
      }
    },
    attachAssistantChoiceForm: (state, action) => {
      const form = action.payload;
      if (!form || !form.form_id || !Array.isArray(form.fields)) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.choiceForm = form;
      }
    },
    attachAssistantConceptCards: (state, action) => {
      const cards = action.payload;
      if (!cards || !Array.isArray(cards.concepts) || cards.concepts.length === 0) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.conceptCards = cards;
      }
    },
    // Records which concept the user picked (so the card can show a chosen state).
    selectConcept: (state, action) => {
      const { messageId, conceptId } = action.payload || {};
      if (!messageId || !conceptId) return;
      const msg = state.messages.find((m) => m.id === messageId);
      if (!msg || !msg.conceptCards) return;
      msg.conceptResult = { conceptId, selected_at: Date.now() };
    },
    submitAssistantChoiceForm: (state, action) => {
      const { messageId, values } = action.payload || {};
      if (!messageId) return;
      const msg = state.messages.find((m) => m.id === messageId);
      if (!msg || !msg.choiceForm) return;
      msg.choiceFormResult = {
        form_id: msg.choiceForm.form_id,
        values: values || {},
        submitted_at: Date.now(),
      };
    },
    attachAssistantStoryboard: (state, action) => {
      const storyboard = action.payload;
      if (!storyboard || !Array.isArray(storyboard.scenes)) return;
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.storyboard = storyboard;
      }
    },
    // Targeted updates from the storyboard UI (per-scene regen, final merge).
    updateStoryboardScene: (state, action) => {
      const { messageId, sceneId, patch } = action.payload || {};
      if (!messageId || !sceneId || !patch) return;
      const msg = state.messages.find((m) => m.id === messageId);
      if (!msg || !msg.storyboard || !Array.isArray(msg.storyboard.scenes)) return;
      const scene = msg.storyboard.scenes.find((s) => s.id === sceneId);
      if (scene) Object.assign(scene, patch);
    },
    setStoryboardFinalVideo: (state, action) => {
      const { messageId, url } = action.payload || {};
      if (!messageId || !url) return;
      const msg = state.messages.find((m) => m.id === messageId);
      if (!msg || !msg.storyboard) return;
      msg.storyboard.final_video_url = url;
    },
    finishAssistantStream: (state, action) => {
      const { messageId, sessionId, completedLabel, steps } = action.payload || {};
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.complete = true;
        if (messageId) msg.id = messageId;
        // Live rows used present-continuous ("Generating…"); swap to the past-tense
        // list for the finished message ("Generated…").
        if (Array.isArray(steps) && steps.length) msg.steps = steps;
      }
      if (sessionId) {
        state.sessionId = sessionId;
        persistSessionId(sessionId);
      }
      state.pending = false;
      state.pendingActiveLabel = null;
      // pendingDoneLabels intentionally retained briefly so the UI can show
      // "Completed in X seconds..." with the step list rendered from msg.steps.
      state.completedLabel = completedLabel || null;
    },
    failAssistantStream: (state, action) => {
      const detail = action.payload || 'Something went wrong.';
      const msg = state.messages[state.messages.length - 1];
      if (msg && msg.role === 'assistant') {
        msg.complete = true;
        if (!msg.text) msg.text = `⚠ ${detail}`;
      }
      state.pending = false;
      state.pendingActiveLabel = null;
      state.pendingDoneLabels = [];
      state.completedLabel = null;
      state.error = detail;
    },
    setConversations: (state, action) => {
      state.conversations = action.payload || [];
      state.conversationsLoading = false;
    },
    setConversationsLoading: (state, action) => {
      state.conversationsLoading = !!action.payload;
    },
    setMessageFeedback: (state, action) => {
      const { messageId, rating } = action.payload || {};
      if (!messageId) return;
      const msg = state.messages.find((m) => m.id === messageId);
      if (msg) {
        msg.feedback = rating ? { rating } : null;
      }
    },
    loadConversation: (state, action) => {
      const { sessionId, messages } = action.payload || {};
      state.sessionId = sessionId || null;
      state.messages = (messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text || '',
        attachments: m.attachments || [],
        images: Array.isArray(m.images) ? m.images : [],
        quote: m.quote
          ? { text: m.quote.text, role: m.quote.role || null, messageId: m.quote.message_id || null }
          : null,
        steps: [],
        complete: true,
        feedback: m.feedback || null,
        competitorAds: Array.isArray(m.competitorAds) ? m.competitorAds : [],
        storyboard: m.storyboard && Array.isArray(m.storyboard.scenes) ? m.storyboard : null,
        adCreative:
          m.adCreative && Array.isArray(m.adCreative.variants) && m.adCreative.variants.length > 0
            ? m.adCreative
            : null,
        choiceForm:
          m.choiceForm && m.choiceForm.form_id && Array.isArray(m.choiceForm.fields)
            ? m.choiceForm
            : null,
        choiceFormResult: m.choiceFormResult || null,
        conceptCards:
          m.conceptCards && Array.isArray(m.conceptCards.concepts) && m.conceptCards.concepts.length > 0
            ? m.conceptCards
            : null,
        conceptResult: m.conceptResult || null,
      }));
      state.pending = false;
      state.pendingActiveLabel = null;
      state.pendingDoneLabels = [];
      state.completedLabel = null;
      state.error = null;
      state.abortRequestId += 1;
      persistSessionId(state.sessionId);
    },
    toggleTool: (state, action) => {
      const key = action.payload;
      if (!TOGGLEABLE_TOOLS.includes(key)) return;
      const idx = state.enabledTools.indexOf(key);
      if (idx === -1) state.enabledTools.push(key);
      else state.enabledTools.splice(idx, 1);
      persistEnabledTools(state.enabledTools);
    },
    clearEnabledTools: (state) => {
      state.enabledTools = [];
      persistEnabledTools([]);
    },
    resetAIAssistant: () => ({
      ...initialState,
      sessionId: loadSessionId(),
      enabledTools: loadEnabledTools(),
    }),
  },
});

export const {
  setSessionId,
  startNewSession,
  pushUserMessage,
  startAssistantStream,
  appendAssistantText,
  pushStep,
  attachAssistantImage,
  attachAssistantAds,
  attachAssistantAdCreative,
  attachAssistantStoryboard,
  attachAssistantChoiceForm,
  attachAssistantConceptCards,
  selectConcept,
  submitAssistantChoiceForm,
  updateStoryboardScene,
  setStoryboardFinalVideo,
  finishAssistantStream,
  failAssistantStream,
  setConversations,
  setConversationsLoading,
  loadConversation,
  setMessageFeedback,
  toggleTool,
  clearEnabledTools,
  resetAIAssistant,
} = aiAssistantSlice.actions;

export default aiAssistantSlice.reducer;
