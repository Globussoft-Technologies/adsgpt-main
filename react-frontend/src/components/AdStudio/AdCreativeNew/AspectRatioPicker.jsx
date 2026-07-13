import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

// ----------------------------------------------------------------------------
// Shared aspect-ratio helpers + the redesigned "visual tiles" panel used by
// every AdCreative image surface (AiCreativesCustom, AdSetupStep,
// RecreateAdModal). Each parent keeps its own pill + open/close coordination;
// this owns the panel body (header, credits, tiles grid, cap note) and the
// per-ratio count logic. Controlled via `counts` / `onChange`.
//
// Ratios come from the backend `ad_creative` surface (per-model). Each tile
// draws a frame shaped to the ratio so 14 options stay scannable.
// ----------------------------------------------------------------------------

// Human descriptions are presentation-only, with a fallback to the raw key.
export const RATIO_DESCRIPTIONS = {
  '1:1': 'square',
  '4:5': 'portrait',
  '9:16': 'vertical',
  '2:3': 'portrait',
  '3:4': 'portrait',
  '16:9': 'widescreen',
  '21:9': 'ultrawide',
  '3:2': 'landscape',
  '4:3': 'landscape',
  '5:4': 'landscape',
  '1:4': 'tall strip',
  '4:1': 'wide strip',
  '1:8': 'tall banner',
  '8:1': 'wide banner',
};
export const ratioLabel = (key) =>
  RATIO_DESCRIPTIONS[key] ? `${key} (${RATIO_DESCRIPTIONS[key]})` : key;

// Max images the user can request per single ratio.
export const MAX_PER_RATIO = 4;

export const totalImages = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
export const primaryRatio = (counts) => Object.keys(counts).find((k) => counts[k] > 0) || '1:1';

// Shape a tile's frame to the ratio: constrain by width for landscape/square,
// by height for portrait, so each ratio renders visibly different inside its
// fixed square slot (only ONE dimension is pinned — pinning both forces a
// square and every frame looks identical).
const frameStyle = (key) => {
  const [w, h] = String(key).split(':').map(Number);
  const width = w || 1;
  const height = h || 1;
  const wide = width >= height;
  return {
    aspectRatio: `${width} / ${height}`,
    width: wide ? '100%' : 'auto',
    height: wide ? 'auto' : '100%',
    maxWidth: '100%',
    maxHeight: '100%',
  };
};

