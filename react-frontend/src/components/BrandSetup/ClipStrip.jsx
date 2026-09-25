// ClipStrip — everything this onboarding has made, along the bottom of the clip
// screen.
//
// The clip view used to show exactly one render and nothing else, so a user who
// had made three ads could only ever see the last one without going back to the
// board. This is the rest of their work, kept one click away.
//
// ── In-flight renders get a card too ───────────────────────────────────────
// Not only finished ones. A render that is still going is the thing the user is
// most curious about, and leaving it out meant the strip visibly disagreed with
// what they had just started. Its card shows a loader, and the moment the clip
// lands the thumbnail CROSSFADES into the real frame rather than popping — the
// card never moves or resizes, so nothing under the cursor jumps.
//
// ── Why the thumbnails are not playing ─────────────────────────────────────
// Each video tile is a paused `<video preload="metadata">`, which paints its
// first frame and nothing more (a `poster` is used when one exists). Autoplaying
// a rail of clips is what made the template dock stutter earlier in this
// project; there is no reason to repeat it for a strip the user is scanning.

import { useEffect, useRef, useState } from 'react';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * @param items     `{ id, title, status, src, poster, isImage }[]`, oldest
 *                  first — the order they were made in, so a card never
 *                  changes place under the user.
 * @param activeId  The render currently on the stage.
 * @param onSelect  Opens that render on the stage.
 */
export default function ClipStrip({ items = [], activeId = '', onSelect }) {
  const railRef = useRef(null);
  const activeRef = useRef(null);

  // Keep the open render in view when it changes from somewhere else — a new
  // render started from the board arrives selected and off-screen otherwise.
  useEffect(() => {
    const el = activeRef.current;
    if (!el || !railRef.current) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeId, items.length]);

  // One card is not a strip — it is the thing already on the stage, restated.
  if (items.length < 2) return null;

  return (
    <div className="shrink-0 px-5 pb-4">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-white/40 uppercase">
        Made in this session
      </p>
      {/* `overflow-x-auto` clips the CROSS axis too, so a card that lifts on
          hover had its top sliced off. The padding is the room it lifts into —
          and the negative margin keeps the row sitting where it did. */}
      <div
        ref={railRef}
        className="clip-strip -mx-1 flex gap-3 overflow-x-auto px-1 pt-2 pb-2"
        role="list"
      >
        {items.map((item, i) => (
          <Card
            key={item.id}
            item={item}
            index={i}
            active={item.id === activeId}
            innerRef={item.id === activeId ? activeRef : undefined}
            onSelect={onSelect}
          />
        ))}
      </div>

      <style>{`
        /* A visible scrollbar under a row of thumbnails reads as a second,
           broken row. The rail still scrolls — by wheel, drag and keyboard. */
        .clip-strip { scrollbar-width: none; }
        .clip-strip::-webkit-scrollbar { display: none; }
        @keyframes clipCardIn {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes clipStripSheen {
          from { background-position: 180% 0; }
          to   { background-position: -80% 0; }
        }
      `}</style>
    </div>
  );
}

function Card({ item, index, active, innerRef, onSelect }) {
  const ready = item.status === 'ready' && Boolean(item.src);
  const failed = item.status === 'failed';

  // Crossfade in only once the bytes are actually decoded. Fading on `src`
  // alone shows an empty box for however long the image takes to arrive.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ready) setShown(false);
  }, [ready, item.src]);

  return (
    <button
      ref={innerRef}
      type="button"
      role="listitem"
      onClick={() => onSelect?.(item.id)}
      title={item.title}
      aria-current={active ? 'true' : undefined}
      className="group relative h-[118px] w-[83px] shrink-0 overflow-hidden rounded-[10px] border bg-[#141418] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15DCFF]"
      style={{
        // The ring is the only thing that says which one is on the stage, so it
        // is a real border rather than an outline that a sibling can overlap.
        borderColor: active ? 'rgba(21,220,255,0.85)' : 'rgba(255,255,255,0.10)',
        boxShadow: active ? '0 0 0 1px rgba(21,220,255,0.45), 0 6px 18px rgba(0,0,0,0.45)' : 'none',
        transitionTimingFunction: EASE,
        // Staggered, and capped: past about ten cards the stagger stops being
        // a flourish and starts being a wait.
        animation: `clipCardIn 320ms ${EASE} both`,
        animationDelay: `${Math.min(index, 10) * 35}ms`,
      }}
    >
      {ready ? (
        item.isImage ? (
          <img
            src={item.src}
            alt=""
            loading="lazy"
            onLoad={() => setShown(true)}
            className="h-full w-full object-cover transition-opacity duration-300"
            style={{ opacity: shown ? 1 : 0, transitionTimingFunction: EASE }}
          />
        ) : (
          <video
            // `#t=0.1` is what makes a frame appear at all. `preload="metadata"`
            // fetches duration and dimensions and NOT a frame, so `loadeddata`
            // never fired and every video card sat at opacity 0 — a strip where
            // the images showed and the clips were blank rectangles. The media
            // fragment asks the browser to seek, which paints one.
            src={item.src ? `${item.src}#t=0.1` : undefined}
            poster={item.poster || undefined}
            muted
            playsInline
            preload="metadata"
            // Both, because which one arrives first differs by browser and by
            // whether a poster was supplied. Either means there is something
            // to show.
            onLoadedData={() => setShown(true)}
            onLoadedMetadata={() => setShown(true)}
            className="h-full w-full object-cover transition-opacity duration-300"
            style={{ opacity: shown ? 1 : 0, transitionTimingFunction: EASE }}
          />
        )
      ) : null}

      {/* Sits UNDER the thumbnail and stays mounted: the loader fading out as
          the frame fades in is what makes the swap read as one movement. */}
      {!ready && (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, rgba(255,255,255,0.04) 20%, rgba(255,255,255,0.10) 40%, rgba(255,255,255,0.04) 60%)',
            backgroundSize: '260% 100%',
            animation: failed ? 'none' : `clipStripSheen 1500ms ease-in-out infinite`,
          }}
        />
      )}

      {failed && (
        <span className="absolute inset-0 grid place-items-center text-[16px] text-white/45">!</span>
      )}

      {/* No caption. At this size it covered the thumbnail it was describing,
          and every card here is one of a handful the user just made — they
          recognise them by sight. The title lives on the `title` attribute for
          anyone who wants it, and the stage names the open one. */}
    </button>
  );
}
