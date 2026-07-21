import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Plus, SendHorizonal, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { streamChat, confirmAction, pickChatMedia, getChatHistory } from '@/apis/metaAds/metaChatApi';
import ChatMessageList from './ChatMessageList';
import SuggestionChips from './cards/SuggestionChips';
import ChatHistoryMenu from './ChatHistoryMenu';

// Remembers the last active session per ad account, so a page refresh (or
// re-selecting an account) resumes the same conversation instead of always
// starting fresh — the getHistory/listSessions endpoints exist specifically
// to make this possible.
const LS_PREFIX = 'metaChat:lastSession:';
const getStoredSessionId = (accountId) => {
  if (!accountId) return null;
  try {
    return localStorage.getItem(LS_PREFIX + accountId);
  } catch {
    return null;
  }
};
const setStoredSessionId = (accountId, sessionId) => {
  if (!accountId) return;
  try {
    if (sessionId) localStorage.setItem(LS_PREFIX + accountId, sessionId);
    else localStorage.removeItem(LS_PREFIX + accountId);
  } catch {
    /* storage unavailable (private mode / quota) — resume just won't persist */
  }
};

const STARTER_ACTIONS = [
  { label: 'Summarize account', prompt: 'Summarize this ad account’s performance over the last 30 days.' },
  { label: 'Top campaign', prompt: 'Which is my best performing campaign? Show a stat card with its key metrics and why it wins.' },
  { label: 'Compare campaigns', prompt: 'Compare my campaigns on spend, CTR and CPC in a table, and highlight the winner.' },
];

let messageIdCounter = 0;
const nextMessageId = () => `msg-${++messageIdCounter}`;

// Turns the backend's frontend-shaped transcript ({role, text, cards, ts})
// back into this component's message shape. Steps/activeStep are
// intentionally omitted — the "Worked for Ns" trace is a live-turn artifact,
// not persisted, so a resumed message just shows its final text + cards.
const hydrateFromTranscript = (transcript = []) =>
  transcript.map((entry) => ({
    id: nextMessageId(),
    role: entry.role,
    text: entry.text || '',
    cards: entry.cards || [],
    steps: [],
    activeStep: null,
    streaming: false,
  }));

// Turn a tool name (byadsco `ads_*` or legacy `meta_ads_*`) into a short
// present-tense activity label for the step indicator, e.g.
// `ads_get_campaigns` → "Reading campaigns".
const VERB_MAP = {
  get: 'Reading',
  list: 'Reading',
  search: 'Searching',
  create: 'Creating',
  update: 'Updating',
  delete: 'Deleting',
  pause: 'Pausing',
  resume: 'Resuming',
  activate: 'Updating',
  upload: 'Uploading',
  clone: 'Cloning',
  insights: 'Analyzing',
};
const stepLabel = (name = '') => {
  const parts = name.replace(/^meta_ads_|^ads_/, '').split('_');
  const verb = VERB_MAP[parts[0]];
  const rest = (verb ? parts.slice(1) : parts).join(' ');
  return `${verb || 'Running'} ${rest}`.trim();
};

