/**
 * One-click image tools for the onboarding clip screen, and the canvas helpers
 * they share with the download-format picker.
 *
 *   FitToPlacement — put the whole ad on a 1:1 / 4:5 / 9:16 / 1.91:1 canvas
 *                    WITHOUT cropping it; the gap is a blurred copy of the ad
 *                    or a solid colour. One image, every Meta placement.
 *   QuickLogo      — a brand logo in a chosen corner at a chosen size, with no
 *                    drag editor. The full editor (`MySpaceLogoEditor`) is
 *                    still there for anything more exact.
 *
 * Both are plain 2D canvas, no Konva and no Filerobot: each is one draw call
 * repeated on every change, and a preview that IS the export means what the
 * user sees is exactly what gets saved.
 *
 * Opened from `ImageEditPanel`; `onSaved(key)` goes through the same path as
 * every other edit there (My Space record + new strip card).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadToS3 } from '@/utils/imageUpload';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { proxied } from '../AdStudio/AdVideoNew/pages/MySpaceLogoEditor';

const SURF = '#131317';
const SURF2 = '#232329';
const LINE = 'rgba(255,255,255,0.09)';
const LINE_STRONG = 'rgba(255,255,255,0.16)';
const ACCENT = '#15DCFF';

/* ── canvas helpers ──────────────────────────────────────────────────────── */

/**
 * Load an image the canvas is allowed to export. Through the CORS proxy, with
 * `crossOrigin`, for the same reason the logo editor does it: a canvas that has
 * drawn a cross-origin image without CORS throws on `toBlob`.
 */
export function loadCanvasImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = /^(blob:|data:)/.test(url) ? url : proxied(url);
  });
}

/** `canvas.toBlob` as a promise. `quality` only matters for JPEG/WebP. */
export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), type, quality)
  );
}

/** Save a blob as a file on the user's machine. */
export function downloadBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick — some browsers read the URL after `click()` returns.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** Upload a finished canvas; resolves to the S3 key (see `toMediaUrl`). */
async function uploadCanvas(canvas, userId, name) {
  const blob = await canvasToBlob(canvas, 'image/png');
  // `isUser = true`: no legacy uploads-collection row; the caller files it in
  // My Space itself (see OnboardingImageEditor for the same choice).
  const key = await uploadToS3(new File([blob], name, { type: 'image/png' }), userId, true);
  if (!key) throw new Error('upload returned no url');
  return key;
}

/* ── the shared modal shell ──────────────────────────────────────────────── */

/**
 * Preview on the left, controls on the right, Save/Cancel at the foot. The
 * preview is the export canvas itself, scaled down by CSS.
 */
