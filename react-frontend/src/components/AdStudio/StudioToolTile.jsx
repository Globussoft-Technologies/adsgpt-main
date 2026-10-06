import React, { useRef } from 'react';
import { ArrowRight } from 'lucide-react';

// Compact "tool" tile for the Ad Creative / Ad Video home screens.
//
// Tools = glass tile, text first, small media window, ambient glow taken from
// the tool's own thumbnail. Templates (below, on the sheet) = pure media.
// Light + dark: follows the app's existing `dark` class on <html> (the
// Light/Dark switch in Account). Page backgrounds are not touched.
// Same assets as before: `img` is the still, `gif` plays on hover (mp4/webm too).

const isVideo = (url) => typeof url === 'string' && /\.(mp4|webm|mov)(\?.*)?$/i.test(url);

export default function StudioToolTile({
  id,
  title,
  desc,
  img,
  gif,
  onClick,
  disabled = false,
  badge = null,
  className = '',
}) {
  const videoRef = useRef(null);
  const play = () => videoRef.current?.play().catch(() => {});
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 2;
  };
  const still = isVideo(img) ? null : img;

  return (
    <button
      type="button"
      id={id}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={play}
      onMouseLeave={stop}
      aria-disabled={disabled || undefined}
      className={`group relative isolate flex h-full w-full items-center gap-2.5 overflow-hidden rounded-2xl border p-2 pr-2.5 text-left 2xl:gap-3
        transition-[transform,border-color,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]
        border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04),0_4px_14px_-6px_rgba(24,24,27,0.08)]
        dark:border-white/[0.06] dark:bg-transparent dark:bg-gradient-to-b dark:from-white/[0.045] dark:to-white/[0.012]
        dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]
        ${disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:-translate-y-0.5 hover:border-[#5057d6]/45 hover:shadow-[0_18px_40px_-16px_rgba(80,87,214,0.45)] dark:hover:border-[#6b72f8]/60 dark:hover:shadow-[0_16px_40px_-14px_rgba(80,87,214,0.6)]'}
        ${className}`}
    >
      {/* Ambient glow from the tool's own image */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[40%] -z-10 bg-cover bg-center opacity-[0.14] blur-[40px] saturate-150 transition-opacity duration-500 group-hover:opacity-30 dark:opacity-20 dark:group-hover:opacity-45"
        style={{
          backgroundImage: still ? `url("${still}")` : 'linear-gradient(135deg,#15DCFF,#6b72f8)',
        }}
      />

      {/* Media window: still → hover preview. Height follows the tile (which
          scales with the window, see TOOL_SLOT); width follows at 3:5. */}
      <span className="relative block aspect-3/5 h-full shrink-0 overflow-hidden rounded-[10px] bg-zinc-200 shadow-[0_6px_16px_rgba(24,24,27,0.18)] dark:bg-[#0f0f0f] dark:shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
        {isVideo(gif) ? (
          <video
            ref={videoRef}
            src={`${gif}#t=2`}
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
          />
        ) : (
          <>
            <img
              src={img}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.07] group-hover:opacity-0"
            />
            <img
              src={gif}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-0 transition-[opacity,transform] duration-500 group-hover:scale-[1.07] group-hover:opacity-100"
            />
          </>
        )}
      </span>

      {/* Text, then a footer row: badge (Premium / Coming Soon) + Create. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Six tiles at 1440px leave ~95px for text: below 2xl the title is 13px so
            "Product B-Rolls" fits on one line; line-clamp-2 is the fallback. */}
        <span className="line-clamp-2 text-[13px] leading-tight 2xl:text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</span>
        {/* One line when a badge shares the footer, so the tile never overflows. */}
        <span className={`${badge ? 'line-clamp-1' : 'line-clamp-2'} text-xs leading-snug text-zinc-500 dark:text-zinc-400`}>{desc}</span>
        {(badge || !disabled) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {badge}
            {!disabled && <CreatePill />}
          </span>
        )}
      </span>
    </button>
  );
}

