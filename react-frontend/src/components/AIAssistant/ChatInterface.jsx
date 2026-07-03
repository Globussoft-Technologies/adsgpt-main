import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';

import Composer from './Composer';
import Messages from './Messages';
import GenCanvas from './GenCanvas';
import { getHistory, streamChat } from '@/apis/aiAssistant/aiAssistantApi';
import {
  buildMockChoiceForm,
  mockChoiceFormResult,
  parseCascadeCommand,
} from './mockChoiceForms';
import {
  appendAssistantText,
  attachAssistantAds,
  attachAssistantChoiceForm,
  attachAssistantConceptCards,
  attachAssistantImage,
  attachAssistantStoryboard,
  failAssistantStream,
  finishAssistantStream,
  loadConversation,
  pushStep,
  pushUserMessage,
  selectConcept,
  setSessionId,
  startAssistantStream,
} from '@/store/reducers/aiAssistant/aiAssistantSlice';

const ChatInterface = () => {
  const dispatch = useDispatch();
  const {
    sessionId,
    messages,
    pending,
    pendingActiveLabel,
    pendingDoneLabels,
    completedLabel,
    abortRequestId,
    enabledTools,
  } = useSelector((state) => state.aiAssistant);
  const { userData } = useSelector((state) => state.socket);

  const greeting = (userData?.user_name?.split(' ')?.[0] || 'there').replace(/^./, (c) =>
    c.toUpperCase(),
  );

  // The message/selection the user is replying to, if any: { text, role, messageId }.
  // Set by the Reply button and the highlight-to-quote popover; cleared on send.
  const [quote, setQuote] = useState(null);
  const handleQuote = useCallback((q) => {
    if (q && q.text && q.text.trim()) setQuote({ ...q, text: q.text.trim() });
  }, []);

  const isEmpty = messages.length === 0 && !pending;

  // Cancel any in-flight stream when this component unmounts.
  const controllerRef = useRef(null);
  useEffect(
    () => () => {
      controllerRef.current?.abort?.();
    },
    [],
  );

  // Abort the current stream whenever the slice's abortRequestId changes — this
  // is how the header's "New Chat" / history-load buttons cancel mid-flight
  // turns without orphan `done` events reviving a dead session.
  useEffect(() => {
    controllerRef.current?.abort?.();
    controllerRef.current = null;
  }, [abortRequestId]);

  // Rehydrate on refresh: we persist only the sessionId (not the transcript), so
  // a reload would otherwise show an empty composer while still pointing at the
  // old conversation — looking like a brand-new chat. If we have a session but no
  // messages in memory, pull its history back so the refresh resumes it.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    if (!sessionId || messages.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const history = await getHistory(sessionId);
        if (!cancelled && Array.isArray(history) && history.length > 0) {
          dispatch(loadConversation({ sessionId, messages: history }));
        }
      } catch {
        /* ignore — fall back to an empty chat if history can't be loaded */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: capture the persisted session once on first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real network turn — extracted so both `/cascade` follow-ups and the
  // normal send path can call it without duplicating the SSE event switch.
  const runStreamingTurn = useCallback(
    ({ text, attachments, formResponse, conceptResponse, quote: turnQuote }) => {
      const controller = streamChat({
        sessionId,
        message: text,
        attachments: attachments?.length
          ? attachments.map((a) => ({ file_type: a.file_type, url: a.url }))
          : null,
        enabledTools,
        formResponse: formResponse || null,
        conceptResponse: conceptResponse || null,
        quote: turnQuote || null,
        onEvent: (event, data) => {
          switch (event) {
            case 'session':
              if (data.session_id) dispatch(setSessionId(data.session_id));
              break;
            case 'step':
              if (data.label) dispatch(pushStep(data.label));
              break;
            case 'token':
              if (data.delta) dispatch(appendAssistantText(data.delta));
              break;
            case 'image':
              if (data.url) dispatch(attachAssistantImage(data.url));
              break;
            case 'competitor_ads':
              if (Array.isArray(data.ads) && data.ads.length > 0) {
                dispatch(attachAssistantAds(data.ads));
              }
              break;
            case 'storyboard':
              if (data.storyboard && Array.isArray(data.storyboard.scenes)) {
                dispatch(attachAssistantStoryboard(data.storyboard));
              }
              break;
            case 'choice_form':
              if (data.form_id && Array.isArray(data.fields)) {
                dispatch(attachAssistantChoiceForm(data));
              }
              break;
            case 'concept_cards':
              if (Array.isArray(data.concepts) && data.concepts.length > 0) {
                dispatch(attachAssistantConceptCards(data));
              }
              break;
            case 'done':
              dispatch(
                finishAssistantStream({
                  messageId: data.message_id,
                  sessionId: data.session_id,
                  completedLabel: data.completed_label,
                  steps: data.steps,
                }),
              );
              break;
            case 'error':
              dispatch(failAssistantStream(data.detail || 'Something went wrong.'));
              toast.error(data.detail || 'Assistant error');
              break;
            default:
              break;
          }
        },
      });
      controllerRef.current = controller;
    },
    [dispatch, sessionId, enabledTools],
  );

  // Demo path: when the user types `/cascade [video|ad|copy]` we skip the
  // network entirely and inject a locally-built ChoiceForm into a fresh
  // assistant message. The form's `form_id` is prefixed `mock_` so the
  // submit handler can short-circuit too. Remove this branch + the mock
  // helpers once the Python agent emits real `choice_form` events.
  const handleCascadeDemo = useCallback(
    (kind) => {
      const form = buildMockChoiceForm(kind);
      dispatch(startAssistantStream());
      dispatch(
        appendAssistantText(
          "Sure — pick what you want below, I'll generate when you hit submit.",
        ),
      );
      dispatch(attachAssistantChoiceForm(form));
      dispatch(finishAssistantStream({}));
    },
    [dispatch],
  );

  const handleSend = useCallback(
    (text, attachments) => {
      if (pending) return;

      const activeQuote = quote;
      setQuote(null); // consume the quote — one reply per quote

      const cascadeKind = parseCascadeCommand(text);
      if (cascadeKind && !attachments?.length) {
        // Still push the user message so the chat reflects what they typed.
        dispatch(pushUserMessage({ text, attachments, quote: activeQuote }));
        handleCascadeDemo(cascadeKind);
        return;
      }

      dispatch(pushUserMessage({ text, attachments, quote: activeQuote }));
      dispatch(startAssistantStream());
      runStreamingTurn({ text, attachments, quote: activeQuote });
    },
    [dispatch, pending, quote, runStreamingTurn, handleCascadeDemo],
  );

  // Called by ChoiceForm when the user submits picks. Mock forms (form_id
  // starts with `mock_`) bypass the network and stream a canned summary.
  // Real forms forward the values to the agent via streamChat's
  // `form_response` field.
  const handleChoiceFormSubmit = useCallback(
    ({ formId, values }) => {
      if (pending) return;
      const isMock = typeof formId === 'string' && formId.startsWith('mock_');

      if (isMock) {
        // form_id shape: mock_<kind>_<nanoid>
        const kind = formId.split('_')[1] || 'video';
        dispatch(startAssistantStream());
        dispatch(appendAssistantText(mockChoiceFormResult(kind, values)));
        dispatch(finishAssistantStream({}));
        return;
      }

      dispatch(startAssistantStream());
      runStreamingTurn({
        text: '',
        attachments: null,
        formResponse: { form_id: formId, values },
      });
    },
    [dispatch, pending, runStreamingTurn],
  );

  // Called by ConceptCards when the user picks a concept. Marks the chosen card,
  // then sends a `concept_response` turn — the agent replies with a creative
  // brief (genCard) pre-filled from that concept, which auto-opens the canvas.
  const handleConceptSelect = useCallback(
    ({ messageId, concept }) => {
      if (pending || !concept) return;
      dispatch(selectConcept({ messageId, conceptId: concept.id }));
      dispatch(startAssistantStream());
      runStreamingTurn({ text: '', attachments: null, conceptResponse: concept });
    },
    [dispatch, pending, runStreamingTurn],
  );

  // ── Right-side canvas (genCards / creative briefs) ──────────────────────────
  // The genCards are every assistant message carrying a choiceForm. The canvas
  // shows one at a time; auto-opens to the newest when a fresh brief arrives.
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const genCards = useMemo(
    () => messages.filter((m) => m.role === 'assistant' && m.choiceForm),
    [messages],
  );
  const prevGenCountRef = useRef(0);
  useEffect(() => {
    if (genCards.length > prevGenCountRef.current) {
      setActiveCardIndex(genCards.length - 1);
      setCanvasOpen(true);
    }
    prevGenCountRef.current = genCards.length;
  }, [genCards.length]);

  const handleOpenCanvas = useCallback(
    (messageId) => {
      const i = genCards.findIndex((m) => m.id === messageId);
      if (i >= 0) setActiveCardIndex(i);
      setCanvasOpen(true);
    },
    [genCards],
  );

  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center px-4 pt-[10vh] sm:pt-[14vh]">
          <h2 className="bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] bg-clip-text text-[42px] leading-tight font-medium text-transparent sm:text-[52px]">
            {`Hi, ${greeting}`}
          </h2>
          <p className="mt-2 text-sm text-white/60">Where do you want to start?</p>
          <div className="mt-7 w-full max-w-[820px] px-3 sm:px-0">
            <Composer
              onSend={handleSend}
              disabled={pending}
              variant="centered"
              quote={quote}
              onClearQuote={() => setQuote(null)}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            <div className="mx-auto w-full min-w-0 max-w-[820px] px-3 sm:px-4">
              <Messages
                messages={messages}
                pending={pending}
                pendingActiveLabel={pendingActiveLabel}
                pendingDoneLabels={pendingDoneLabels}
                completedLabel={completedLabel}
                onChoiceFormSubmit={handleChoiceFormSubmit}
                onConceptSelect={handleConceptSelect}
                onOpenCanvas={handleOpenCanvas}
                onQuote={handleQuote}
              />
            </div>
          </div>
          <div className="shrink-0 px-3 pt-3 pb-4 sm:px-4">
            <div className="mx-auto w-full max-w-[820px]">
              <Composer
                onSend={handleSend}
                disabled={pending}
                variant="docked"
                placeholder="Ask anything..."
                quote={quote}
                onClearQuote={() => setQuote(null)}
              />
            </div>
          </div>
        </>
      )}
      </div>

      <GenCanvas
        open={canvasOpen}
        cards={genCards}
        activeIndex={activeCardIndex}
        onPrev={() => setActiveCardIndex((i) => Math.max(0, i - 1))}
        onNext={() => setActiveCardIndex((i) => Math.min(genCards.length - 1, i + 1))}
        onClose={() => setCanvasOpen(false)}
        onChoiceFormSubmit={handleChoiceFormSubmit}
        pending={pending}
      />
    </div>
  );
};

export default ChatInterface;
