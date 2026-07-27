import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link2, Loader2, Paperclip, Send, X, Quote } from 'lucide-react';
import { uploadFile } from '@/apis/aiAssistant/aiAssistantApi';
import { uploadToS3 } from '@/utils/imageUpload';
import toMediaUrl from '@/utils/mediaUrl';
import toast from 'react-hot-toast';
import BorderGlow from './BorderGlow/BorderGlow';
import ToolToggles from './ToolToggles';
import ImageLightbox from './ImageLightbox';

let _tmpId = 0;
const nextTmpId = () => `att_${++_tmpId}`;
const isImageFile = (file) => (file?.type || '').startsWith('image/');
const looksLikeLogoName = (name = '') =>
  /(logo|logotype|wordmark|brand[\s_-]*mark)/i.test(name);
const extOf = (name) => {
  const dot = (name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};

// An image copied from a web page lands on the clipboard as `kind:'string'`
// (an <img> HTML fragment and/or a bare image URL), NOT a binary file — so it
// would otherwise paste into the textarea as raw text/URL. Pull an image URL
// out of the HTML or plain-text flavours so we can turn it into a real preview.
const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i;
const extractImageUrl = (html, text) => {
  const fromHtml = (html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  if (fromHtml && /^https?:\/\//i.test(fromHtml[1])) return fromHtml[1];
  const t = (text || '').trim();
  if (/^https?:\/\/\S+$/i.test(t) && IMAGE_URL_RE.test(t)) return t;
  return null;
};

// Client-side upload guard. The OS file picker's `accept` is only a hint (users
// can switch to "All files"; drag/paste bypass it entirely), so validate here
// too — otherwise a rejected file (e.g. an .exe) flashes in as a chip before the
// backend rejects it, with a raw error. Keep in sync with the backend
// ALLOWED_UPLOAD_EXT (Agent chat.py).
const ALLOWED_EXTS = new Set([
  '.pdf', '.xlsx', '.xls', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.txt', '.md', '.json',
]);
const ACCEPT_ATTR = [...ALLOWED_EXTS].join(',');
// Max attachments per message — keeps processing/latency sane and matches the
// brief card's reference-image cap.
const MAX_ATTACHMENTS = 6;

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
  // Each attachment: { tempId, file_type, filename, url, isImage, role,
  // preview?, pending }. Image role is sent to the backend so Reference Image
  // and Brand Logo mapping never has to guess from upload order.
  // Images get an instant local `preview` (object URL) + a spinner while they
  // upload to S3 in the background — like ChatGPT — so the user never waits on a
  // blank composer.
  const [attachments, setAttachments] = useState([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [urlAdding, setUrlAdding] = useState(false);
  // Full-screen preview of an attached image (double-click a thumbnail).
  const [lightboxSrc, setLightboxSrc] = useState(null);
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

  // Refocus the composer when a turn/generation finishes streaming (disabled
  // flips true → false) so the user can type a follow-up immediately without
  // having to click back into the box. Don't steal focus if they're actively
  // typing elsewhere (e.g. editing a Creative Studio field).
  const wasDisabledRef = useRef(disabled);
  useEffect(() => {
    const justFinished = wasDisabledRef.current && !disabled;
    wasDisabledRef.current = disabled;
    if (!justFinished) return;
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || active?.isContentEditable) return;
    textareaRef.current?.focus();
  }, [disabled]);

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
      role: a.role || null,
    }));
    attachments.forEach(
      (a) => a.preview?.startsWith?.('blob:') && URL.revokeObjectURL(a.preview),
    );
    onSend?.(text.trim(), payload);
    setText('');
    setAttachments([]);
    setImageUrl('');
    setShowUrlInput(false);
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
    // 1) Reject unsupported types (e.g. .exe) up front with a friendly message.
    const supported = [];
    files.forEach((file) => {
      if (ALLOWED_EXTS.has(extOf(file.name))) supported.push(file);
      else toast.error(`"${file.name}" isn't a supported file type.`);
    });
    if (!supported.length) return;

    // 2) Cap the number of attachments per message.
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    const accepted = supported.slice(0, room);
    if (supported.length > room) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
    }

    accepted.forEach((file) => {
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
          role: isImage
            ? looksLikeLogoName(file.name)
              ? 'brand_logo'
              : 'reference_image'
            : null,
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

  // Turn a pasted remote image URL into a real attachment with a preview.
  // Preferred path: fetch the bytes and run them through the normal upload flow
  // so it's stored like any other attachment. If the fetch is blocked (most
  // cross-origin images are), fall back to referencing the URL directly so the
  // user still gets a thumbnail preview and can send it.
  const addImageByUrl = async (rawUrl) => {
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return false;
    }
    const url = rawUrl.trim();
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      toast.error('Enter a valid public http(s) image URL.');
      return false;
    }
    setUrlAdding(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not an image');
      const ext = (blob.type.split('/')[1] || 'png').split('+')[0];
      addFiles([new File([blob], `pasted-image.${ext}`, { type: blob.type })]);
    } catch {
      const tempId = nextTmpId();
      setAttachments((prev) => [
        ...prev,
        {
          tempId,
          file_type: extOf(url.split('?')[0]) || '.png',
          filename: url.split('/').pop()?.split('?')[0] || 'pasted-image',
          url,
          isImage: true,
          role: 'reference_image',
          preview: url,
          pending: false,
        },
      ]);
    } finally {
      setUrlAdding(false);
    }
    return true;
  };

  const handleAddImageUrl = async () => {
    const added = await addImageByUrl(imageUrl);
    if (!added) return;
    setImageUrl('');
    setShowUrlInput(false);
  };

  // Let users paste an image straight from the clipboard (screenshots, copied
  // product photos, or an image copied from a web page) instead of only via the
  // attach button. Screenshots/copied files arrive as binary `kind:'file'`
  // items; web-page images arrive as an <img> HTML fragment or a bare URL.
  const handlePaste = (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    // No binary image — check for an image copied as HTML/URL and keep it out
    // of the textarea (which is what made it show up as raw text before).
    const url = extractImageUrl(cd.getData('text/html'), cd.getData('text/plain'));
    if (url) {
      e.preventDefault();
      addImageByUrl(url);
    }
  };

  const removeAttachment = (idx) =>
    setAttachments((prev) => {
      const target = prev[idx];
      if (target?.preview?.startsWith?.('blob:')) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });

  const toggleImageRole = (tempId) =>
    setAttachments((prev) => {
      const target = prev.find((item) => item.tempId === tempId);
      const nextRole =
        target?.role === 'brand_logo' ? 'reference_image' : 'brand_logo';
      return prev.map((item) => {
        if (item.tempId === tempId) return { ...item, role: nextRole };
        // The Creative Studio logo field is singular. Choosing a new logo
        // deterministically returns the old one to the reference-image group.
        if (
          nextRole === 'brand_logo' &&
          item.isImage &&
          item.role === 'brand_logo'
        ) {
          return { ...item, role: 'reference_image' };
        }
        return item;
      });
    });

  const radius = variant === 'centered' ? 28 : 24;

  return (
    <>
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
                  onDoubleClick={() => !a.pending && setLightboxSrc(a.url)}
                  title={a.pending ? undefined : 'Double-click to preview'}
                  className="group relative h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border border-white/10 bg-black/40"
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
                    <>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white/80 hover:bg-black hover:text-white"
                        aria-label="Remove attachment"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleImageRole(a.tempId)}
                        className="absolute right-1 bottom-1 left-1 truncate rounded bg-black/75 px-1 py-0.5 text-[8.5px] font-semibold tracking-wide text-white/85 uppercase hover:bg-black"
                        title="Click to switch between reference image and brand logo"
                        aria-label={`Use ${a.filename} as ${
                          a.role === 'brand_logo' ? 'reference image' : 'brand logo'
                        }`}
                      >
                        {a.role === 'brand_logo' ? 'Logo' : 'Reference'}
                      </button>
                    </>
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

        {/* Always-visible attachment count + cap, so the limit is discoverable
            BEFORE it's hit (not just via an error at the cap). Turns amber on the
            last slot. */}
        {attachments.length > 0 && (
          <span
            className={`text-[11px] font-medium ${
              attachments.length >= MAX_ATTACHMENTS ? 'text-amber-400/90' : 'text-white/45'
            }`}
          >
            {attachments.length} / {MAX_ATTACHMENTS} files
            {attachments.length >= MAX_ATTACHMENTS ? ' · limit reached' : ''}
          </span>
        )}

        {showUrlInput && (
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
            <Link2 className="ml-1 h-4 w-4 shrink-0 text-white/45" />
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddImageUrl();
                } else if (e.key === 'Escape') {
                  setShowUrlInput(false);
                }
              }}
              autoFocus
              placeholder="https://example.com/image.png"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/35"
            />
            <button
              type="button"
              onClick={handleAddImageUrl}
              disabled={urlAdding || !imageUrl.trim()}
              className="inline-flex h-7 items-center rounded-full bg-white px-3 text-[11px] font-semibold text-black hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {urlAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUrlInput(false);
                setImageUrl('');
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
              aria-label="Close image URL input"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
              onClick={() => setShowUrlInput((open) => !open)}
              disabled={disabled}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 ${
                showUrlInput ? 'bg-white/10 text-white' : 'text-white/60'
              }`}
              aria-label="Attach image from URL"
              title="Attach image from URL"
            >
              <Link2 className="h-4 w-4" />
            </button>
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
              accept={ACCEPT_ATTR}
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
    <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
};

export default Composer;
