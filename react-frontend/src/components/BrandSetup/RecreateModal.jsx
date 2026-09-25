// Recreate a reference template — the modal behind the Recreate button on a
// template tile in the workspace dock.
//
// Both halves are live:
//
//   • the "More like this" rail IS real — `GET /onboarding/templates/:id/similar`,
//     Node's proxy for the contract's fixed-anchor search
//     (TEMPLATE_RECOMMENDATIONS_API_CONTRACT §"Similar templates"). Node flattens
//     upstream's ranked `results[]` into the flat tile shape this file already
//     rendered, so nothing here knows about two shapes. When the search has not
//     answered, or fails, the rail falls back to the session's own templates —
//     silently, by decision: a working screen beats an explained broken one.
//   • Recreate is real too, as of 2026-09-23 —
//     `POST /onboarding/sessions/:id/templates/:templateId/recreate`, multipart.
//     The product image is REQUIRED: the template lends composition and style,
//     and the upload is what the ad is actually of. The route answers 202 with a
//     job id; this sheet's job ends at "it started", and the workspace follows
//     the job from there.
//
// Everything above the divider is the form; everything below it is the rail.
// Layout chosen 2026-09-22 with Bharath: form on top, rail full-width beneath,
// so the rail gets the whole width for a masonry rather than a narrow column.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import creditIcon from '@/assets/layouts/profile/adcreative.svg';
import SplitChargeDialog from './SplitChargeDialog';
import { getSimilarTemplates, recreateFromTemplate } from '@/apis/onboarding/onboardingApi';

const LINE = 'rgba(255,255,255,0.09)';
const LINE_STRONG = 'rgba(255,255,255,0.16)';
const SURF = '#17171c'; // the sheet
const SURF2 = '#1f1f26'; // a control sitting on the sheet

// What one recreate costs, per corpus. These mirror the server:
// `renderBilling.templateAdCeiling()` — an image is one credit (Nano Banana 2
// at the low tier), a video is 32 (`veo-3.1-fast` x 8s).
//
// Duplicated here because `/eligibility` answers with the BUDGET, not with
// prices. `Workspace` holds the same 32 for the same reason; a third copy of
// either number is the signal to have the server send them.
const RECREATE_COST = { image: 1, video: 32 };
/* TEMPORARY (2026-09-24, Bharath) — the Recreate button's credit badge. Its
   twin lives in Workspace.jsx for the Generate buttons; kept as two constants
   because this sheet is imported by that file and importing back would be a
   cycle. Flip BOTH to bring the prices back. Billing is untouched either way,
   and SplitChargeDialog still states the charge before it is taken. */
const HIDE_RENDER_PRICE = true;

// Page sizes, per corpus.
//
// The image leg is asked for twenty up front and eight after that: it is the
// cheap one (~380ms against the video leg's ~2.4s) and image tiles are shorter,
// so far more of them fit in the first screen of the rail.
//
// Video stays at eight throughout: that leg is the slow one, and its wait is
// paid before anything at all appears.
const FIRST_PAGE = { image: 80, video: 8 };
const NEXT_PAGE = 8;

// A hard ceiling on how far the rail will page. Not a product limit — a
// circuit breaker. Upstream's end-of-list signals are what SHOULD stop this,
// and when one of them is wrong the sentinel will ask forever; this is the
// stop that does not depend on upstream being right.
const MAX_PAGES = 6;

// The rail packs at the dock's own gap. Deliberately the same number as
// `GAP_PX` in Workspace's TemplateDock: the two walls sit one on top of the
// other, and a looser one over a tighter one reads as a different component.
const RAIL_GAP_PX = 6;

// The shapes the skeleton stands in for. Mixed on purpose: the real rail is a
// wall of 9:16, 4:5 and 16:9 side by side, and a grid of identical rectangles
// would promise a tidiness the answer does not have.
const SKELETON_RATIOS = [
  9 / 16, 4 / 5, 16 / 9, 9 / 16, 1, 9 / 16,
  4 / 5, 9 / 16, 16 / 9, 9 / 16, 4 / 5, 1,
];

const EASE = 'cubic-bezier(.4,0,.2,1)';

/* ── bits ───────────────────────────────────────────────────────────────────*/

/**
 * A field label.
 *
 * 13px semibold at 70% white, not 11px bold at 45%. The old one measured
 * 4.47:1 against the sheet — AA only if you round it up — and 11px with
 * 0.16em of tracking is the size at which letter-spacing stops being style and
 * starts being smear. The tracking is halved for the same reason: it has to
 * survive at a size people can actually read.
 */
function SectionLabel({ children, right = null }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h3 className="text-[13px] font-semibold tracking-[0.08em] text-white/70 uppercase">
        {children}
      </h3>
      {right}
    </div>
  );
}