function ToolModal({ title, canvasRef, loading, error, saving, onSave, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border"
        style={{ background: SURF, borderColor: LINE_STRONG }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: LINE }}>
          <h2 className="text-[14px] font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded p-1 text-white/60 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 md:flex-row">
          <div
            className="grid min-h-[260px] flex-1 place-items-center rounded-xl border p-3"
            style={{
              borderColor: LINE,
              // A checkerboard, so a transparent area reads as transparent.
              background:
                'repeating-conic-gradient(#1b1b21 0% 25%, #16161b 0% 50%) 50% / 18px 18px',
            }}
          >
            {error ? (
              <p className="text-[12.5px] text-white/70">{error}</p>
            ) : (
              <>
                {loading && <p className="text-[12.5px] text-white/60">Loading image…</p>}
                <canvas
                  ref={canvasRef}
                  className="max-h-[62vh] max-w-full rounded-md shadow-lg"
                  style={{ display: loading ? 'none' : 'block' }}
                />
              </>
            )}
          </div>
          <div className="flex w-full shrink-0 flex-col gap-5 md:w-[260px]">{children}</div>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: LINE }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold text-white/70 hover:text-white"
            style={{ background: SURF2, borderColor: LINE_STRONG }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || loading || Boolean(error)}
            className="rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: 'rgba(21,220,255,0.12)', borderColor: 'rgba(21,220,255,0.4)', color: ACCENT }}
          >
            {saving ? 'Saving…' : 'Save as new image'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** A label over a row of pill choices. */
function Choice({ label, options, value, onChange }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className="rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition"
              style={{
                background: on ? 'rgba(21,220,255,0.12)' : SURF2,
                borderColor: on ? 'rgba(21,220,255,0.45)' : LINE_STRONG,
                color: on ? ACCENT : 'rgba(255,255,255,0.75)',
              }}
            >
              {o.label}
              {o.hint && <span className="ml-1 font-normal text-white/45">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Load one image for a tool; `{ img, error }`. */
function useCanvasImage(src) {
  const [state, setState] = useState({ img: null, error: '' });
  useEffect(() => {
    let live = true;
    setState({ img: null, error: '' });
    if (!src) return undefined;
    loadCanvasImage(src)
      .then((img) => live && setState({ img, error: '' }))
      .catch(() => live && setState({ img: null, error: 'Couldn’t load this image.' }));
    return () => {
      live = false;
    };
  }, [src]);
  return state;
}

/** Shared save: upload the canvas, hand back the key, report failures. */
function useCanvasSave(canvasRef, name, onSaved) {
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!canvasRef.current || saving) return;
    setSaving(true);
    try {
      onSaved(await uploadCanvas(canvasRef.current, userId, name));
    } catch (err) {
      console.error('[onboarding] quick tool save failed:', err);
      toast.error('Couldn’t save your edit. Try again.');
      setSaving(false);
    }
  };
  return { saving, save };
}

/* ── Fit to placement ────────────────────────────────────────────────────── */

const PLACEMENTS = [
  { value: 1, label: 'Square', hint: '1:1' },
  { value: 4 / 5, label: 'Feed', hint: '4:5' },
  { value: 9 / 16, label: 'Story', hint: '9:16' },
  { value: 1.91, label: 'Landscape', hint: '1.91:1' },
];

const FILLS = [
  { value: 'blur', label: 'Blurred' },
  { value: 'solid', label: 'Solid colour' },
];

/** Longest side of an export. Past this the file grows and Meta downsizes it anyway. */
const MAX_SIDE = 2400;

/**
 * Draw `img` blurred and scaled to COVER the canvas.
 *
 * Downscale-then-upscale rather than `ctx.filter = 'blur()'`: Safari only
 * shipped canvas filters recently, and an unsupported filter is silently
 * ignored — the "blurred" background would be a sharp, cropped duplicate of the
 * ad, which looks like a mistake. Scaling to ~1/24 and back blurs everywhere.
 */
function drawBlurredCover(ctx, img, W, H) {
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(W / 24));
  small.height = Math.max(1, Math.round(H / 24));
  const sctx = small.getContext('2d');
  sctx.drawImage(img, (W - w) / 2 / 24, (H - h) / 2 / 24, w / 24, h / 24);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  // A dark wash, so the ad in front is the thing the eye lands on.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, W, H);
}

export function FitToPlacement({ src, onSaved, onClose }) {
  const canvasRef = useRef(null);
  const { img, error } = useCanvasImage(src);
  const [ratio, setRatio] = useState(4 / 5);
  const [fill, setFill] = useState('blur');
  const [color, setColor] = useState('#ffffff');
  const { saving, save } = useCanvasSave(canvasRef, 'fit-placement.png', onSaved);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    // The canvas is sized so the ad lands at its OWN resolution — it is only
    // ever padded, never scaled down — then capped.
    let W = iw / ih > ratio ? iw : ih * ratio;
    let H = W / ratio;
    const cap = Math.min(1, MAX_SIDE / Math.max(W, H));
    W = Math.round(W * cap);
    H = Math.round(H * cap);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (fill === 'blur') drawBlurredCover(ctx, img, W, H);
    else {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
    }
    const s = Math.min(W / iw, H / ih);
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }, [img, ratio, fill, color]);

  return (
    <ToolModal
      title="Fit to placement"
      canvasRef={canvasRef}
      loading={!img && !error}
      error={error}
      saving={saving}
      onSave={save}
      onClose={onClose}
    >
      <p className="text-[12px] leading-relaxed text-white/60">
        Your whole ad on a new shape — nothing is cropped. The space around it is filled for you.
      </p>
      <Choice label="Placement" options={PLACEMENTS} value={ratio} onChange={setRatio} />
      <Choice label="Fill" options={FILLS} value={fill} onChange={setFill} />
      {fill === 'solid' && (
        <label className="flex items-center gap-3 text-[12.5px] text-white/75">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
          />
          {color.toUpperCase()}
        </label>
      )}
    </ToolModal>
  );
}

