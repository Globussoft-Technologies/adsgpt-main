import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bot, Check, ChevronRight, Copy, Loader2, RotateCcw, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ConfirmActionCard from './ConfirmActionCard';
import CardBlock from './cards/CardBlock';

// Shared markdown styling — same arbitrary-selector approach the AI Assistant
// uses (no @tailwindcss/typography plugin needed), tuned for the narrow widget.
const MARKDOWN_CLASS =
  'max-w-none break-words text-sm leading-relaxed ' +
  '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_li]:my-0.5 [&_li]:marker:text-[#15DCFF] [&_h1]:text-base [&_h1]:font-semibold [&_h1]:my-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:my-2 ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1.5 [&_strong]:font-semibold ' +
  '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] dark:[&_code]:bg-white/10 ' +
  '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-2 dark:[&_pre]:bg-white/10 ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-[#0082FB] [&_a]:underline [&_a]:break-words ' +
  '[&_table]:block [&_table]:overflow-x-auto [&_table]:my-2 [&_th]:border [&_th]:border-black/10 [&_th]:px-2 [&_th]:py-1 ' +
  '[&_td]:border [&_td]:border-black/10 [&_td]:px-2 [&_td]:py-1 dark:[&_th]:border-white/15 dark:[&_td]:border-white/15';

const Markdown = ({ children }) => (
  <div className={MARKDOWN_CLASS}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} /> }}
    >
      {children}
    </ReactMarkdown>
  </div>
);

// Small gradient avatar shared by the header and every assistant message.
const BotAvatar = ({ size = 'h-6 w-6' }) => (
  <div
    className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#15DCFF] to-[#6b72f8]`}
  >
    <Bot className="h-3.5 w-3.5 text-white" />
  </div>
);

const UserAvatar = () => (
  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 dark:bg-white/15">
    <User className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
  </div>
);

// Three-dot "thinking" indicator shown before the model has produced any
// steps, cards, or text for the current turn.
const TypingDots = () => (
  <div className="flex items-center gap-1 py-1">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="h-1.5 w-1.5 animate-bounce rounded-full bg-gradient-to-br from-[#15DCFF] to-[#6b72f8]"
        style={{ animationDelay: `${i * 0.12}s`, animationDuration: '0.9s' }}
      />
    ))}
  </div>
);

// Collapsible tool-activity trace — the reference's "Thought for 3s".
const WorkedTrace = ({ steps = [], activeStep, streaming, elapsedMs }) => {
  const [open, setOpen] = useState(false);
  if (!steps.length && !activeStep) return null;
  const label = streaming
    ? activeStep || 'Working…'
    : `Worked for ${elapsedMs ? (elapsedMs / 1000).toFixed(1) : '0.0'}s`;
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pr-2 pl-2.5 text-[12px] text-gray-500 transition-colors hover:bg-gray-200 dark:bg-white/5 dark:text-white/55 dark:hover:bg-white/10"
      >
        {streaming ? (
          <Loader2 className="h-3 w-3 animate-spin text-[#15DCFF]" />
        ) : (
          <Check className="h-3 w-3 text-emerald-500" />
        )}
        <span>{label}</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && steps.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 border-l border-gray-200 pl-3 dark:border-white/10">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-white/50">
              <Check className="h-3 w-3 text-gray-400 dark:text-white/40" />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Copy / regenerate / thumbs row under a finished assistant message.
const MessageActions = ({ text, onRegenerate }) => {
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState(null); // local only (no feedback endpoint yet)
  const iconBtn =
    'rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200';
  return (
    <div className="mt-1.5 flex items-center gap-0.5">
      <button
        type="button"
        title="Copy"
        className={iconBtn}
        onClick={() =>
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onRegenerate && (
        <button type="button" title="Regenerate" className={iconBtn} onClick={onRegenerate}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        title="Good response"
        className={`${iconBtn} ${vote === 'up' ? 'text-[#15DCFF]' : ''}`}
        onClick={() => setVote((v) => (v === 'up' ? null : 'up'))}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Bad response"
        className={`${iconBtn} ${vote === 'down' ? 'text-red-500' : ''}`}
        onClick={() => setVote((v) => (v === 'down' ? null : 'down'))}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

const AssistantMessage = ({ message, onAction, onRegenerate, streaming }) => {
  const hasAny =
    Boolean(message.text) ||
    message.steps?.length ||
    message.activeStep ||
    message.cards?.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex max-w-[92%] items-start gap-2 self-start"
    >
      <BotAvatar />
      <div className="min-w-0 flex-1">
        <WorkedTrace
          steps={message.steps}
          activeStep={message.activeStep}
          streaming={message.streaming}
          elapsedMs={message.elapsedMs}
        />

        {message.cards?.length > 0 && (
          <div className="mb-2 flex flex-col gap-2">
            {message.cards.map((card, i) => (
              <CardBlock key={i} card={card} onAction={onAction} disabled={streaming} />
            ))}
          </div>
        )}

        {message.text ? (
          <div className="rounded-2xl rounded-tl-sm border border-gray-200/70 bg-gray-50 px-3.5 py-2.5 text-gray-900 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
            <Markdown>{message.text}</Markdown>
            {!message.streaming && (
              <MessageActions text={message.text} onRegenerate={onRegenerate} />
            )}
          </div>
        ) : (
          message.streaming && !hasAny && (
            <div className="rounded-2xl rounded-tl-sm border border-gray-200/70 bg-gray-50 px-3.5 py-2.5 dark:border-white/10 dark:bg-white/[0.06]">
              <TypingDots />
            </div>
          )
        )}
      </div>
    </motion.div>
  );
};

const MessageBubble = ({ message, onAction, onRegenerate, streaming }) => {
  if (message.role === 'assistant') {
    return (
      <AssistantMessage
        message={message}
        onAction={onAction}
        onRegenerate={onRegenerate}
        streaming={streaming}
      />
    );
  }
  const isUser = message.role === 'user';
  if (isUser) {
    return (
      <div className="flex max-w-[85%] items-start gap-2 self-end">
        <div className="rounded-2xl rounded-tr-sm bg-gray-900 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white dark:bg-white/10">
          {message.text}
        </div>
        <UserAvatar />
      </div>
    );
  }
  return (
    <div className="flex max-w-[85%] items-start gap-2 self-start">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/15">
        <span className="text-[11px] font-bold text-red-500">!</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-destructive/10 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-destructive">
        {message.text}
      </div>
    </div>
  );
};

const ChatMessageList = ({
  messages,
  pendingConfirm,
  onConfirm,
  onCancel,
  confirmBusy,
  onAction,
  onRegenerate,
  isStreaming,
}) => {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingConfirm]);

  // Regenerate only the most recent assistant message.
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onAction={onAction}
          onRegenerate={
            !isStreaming && message.id === lastAssistantId ? onRegenerate : undefined
          }
          streaming={isStreaming}
        />
      ))}

      {pendingConfirm && (
        <div className="flex w-full max-w-[92%] items-start gap-2 self-start">
          <BotAvatar />
          <div className="min-w-0 flex-1">
            <ConfirmActionCard
              actions={pendingConfirm.actions}
              busy={confirmBusy}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default ChatMessageList;
