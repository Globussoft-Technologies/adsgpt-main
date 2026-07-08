import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Loader2, Paperclip, Send, X, Quote } from 'lucide-react';
import { uploadFile } from '@/apis/aiAssistant/aiAssistantApi';
import { uploadToS3 } from '@/utils/imageUpload';
import toMediaUrl from '@/utils/mediaUrl';
import toast from 'react-hot-toast';
import BorderGlow from './BorderGlow/BorderGlow';
import ToolToggles from './ToolToggles';

let _tmpId = 0;
const nextTmpId = () => `att_${++_tmpId}`;
const isImageFile = (file) => (file?.type || '').startsWith('image/');
const extOf = (name) => {
  const dot = (name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

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
  // Each attachment: { tempId, file_type, filename, url, isImage, preview?, pending }.
  // Images get an instant local `preview` (object URL) + a spinner while they
  // upload to S3 in the background — like ChatGPT — so the user never waits on a
  // blank composer.
  const [attachments, setAttachments] = useState([]);
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const uploadingCount = attachments.filter((a) => a.pending).length;

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

  const readyAttachments = attachments.filter((a) => !a.pending && a.url);
  const canSend =
    !disabled && uploadingCount === 0 && (text.trim().length > 0 || readyAttachments.length > 0);

  const handleSend = () => {
    if (!canSend) return;
    // Send only the fields the agent needs; drop UI-only preview/pending state.
    const payload = readyAttachments.map((a) => ({
      file_type: a.file_type,
      url: a.url,
      filename: a.filename,
    }));
    attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
    onSend?.(text.trim(), payload);
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

  // Add files with an instant optimistic entry, then upload in the background.
  // Images go straight to S3 via the shared `uploadToS3` (returns a stored PATH)
  // and show a local preview meanwhile; other files use the Agent /upload.
  const addFiles = (files) => {
    files.forEach((file) => {
      const isImage = isImageFile(file);
      const tempId = nextTmpId();
      const preview = isImage ? URL.createObjectURL(file) : null;
      setAttachments((prev) => [
        ...prev,
        {
          tempId,
          file_type: extOf(file.name),
          filename: file.name,
          url: '',
          isImage,
          preview,
          pending: true,
        },
      ]);

      (async () => {
        try {
          let url;
          let fileType = extOf(file.name);
          if (isImage) {
            url = await uploadToS3(file, userId, true); // → S3 path
            if (!url) throw new Error('Upload failed');
          } else {
            const res = await uploadFile(file);
            url = res.url;
            fileType = res.file_type || fileType;
          }
          setAttachments((prev) =>
            prev.map((a) => (a.tempId === tempId ? { ...a, url, file_type: fileType, pending: false } : a)),
          );
        } catch (err) {
          toast.error(err?.response?.data?.detail || err?.message || 'Upload failed');
          setAttachments((prev) => prev.filter((a) => a.tempId !== tempId));
          if (preview) URL.revokeObjectURL(preview);
        }
      })();
    });
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    addFiles(files);
  };

  // Let users paste an image straight from the clipboard (screenshots, copied
  // product photos) instead of only via the attach button.
  const handlePaste = (e) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const removeAttachment = (idx) =>
    setAttachments((prev) => {
      const target = prev[idx];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });

  const radius = variant === 'centered' ? 28 : 24;

  return (
    <BorderGlow
      edgeSensitivity={30}
      glowColor="40 80 80"
      // Glassmorphism (matches the Ad Studio → Ad Copy prompt box): translucent
      // dark fill + heavy backdrop blur so the background gradient frosts through.
      // `glow-edge-only` disables BorderGlow's two colored mesh-gradient layers
      // (::before/::after) — they mask their interior with the card bg, so a
      // TRANSLUCENT glass card lets the mesh bleed inside. Dropping them keeps the
      // outer edge glow + border only, with a clean glass interior.
      backgroundColor="rgba(20,20,26,0.35)"
      className="backdrop-blur-[40px] glow-edge-only"
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
            {attachments.map((a, i) =>
              a.isImage ? (
                <div
                  key={a.tempId}
                  className="group relative h-16 w-16 overflow-hidden rounded-lg border border-white/10 bg-black/40"
                >
                  <img
                    src={a.pending ? a.preview : toMediaUrl(a.url)}
                    alt={a.filename}
                    className="h-full w-full object-cover"
                  />
                  {a.pending && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                  {!a.pending && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 hover:bg-black hover:text-white"
                      aria-label="Remove attachment"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div
                  key={a.tempId}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/85"
                >
                  {a.pending && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span className="max-w-[200px] truncate">{a.filename || a.url}</span>
                  {!a.pending && (
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="text-white/60 hover:text-white"
                      aria-label="Remove attachment"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={3}
          // Stay typeable while a response streams — the user can compose their
          // next message; only sending is locked (see canSend / the send button).
          disabled={false}
          className="w-full resize-none overflow-y-auto border-0 bg-transparent text-[19px] leading-8 text-white outline-none placeholder:text-white/40 disabled:opacity-60"
          style={{ minHeight: `${minTextareaPx}px`, maxHeight: `${maxTextareaPx}px` }}
        />

        {/* Bottom action row: toggle chips on the left, attach + send on the right. */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <ToolToggles />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAttachClick}
              disabled={disabled}
              className="flex h-10 w-10 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="Attach file"
              title="Attach file"
            >
              {uploadingCount > 0 ? (
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