/* ── Quick logo ──────────────────────────────────────────────────────────── */

const CORNERS = [
  { value: 'tl', label: 'Top left' },
  { value: 'tc', label: 'Top centre' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'bc', label: 'Bottom centre' },
  { value: 'br', label: 'Bottom right' },
];

export function QuickLogo({ src, onSaved, onClose }) {
  const dispatch = useDispatch();
  const userId = useSelector((s) => s.socket?.userData?.user_id);
  const myBrands = useSelector((s) => s.brandIQTabs?.myBrands);
  const canvasRef = useRef(null);
  const { img, error } = useCanvasImage(src);

  // The same list the logo editor offers — every logo on every brand.
  useEffect(() => {
    if (userId && !(Array.isArray(myBrands) && myBrands.length)) dispatch(fetchBrands(userId));
  }, [dispatch, userId, myBrands]);
  const logos = useMemo(
    () =>
      (Array.isArray(myBrands) ? myBrands : []).flatMap((b) =>
        (b?.logoUrls || []).map((url) => ({ url, name: b?.name || 'Logo' }))
      ),
    [myBrands]
  );

  const [logoUrl, setLogoUrl] = useState('');
  const [upload, setUpload] = useState(''); // a blob: URL from "Upload"
  const [corner, setCorner] = useState('tr');
  const [size, setSize] = useState(18); // % of the ad's width
  const chosen = upload || logoUrl || logos[0]?.url || '';
  const { img: logo, error: logoError } = useCanvasImage(chosen);
  const { saving, save } = useCanvasSave(canvasRef, 'logo-corner.png', onSaved);

  useEffect(() => () => upload && URL.revokeObjectURL(upload), [upload]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    if (!logo) return;
    const lw = (W * size) / 100;
    const lh = lw * (logo.naturalHeight / logo.naturalWidth);
    // One margin for every corner, off the SHORTER side, so a tall story and a
    // wide banner get the same visual breathing room.
    const m = Math.min(W, H) * 0.04;
    const x = corner.endsWith('l') ? m : corner.endsWith('r') ? W - lw - m : (W - lw) / 2;
    const y = corner.startsWith('t') ? m : H - lh - m;
    ctx.drawImage(logo, x, y, lw, lh);
  }, [img, logo, corner, size]);

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/webp';
    input.onchange = (e) => {
      const f = e.target.files?.[0];
      if (f) setUpload(URL.createObjectURL(f));
    };
    input.click();
  };

  return (
    <ToolModal
      title="Quick logo"
      canvasRef={canvasRef}
      loading={!img && !error}
      error={error}
      saving={saving}
      onSave={save}
      onClose={onClose}
    >
      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">Logo</p>
        <div className="flex flex-wrap gap-2">
          {logos.map((l) => {
            const on = !upload && chosen === l.url;
            return (
              <button
                key={l.url}
                type="button"
                title={l.name}
                onClick={() => {
                  setUpload('');
                  setLogoUrl(l.url);
                }}
                className="grid h-14 w-14 place-items-center rounded-lg border p-1.5"
                style={{
                  background: '#ffffff10',
                  borderColor: on ? 'rgba(21,220,255,0.6)' : LINE_STRONG,
                }}
              >
                <img src={l.url} alt={l.name} className="max-h-full max-w-full object-contain" />
              </button>
            );
          })}
          <button
            type="button"
            onClick={pickFile}
            className="h-14 rounded-lg border border-dashed px-3 text-[12px] font-semibold text-white/70 hover:text-white"
            style={{ borderColor: upload ? 'rgba(21,220,255,0.6)' : LINE_STRONG }}
          >
            {upload ? 'Uploaded ✓' : 'Upload'}
          </button>
        </div>
        {!logos.length && !upload && (
          <p className="mt-2 text-[11.5px] text-white/50">No brand logos yet — upload one.</p>
        )}
        {logoError && <p className="mt-2 text-[11.5px] text-[#FF7A7A]">Couldn’t load that logo.</p>}
      </div>

      <Choice label="Position" options={CORNERS} value={corner} onChange={setCorner} />

      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">
          Size <span className="font-normal tracking-normal normal-case text-white/45">{size}% of width</span>
        </p>
        <input
          type="range"
          min={8}
          max={40}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-full accent-[#15DCFF]"
        />
      </div>
    </ToolModal>
  );
}
