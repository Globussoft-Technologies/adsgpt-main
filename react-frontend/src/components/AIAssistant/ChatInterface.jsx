import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

import Composer from './Composer';
import Messages from './Messages';
import GenCanvas from './GenCanvas';
import BlurText from './BlurText';
import { getHistory, streamChat } from '@/apis/aiAssistant/aiAssistantApi';
import {
  appendAssistantText,
  appendMetaConnectionStatus,
  resetAssistantText,
  attachAssistantAds,
  attachAssistantAdCreative,
  attachAssistantChoiceForm,
  attachAssistantConceptCards,
  attachAssistantImage,
  attachAssistantMetaCards,
  attachAssistantMetaConfirmation,
  attachAssistantMetaMediaPicker,
  attachAssistantStoryboard,
  failAssistantStream,
  finishAssistantStream,
  loadConversation,
  pushStep,
  pushUserMessage,
  resolveAssistantMetaAction,
  resolveAssistantMetaMedia,
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
  const hasPendingMetaControl = useMemo(
    () =>
      messages.some(
        (message) =>
          message.metaPendingAction?.status === 'pending' ||
          message.metaMediaPicker?.status === 'pending',
      ),
    [messages],
  );

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

  // Stable per-conversation key for the Composer's unsent-draft cache. Frozen
  // to the sessionId (or 'new') at the moment the user explicitly starts a new
  // chat or loads one from History — both bump `abortRequestId` — rather than
  // tracking `sessionId` directly, because `sessionId` also updates mid-stream
  // (server assigns it right after the first message) while the user may still
  // be typing a follow-up; keying off that would wipe their in-progress text.
  // Computed during render (not in an effect) so a New Chat / History switch
  // never has the newly-mounted Composer read one render's worth of stale key.
  const draftKeyRef = useRef(null);
  const draftAbortRef = useRef(abortRequestId);
  if (draftKeyRef.current === null || abortRequestId !== draftAbortRef.current) {
    draftAbortRef.current = abortRequestId;
    draftKeyRef.current = sessionId || 'new';
  }
  const draftKey = draftKeyRef.current;

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
  const metaControlRequestRef = useRef(new Set());
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
    metaControlRequestRef.current.clear();
  }, [abortRequestId]);

  // Start fresh every time the module is entered. Navigating away and back (or
  // reloading) should open a brand-new chat rather than restoring the previous
  // conversation/generation — past chats stay reachable via the History drawer.
  const freshSessionRef = useRef(false);
  useEffect(() => {
    if (freshSessionRef.current) return;
    freshSessionRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const returnedFromMeta = params.get('meta_connected') === '1';
    let resumeSessionId = null;
    if (returnedFromMeta) {
      try {
        resumeSessionId = JSON.parse(
          sessionStorage.getItem('aia1_meta_oauth_resume') || '{}',
        ).sessionId;
        sessionStorage.removeItem('aia1_meta_oauth_resume');
      } catch {
        resumeSessionId = null;
      }
      window.history.replaceState(null, '', '/assistant');
    }

    if (!returnedFromMeta || !resumeSessionId) {
      dispatch(startNewSession());
      return;
    }

    (async () => {
      try {
        const history = await getHistory(resumeSessionId);
        dispatch(loadConversation({ sessionId: resumeSessionId, messages: history || [] }));
      } catch {
        dispatch(startNewSession());
      } finally {
        dispatch(appendMetaConnectionStatus());
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real network turn — extracted so form/concept follow-ups and the
  // normal send path can call it without duplicating the SSE event switch.
  const runStreamingTurn = useCallback(
    ({
      text,
      attachments,
      formResponse,
      conceptResponse,
      metaAccountSelection,
      metaActionResponse,
      metaMediaResponse,
      recreateSource,
      quote: turnQuote,
    }) => {
      const controller = streamChat({
        sessionId,
        message: text,
        attachments: attachments?.length
          ? attachments.map((a) => ({
              file_type: a.file_type,
              url: a.url,
              filename: a.filename,
              role: a.role || null,
            }))
          : null,
        enabledTools,
        formResponse: formResponse || null,
        conceptResponse: conceptResponse || null,
        metaAccountSelection: metaAccountSelection || null,
        metaActionResponse: metaActionResponse || null,
        metaMediaResponse: metaMediaResponse || null,
        recreateSource: recreateSource || null,
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
            case 'meta_cards':
              if (Array.isArray(data.cards) && data.cards.length > 0) {
                dispatch(attachAssistantMetaCards(data.cards));
              }
              break;
            case 'meta_confirmation':
              if (data.actionId && Array.isArray(data.actions)) {
                dispatch(attachAssistantMetaConfirmation(data));
              }
              break;
            case 'meta_media_picker':
              if (data.inputId) {
                dispatch(attachAssistantMetaMediaPicker(data));
              }
              break;
            case 'meta_control_resolved':
              if (data.control === 'action' && data.id) {
                metaControlRequestRef.current.delete(`action:${data.id}`);
                dispatch(
                  resolveAssistantMetaAction({
                    actionId: data.id,
                    status: data.status,
                  }),
                );
              } else if (data.control === 'media' && data.id) {
                metaControlRequestRef.current.delete(`media:${data.id}`);
                dispatch(
                  resolveAssistantMetaMedia({
                    inputId: data.id,
                    status: data.status,
                  }),
                );
              }
              break;
            case 'ad_creative':
              if (data.pack && Array.isArray(data.pack.variants)) {
                dispatch(attachAssistantAdCreative(data.pack));
              }
              break;
            case 'done':
              if (metaActionResponse?.action_id) {
                metaControlRequestRef.current.delete(
                  `action:${metaActionResponse.action_id}`,
                );
              }
              if (metaMediaResponse?.input_id) {
                metaControlRequestRef.current.delete(
                  `media:${metaMediaResponse.input_id}`,
                );
              }
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
              if (metaActionResponse?.action_id) {
                metaControlRequestRef.current.delete(
                  `action:${metaActionResponse.action_id}`,
                );
              }
              if (metaMediaResponse?.input_id) {
                metaControlRequestRef.current.delete(
                  `media:${metaMediaResponse.input_id}`,
                );
              }
              if (data.status && metaActionResponse?.action_id) {
                dispatch(
                  resolveAssistantMetaAction({
                    actionId: metaActionResponse.action_id,
                    status: 'failed',
                  }),
                );
              }
              if (data.status && metaMediaResponse?.input_id) {
                dispatch(
                  resolveAssistantMetaMedia({
                    inputId: metaMediaResponse.input_id,
                    status: 'failed',
                  }),
                );
              }
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
    (text, attachments, options = {}) => {
      if (pending || hasPendingMetaControl) return;

      const activeQuote = quote;
      setQuote(null); // consume the quote — one reply per quote

      dispatch(pushUserMessage({ text, attachments, quote: activeQuote }));
      dispatch(startAssistantStream());
      runStreamingTurn({
        text,
        attachments,
        quote: activeQuote,
        metaAccountSelection: options.metaAccountSelection || null,
        recreateSource: options.recreateSource || null,
      });
    },
    [dispatch, pending, hasPendingMetaControl, quote, runStreamingTurn],
  );

  // Called by ChoiceForm when the user submits picks — forwards the values to
  // the agent via streamChat's `form_response` field.
  const handleChoiceFormSubmit = useCallback(
    ({ formId, values, regenerate }) => {
      if (pending || hasPendingMetaControl) return;

      dispatch(startAssistantStream());
      runStreamingTurn({
        text: '',
        attachments: null,
        formResponse: { form_id: formId, values, regenerate: !!regenerate },
      });
    },
    [dispatch, pending, hasPendingMetaControl, runStreamingTurn],
  );

  // Called by ConceptCards when the user picks a concept. Marks the chosen card,
  // then sends a `concept_response` turn — the agent replies with a creative
  // brief (genCard) pre-filled from that concept, which auto-opens the canvas.
  const handleConceptSelect = useCallback(
    ({ messageId, concept }) => {
      if (pending || hasPendingMetaControl || !concept) return;
      dispatch(selectConcept({ messageId, conceptId: concept.id }));
      dispatch(startAssistantStream());
      runStreamingTurn({ text: '', attachments: null, conceptResponse: concept });
    },
    [dispatch, pending, hasPendingMetaControl, runStreamingTurn],
  );

  // Called by an Ad Library result card's "Recreate" button. Sends a turn that
  // asks the assistant to build a similar ad, passing the reference ad's image
  // as an attachment so the agent can use it as visual reference (→ brief card).
  const handleRecreate = useCallback(
    (ad) => {
      if (pending || hasPendingMetaControl || !ad) return;
      const img =
        ad.image_url ||
        ad.thumbnail_url ||
        (Array.isArray(ad.image_candidates) ? ad.image_candidates[0] : '');
      const sourceBrand = (ad.brand || '').trim();
      const sourceDescription = (ad.snippet || ad.headline || '').trim();
      const sourceCta = (ad.call_to_action || '').trim();
      const text =
        `Recreate the selected ad as an original creative with a similar visual direction. ` +
        `Use only these source-ad details in Creative Studio: ` +
        `brand name "${sourceBrand}", brand description "${sourceDescription}", ` +
        `CTA "${sourceCta}". Do not substitute a saved or unrelated brand.`;
      // The prompt above is a hint the model often dropped, leaving brand_name
      // empty — which the backend then filled from the user's saved brand. Send
      // the same details as data so the brief is seeded deterministically.
      const recreateSource = {
        brand: sourceBrand || null,
        description: sourceDescription || null,
        cta: sourceCta || null,
      };
      // Derive a sane image extension; ad-CDN URLs often omit one, so default jpg.
      const clean = (img || '').split('?')[0];
      const m = clean.match(/\.(png|jpe?g|webp|gif|bmp)$/i);
      const attachments = img
        ? [{
            file_type: m ? `.${m[1].toLowerCase()}` : '.jpg',
            url: img,
            filename: 'reference-ad',
            role: 'reference_image',
          }]
        : [];
      handleSend(text, attachments, { recreateSource });
    },
    [pending, hasPendingMetaControl, handleSend],
  );

  const handleMetaCardAction = useCallback(
    (prompt, metadata = {}) => {
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      handleSend(prompt.trim(), null, {
        metaAccountSelection: metadata.metaAccountSelection || null,
      });
    },
    [handleSend],
  );

  const handleMetaConfirmation = useCallback(
    (pendingAction, approve) => {
      if (pending || !pendingAction?.actionId) return;
      const requestKey = `action:${pendingAction.actionId}`;
      if (metaControlRequestRef.current.has(requestKey)) return;
      metaControlRequestRef.current.add(requestKey);
      dispatch(startAssistantStream());
      runStreamingTurn({
        text: '',
        attachments: null,
        metaActionResponse: {
          action_id: pendingAction.actionId,
          approve,
        },
      });
    },
    [dispatch, pending, runStreamingTurn],
  );

  const handleMetaMediaResponse = useCallback(
    (picker, url, mediaType, cancel = false) => {
      if (pending || !picker?.inputId) return;
      const requestKey = `media:${picker.inputId}`;
      if (metaControlRequestRef.current.has(requestKey)) return;
      metaControlRequestRef.current.add(requestKey);
      dispatch(startAssistantStream());
      runStreamingTurn({
        text: '',
        attachments: null,
        metaMediaResponse: {
          input_id: picker.inputId,
          media_type: mediaType || picker.mediaType || 'image',
          url: cancel ? null : url,
          cancel,
        },
      });
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
              disabled={pending || hasPendingMetaControl}
              variant="centered"
              quote={quote}
              onClearQuote={() => setQuote(null)}
              draftKey={draftKey}
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
                onMetaAction={handleMetaCardAction}
                onMetaConfirm={(action) => handleMetaConfirmation(action, true)}
                onMetaCancel={(action) => handleMetaConfirmation(action, false)}
                onMetaMediaPick={(picker, url, mediaType) =>
                  handleMetaMediaResponse(picker, url, mediaType, false)
                }
                onMetaMediaCancel={(picker) =>
                  handleMetaMediaResponse(picker, null, picker.mediaType, true)
                }
              />
            </div>
          </div>
          <div className="shrink-0 px-3 pt-3 pb-4 sm:px-4">
            <div className="mx-auto w-full max-w-[820px]">
              <Composer
                onSend={handleSend}
                disabled={pending || hasPendingMetaControl}
                variant="docked"
                placeholder="Ask anything..."
                quote={quote}
                onClearQuote={() => setQuote(null)}
                draftKey={draftKey}
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