// The "Create" button the old full-image cards had (CreateCardButton), restyled
// for the tile: a quiet outlined pill at rest that fills with the brand gradient
// and nudges its arrow on tile hover. Not a <button> — the whole tile is the
// button; this is its label. The gradient is a separate layer faded in, and uses
// `bg-linear-to-r` because App.css blanks light-mode `rounded-full bg-gradient-to-*`.
function CreatePill() {
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-[3px] text-[11px] font-semibold text-zinc-700 transition-colors duration-200 group-hover:border-transparent group-hover:text-white dark:border-white/15 dark:bg-white/[0.06] dark:text-white/90">
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-r from-[#0c9fbd] to-[#5057d6] opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:from-[#15DCFF] dark:to-[#6b72f8]"
      />
      <span className="relative">Create</span>
      <ArrowRight className="relative h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
    </span>
  );
}

// Heading above the tools. Replaces the "Hello, {userName}" greeting.
// (The "N tools" count on the right was removed 2026-10-01, user request.)
export function StudioToolHeader({ kind = 'image' }) {
  return (
    // Centred over the tool stage (stage update 2026-10-05).
    <div className="mb-5 text-center 2xl:mb-6">
      <div>
        <h1 className="text-2xl leading-tight font-bold tracking-tight text-zinc-900 2xl:text-[28px] dark:text-white">
          Create {kind === 'video' ? 'a ' : 'an '}
          <span className="bg-gradient-to-r from-[#0c9fbd] to-[#5057d6] bg-clip-text text-transparent dark:from-[#15DCFF] dark:to-[#6b72f8]">
            {kind === 'video' ? 'video ad' : 'image ad'}
          </span>
        </h1>
        <p className="mx-auto mt-1.5 max-w-xl text-[13px] text-zinc-500 dark:text-zinc-400">
          Pick a tool to get started. Each one walks you through it.
        </p>
      </div>
    </div>
  );
}

// The tool row, responsive:
//   < md   one sideways-swiping row (tiles 240px–78vw, snap), as on a phone a
//          grid of tiles this wide would leave ~45px for text;
//   md–    3 columns, wrapping (5 tools → 3 + 2, 6 → 3 + 3);
//   one row from 1280px for up to 5 tools, from 1360px (85rem — rem, so Tailwind
//   orders it after md:) for 6. At 1280 six
//   tiles left ~80px for text and "Product B-Rolls" / "Clone Yourself" wrapped.
// `overflow-x-auto` also clips vertically, which cut off a hovered tile's lift
// and glow; the padding gives it room and the negative margins cancel it out.
const ONE_ROW_5 = 'xl:grid-cols-[repeat(var(--tool-cols),minmax(0,1fr))]';
const ONE_ROW_6 = 'min-[85rem]:grid-cols-[repeat(var(--tool-cols),minmax(0,1fr))]';

export function StudioToolRow({ count, children, className = '' }) {
  return (
    <div className={`-mx-1.5 -mt-1.5 -mb-3 w-[calc(100%+0.75rem)] snap-x scroll-px-1.5 overflow-x-auto scrollbar-none px-1.5 pt-1.5 pb-3 md:snap-none ${className}`}>
      <div
        className={`grid auto-cols-[minmax(240px,78vw)] grid-flow-col gap-2.5 md:auto-cols-auto md:grid-flow-row md:grid-cols-3 ${count > 5 ? ONE_ROW_6 : ONE_ROW_5}`}
        style={{ '--tool-cols': count }}
      >
        {children}
      </div>
    </div>
  );
}

// Tile height scales with the window: 15vh, between 112px and 136px
// (136 = 129 + 5%, user 2026-10-01; 129 was 112 + 15%). The media window
// follows it. `snap-start` is for the phone swipe row.
export const TOOL_SLOT = 'h-[clamp(112px,15vh,136px)] snap-start';
