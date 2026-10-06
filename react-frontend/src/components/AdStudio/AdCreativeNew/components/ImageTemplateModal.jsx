import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { Check, ImagePlus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';
import { uploadToS3 } from '@/utils/imageUpload';
import { useGenieToMySpace } from '@/utils/ui/useGenieToMySpace';
import toMediaUrl from '@/utils/mediaUrl';
import { generateStudioTemplateImage, getStudioRenderPrice } from '@/apis/adStudio/studioTemplatesApi';
const GENIE_TIMEOUT_MS = 4000;

// "Recreate this ad" for one DS image template, opened from the Ad Creative
// home gallery (AdCreativeNewHome). Template on the left; product images +
// prompt on the right.
//
// Look and preview follow onboarding's sheet (components/BrandSetup/
// RecreateModal.jsx, 2026-09-30 decision): own portal + scrim instead of the
// shadcn Dialog, and a preview box that takes the TEMPLATE's own shape — the
// old fixed half-width box with object-contain left grey bars beside every
// portrait ad. The "More like this" rail is deliberately not included (yet).
//
// Generate: uploaded/pasted files go to S3 first (brand quick-picks are
// already URLs), then POST /adsgpt/ad-studio/templates/generate — rendered like
// onboarding's Recreate (no model/ratio; brand description as context). On
// acceptance the sheet genies into My Space, where the loader card turns into
// the image when it lands (same hand-off as AdLibrary's RecreateAdModal).
// The form is keyed by template and unmounted on close, so every open starts empty.

const MAX_PRODUCT_IMAGES = 3;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PROMPT_MAX = 2000;

// Onboarding's sheet palette, kept identical so the two modals read as one.
// Theme-aware: each is a CSS variable whose light value is the default and
// whose dark value (the original look) applies under html.dark — defined in
// the <style> block at the bottom of RecreateSheet (.recreate-root).
const LINE = 'var(--rc-line)';
const LINE_STRONG = 'var(--rc-line-strong)';
const SURF = 'var(--rc-surf)'; // the sheet
const SURF2 = 'var(--rc-surf2)'; // a control sitting on the sheet
const ACCENT = 'rgba(124,92,255,0.55)';
const EASE = 'cubic-bezier(.4,0,.2,1)';

// Preview stage (same bounds as onboarding): the height a portrait fills and
// the width a landscape fills. The column stays fixed so the form never moves.
const PREVIEW_BAND_H = 560;
const PREVIEW_MAX_W = 560;
const clampAspect = (value) => {
  const a = Number(value);
  if (!Number.isFinite(a) || a <= 0) return 4 / 5;
  return Math.min(Math.max(a, 0.4), 2.4);
};

const isHttpImageUrl = (text) =>
  /^https?:\/\/\S+\.(png|jpe?g|webp)(\?\S*)?$/i.test(String(text || '').trim());

let nextId = 0;
const newId = () => `p${(nextId += 1)}`;

/**
 * The template at its own shape: the box's aspect ratio comes from the loaded
 * image (naturalWidth / naturalHeight), its width from the band, capped. A
 * shimmer holds the space until the image has painted, then it fades in.
 */
function TemplatePreview({ template }) {
  const [aspect, setAspect] = useState(4 / 5);
  const [ready, setReady] = useState(false);
  const imgRef = useRef(null);
  const width = Math.round(Math.min(PREVIEW_MAX_W, PREVIEW_BAND_H * aspect));

  const takeSize = (img) => {
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w > 0 && h > 0) setAspect(clampAspect(w / h));
    setReady(true);
  };

  // The gallery card already loaded this URL, so the browser can have the
  // image complete before React attaches onLoad — which then never fires, and
  // the preview would sit on the shimmer at the placeholder shape. Read the
  // size directly when that happens.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) takeSize(img);
  }, []);

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl bg-[var(--rc-preview)]"
      style={{
        width,
        maxWidth: '100%',
        aspectRatio: String(aspect),
        border: `1px solid ${LINE}`,
        transition: `width 260ms ${EASE}, aspect-ratio 260ms ${EASE}`,
      }}
    >
      {!ready && <div className="recreate-shimmer absolute inset-0" aria-hidden />}
      <img
        ref={imgRef}
        src={template.url}
        alt="Ad template"
        onLoad={(e) => takeSize(e.currentTarget)}
        className="relative h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: ready ? 1 : 0, transitionTimingFunction: EASE }}
      />
    </div>
  );
}