// The chat surface itself. Scoped to whichever ad account the Meta Ads
// dashboard has selected — passed in as props, so this component owns no
// account selection of its own.
const MetaAdsChatPanel = ({
  adAccountId,
  adAccountName,
  adAccountCurrency,
  campaignId,
  adSetId,
  adId,
  onClose,
}) => {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null);
  // Parallel to pendingConfirm, for an input-required pause (media picker).
  const [pendingPick, setPendingPick] = useState(null);

  const controllerRef = useRef(null);
  // id of the in-progress assistant message (steps + streamed text live on it)
  const currentAsstRef = useRef(null);
  const composerRef = useRef(null);
  // Only restore focus after this panel initiated a chat turn. This avoids
  // stealing focus when a user merely opens the panel or resumes a session.
  const restoreComposerFocusRef = useRef(false);

  useEffect(() => {
    if (
      !restoreComposerFocusRef.current ||
      !adAccountId ||
      isStreaming ||
      pendingConfirm ||
      pendingPick
    ) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      composerRef.current?.focus();
      restoreComposerFocusRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [adAccountId, isStreaming, pendingConfirm, pendingPick]);

  // Applies a GET /history/:sessionId response to local state — shared by the
  // account-restore effect below and the history dropdown's session picker.
  const applySessionData = useCallback((data) => {
    setSessionId(data.sessionId);
    setMessages(hydrateFromTranscript(data.transcript));
    setPendingConfirm(
      data.pendingAction
        ? {
            actions: (data.pendingAction.calls || []).map((c) => ({
              toolName: c.name,
              args: c.args,
              displayName: c.displayName,
            })),
          }
        : null,
    );
    setPendingPick(
      data.pendingInput
        ? { mediaType: data.pendingInput.mediaType || 'image', purpose: data.pendingInput.purpose || null }
        : null,
    );
    setStoredSessionId(data.adAccountId, data.sessionId);
  }, []);

  // Switching accounts starts a fresh conversation by default — a session is
  // bound to one ad account on the backend — but first tries to resume
  // whatever session was last active for the NEW account (persisted in
  // localStorage), so a page refresh doesn't always lose the conversation.
  useEffect(() => {
    controllerRef.current?.abort();
    currentAsstRef.current = null;
    setSessionId(null);
    setMessages([]);
    setPendingConfirm(null);
    setPendingPick(null);
    setIsStreaming(false);
    setConfirmBusy(false);

    const storedId = getStoredSessionId(adAccountId);
    if (!adAccountId || !storedId) return undefined;

    let cancelled = false;
    getChatHistory(storedId)
      .then((data) => {
        if (!cancelled) applySessionData(data);
      })
      .catch(() => {
        // Session gone (expired/deleted) or the fetch failed — fine, the
        // reset above already left a blank slate; just forget the stale id.
        if (!cancelled) setStoredSessionId(adAccountId, null);
      });
    return () => {
      cancelled = true;
    };
  }, [adAccountId, applySessionData]);

  const appendMessage = useCallback((message) => {
    const id = nextMessageId();
    setMessages((prev) => [...prev, { id, ...message }]);
  }, []);

  // Switch to a past session picked from the history dropdown.
  const handleSelectSession = useCallback(
    (id) => {
      if (!id || id === sessionId) return;
      controllerRef.current?.abort();
      currentAsstRef.current = null;
      setIsStreaming(false);
      setConfirmBusy(false);
      setPendingConfirm(null);
      setPendingPick(null);
      setInput('');
      getChatHistory(id)
        .then(applySessionData)
        .catch(() => {
          appendMessage({ role: 'error', text: "Couldn't load that conversation." });
        });
    },
    [sessionId, applySessionData, appendMessage],
  );

  // Ensure an assistant message exists for the current turn, then return its id.
  const ensureAssistant = useCallback(() => {
    if (currentAsstRef.current) return currentAsstRef.current;
    const id = nextMessageId();
    currentAsstRef.current = id;
    setMessages((prev) => [
      ...prev,
      {
        id,
        role: 'assistant',
        steps: [],
        activeStep: null,
        text: '',
        cards: [],
        streaming: true,
        startedAt: Date.now(),
      },
    ]);
    return id;
  }, []);

  const updateAssistant = useCallback((updater) => {
    const id = currentAsstRef.current;
    if (!id) return;
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  // End the current assistant turn: drop any active spinner, stop streaming.
  const finalizeAssistant = useCallback(() => {
    updateAssistant((m) => ({
      ...m,
      activeStep: null,
      streaming: false,
      elapsedMs: m.startedAt ? Date.now() - m.startedAt : m.elapsedMs,
    }));
    currentAsstRef.current = null;
  }, [updateAssistant]);

  // Clear per-turn flags on every terminal path. Idempotent — safe to call
  // from 'done', 'error', and the stream's 'end' safety signal alike.
  const resetTurnState = useCallback(() => {
    setIsStreaming(false);
    setConfirmBusy(false);
  }, []);

  const handleStreamEvent = useCallback(
    (event, data) => {
      switch (event) {
        case 'session':
          if (data.sessionId) {
            setSessionId(data.sessionId);
            setStoredSessionId(adAccountId, data.sessionId);
          }
          break;
        case 'tool_call':
          ensureAssistant();
          // Move any prior active step to done, set this call as active.
          updateAssistant((m) => ({
            ...m,
            steps: m.activeStep ? [...m.steps, m.activeStep] : m.steps,
            activeStep: stepLabel(data.name),
          }));
          break;
        case 'tool_result':
          updateAssistant((m) => ({
            ...m,
            steps: m.activeStep ? [...m.steps, m.activeStep] : m.steps,
            activeStep: null,
          }));
          break;
        case 'tool_declined':
          updateAssistant((m) => ({
            ...m,
            steps: [...m.steps, `Cancelled ${stepLabel(data.name)}`],
            activeStep: null,
          }));
          break;
        case 'token':
          ensureAssistant();
          updateAssistant((m) => ({ ...m, text: m.text + (data.delta || '') }));
          break;
        case 'card':
          ensureAssistant();
          updateAssistant((m) => ({ ...m, cards: [...(m.cards || []), data] }));
          break;
        case 'message':
          // Authoritative full text — reconcile against streamed deltas.
          ensureAssistant();
          updateAssistant((m) => ({ ...m, text: data.text ?? m.text }));
          break;
        case 'confirm_action':
          finalizeAssistant();
          setConfirmBusy(false);
          setIsStreaming(false);
          setPendingPick(null);
          setPendingConfirm({
            actions: data.actions || [{ toolName: data.toolName, args: data.args }],
          });
          break;
        case 'pick_media':
          finalizeAssistant();
          setConfirmBusy(false);
          setIsStreaming(false);
          setPendingConfirm(null);
          setPendingPick({
            mediaType: data.mediaType === 'video' ? 'video' : 'image',
            purpose: data.purpose || null,
          });
          break;
        case 'error':
          finalizeAssistant();
          setPendingConfirm(null);
          setPendingPick(null);
          appendMessage({ role: 'error', text: data.detail || 'Something went wrong.' });
          resetTurnState();
          break;
        case 'done':
          finalizeAssistant();
          resetTurnState();
          break;
        case 'end':
          // Stream fully closed. If no terminal event cleared the flags, do it
          // now so the composer can never get stuck disabled.
          finalizeAssistant();
          resetTurnState();
          break;
        default:
          break;
      }
    },
    [adAccountId, appendMessage, ensureAssistant, updateAssistant, finalizeAssistant, resetTurnState]
  );

  // Start a turn with the given text. Used by the composer and by suggestion
  // chips (which pass their prompt directly).
  const sendText = useCallback(
    (raw) => {
      const text = (raw ?? '').trim();
      if (!text || !adAccountId || isStreaming || pendingConfirm || pendingPick) return;

      controllerRef.current?.abort();
      currentAsstRef.current = null;
      appendMessage({ role: 'user', text });
      setInput('');
      restoreComposerFocusRef.current = true;
      setIsStreaming(true);
      controllerRef.current = streamChat({
        sessionId,
        adAccountId,
        currency: adAccountCurrency,
        campaignId,
        adSetId,
        adId,
        message: text,
        onEvent: handleStreamEvent,
      });
    },
    [
      adAccountId,
      adAccountCurrency,
      campaignId,
      adSetId,
      adId,
      isStreaming,
      pendingConfirm,
      pendingPick,
      sessionId,
      appendMessage,
      handleStreamEvent,
    ]
  );

  const handleSend = useCallback(() => sendText(input), [sendText, input]);

  const handleNewChat = useCallback(() => {
    controllerRef.current?.abort();
    currentAsstRef.current = null;
    setSessionId(null);
    setMessages([]);
    setPendingConfirm(null);
    setPendingPick(null);
    setIsStreaming(false);
    setConfirmBusy(false);
    setInput('');
    // Otherwise a refresh right after "+" would resume the OLD session again
    // (its id was still the last one stored) instead of staying blank.
    setStoredSessionId(adAccountId, null);
  }, [adAccountId]);

  // Regenerate = re-send the most recent user message.
  const handleRegenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) sendText(lastUser.text);
  }, [messages, sendText]);

  const handleConfirm = useCallback(
    (approve) => {
      if (!sessionId) return;
      controllerRef.current?.abort();
      currentAsstRef.current = null;
      setConfirmBusy(true);
      setPendingConfirm(null);
      setIsStreaming(true);
      controllerRef.current = confirmAction({
        sessionId,
        approve,
        onEvent: handleStreamEvent,
      });
    },
    [sessionId, handleStreamEvent]
  );

  // Resume a media-picker pause. `url`/`mediaType` when the user picked
  // something; call handleMediaCancel to back out. Mirrors handleConfirm: the
  // card is dismissed immediately and the turn resumes streaming.
  const handleMediaPick = useCallback(
    (url, mediaType) => {
      if (!sessionId || !url) return;
      controllerRef.current?.abort();
      currentAsstRef.current = null;
      setConfirmBusy(true);
      setPendingPick(null);
      setIsStreaming(true);
      controllerRef.current = pickChatMedia({
        sessionId,
        url,
        mediaType,
        onEvent: handleStreamEvent,
      });
    },
    [sessionId, handleStreamEvent]
  );

  const handleMediaCancel = useCallback(() => {
    if (!sessionId) return;
    controllerRef.current?.abort();
    currentAsstRef.current = null;
    setConfirmBusy(true);
    setPendingPick(null);
    setIsStreaming(true);
    controllerRef.current = pickChatMedia({
      sessionId,
      cancel: true,
      onEvent: handleStreamEvent,
    });
  }, [sessionId, handleStreamEvent]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {/* subtle dot-grid texture, matching the dashboard's own background treatment */}
      <div
        className="pointer-events-none absolute inset-0 text-gray-900 opacity-[0.02] dark:text-white"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />
      {/* ambient glow behind the header, matching the launcher/app accent */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gradient-to-br from-[#15DCFF]/25 to-[#6b72f8]/25 blur-3xl dark:from-[#15DCFF]/10 dark:to-[#6b72f8]/10" />

      {/* header — z-20 (not z-10 like the composer/empty-state below) so the history
          dropdown, which is positioned absolutely off this element, reliably paints
          above them wherever it overlaps. z-10 on all three was a tie broken by DOM
          order, and the composer (later in the DOM) was winning that tie. */}
      <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] shadow-sm shadow-[#6b72f8]/30">
            <Bot className="h-4.5 w-4.5 text-white" />
            <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400 dark:border-[#161616]" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Ads Chat</h2>
            <p className="max-w-40 truncate text-10 text-gray-500 dark:text-gray-400">
              {adAccountName || 'No account selected'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ChatHistoryMenu
            adAccountId={adAccountId}
            currentSessionId={sessionId}
            onSelectSession={handleSelectSession}
          />
          <button
            onClick={handleNewChat}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="size-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
              aria-label="Close chat"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {messages.length === 0 && !isStreaming ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] shadow-lg shadow-[#6b72f8]/25">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {adAccountId ? `Ask me about ${adAccountName || 'this account'}` : 'Ads Chat'}
            </h3>
            <p className="max-w-64 text-xs text-gray-500 dark:text-gray-400">
              {adAccountId
                ? 'Ask about performance, or ask it to pause, resume, or create campaigns — any change to your account will ask you to confirm first.'
                : 'Select an ad account in the dashboard to start chatting.'}
            </p>
          </div>
          {adAccountId && (
            <SuggestionChips actions={STARTER_ACTIONS} onAction={sendText} center />
          )}
        </div>
      ) : (
        <ChatMessageList
          messages={messages}
          pendingConfirm={pendingConfirm}
          confirmBusy={confirmBusy}
          onConfirm={() => handleConfirm(true)}
          onCancel={() => handleConfirm(false)}
          pendingPick={pendingPick}
          onMediaPick={handleMediaPick}
          onMediaCancel={handleMediaCancel}
          onAction={sendText}
          onRegenerate={handleRegenerate}
          isStreaming={isStreaming}
          currency={adAccountCurrency}
        />
      )}

      {/* composer */}
      <div className="relative z-10 shrink-0 border-t border-gray-200 p-3 dark:border-white/10">
        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 transition-all focus-within:border-[#15DCFF]/60 focus-within:shadow-[0_0_0_3px_rgba(21,220,255,0.12)] dark:border-white/15 dark:bg-white/5 dark:focus-within:border-[#15DCFF]/50">
          <Textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              pendingPick
                ? 'Choose media above to continue…'
                : adAccountId
                  ? 'Ask about your Meta Ads account…'
                  : 'Select an ad account first'
            }
            disabled={!adAccountId || isStreaming || Boolean(pendingConfirm) || Boolean(pendingPick)}
            rows={1}
            className="max-h-32 min-h-6 flex-1 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            size="icon"
            className="size-8 shrink-0 rounded-full border-0 bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] text-white hover:opacity-90"
            onClick={handleSend}
            disabled={!input.trim() || !adAccountId || isStreaming || Boolean(pendingConfirm) || Boolean(pendingPick)}
          >
            <SendHorizonal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// Memoized: the parent (MetaAdsChatWidget) re-renders on every resize-drag frame
// to update the panel's width, and without this the whole transcript/cards subtree
// would re-render (and re-run markdown/chart rendering) on every one of those frames.
export default memo(MetaAdsChatPanel);