/**
 * The template you clicked, playing — at ITS OWN shape.
 *
 * Its own element rather than the dock's `TemplateTile`, because a tile is a
 * thumbnail with a hover story and a Recreate button of its own — none of which
 * belongs on the hero of a modal that IS the recreate.
 *
 * ── Why the box is not a fixed ratio ────────────────────────────────────────
 * It used to be 2:3, and this corpus is not one shape: a 16:9 reference in a
 * 2:3 hole loses a third of its frame to `object-cover`, and cropping the ad
 * you are asking someone to judge is the one thing this panel must not do. So
 * the box takes the MEDIA's ratio and the HEIGHT is what is held steady —
 * portrait comes out tall and narrow, landscape short and wide, and the column
 * width follows, exactly the way the sheet should breathe.
 *
 * The ratio arrives twice: `aspectFor` is what the payload claims (often
 * nothing), and `onLoadedMetadata` / `onLoad` is what the file actually is. The
 * second corrects the first.
 *
 * `sources` and `aspectFor` are resolved by the caller (Workspace owns
 * `videoSources` and `aspectOf`), so this file needs no knowledge of how a
 * template names its media.
 */

// The preview's stage: the height a portrait fills, and the width a landscape
// fills. Both are bounds, not sizes — the media takes whichever one it hits
// first and centres in the rest.
//
// The STAGE is a fixed-width column (see the grid below) and the media moves
// inside it. That is the whole point: the form beside it must not move when the
// shape changes. A column sized to its content shifts every field on the sheet
// the moment you click a 16:9 reference after a 9:16 one, and a form that walks
// left and right as you browse is a form you have to re-find each time.
const PREVIEW_BAND_H = 560;
const PREVIEW_MAX_W = 560;

// Beyond these a "ratio" is a data error, not a shape — a sliver of a panel
// helps nobody, so it is clamped back to something a person can look at.
const clampAspect = (value) => {
  const a = Number(value);
  if (!Number.isFinite(a) || a <= 0) return 9 / 16;
  return Math.min(Math.max(a, 0.4), 2.4);
};

