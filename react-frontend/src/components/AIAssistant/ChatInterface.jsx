import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

import Composer from './Composer';
import Messages from './Messages';
import GenCanvas from './GenCanvas';
import BlurText from './BlurText';
import { streamChat } from '@/apis/aiAssistant/aiAssistantApi';
import {
  appendAssistantText,
  resetAssistantText,
  attachAssistantAds,
  attachAssistantChoiceForm,
  attachAssistantConceptCards,
  attachAssistantImage,
  attachAssistantStoryboard,
  failAssistantStream,
  finishAssistantStream,
  pushStep,
  pushUserMessage,
  selectConcept,
  setSessionId,
  startAssistantStream,
  startNewSession,
} from '@/store/reducers/aiAssistant/aiAssistantSlice';

// Welcome intro: same blur-in curve as BlurText's defaults, applied to the
// gradient heading as one unit — word-splitting would break the continuous
// bg-clip-text gradient across the heading (per-word filters/transforms take
// the glyphs out of the parent's text-clip).
const INTRO_HEADING_FROM = { filter: 'blur(10px)', opacity: 0, y: -50 };
const INTRO_HEADING_KEYFRAMES = {
  filter: ['blur(10px)', 'blur(5px)', 'blur(0px)'],
  opacity: [0, 0.5, 1],
  y: [-50, 5, 0],
};

