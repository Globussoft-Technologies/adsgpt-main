import { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Send, X, Quote } from 'lucide-react';
import { uploadFile } from '@/apis/aiAssistant/aiAssistantApi';
import toast from 'react-hot-toast';
import BorderGlow from './BorderGlow/BorderGlow';
import ToolToggles from './ToolToggles';

// Tweak these to change composer size:
//   MIN_*  → starting / minimum height
//   MAX_*  → cap before the textarea starts scrolling internally
const MIN_TEXTAREA_PX_CENTERED = 130;
const MAX_TEXTAREA_PX_CENTERED = 200;
const MIN_TEXTAREA_PX_DOCKED = 56;
const MAX_TEXTAREA_PX_DOCKED = 140;

const Composer = ({
  onSend,
  disabled,
  variant = 'centered', // 'centered' | 'docked'
  placeholder = 'Ask Anything...',
  quote = null, // { text, role, messageId } the user is replying to
  onClearQuote,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const minTextareaPx =
    variant === 'docked' ? MIN_TEXTAREA_PX_DOCKED : MIN_TEXTAREA_PX_CENTERED;
  const maxTextareaPx =
    variant === 'docked' ? MAX_TEXTAREA_PX_DOCKED : MAX_TEXTAREA_PX_CENTERED;

  // Auto-grow the textarea between min and max. Past max, the textarea's own
  // overflow-y-auto kicks in and shows a scrollbar.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minTextareaPx), maxTextareaPx)}px`;
  }, [text, minTextareaPx, maxTextareaPx]);

  // Focus the input when the user picks something to reply to.
  useEffect(() => {
    if (quote?.text) textareaRef.current?.focus();
  }, [quote]);

  const canSend = !disabled && !uploading && (text.trim().length > 0 || attachments.length > 0);

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(text.trim(), attachments);
    setText('');
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (f) => {
          const res = await uploadFile(f);
          return { file_type: res.file_type, url: res.url, filename: res.filename };
        }),
      );
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (idx) =>
    setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const radius = variant === 'centered' ? 28 : 24;

  return (
    <BorderGlow
      edgeSensitivity={30}
      glowColor="40 80 80"
      backgroundColor="#000000"
      borderRadius={radius}
      glowRadius={40}
      glowIntensity={1}
      coneSpread={25}
      animated={false}
      colors={['#c084fc', '#f472b6', '#38bdf8']}
    >
      <div className="flex w-full flex-col gap-2 px-5 py-4">
        {quote?.text && (
          <div className="flex items-start gap-2 rounded-xl border-l-2 border-white/30 bg-white/[0.04] px-3 py-2">
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/70" />
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-medium tracking-wide text-white/70 uppercase">
                Replying to {quote.role === 'assistant' ? 'assistant' : quote.role === 'user' ? 'you' : 'message'}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-white/65">
                {quote.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onClearQuote?.()}
              className="shrink-0 text-white/45 hover:text-white"
              aria-label="Cancel reply"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div
                key={`${a.url}-${i}`}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/85"
              >
                <span className="max-w-[200px] truncate">{a.filename || a.url}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="text-white/60 hover:text-white"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={disabled}
          className="w-full resize-none overflow-y-auto bo2rder-none bg-transparent text-[19px] leading-8 text-white outline-none placeholder:text-white/40 disabled:opacity-60"
          style={{ minHeight: `${minTextareaPx}px`, maxHeight: `${maxTextareaPx}px` }}
        />

        {/* Bottom action row: toggle chips on the left, attach + send on the right. */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <ToolToggles />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={disabled || uploading}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="Attach file"
              title="Attach file"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
              accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.bmp,.txt,.md,.json"
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                canSend
                  ? 'bg-white text-black hover:bg-white/90 shadow-[0_4px_12px_rgba(255,255,255,0.15)]'
                  : 'bg-white/10 text-white/40'
              }`}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </BorderGlow>
  );
};

export default Composer;