export default function AspectRatioTiles({
  counts,
  onChange,
  ratios = [],
  creditsPerImage,
  maxPerRatio = MAX_PER_RATIO,
}) {
  const total = totalImages(counts);
  const gridRef = useRef(null);
  const menuRef = useRef(null);
  const closeTimer = useRef(null);
  // menu: { key, left, top?, bottom?, below } — positioned as a portal (fixed)
  // so the scrollable grid + the form's backdrop-blur don't clip it.
  const [menu, setMenu] = useState(null);
  const [visible, setVisible] = useState(false); // drives the open/close animation

  const MENU_W = 112;

  const openMenu = (key, el) => {
    clearTimeout(closeTimer.current);
    const r = el.getBoundingClientRect();
    const estH = (maxPerRatio + 1) * 34 + 10;
    const below = r.bottom + estH + 8 <= window.innerHeight;
    setMenu({
      key,
      below,
      left: Math.max(8, r.left + r.width / 2 - MENU_W / 2),
      top: below ? r.bottom + 6 : undefined,
      bottom: below ? undefined : window.innerHeight - r.top + 6,
    });
    // Double rAF so the closed state paints first, otherwise the enter
    // transition is skipped and the menu just pops in.
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  };

  const closeMenu = () => {
    setVisible(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 200); // matches exit duration
  };

  // Close on outside click (excluding the grid + the portalled menu) and on
  // scroll / resize (the fixed position would otherwise go stale).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (gridRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      closeMenu();
    };
    const onScrollResize = () => closeMenu();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [menu]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const optionLabel = (n) => (n === 0 ? 'None' : `${n} image${n > 1 ? 's' : ''}`);

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[13px] font-medium text-gray-900 dark:text-[#d9d9d9]">Aspect Ratio per Image</p>
        <span className="text-[12px] text-gray-500 dark:text-white/60">
          Total: <span className="font-medium text-gray-900 dark:text-white">{total}</span>
        </span>
      </div>
      <p className="mb-3 text-[11px] text-gray-500 dark:text-white/50">{creditsPerImage} credits per image</p>

      <div ref={gridRef} className="grid max-h-[264px] grid-cols-3 gap-2 overflow-y-auto pr-1">
        {ratios.map((key) => {
          const count = counts[key] || 0;
          const active = count > 0;
          const open = menu?.key === key;
          return (
            <button
              key={key}
              type="button"
              onClick={(e) => (open ? closeMenu() : openMenu(key, e.currentTarget))}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-label={`${ratioLabel(key)}${count ? `, ${count} selected` : ''}`}
              className={`relative flex w-full flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                open ? 'border-[#3ad0c8] ring-2 ring-[#3ad0c8]/40' : active ? 'border-[#3ad0c8]' : 'border-black/10 hover:border-[#3ad0c8]/60 dark:border-white/10 dark:hover:border-[#3ad0c8]/60'
              } ${active ? 'bg-[#3ad0c8]/10' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}
            >
              {count > 0 && (
                <span className="absolute right-1 top-1 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#3ad0c8] px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                  {count}
                </span>
              )}
              <div className="mt-1 flex h-9 w-9 items-center justify-center">
                <div
                  className={`rounded-[3px] border ${active ? 'border-[#3ad0c8] bg-[#3ad0c8]/25' : 'border-gray-400 dark:border-white/50'}`}
                  style={frameStyle(key)}
                />
              </div>
              <span className="flex items-center gap-0.5 text-[11px] font-medium text-gray-800 dark:text-white/90">
                {key}
                <ChevronDown size={11} className={`text-gray-400 transition-transform dark:text-white/50 ${open ? 'rotate-180' : ''}`} />
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-right text-[10px] text-gray-500 dark:text-white/40">Click a ratio to set quantity · max {maxPerRatio} each</p>

      {/* Quantity dropdown — portalled + fixed so the scroll container never clips it. */}
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            data-aspect-quantity-menu=""
            style={{ position: 'fixed', left: menu.left, top: menu.top, bottom: menu.bottom, width: MENU_W }}
            className={`z-[80] overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-xl ring-1 ring-black/5 transition-all duration-200 ease-out will-change-transform dark:border-white/10 dark:bg-[#232323] dark:ring-white/5 ${
              menu.below ? 'origin-top' : 'origin-bottom'
            } ${
              visible
                ? 'translate-y-0 scale-100 opacity-100'
                : `${menu.below ? '-translate-y-1' : 'translate-y-1'} scale-95 opacity-0`
            }`}
          >
            {Array.from({ length: maxPerRatio + 1 }, (_, n) => n).map((n) => {
              const selected = (counts[menu.key] || 0) === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange({ ...counts, [menu.key]: n });
                    closeMenu();
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors ${
                    selected
                      ? 'bg-[#3ad0c8]/15 font-semibold text-gray-900 dark:text-white'
                      : 'text-gray-600 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5'
                  }`}
                >
                  <span>{optionLabel(n)}</span>
                  {selected && <Check size={13} className="text-[#3ad0c8]" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

// Animated open/close wrapper for the aspect-ratio popover panel. Parents keep
// their own `open` state + outside-click; this only handles the enter/exit
// animation so every surface's panel opens like the tile dropdown.
export function AnimatedPanel({ open, className = '', children }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    timer.current = setTimeout(() => setMounted(false), 200);
    return undefined;
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!mounted) return null;
  return (
    <div
      className={`${className} origin-bottom transition-all duration-200 ease-out will-change-transform ${
        visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1 scale-95 opacity-0'
      }`}
    >
      {children}
    </div>
  );
}