function AnchorPreview({ template, sources, aspectFor }) {
  const [srcIndex, setSrcIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [aspect, setAspect] = useState(() => clampAspect(aspectFor?.(template)));
  // Can the media actually paint yet? Until it can, the box holds a shimmer at
  // the previous shape rather than a hole.
  const [ready, setReady] = useState(false);

  // Reset when the anchor is swapped from the rail below — without this, a
  // second template inherits the first one's dead-source index.
  //
  // The ASPECT is deliberately not reset. `aspectFor` answers with a fallback
  // whenever the payload declares nothing, which is most of this corpus — so
  // resetting made the box snap to 9:16 and then snap again to the real shape a
  // moment later. Holding the previous shape until `onLoadedMetadata` says
  // otherwise is one move instead of two, and the 260ms transition below turns
  // that move into a morph.
  useEffect(() => {
    setSrcIndex(0);
    setImageFailed(false);
    setReady(false);
  }, [template?.template_id, template?.image_url]);

  const isImage = template?.media_type === 'image';
  const src = sources?.[srcIndex];
  // Whether there is anything to WAIT for. Without this the text fallback —
  // which has nothing to load — would shimmer behind its own sentence forever.
  const hasMedia = (isImage && Boolean(template?.image_url) && !imageFailed) || Boolean(src);
  const summary = template?.one_line_summary || template?.headline?.split('||')[0] || '';

  // Width derived from the band, then capped. `maxWidth: 100%` handles the
  // narrow-screen case on its own: with the height left auto, `aspect-ratio`
  // recomputes it from whatever width survives the clamp.
  const width = Math.round(Math.min(PREVIEW_MAX_W, PREVIEW_BAND_H * aspect));

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl bg-[#101014]"
      style={{
        width,
        maxWidth: '100%',
        aspectRatio: String(aspect),
        border: `1px solid ${LINE}`,
        // The swap between two shapes is a move, not a jump.
        transition: `width 260ms ${EASE}, aspect-ratio 260ms ${EASE}`,
      }}
    >
      {/* Underneath everything, and only visible through a media that has not
          faded in yet. A swap then reads as "the next one is coming" instead of
          as the panel breaking for a frame. */}
      {!ready && hasMedia && <div className="recreate-shimmer absolute inset-0" aria-hidden />}

      {isImage && template.image_url && !imageFailed ? (
        <img
          key={template.image_url}
          src={template.image_url}
          alt={summary || 'Reference ad'}
          onError={() => setImageFailed(true)}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) setAspect(clampAspect(w / h));
            setReady(true);
          }}
          className="relative h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: ready ? 1 : 0, transitionTimingFunction: EASE }}
        />
      ) : src ? (
        <video
          key={src}
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setSrcIndex((i) => i + 1)}
          onLoadedMetadata={(e) => {
            // The file's own dimensions, which beat anything the payload said.
            // A failed decode reports 0x0, so guard before trusting it.
            const { videoWidth: w, videoHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) setAspect(clampAspect(w / h));
          }}
          // `loadeddata`, not `loadedmetadata`: metadata means the dimensions
          // are known, which is what resizes the box — but the first FRAME is
          // not decoded yet, so fading in on metadata still shows a moment of
          // empty. This one fires when there is a picture to show.
          onLoadedData={() => setReady(true)}
          className="relative h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: ready ? 1 : 0, transitionTimingFunction: EASE }}
        />
      ) : (
        // No playable file. Say what the ad IS rather than showing a grey box —
        // the corpus ships plenty of matches with no preview, and the summary is
        // the only thing left that tells the user what they are recreating.
        <div className="relative grid h-full w-full place-items-center px-6 text-center">
          <p className="text-[13px] leading-relaxed text-white/65">
            {summary || 'No preview available for this reference ad.'}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Upload product — the one required field.
 *
 * Local only. The file never leaves the browser: it is read into an object URL
 * for the thumbnail and revoked when it is replaced or the modal closes.
 */
function ProductUpload({ file, previewUrl, onPick, onClear }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);

  const take = (f) => {
    if (f && f.type.startsWith('image/')) onPick(f);
  };

  const pasteImage = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((entry) =>
      entry.type.startsWith('image/')
    );
    const image = item?.getAsFile();

    if (!image) return;

    e.preventDefault();
    take(image);
  };

  return (
    <div>
      {/* No "Required" badge: the button is disabled and says why, in words,
          right beside it. Two places telling you the same thing. */}
      <SectionLabel>Replace product</SectionLabel>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
        onPaste={pasteImage}
        tabIndex={0}
        className={cn(
          'relative grid h-[124px] w-full place-items-center overflow-hidden rounded-xl',
          'cursor-pointer text-center transition-all duration-200'
        )}
        style={{
          background: dragging ? 'rgba(124,92,255,0.10)' : SURF2,
          border: `1px ${file ? 'solid' : 'dashed'} ${dragging ? 'rgba(124,92,255,0.55)' : LINE_STRONG}`,
          transitionTimingFunction: EASE,
        }}
        onClick={() => !file && input.current?.click()}
      >
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            take(e.target.files?.[0]);
            // Lets the same file be picked again after a clear.
            e.target.value = '';
          }}
        />

        {file ? (
          // Just the picture, centred, with the remove control on its corner.
          //
          // The filename, the file size and a pair of labelled buttons were all
          // answering questions nobody asks here: you can SEE which image it is,
          // and its size only matters if it was refused — which happens before
          // it ever reaches this state. Clicking the thumbnail replaces it, and
          // the one control that cannot be inferred gets the one affordance.
          <div className="group/thumb relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                input.current?.click();
              }}
              title="Replace this image"
              className="block overflow-hidden rounded-lg transition duration-200 hover:brightness-110"
              style={{ border: `1px solid ${LINE_STRONG}` }}
            >
              <img
                src={previewUrl}
                alt={file.name}
                className="h-[86px] w-[86px] object-cover"
              />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              aria-label="Remove this image"
              // On the corner of the thumbnail, half outside it, so it reads as
              // attached to the picture rather than floating in the dropzone.
              className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full text-white/70 shadow-md transition duration-200 hover:text-white"
              style={{ background: '#2a2a32', border: `1px solid ${LINE_STRONG}` }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="px-4">
            <div
              className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded-full transition-transform duration-200"
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: `1px solid ${LINE_STRONG}`,
                transform: dragging ? 'scale(1.12)' : 'scale(1)',
                transitionTimingFunction: EASE,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-white/70" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <p className="text-[13px] font-semibold text-white/80">Upload product</p>
            <p className="mt-0.5 text-[12px] text-white/55">PNG or JPG · drop or paste here</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the modal ──────────────────────────────────────────────────────────────*/

/**
 * @param template      the anchor — the tile whose Recreate was pressed
 * @param items         every template the session has (the rail's source)
 * @param sourcesFor    (template) => string[] playable urls; owned by Workspace
 * @param aspectFor     (template) => number, the payload's claimed ratio; ditto
 * @param TileComponent the dock's TemplateTile, passed in rather than imported,
 *                      so this file and Workspace never import each other
 * @param onPickTemplate swap the anchor to another template from the rail
 * @param onClose
 */
export default function RecreateModal({
  template,
  items = [],
  sessionId,
  sourcesFor,
  aspectFor,
  // Credits of onboarding allowance left. The sheet shows "Free" only when the
  // budget covers this recreate in FULL — all or nothing, the same rule the
  // server applies (ONBOARDING_ALLOWANCE.md D1). Anything less shows the price,
  // because anything less IS the price.
  allowanceRemaining = 0,
  TileComponent,
  onPickTemplate,
  // Called with `{ jobId, credits }` once a render is accepted.
  onStarted,
  onClose,
}) {
  // Drives the enter transition. Mounting at the final values means the browser
  // has nothing to animate FROM, so the sheet would simply appear.
  const [shown, setShown] = useState(false);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  // idle → working → error. There is no 'done': see `submit`.
  const [phase, setPhase] = useState('idle');
  // What went wrong, in words the user can act on. Empty unless phase is
  // 'error'.
  const [errorText, setErrorText] = useState('');

  const scroller = useRef(null);
  const grid = useRef(null);
  // How many columns the rail packs into, and how wide one ends up. The width
  // is only used for the tiles' own chip-count decision, so it needs to be
  // roughly right rather than exact — a resize observer on the container is
  // enough for both.
  const [cols, setCols] = useState(5);
  const [colW, setColW] = useState(180);

  // Which corpus the anchor belongs to. Every template object carries this —
  // `sessionMirror` tags the session's own, the search tags its results — so the
  // server never has to infer it from the id's shape.
  const anchorKind = template?.media_type === 'image' ? 'image' : 'video';
  const cost = RECREATE_COST[anchorKind];
  const coveredByAllowance = allowanceRemaining >= cost;
  // SOME budget, but not enough — the budget pays its share and the wallet
  // funds the rest, so the user confirms the split before anything is taken.
  // See SplitChargeDialog. In practice this only ever fires for VIDEO: an image
  // costs 1, so a budget with anything left in it covers it outright.
  const splitNeeded = !coveredByAllowance && allowanceRemaining > 0;
  // `{ wallet, stale }` while the confirmation is up.
  const [splitAsk, setSplitAsk] = useState(null);

  // What the rail actually shows. `null` means "the similar call has not
  // answered yet (or failed)", which is the signal to fall back — NOT an empty
  // array, because an empty array is a real answer meaning "nothing is similar
  // to this one".
  const [similar, setSimilar] = useState(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  // Upstream's frozen-ordering token and its own cursor. Without `search_id`
  // every page is a fresh re-rank, which is how page 2 comes back as mostly
  // page 1 again.
  const cursor = useRef({ searchId: '', nextSkip: null, pages: 0 });
  // Guards a second page being asked for while the first is still in the air.
  // A ref, not state: the sentinel can fire several times in one frame and a
  // state update would not have landed before the next one reads it.
  const paging = useRef(false);
  const sentinel = useRef(null);

  // The session's own templates, minus the anchor. The fallback when the
  // similar search FAILS — never while it is merely pending.
  const fallback = useMemo(
    () => items.filter((t) => t.template_id !== template?.template_id),
    [items, template?.template_id]
  );

  // While the search runs the rail shows skeletons, NOT the session's
  // templates. Showing a real list and then replacing it under the user is a
  // swap they did not ask for — and worse, for the second or two it is up, it
  // is a wrong answer presented as a right one. The fallback is for FAILURE,
  // which is a different thing from "not yet".
  const related = similar && similar.length ? similar : fallback;
  const showSkeleton = similarLoading && !similar;
  // Paging only makes sense over a real result. While the fallback is on screen
  // there is no cursor to advance — those templates came from the session, not
  // from this search.
  const canPage = Boolean(similar && similar.length) && !exhausted;

  // Page one. Runs again on every anchor swap, which is the whole point of the
  // rail: a new anchor is a new query.
  useEffect(() => {
    const anchor = template?.template_id;
    if (!anchor) return undefined;
    // `cancelled` rather than an AbortController: a fast swap would otherwise
    // let the first anchor's answer land after the second's and win.
    let cancelled = false;
    setSimilar(null);
    setExhausted(false);
    cursor.current = { searchId: '', nextSkip: null, pages: 0 };
    paging.current = false;
    setSimilarLoading(true);
    getSimilarTemplates(anchor, {
      limit: FIRST_PAGE[anchorKind],
      skip: 0,
      kind: anchorKind,
    })
      .then((page) => {
        if (cancelled) return;
        // Upstream excludes the anchor from its own results, but a corpus that
        // stores the same ad twice under two ids would not be caught by that.
        setSimilar(page.templates.filter((t) => t.template_id !== anchor));
        cursor.current = {
          searchId: page.searchId,
          nextSkip: page.nextSkip,
          pages: 1,
        };
        if (!page.hasMore) setExhausted(true);
      })
      // Deliberately quiet. A failed similar search leaves the rail showing the
      // session's templates, which is a working screen — telling the user their
      // recommendations failed would describe our plumbing, not their problem.
      .catch(() => {
        if (!cancelled) {
          setSimilar(null);
          setExhausted(true);
        }
      })
      .finally(() => {
        if (!cancelled) setSimilarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [template?.template_id, anchorKind]);

  // The next page.
  //
  // ── Three separate stops, and every one of them earned its place ──────────
  // The first version had ONE: "a page shorter than we asked for means the end".
  // That is not a stop at all when the cursor does not advance — and the image
  // route has no `skip` in its contract, so every page WAS the same eight. They
  // all de-duplicated away, the list never grew, `skip` never moved, the
  // sentinel stayed on screen, and the rail asked for that same page several
  // hundred times. That is the runaway in the network panel.
  const loadMore = useCallback(async () => {
    const anchor = template?.template_id;
    if (!anchor || paging.current || !canPage) return;
    paging.current = true;
    setLoadingMore(true);
    try {
      const page = await getSimilarTemplates(anchor, {
        limit: NEXT_PAGE,
        // Upstream's own cursor when it gave one; otherwise how many we hold.
        skip: cursor.current.nextSkip ?? similar.length,
        kind: anchorKind,
        searchId: cursor.current.searchId,
      });

      let addedCount = 0;
      setSimilar((prev) => {
        const held = new Set((prev || []).map((t) => t.template_id));
        const added = page.templates.filter(
          (t) => t.template_id !== anchor && !held.has(t.template_id)
        );
        addedCount = added.length;
        return [...(prev || []), ...added];
      });

      cursor.current = {
        searchId: page.searchId || cursor.current.searchId,
        nextSkip: page.nextSkip,
        pages: cursor.current.pages + 1,
      };

      // STOP 1 — upstream says there is nothing after this.
      // STOP 2 — the page brought nothing we did not already have. Whatever the
      //          cause (no skip support, a re-rank, a repeat), asking again
      //          cannot do better, and asking again is the loop.
      // STOP 3 — a hard ceiling. Neither of the above can be relied on to be
      //          true one day when upstream changes; the rail is a browse strip,
      //          not the whole corpus, and it stops after this many pages.
      if (!page.hasMore || addedCount === 0 || cursor.current.pages >= MAX_PAGES) {
        setExhausted(true);
      }
    } catch {
      // One failed page stops the paging rather than retrying into a loop. What
      // is already on screen stays there.
      setExhausted(true);
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }, [template?.template_id, anchorKind, similar, canPage]);

  // Reaching the end of the rail IS the request. A sentinel below the last tile
  // with 400px of margin means the next page is usually already in by the time
  // the user gets there, so the wall just keeps going.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canPage || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canPage, loadMore]);

  // ── The wall, packed into columns ONCE and never re-balanced ─────────────
  // This used to be CSS `column-count`, and that is what made a new page appear
  // at the TOP: multi-column fills column 1, then column 2, so appending eight
  // tiles re-distributes every tile already on screen. Nothing was inserted at
  // the top — the whole wall was re-dealt.
  //
  // Greedy shortest-column packing, walked in list order, does not have that
  // property: item n's column is decided by items 0..n-1 only, so a page
  // appended later cannot move anything already placed. New tiles land at the
  // bottom of whichever column is shortest, which is what "append" should look
  // like on a masonry.
  const columns = useMemo(() => {
    const buckets = Array.from({ length: Math.max(1, cols) }, () => ({ items: [], h: 0 }));
    related.forEach((t) => {
      const height = colW / clampAspect(aspectFor?.(t));
      // Leftmost of the equally-short ones, so the first row fills left to right.
      let target = buckets[0];
      for (const b of buckets) if (b.h < target.h) target = b;
      target.items.push(t);
      target.h += height + RAIL_GAP_PX;
    });
    return buckets.map((b) => b.items);
  }, [related, cols, colW, aspectFor]);

  // Reaching the end of the rail IS the request. A sentinel below the last tile
  // with 400px of margin means the next page is usually already in by the time
  // the user gets there, so the wall just keeps going.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canPage || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canPage, loadMore]);

  const anchorSources = useMemo(
    () => (sourcesFor && template ? sourcesFor(template) : []),
    [sourcesFor, template]
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Esc closes, and the page behind does not scroll while this is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Object URLs are a real allocation; revoke the old one on every swap and on
  // unmount, or a user who tries five products leaks five files.
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  useEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      // Capped at four. Five fit, but a reference ad is something you look AT
      // — at five the tiles are thumbnails of thumbnails, and the wall behind
      // the sheet is already the place for browsing at speed.
      const n = Math.max(2, Math.min(4, Math.floor(w / 186)));
      setCols(n);
      setColW(Math.floor((w - RAIL_GAP_PX * (n - 1)) / n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pickFile = useCallback((f) => {
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setFile(f);
    setPhase('idle');
  }, []);

  const clearFile = useCallback(() => {
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return '';
    });
    setFile(null);
    setPhase('idle');
  }, []);

  // Swapping the anchor from the rail keeps the form as it is — the product and
  // the edit you typed are about YOUR product, not about which reference you
  // picked, so throwing them away on every browse would be the wrong instinct.
  const swapAnchor = useCallback(
    (next) => {
      onPickTemplate?.(next);
      setPhase('idle');
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [onPickTemplate]
  );

  // The button. Everything that starts a render goes through `send` below; this
  // only decides whether the user is asked first.
  const submit = () => {
    if (!file || phase === 'working') return;
    if (splitNeeded) {
      setSplitAsk({ wallet: cost - allowanceRemaining, stale: false });
      return;
    }
    send();
  };

  const send = async (quote) => {
    if (!file || phase === 'working') return;
    // Never a silent return. A guard that quietly does nothing is how a button
    // ends up looking broken with no way to find out why — which is exactly what
    // a snake_case/camelCase mismatch on `sessionId` did here.
    if (!sessionId) {
      setErrorText('This session isn’t ready yet. Reload the page and try again.');
      setPhase('error');
      return;
    }
    setPhase('working');
    setErrorText('');
    try {
      const started = await recreateFromTemplate(sessionId, template.template_id, {
        file,
        instruction: prompt,
        kind: anchorKind,
        // The wallet figure the confirmation quoted, when there was one. The
        // server refuses rather than charging more than it.
        maxWalletCredits: quote?.maxWalletCredits,
      });
      setSplitAsk(null);
      // No success state of its own. The host closes this sheet and moves the
      // user to the clip screen — the same screen a storyboard render goes to —
      // so a "your ad is rendering" message here would be shown for one frame
      // on a sheet that is about to disappear, and would then be the SECOND
      // place claiming to be where the render is.
      onStarted?.(started);
    } catch (error) {
      const status = error?.response?.status;
      // 409: the onboarding budget moved between the quote and the charge and
      // the server took NOTHING rather than charging more than was shown. Not
      // an error to report — re-ask with the real numbers.
      if (status === 409) {
        const quoted = error?.response?.data?.quote;
        setPhase('idle');
        setSplitAsk({ wallet: Number(quoted?.wallet) || cost, stale: true });
        return;
      }
      // Four different things to say, because they need four different next
      // moves from the user. A single "something went wrong" would leave
      // someone topping up credits they already have.
      setErrorText(
        status === 402
          ? "You don't have enough credits for this."
          : status === 403
            ? 'An active plan is needed to generate.'
            : status === 404
              ? "We can't build from this template yet. Try another one."
              : status === 400
                ? error?.response?.data?.error || "That didn't work. Check the image and try again."
                : 'We couldn’t start this render. Please try again.'
      );
      setPhase('error');
    }
  };


  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-hidden p-4 sm:p-6"
      style={{
        // No backdrop-filter. Blurring the full viewport is re-run by the
        // compositor on EVERY frame of every video still playing behind it, and
        // behind this sheet there is a whole dock of them. A slightly heavier
        // scrim costs one paint instead.
        background: 'rgba(6,6,8,0.88)',
        opacity: shown ? 1 : 0,
        transition: `opacity 220ms ${EASE}`,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Recreate template"
    >
      <div
        ref={scroller}
        onClick={(e) => e.stopPropagation()}
        className="recreate-sheet relative max-h-full w-full max-w-[1120px] overflow-y-auto overscroll-contain rounded-2xl"
        style={{
          background: SURF,
          border: `1px solid ${LINE_STRONG}`,
          boxShadow: '0 50px 140px -30px rgba(0,0,0,0.92)',
          opacity: shown ? 1 : 0,
          transform: shown ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.985)',
          transition: `opacity 260ms ${EASE}, transform 300ms ${EASE}`,
        }}
      >
        {/* Nothing but the close button. The sheet IS the recreate — the
            template on the left, the form on the right — and a heading spelling
            that out was a label on the obvious.

            Still sticky, so close is reachable from the bottom of a long rail,
            and on the sheet's own background so tiles do not scroll under a
            hole. */}
        <div
          className="sticky top-0 z-[2] flex items-center justify-end px-5 pt-4 pb-1 sm:px-8"
          style={{ background: SURF }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 transition duration-200 hover:text-white"
            style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${LINE_STRONG}` }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── the form ───────────────────────────────────────────────────── */}
        <div className="mx-auto grid w-full max-w-[1040px] gap-7 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,560px)_minmax(0,400px)] lg:items-center lg:justify-center lg:gap-12">
          <div>
            {/* Deliberately NOT keyed. A key here remounts the element on every
                swap — the old frame is destroyed before the new one has a single
                byte, which is exactly the blank flash it was producing. It keeps
                its identity and crossfades instead. */}
            <AnchorPreview
              template={template}
              sources={anchorSources}
              aspectFor={aspectFor}
            />
          </div>

          <div className="flex min-w-0 flex-col justify-center gap-6">
            <ProductUpload
              file={file}
              previewUrl={previewUrl}
              onPick={pickFile}
              onClear={clearFile}
            />

            <div>
              <SectionLabel>Describe your edit</SectionLabel>
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (phase === 'error') setPhase('idle');
                }}
                rows={4}
                placeholder="What do you want to change? Leave it empty to keep the reference as it is."
                className={cn(
                  'w-full resize-none rounded-xl px-3.5 py-3 text-[13.5px] leading-relaxed',
                  'text-white/90 placeholder:text-white/50 outline-none transition-all duration-200'
                )}
                style={{
                  background: SURF2,
                  border: `1px solid ${LINE_STRONG}`,
                  transitionTimingFunction: EASE,
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(124,92,255,0.55)';
                  e.target.style.boxShadow = '0 0 0 3px rgba(124,92,255,0.14)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = LINE_STRONG;
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={!file || phase === 'working'}
                className={cn(
                  'relative inline-flex h-[38px] items-center justify-center gap-2 overflow-hidden rounded-[10px] px-5',
                  'text-[13px] font-bold text-white transition-all duration-200',
                  'disabled:cursor-not-allowed disabled:opacity-45',
                  'enabled:hover:brightness-[1.08] enabled:active:translate-y-px'
                )}
                style={{
                  background:
                    'linear-gradient(180deg,#9176ff 0%,#7c5cff 46%,#6148c7 100%)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.28), 0 8px 20px -12px rgba(124,92,255,0.9)',
                  transitionTimingFunction: EASE,
                }}
              >
                {phase === 'working' ? (
                  <>
                    <span
                      className="h-4 w-4 rounded-full border-2 border-white/35 border-t-white"
                      style={{ animation: 'spin 700ms linear infinite' }}
                    />
                    Recreating…
                  </>
                ) : (
                  <>
                    Recreate
                    {/* Hidden for now — see `HIDE_RENDER_PRICE` at the top of
                        this file. The whole badge goes, "Free" pill included: a
                        button that still says Free while its sibling shows no
                        price at all reads as two different products. */}
                    <span
                      hidden={HIDE_RENDER_PRICE}
                      className="ml-1 inline-flex items-center gap-1 text-[13px] font-semibold text-white/85"
                    >
                      <img src={creditIcon} alt="" className="h-3.5 w-3.5" aria-hidden />
                      {coveredByAllowance ? (
                        <>
                          <s className="opacity-70">{cost}</s>
                          <span className="rounded-[5px] bg-black/25 px-[6px] py-[1px] font-bold">
                            Free
                          </span>
                        </>
                      ) : (
                        cost
                      )}
                    </span>
                  </>
                )}
              </button>

              {!file && (
                <p className="text-[12.5px] text-white/58">Add a product image to continue.</p>
              )}
            </div>

            {/* Failures only. There is no success message because there is no
                success state: an accepted render closes this sheet and moves to
                the clip screen. A refusal is the only thing that leaves the user
                standing here needing to be told something. */}
            <div
              className="overflow-hidden transition-all duration-300"
              style={{
                maxHeight: phase === 'error' ? 140 : 0,
                opacity: phase === 'error' ? 1 : 0,
                transitionTimingFunction: EASE,
              }}
            >
              <div
                className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed text-white/80"
                style={{
                  background: 'rgba(239,68,68,0.10)',
                  border: '1px solid rgba(239,68,68,0.32)',
                }}
              >
                {errorText}
              </div>
            </div>
          </div>
        </div>

        {/* ── more like this ─────────────────────────────────────────────── */}
        {(showSkeleton || related.length > 0) && (
          <div className="px-5 pb-8 sm:px-8" style={{ borderTop: `1px solid ${LINE}` }}>
            <div className="pt-6">
              {/* Not a `SectionLabel`. Those are field labels for the form — 11px
                  and half-lit, which is right above a text box and far too quiet
                  for the heading of a whole second half of the sheet. This one
                  matches the dock's own "Templates from your industry". */}
              <h3 className="mb-3 text-sm font-semibold text-white 2xl:text-base">
                More like this
              </h3>

              {/* Flex columns, not CSS `column-count` — see `columns` above for
                  why. Each column is its own stack, so a page appended later
                  only ever grows the bottom of one of them. */}
              <div ref={grid} className="flex items-start" style={{ gap: RAIL_GAP_PX }}>
                {showSkeleton
                  ? Array.from({ length: Math.max(1, cols) }, (_, c) => (
                      <div
                        key={`skcol-${c}`}
                        className="flex min-w-0 flex-1 flex-col"
                        style={{ gap: RAIL_GAP_PX }}
                      >
                        {SKELETON_RATIOS.filter((_, i) => i % cols === c).map((ratio, i) => (
                          <div
                            key={`sk-${c}-${i}`}
                            className="recreate-shimmer w-full rounded-sm"
                            style={{
                              aspectRatio: String(ratio),
                              // Offset so the sheen crosses the wall diagonally
                              // rather than every block pulsing in unison, which
                              // reads as a broken render rather than as loading.
                              animationDelay: `${((c + i) % 6) * 110}ms`,
                            }}
                          />
                        ))}
                      </div>
                    ))
                  : columns.map((column, c) => (
                      <div
                        key={`col-${c}`}
                        className="flex min-w-0 flex-1 flex-col"
                        style={{ gap: RAIL_GAP_PX }}
                      >
                        {column.map((t, i) => (
                          <button
                            key={t.template_id || t.image_url || `${c}-${i}`}
                            type="button"
                            onClick={() => swapAnchor(t)}
                            className="group/rel block w-full cursor-pointer text-left transition-transform duration-200 hover:-translate-y-0.5"
                            style={{
                              // Staggered across the first rows only — past that
                              // the user is scrolling and a delay reads as jank.
                              animation: `recreateTileIn 320ms ${EASE} both`,
                              animationDelay: `${Math.min(i * cols + c, 11) * 28}ms`,
                            }}
                            aria-label="Use this reference instead"
                          >
                            {/* The tile's own Recreate does the same thing as
                                clicking the tile. It stops propagation, so
                                without this it would be the one dead button on
                                the screen. */}
                            <TileComponent
                              template={t}
                              expanded
                              slot={Math.max(140, colW)}
                              onRecreate={swapAnchor}
                            />
                          </button>
                        ))}
                      </div>
                    ))}
              </div>

              {/* Not a button. Reaching the bottom of the rail is the request,
                  so this is just the place that notices — and, while a page is
                  in the air, the thing that says so. It stays mounted while
                  paging is possible so the observer above has something to
                  watch. */}
              {canPage && (
                <div ref={sentinel} className="grid h-12 place-items-center">
                  <span
                    className="h-4 w-4 rounded-full border-2 border-white/15 border-t-white/60 transition-opacity duration-200"
                    style={{
                      animation: 'spin 700ms linear infinite',
                      opacity: loadingMore ? 1 : 0,
                    }}
                    aria-hidden
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Local to this modal: a keyframe cannot live in a Tailwind class, and
            these two are not wanted anywhere else. */}
        <style>{`
          /* The sheet scrolls but does not draw a bar. The content already says
             there is more below it (a tile cut by the sheet's edge), and a
             full-height track down the side of a wall of video is the loudest
             thing on the screen. */
          .recreate-sheet { scrollbar-width: none; -ms-overflow-style: none; }
          .recreate-sheet::-webkit-scrollbar { width: 0; height: 0; display: none; }
          /* A sheen travelling across the block, not a pulse. A pulse says
             "something is wrong here"; a sweep says "this is filling in". */
          .recreate-shimmer {
            background: linear-gradient(
              100deg,
              rgba(255,255,255,0.035) 20%,
              rgba(255,255,255,0.085) 40%,
              rgba(255,255,255,0.035) 60%
            );
            background-size: 260% 100%;
            animation: recreateShimmer 1500ms ease-in-out infinite;
          }
          @keyframes recreateShimmer {
            from { background-position: 160% 0; }
            to   { background-position: -60% 0; }
          }
          @keyframes recreateTileIn {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>

      {/* Its own portal, at a higher z-index than this sheet — it is asking
          about money and must not be something the sheet can cover. */}
      <SplitChargeDialog
        open={Boolean(splitAsk)}
        cost={cost}
        allowance={allowanceRemaining}
        wallet={splitAsk?.wallet || 0}
        stale={Boolean(splitAsk?.stale)}
        busy={phase === 'working'}
        onCancel={() => setSplitAsk(null)}
        onConfirm={() => send({ maxWalletCredits: splitAsk?.wallet })}
      />
    </div>,
    document.body
  );
}