// Turn a raw/technical failure detail into a clear, friendly message with a
// hint at the cause or next step. Falls back to the backend's reason when it's
// already meaningful, and to a safe default otherwise.
const friendlyErrorMessage = (detail) => {
  const d = (detail || '').toString().trim();
  const l = d.toLowerCase();
  if (!l || l === 'something went wrong.' || l === 'assistant error') {
    return 'Something went wrong while generating. Please try again in a moment.';
  }
  if (l.includes('timed out') || l.includes('timeout')) {
    return 'That took too long and timed out. Please try again — a shorter or simpler prompt can help.';
  }
  if (
    l.includes('network') ||
    l.includes('stream interrupted') ||
    l.includes('did not respond') ||
    l.startsWith('http ')
  ) {
    return 'We lost the connection before finishing. Please check your internet and try again.';
  }
  if (l.includes('auth') || l.includes('401') || l.includes('403') || l.includes('token')) {
    return 'Your session has expired. Please refresh the page and sign in again.';
  }
  if (l.includes('credit') || l.includes('insufficient')) {
    return "You don't have enough credits for this generation. Top up your credits and try again.";
  }
  if (
    l.includes('rate limit') ||
    l.includes('429') ||
    l.includes('too many requests') ||
    l.includes('overloaded') ||
    l.includes('busy')
  ) {
    return 'The service is busy right now. Please wait a few seconds and try again.';
  }
  if (
    l.includes('content policy') ||
    l.includes('safety') ||
    l.includes('blocked') ||
    l.includes('violat')
  ) {
    return "That request couldn't be processed due to content guidelines. Try rephrasing or adjusting it and send again.";
  }
  if (l.includes('conversation') && (l.includes('limit') || l.includes('full') || l.includes('new chat'))) {
    // Backend sends a clean, actionable message here — keep it.
    return d;
  }
  if (l.includes('internal error') || l.includes('500') || l.includes('traceback')) {
    return 'Our servers hit a snag generating that. Please try again in a moment.';
  }
  // Fall back to the backend's reason only when it reads like a human sentence.
  // Raw/technical payloads (JSON, stack traces, single tokens, very long dumps)
  // get a safe generic message instead of being shown verbatim.
  const looksTechnical =
    d.length > 200 ||
    /[{}[\]]|traceback|exception|\bat \w+\.|https?:\/\//i.test(d) ||
    !d.includes(' ');
  if (looksTechnical) {
    return 'Something went wrong while generating. Please try again in a moment.';
  }
  return d;
};

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

  // Play the welcome intro (blur-in greeting) once per page entry — this
  // component mounts fresh each time the sidebar's AI button opens the module.
  // Returning to the empty state later in the same visit (New Chat) shows the
  // static greeting instead of replaying the animation.
  const [introPlayed, setIntroPlayed] = useState(false);
  useEffect(() => {
    if (!isEmpty && !introPlayed) setIntroPlayed(true);
  }, [isEmpty, introPlayed]);
  const animateIntro = !introPlayed;

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

  // Start fresh every time the module is entered. Navigating away and back (or
  // reloading) should open a brand-new chat rather than restoring the previous
  // conversation/generation — past chats stay reachable via the History drawer.
  const freshSessionRef = useRef(false);
  useEffect(() => {
    if (freshSessionRef.current) return;
    freshSessionRef.current = true;
    dispatch(startNewSession());
    // Mount-only: reset to a clean session on entering the module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real network turn — extracted so form/concept follow-ups and the
  // normal send path can call it without duplicating the SSE event switch.
  const runStreamingTurn = useCallback(
    ({ text, attachments, formResponse, conceptResponse, quote: turnQuote }) => {
      const controller = streamChat({
        sessionId,
        message: text,
        attachments: attachments?.length
          ? attachments.map((a) => ({ file_type: a.file_type, url: a.url, filename: a.filename }))
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
            case 'token_reset':
              // Server dropped pre-tool preamble; clear it so the final reply
              // isn't appended onto repeated between-tool chatter.
              dispatch(resetAssistantText());
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
            case 'error': {
              const friendly = friendlyErrorMessage(data.detail);
              dispatch(failAssistantStream(friendly));
              toast.error(friendly);
              break;
            }
            default:
              break;
          }
        },
      });
      controllerRef.current = controller;
    },
    [dispatch, sessionId, enabledTools],
  );

  const handleSend = useCallback(
    (text, attachments) => {
      if (pending) return;

      const activeQuote = quote;
      setQuote(null); // consume the quote — one reply per quote

      dispatch(pushUserMessage({ text, attachments, quote: activeQuote }));
      dispatch(startAssistantStream());
      runStreamingTurn({ text, attachments, quote: activeQuote });
    },
    [dispatch, pending, quote, runStreamingTurn],
  );

  // Called by ChoiceForm when the user submits picks — forwards the values to
  // the agent via streamChat's `form_response` field.
  const handleChoiceFormSubmit = useCallback(
    ({ formId, values, regenerate }) => {
      if (pending) return;

      dispatch(startAssistantStream());
      runStreamingTurn({
        text: '',
        attachments: null,
        formResponse: { form_id: formId, values, regenerate: !!regenerate },
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

  // Called by an Ad Library result card's "Recreate" button. Sends a turn that
  // asks the assistant to build a similar ad, passing the reference ad's image
  // as an attachment so the agent can use it as visual reference (→ brief card).
  const handleRecreate = useCallback(
    (ad) => {
      if (pending || !ad) return;
      const img =
        ad.image_url ||
        ad.thumbnail_url ||
        (Array.isArray(ad.image_candidates) ? ad.image_candidates[0] : '');
      const brand = ad.brand ? ` this ${ad.brand}` : ' this';
      const bits = [ad.headline, ad.call_to_action].filter(Boolean).join(' — ');
      const text =
        `Recreate${brand} ad as inspiration — keep the overall style and layout, ` +
        `but make it an original creative I can use.` +
        (bits ? ` (Reference: ${bits})` : '');
      // Derive a sane image extension; ad-CDN URLs often omit one, so default jpg.
      const clean = (img || '').split('?')[0];
      const m = clean.match(/\.(png|jpe?g|webp|gif|bmp)$/i);
      const attachments = img
        ? [{ file_type: m ? `.${m[1].toLowerCase()}` : '.jpg', url: img, filename: 'reference-ad' }]
        : [];
      handleSend(text, attachments);
    },
    [pending, handleSend],
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
        // subtle-scroll + pb so a tall composer (long prompt) is never clipped by
        // the parent's overflow-hidden at 100% zoom / shorter viewports.
        <div className="subtle-scroll flex flex-1 flex-col items-center overflow-y-auto px-4 pt-[10vh] pb-10 sm:pt-[14vh]">
          <motion.h2
            className="bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] bg-clip-text text-[42px] leading-tight font-medium text-transparent sm:text-[52px]"
            initial={animateIntro ? INTRO_HEADING_FROM : false}
            animate={animateIntro ? INTRO_HEADING_KEYFRAMES : undefined}
            transition={{ duration: 0.7, times: [0, 0.5, 1] }}
          >
            {`Hi, ${greeting}`}
          </motion.h2>
          {animateIntro ? (
            <BlurText
              text="Where do you want to start?"
              delay={120}
              stepDuration={0.3}
              className="mt-2 justify-center text-sm text-white/60"
            />
          ) : (
            <p className="mt-2 text-sm text-white/60">Where do you want to start?</p>
          )}
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
          <div className="subtle-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            <div className="mx-auto w-full min-w-0 max-w-[820px] px-3 pt-5 sm:px-4 sm:pt-6">
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
                onRecreate={handleRecreate}
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