function RecreateSheet({ template, brand, onClose }) {
  const [shown, setShown] = useState(false);
  // [{ id, preview, file?: File, url?: string, source: 'upload' | 'paste' | 'brand' }]
  const [images, setImages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Enter animation, Escape to close, and no page scroll behind the sheet —
  // the same three things onboarding's sheet does on mount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Object URLs for uploaded/pasted files are released when the sheet closes.
  useEffect(
    () => () => {
      imagesRef.current.forEach((img) => img.file && URL.revokeObjectURL(img.preview));
    },
    []
  );

  const brandImages = Array.isArray(brand?.imageUrl) ? brand.imageUrl.filter(Boolean) : [];
  const isFull = images.length >= MAX_PRODUCT_IMAGES;

  const addFiles = (files, source) => {
    const list = Array.from(files || []);
    const valid = list.filter((f) => ACCEPTED_TYPES.includes(f.type));
    const room = MAX_PRODUCT_IMAGES - imagesRef.current.length;
    if (valid.length < list.length) setNotice('Only PNG, JPG or WebP images can be added.');
    else if (valid.length > room) setNotice(`You can add up to ${MAX_PRODUCT_IMAGES} product images.`);
    const added = valid.slice(0, Math.max(room, 0)).map((file) => ({
      id: newId(),
      file,
      preview: URL.createObjectURL(file),
      source,
    }));
    if (!added.length) return;
    imagesRef.current = [...imagesRef.current, ...added];
    setImages(imagesRef.current);
  };

  const addUrl = (url, source) => {
    const current = imagesRef.current;
    if (current.some((img) => img.url === url)) return;
    if (current.length >= MAX_PRODUCT_IMAGES) {
      setNotice(`You can add up to ${MAX_PRODUCT_IMAGES} product images.`);
      return;
    }
    imagesRef.current = [...current, { id: newId(), url, preview: url, source }];
    setImages(imagesRef.current);
  };

  const remove = (id) => {
    const target = imagesRef.current.find((img) => img.id === id);
    if (target?.file) URL.revokeObjectURL(target.preview);
    imagesRef.current = imagesRef.current.filter((img) => img.id !== id);
    setImages(imagesRef.current);
    setNotice('');
  };

  const toggleBrandImage = (url) => {
    const existing = images.find((img) => img.url === url);
    if (existing) remove(existing.id);
    else addUrl(url, 'brand');
  };

  // Paste anywhere while the sheet is open: image files from the clipboard, or
  // a direct image link. Text pasted into the prompt box is left alone.
  //
  // Listened on `document`, not on an element: a paste event fires on the
  // FOCUSED element, which after clicking empty space is not inside any one
  // field. The sheet is modal, so every paste on the page is meant for it.
  const onPaste = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      setNotice('');
      addFiles(files, 'paste');
      return;
    }
    const text = e.clipboardData?.getData('text') || '';
    if (isHttpImageUrl(text)) {
      e.preventDefault();
      setNotice('');
      addUrl(text.trim(), 'paste');
    }
  };

  // Latest handler in a ref, so the listener is attached once per open.
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  useEffect(() => {
    const listener = (e) => onPasteRef.current(e);
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  }, []);

  const userId = useSelector((state) => state.socket.userData?.user_id);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'working'
  const [errorText, setErrorText] = useState('');

  // The exact amount the server will charge (Nano Banana 2 at the medium tier,
  // from the model config in the DB) — asked of the server rather than looked
  // up in the AdCreative model list, whose keys didn't match in every
  // environment. Hidden until it arrives; never guessed.
  const [price, setPrice] = useState(null);
  useEffect(() => {
    let alive = true;
    getStudioRenderPrice()
      .then((credits) => alive && setPrice(credits))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Genie target: the sidebar My Space button, or this zero-size anchor.
  const sheetRef = useRef(null);
  const anchorRef = useRef(null);
  const genieToMySpace = useGenieToMySpace(sheetRef, anchorRef);
  // Same hand-off with no animation (empty refs = navigate only), for the
  // safety net in submit().
  const noRef = useRef(null);
  const goToMySpace = useGenieToMySpace(noRef, noRef);

  const canGenerate = images.length > 0 && Boolean(brand?.id) && phase === 'idle'; // prompt is optional

  const submit = async () => {
    if (!canGenerate) return;
    setPhase('working');
    setErrorText('');
    try {
      // Files → S3; URLs (brand quick-pick, pasted link) are sent as they are.
      // uploadToS3 answers with a root-relative S3 PATH (`/creatives/<user>/x.webp`);
      // DS has to download it, so it is made absolute with the public S3 base
      // (toMediaUrl — the same resolver My Space renders with).
      const productImageUrls = await Promise.all(
        images.map(async (img) => toMediaUrl(img.file ? await uploadToS3(img.file, userId) : img.url))
      );
      if (productImageUrls.some((u) => !/^https?:\/\//i.test(String(u || '')))) {
        throw Object.assign(new Error('upload failed'), {
          userMessage: "Couldn't upload a product image. Please try again.",
        });
      }
      await generateStudioTemplateImage({
        brandId: brand.id,
        templateId: template.template_id,
        templateUrl: template.url,
        productImageUrls,
        prompt: prompt.trim(),
      });
      // Accepted: fly into My Space (closing this sheet as the snapshot is taken).
      // The animation is decoration on a render that is already paid for: its
      // snapshot step (html-to-image) fetches every image in the sheet and has
      // no timeout of its own, so if it has not finished in 4s, close and go to
      // My Space without it rather than leave the user on "Generating…".
      let handedOff = false;
      const animated = genieToMySpace('image', { onCaptured: onClose }).then(() => {
        handedOff = true;
      });
      await Promise.race([animated, new Promise((resolve) => setTimeout(resolve, GENIE_TIMEOUT_MS))]);
      if (!handedOff) {
        onClose();
        await goToMySpace('image');
      }
    } catch (err) {
      setErrorText(
        err?.userMessage ||
          err?.response?.data?.user_message ||
          "Couldn't start the image right now. Please try again in a moment."
      );
      setPhase('idle');
    }
  };

  // Centred both ways. Safe for a tall sheet: it is capped at the overlay's
  // height (max-h-full) and scrolls inside, so centring never clips its top.
  return createPortal(
    <div
      className="recreate-root fixed inset-0 z-[60] flex items-center justify-center overflow-hidden p-4 sm:p-6"
      style={{
        // Both themes: onboarding's heavy tint plus a LIGHT 4px blur (user,
        // 2026-10-06). Kept small on purpose: backdrop blur re-runs every frame
        // over playing media, and its cost grows with the radius.
        background: 'var(--rc-scrim)',
        backdropFilter: 'var(--rc-scrim-blur)',
        WebkitBackdropFilter: 'var(--rc-scrim-blur)',
        opacity: shown ? 1 : 0,
        transition: `opacity 220ms ${EASE}`,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Recreate this ad"
    >
      {/* Genie fallback target if the sidebar's My Space button isn't mounted. */}
      <span ref={anchorRef} aria-hidden className="pointer-events-none fixed right-4 top-[700px] h-0 w-0" />
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="recreate-sheet relative max-h-full w-full max-w-[1120px] overflow-y-auto overscroll-contain rounded-2xl"
        style={{
          background: SURF,
          border: '1px solid var(--rc-sheet-border)',
          boxShadow: 'var(--rc-shadow)',
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.985)',
          transition: `opacity 260ms ${EASE}, transform 300ms ${EASE}`,
        }}
      >
        {/* Sticky close, on the sheet's own background. */}
        <div className="sticky top-0 z-[2] flex items-center justify-end px-5 pt-4 pb-1 sm:px-8" style={{ background: SURF }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-zinc-500 dark:text-white/60 transition duration-200 hover:text-zinc-900 dark:hover:text-white"
            style={{ background: 'var(--rc-chip)', border: `1px solid ${LINE_STRONG}` }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-auto grid w-full max-w-[1040px] gap-7 px-5 pt-2 pb-8 sm:px-8 lg:grid-cols-[minmax(0,560px)_minmax(0,400px)] lg:items-center lg:justify-center lg:gap-12">
          {/* ── Left: the template, at its own shape ── */}
          <div className="flex flex-col gap-3">
            <TemplatePreview template={template} />
            {template.tags?.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {template.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2 py-0.5 text-10 font-semibold tracking-wide text-zinc-500 dark:text-white/60 uppercase"
                    style={{ border: `1px solid ${LINE_STRONG}` }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: the questions ── */}
          <div className="flex min-w-0 flex-col justify-center gap-6">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Recreate this ad</h2>
              <p className="mt-1 text-[13px] text-zinc-500 dark:text-white/60">
                Add your product and we&apos;ll rebuild this ad for {brand?.name || 'your brand'}.
              </p>
            </div>

            {/* Product images */}
            <section className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-white/85">
                  Product images <span className="text-red-400">*</span>
                </h3>
                <span className="text-xs text-zinc-500 dark:text-white/50">
                  {images.length} of {MAX_PRODUCT_IMAGES} added
                </span>
              </div>

              <div className="flex flex-wrap gap-2.5">
                {images.map((img) => (
                  <div key={img.id} className="relative">
                    <img
                      src={img.preview}
                      alt="Product"
                      className="h-[86px] w-[86px] rounded-lg object-cover"
                      style={{ border: `1px solid ${LINE_STRONG}` }}
                    />
                    <button
                      type="button"
                      onClick={() => remove(img.id)}
                      aria-label="Remove image"
                      className="absolute -top-2 -right-2 grid h-5 w-5 cursor-pointer place-items-center rounded-full text-zinc-600 dark:text-white/70 shadow-md transition duration-200 hover:text-zinc-900 dark:hover:text-white"
                      style={{ background: 'var(--rc-remove)', border: `1px solid ${LINE_STRONG}` }}
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={3} />
                    </button>
                  </div>
                ))}

                {!isFull && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      setNotice('');
                      addFiles(e.dataTransfer?.files, 'upload');
                    }}
                    className={cn(
                      'flex min-h-[86px] min-w-[86px] flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-4 text-center transition-all duration-200'
                    )}
                    style={{
                      background: dragging ? 'rgba(124,92,255,0.10)' : SURF2,
                      border: `1px dashed ${dragging ? ACCENT : LINE_STRONG}`,
                      transitionTimingFunction: EASE,
                    }}
                  >
                    <span
                      className="grid h-8 w-8 place-items-center rounded-full"
                      style={{ background: 'var(--rc-chip)', border: `1px solid ${LINE_STRONG}` }}
                    >
                      <ImagePlus className="h-4 w-4 text-zinc-600 dark:text-white/70" />
                    </span>
                    <span className="text-[13px] font-semibold text-zinc-700 dark:text-white/80">Upload product</span>
                    {/* Paste is caught document-wide while the modal is open (no
                        click needed); clicking this box opens the file picker. */}
                    <span className="text-[12px] text-zinc-500 dark:text-white/55">Click to browse · or drop, or press Ctrl+V anywhere</span>
                    <span className="text-[11px] text-zinc-400 dark:text-white/40">PNG, JPG or WebP</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(',')}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setNotice('');
                    addFiles(e.target.files, 'upload');
                    e.target.value = '';
                  }}
                />
              </div>

              {brandImages.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-zinc-500 dark:text-white/50">Or pick from {brand?.name || 'your brand'}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {brandImages.map((url) => {
                      const selected = images.some((img) => img.url === url);
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => toggleBrandImage(url)}
                          disabled={!selected && isFull}
                          aria-pressed={selected}
                          className="relative h-12 w-12 cursor-pointer overflow-hidden rounded-md disabled:cursor-not-allowed disabled:opacity-40"
                          style={{ border: `2px solid ${selected ? '#7c5cff' : 'transparent'}` }}
                        >
                          <img src={url} alt="Brand product" className="h-full w-full object-cover" />
                          {selected && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Check className="h-4 w-4 text-white" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {notice && <p className="text-xs text-amber-400">{notice}</p>}
            </section>

            {/* Prompt (optional — not labelled as such, by decision) */}
            <section className="flex flex-col gap-2.5">
              <label htmlFor="recreate-prompt" className="text-[13px] font-semibold text-zinc-800 dark:text-white/85">
                Prompt
              </label>
              <textarea
                id="recreate-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_MAX))}
                rows={4}
                placeholder="e.g. Put my product in this scene, keep the lighting and layout"
                className="recreate-prompt w-full resize-none rounded-xl px-3.5 py-3 text-[13.5px] leading-relaxed text-zinc-800 dark:text-white/90 outline-none transition-all duration-200 placeholder:text-zinc-400 dark:placeholder:text-white/45"
                style={{ background: SURF2, border: `1px solid ${LINE_STRONG}`, transitionTimingFunction: EASE }}
                onFocus={(e) => {
                  e.target.style.borderColor = ACCENT;
                  e.target.style.boxShadow = '0 0 0 3px rgba(124,92,255,0.14)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = LINE_STRONG;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </section>

            {/* Generate */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={!canGenerate}
                className="relative inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-[10px] px-5 text-[13px] font-bold text-white transition-all duration-200 enabled:hover:brightness-[1.08] enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: 'linear-gradient(180deg,#9176ff 0%,#7c5cff 46%,#6148c7 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.28), 0 8px 20px -12px rgba(124,92,255,0.9)',
                }}
              >
                {phase === 'working' ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate
                    {price > 0 && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[13px] font-semibold text-white/85" data-testid="render-price">
                        <img src={creditIcon} alt="" className="h-3.5 w-3.5" aria-hidden />
                        {price}
                      </span>
                    )}
                  </>
                )}
              </button>
              {images.length === 0 && (
                <p className="text-[12.5px] text-zinc-500 dark:text-white/55">Add a product image to continue.</p>
              )}
            </div>

            {/* Failures only: success closes the sheet into My Space. */}
            {errorText && (
              <div
                role="alert"
                className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed text-zinc-700 dark:text-white/80"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.32)' }}
              >
                {errorText}
              </div>
            )}
          </div>
        </div>

        {/* Local to this sheet (same as onboarding's): hidden scrollbar + the
            travelling shimmer; a keyframe cannot live in a Tailwind class. */}
        <style>{`
          .recreate-sheet { scrollbar-width: none; -ms-overflow-style: none; }
          .recreate-sheet::-webkit-scrollbar { width: 0; height: 0; display: none; }
          /* Light (default) — matched to Ad Library's popup
             (components/AdLibrary/RecreateAdModal.jsx DialogContent + the
             ui/dialog.jsx overlay): sheet #FAF9F6, border #D8D5CC, ring
             black/15 + its shadow, gray-100 fills with black/10 rings inside. */
          .recreate-root {
            --rc-surf: #FAF9F6;
            --rc-sheet-border: #D8D5CC;
            --rc-surf2: #F3F4F6;
            --rc-line: rgba(0,0,0,0.10);
            --rc-line-strong: rgba(0,0,0,0.12);
            --rc-preview: #F3F4F6;
            /* Backdrop = dark mode's exactly (user, 2026-10-06: Ad Library's
               black/30 + blur showed too much of the page behind). */
            --rc-scrim: rgba(6,6,8,0.88);
            --rc-scrim-blur: blur(4px);
            --rc-shadow: 0 0 0 1px rgba(0,0,0,0.15), 0 24px 70px rgba(31,29,41,0.24);
            --rc-chip: rgba(0,0,0,0.05);
            --rc-remove: #ffffff;
            --rc-shimmer-a: rgba(15,15,25,0.04);
            --rc-shimmer-b: rgba(15,15,25,0.09);
          }
          /* Dark — the original values */
          .dark .recreate-root {
            --rc-surf: #17171c;
            --rc-sheet-border: rgba(255,255,255,0.16);
            --rc-scrim-blur: blur(4px);
            --rc-surf2: #1f1f26;
            --rc-line: rgba(255,255,255,0.09);
            --rc-line-strong: rgba(255,255,255,0.16);
            --rc-preview: #101014;
            --rc-scrim: rgba(6,6,8,0.88);
            --rc-shadow: 0 50px 140px -30px rgba(0,0,0,0.92);
            --rc-chip: rgba(255,255,255,0.05);
            --rc-remove: #2a2a32;
            --rc-shimmer-a: rgba(255,255,255,0.035);
            --rc-shimmer-b: rgba(255,255,255,0.085);
          }
          /* App.css styles every light-mode textarea with !important (cream field,
             its own border/placeholder) through selectors with up to six :not() parts.
             The #id here outranks them, keeping the Prompt box on the sheet's own
             surface. Dark mode is untouched by App.css. */
          html:not(.dark) .recreate-root textarea#recreate-prompt {
            background: var(--rc-surf2) !important;
            border: 1px solid var(--rc-line-strong) !important;
            box-shadow: none !important;
            color: #27272a !important;
          }
          html:not(.dark) .recreate-root textarea#recreate-prompt:focus {
            border-color: rgba(124,92,255,0.55) !important;
            box-shadow: 0 0 0 3px rgba(124,92,255,0.14) !important;
          }
          html:not(.dark) .recreate-root textarea#recreate-prompt::placeholder {
            color: #a1a1aa !important;
          }
          .recreate-shimmer {
            background: linear-gradient(100deg, var(--rc-shimmer-a) 20%, var(--rc-shimmer-b) 40%, var(--rc-shimmer-a) 60%);
            background-size: 260% 100%;
            animation: recreateShimmer 1500ms ease-in-out infinite;
          }
          @keyframes recreateShimmer { from { background-position: 160% 0; } to { background-position: -60% 0; } }
        `}</style>
      </div>
    </div>,
    document.body
  );
}

/**
 * @param {object|null} template - `{ template_id, url, tags }` from useStudioTemplates; null = closed
 * @param {object|null} brand    - the header-selected brand (`name`, `imageUrl[]`)
 * @param {() => void} onClose
 */
export default function ImageTemplateModal({ template, brand, onClose }) {
  if (!template) return null;
  return <RecreateSheet key={template.template_id} template={template} brand={brand} onClose={onClose} />;
}
