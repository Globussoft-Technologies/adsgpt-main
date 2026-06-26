import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';

import Composer from './Composer';
import Messages from './Messages';
import { streamChat } from '@/apis/aiAssistant/aiAssistantApi';
import {
  buildMockChoiceForm,
  mockChoiceFormResult,
  parseCascadeCommand,
} from './mockChoiceForms';
import {
  appendAssistantText,
  attachAssistantAdCreative,
  attachAssistantAds,
  attachAssistantChoiceForm,
  attachAssistantImage,
  attachAssistantStoryboard,
  failAssistantStream,
  finishAssistantStream,
  pushStep,
  pushUserMessage,
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

  // Real network turn — extracted so both `/cascade` follow-ups and the
  // normal send path can call it without duplicating the SSE event switch.
  const runStreamingTurn = useCallback(
    ({ text, attachments, formResponse, quote: turnQuote }) => {
      const controller = streamChat({
        sessionId,
        message: text,
        attachments: attachments?.length
          ? attachments.map((a) => ({ file_type: a.file_type, url: a.url }))
          : null,
        enabledTools,
        formResponse: formResponse || null,
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
            case 'ad_creative':
              if (data.pack && Array.isArray(data.pack.variants) && data.pack.variants.length > 0) {
                dispatch(attachAssistantAdCreative(data.pack));
              }
              break;
            case 'choice_form':
              if (data.form_id && Array.isArray(data.fields)) {
                dispatch(attachAssistantChoiceForm(data));
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

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center px-4 pt-[10vh] sm:pt-[14vh]">
          <h2 className="bg-gradient-to-r from-[#15DCFF] to-[#5E66F5] bg-clip-text text-[42px] leading-tight font-medium text-transparent sm:text-[52px]">
            {`Hi, ${greeting}`}
          </h2>
          <p className="mt-2 text-sm text-white/60">Where do you want to start?</p>
          <div className="mt-7 w-full max-w-[820px]">
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
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="mx-auto w-full max-w-[820px]">
              <Messages
                messages={messages}
                pending={pending}
                pendingActiveLabel={pendingActiveLabel}
                pendingDoneLabels={pendingDoneLabels}
                completedLabel={completedLabel}
                onChoiceFormSubmit={handleChoiceFormSubmit}
                onQuote={handleQuote}
              />
            </div>
          </div>
          <div className="shrink-0 pt-3 pb-4">
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
  );
};

export default ChatInterface;
