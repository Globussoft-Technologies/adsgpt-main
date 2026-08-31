import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Check, Download, Eye, ImageOff, Loader2, Rocket, X } from 'lucide-react';

import { downloadMediaFromUrl } from '@/store/actions/adVideoNew/Advideoactions';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import MobilePreview from '@/components/AdFactory/AdPreview/MobilePreview';
import {
  PublishError,
  PublishResult,
  PublishTargetFields,
  usePublishTarget,
} from './ShipTheseAds';
import { GhostBtn, PrimaryBtn } from './Panel';
import { CARD, FAINT, MUTED, NUM, RULE_BORDER, SECTION, TITLE } from './_tokens';

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

const srcOf = (data) => {
  const s = String(data || '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${S3}${s}`;
};

const aspectOf = (ratio) => {
  const [w, h] = String(ratio || '')
    .split(':')
    .map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${w} / ${h}` : '4 / 5';
};

const when = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

// ----------------------------------------------------------------------------
// RunGallery — every ad this brief has made, and the one place any selection of
// them goes live.
//
// ─── Why picking and posting share a screen ──────────────────────────────────
//
// The first version of this was two views: a grid, then a Post button that
// replaced the grid with the form. That is a wizard, and it is the wrong shape
// for this job. Choosing which ads to run is not a decision you make once and
// walk away from — you pick two, look at the ad set you are posting into,
// realise it is the retargeting one, and change your mind about which two. With
// the grid swapped out for the form, checking that costs a trip back and the
// selection is out of sight while you are deciding where it goes.
//
// So: the ads on the left, where they are going on the right, one action bar
// across the bottom that always says what is about to happen. Select, fill,
// post, in one pass, with both halves of the decision visible the whole time.
//
// ─── Why the layout cannot break ─────────────────────────────────────────────
//
// A run can be 3 ads or 50 — "ads per run" goes up to 50 — and there can be any
// number of runs. Every dimension of that is absorbed by scrolling INSIDE the
// pane it belongs to, never by the modal growing:
//
//   • the modal is a fixed 90vh, `flex flex-col`, and its header and action bar
//     are `shrink-0`, so they cannot be pushed off by a tall body
//   • the two panes are `min-h-0` (without it a flex child refuses to shrink
//     below its content and the scroll silently moves to the page)
//   • each pane scrolls on its own, so 50 ads on the left never move the form
//   • the form pane is a fixed 360px and the grid takes the rest, so more ads
//     make the grid denser, not the form narrower
//
// Below `lg` the two stack and the body scrolls as one — a 360px form beside
// anything on a phone is two unusable columns instead of one good one. The
// action bar stays pinned either way.
//
// ─── Posting is the form we already have ─────────────────────────────────────
//
// Not a copy of it: `usePublishTarget` + `PublishTargetFields` are the same
// parts the full-width "Ship these ads" card composes, rendered `stacked` here.
// One set of Meta plumbing, two layouts. See the note in ShipTheseAds.jsx.
// ----------------------------------------------------------------------------

export default function RunGallery({
  open,
  onOpenChange,
  runs = [],
  ratio = '4:5',
  callToAction = 'Learn more',
  brandName,
  linkUrl,
  connection,
  onConnectionChange,
  onPublish,
  publishing = false,
  publishResult = null,
  publishError = null,
  onDismissResult,
}) {
  // Keyed by image url — the same identity the server filters on, and stable
  // across a refetch that hands back new pair objects.
  const [selected, setSelected] = useState(() => new Set());
  const [previewing, setPreviewing] = useState(null);

  const target = usePublishTarget({ connection, publishing });

  const total = useMemo(() => runs.reduce((sum, r) => sum + (r.pairs?.length || 0), 0), [runs]);
  const pendingTotal = useMemo(
    () => runs.reduce((sum, r) => sum + (r.pending || 0), 0),
    [runs]
  );

  const allUrls = useMemo(
    () => runs.flatMap((r) => (r.pairs || []).map((p) => p.imageUrl).filter(Boolean)),
    [runs]
  );

  // A fresh grid every time it opens. Carrying a selection across an open is
  // how someone posts an ad they picked ten minutes ago and forgot about.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setPreviewing(null);
  }, [open]);

  // A run that regenerates while this is open can retire a selected ad. Drop
  // what no longer exists rather than sending the server a url it will refuse.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(allUrls);
      const next = new Set([...prev].filter((u) => live.has(u)));
      return next.size === prev.size ? prev : next;
    });
  }, [allUrls]);

  const toggle = useCallback((url) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const count = selected.size;
  const allSelected = total > 0 && count === total;
  const canPost = target.canPublish(count);

  const handlePublish = useCallback(
    () => onPublish?.({ ...target.publishArgs, imageUrls: [...selected] }),
    [onPublish, target.publishArgs, selected]
  );

  // What the action bar's button says, in the order the user hits the reasons:
  // nothing picked → no Meta → no ad set → go.
  const blocker = !count
    ? 'Select ads to post'
    : !target.connected
      ? 'Connect Meta to post'
      : !target.targeted
        ? 'Choose a campaign & ad set'
        : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] w-[96%] max-w-6xl! scale-100! flex-col overflow-hidden rounded-xl border-[var(--ws-border)] bg-[var(--ws-bg)] p-0 text-[var(--ws-text-primary)] dark:border-[#2A2A2A] dark:bg-[#0f0f0f] dark:text-[#F4F4F5]"
      >
        {/* ── Header ── */}
        <div
          className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-4 ${RULE_BORDER}`}
        >
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className={TITLE}>All generations</h2>
            <span className={MUTED}>
              <span className={NUM}>{total}</span> {total === 1 ? 'ad' : 'ads'} across{' '}
              <span className={NUM}>{runs.length}</span> {runs.length === 1 ? 'run' : 'runs'}
              {/* Live: this modal re-renders from the brief, which the socket
                  refetches as each image lands, so the count climbs on its
                  own while you are looking at it. */}
              {pendingTotal > 0 && (
                <>
                  {' · '}
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#4654D4] dark:text-[#15DCFF]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className={NUM}>{pendingTotal}</span> still generating
                  </span>
                </>
              )}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {total > 0 && !publishResult && (
              <GhostBtn onClick={() => setSelected(allSelected ? new Set() : new Set(allUrls))}>
                {allSelected ? 'Clear selection' : 'Select all'}
              </GhostBtn>
            )}
            <GhostBtn onClick={() => onOpenChange?.(false)} aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </GhostBtn>
          </div>
        </div>

        {/* ── Body ── two panes on lg, one scrolling column below it. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* ── The ads ── */}
          <div className="min-w-0 shrink-0 px-5 pt-4 pb-5 lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
            {total === 0 && pendingTotal === 0 ? (
              <p className={`py-12 text-center ${MUTED}`}>
                Nothing generated yet. Press Generate and they&apos;ll collect here.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {runs
                  .filter((r) => (r.pairs?.length || 0) > 0 || (r.pending || 0) > 0)
                  .map((run) => (
                    <section key={run.key} className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <h3 className={SECTION}>{run.title}</h3>
                        {run.at && <span className={FAINT}>{when(run.at)}</span>}
                        <span className={FAINT}>
                          <span className={NUM}>{run.pairs.length}</span>{' '}
                          {run.pairs.length === 1 ? 'ad' : 'ads'}
                          {run.pending > 0 && (
                            <>
                              {' of '}
                              <span className={NUM}>{run.pairs.length + run.pending}</span>
                            </>
                          )}
                        </span>
                      </div>

                      {/* Denser than the page's preview grid on purpose: this
                          is for picking out of everything, not for reading one
                          batch. A 50-ad run stays a grid rather than a column
                          of billboards. */}
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {run.pairs.map((pair, i) => (
                          <Tile
                            key={pair.imageUrl || `${run.key}-${i}`}
                            pair={pair}
                            ratio={ratio}
                            callToAction={callToAction}
                            selected={selected.has(pair.imageUrl)}
                            onToggle={() => toggle(pair.imageUrl)}
                            onPreview={() => setPreviewing(pair)}
                          />
                        ))}

                        {/* One placeholder per slot this run asked for and
                            hasn't delivered. They occupy the exact footprint
                            the real card will, so the grid doesn't reflow under
                            the cursor as each image arrives. */}
                        {Array.from({ length: run.pending || 0 }).map((_, i) => (
                          <SkeletonTile key={`pending-${run.key}-${i}`} ratio={ratio} />
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            )}
          </div>

          {/* ── Where they go ── */}
          <aside
            className={`flex shrink-0 flex-col border-t ${RULE_BORDER} bg-[var(--ws-surface)]/70 lg:min-h-0 lg:w-90 lg:border-t-0 lg:border-l lg:overflow-y-auto dark:bg-[#171717]/70`}
          >
            <div className="flex flex-col gap-4 px-5 py-4">
              {publishResult ? (
                <PublishResult
                  result={publishResult}
                  adCount={count}
                  adAccountId={target.adAccountId}
                  stacked
                  onDismiss={() => {
                    onDismissResult?.();
                    setSelected(new Set());
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <h3 className={SECTION}>Where these publish</h3>
                    <p className={MUTED}>
                      {count === 0 ? (
                        'Tick the ads on the left, then pick where they go.'
                      ) : (
                        <>
                          <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                            {count}
                          </b>{' '}
                          {count === 1 ? 'ad' : 'ads'} ready to post — from any run.
                        </>
                      )}
                    </p>
                  </div>

                  {publishError && <PublishError error={publishError} />}

                  <PublishTargetFields
                    target={target}
                    connection={connection}
                    onConnectionChange={onConnectionChange}
                    publishing={publishing}
                    stacked
                  />
                </>
              )}
            </div>
          </aside>
        </div>

        {/* ── Action bar ── one row, always visible, always saying what the
            button will do. Pinned outside both scroll areas so neither a long
            run nor a long form can scroll it away. */}
        {!publishResult && (
          <div
            className={`flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-t px-5 py-3.5 ${RULE_BORDER}`}
          >
            <p className={MUTED}>
              {count === 0 ? (
                'Nothing selected yet.'
              ) : (
                <>
                  <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>
                    {count}
                  </b>{' '}
                  {count === 1 ? 'ad' : 'ads'} selected · go live immediately · no credits, no
                  schedule
                </>
              )}
            </p>
            <PrimaryBtn
              icon={publishing ? undefined : Rocket}
              onClick={handlePublish}
              busy={publishing}
              disabled={!canPost}
            >
              {publishing ? 'Posting…' : blocker || `Post ${count} ${count === 1 ? 'ad' : 'ads'}`}
            </PrimaryBtn>
          </div>
        )}

        {/* ── The ad preview ── Ad Factory's own phone-frame preview, not a
            fullscreen image. What matters when judging an ad is how the copy,
            the image and the button sit together in a feed; a bare JPEG at
            2000px shows none of that. */}
        {previewing && (
          <div
            role="presentation"
            onClick={() => setPreviewing(null)}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          >
            <div className="relative" onClick={(e) => e.stopPropagation()} role="presentation">
              <MobilePreview
                image={srcOf(previewing.imageUrl)}
                text={previewing.copy || {}}
                cta={callToAction}
                ctaLink={linkUrl}
                brandName={brandName}
              />
              <button
                type="button"
                onClick={() => setPreviewing(null)}
                aria-label="Close preview"
                className="absolute -top-2 -right-2 rounded-full bg-[#5867EB] p-1.5 text-white shadow-lg dark:bg-[#15DCFF] dark:text-[#062024]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Tile({ pair, ratio, callToAction, selected, onToggle, onPreview }) {
  const dispatch = useDispatch();
  const copy = pair.copy || {};
  const src = srcOf(pair.imageUrl);
  // The record says the image was delivered, but the CDN can still drop it.
  // A broken-image glyph in a grid you are picking from reads as "this ad is
  // broken", which is the right message — say it plainly instead.
  const [broken, setBroken] = useState(false);

  return (
    <article
      className={`group relative flex flex-col overflow-hidden ${CARD} ${
        selected ? 'ring-2 ring-[#5867EB] dark:ring-[#15DCFF]' : ''
      }`}
    >
      {/* The whole image is the checkbox. On a grid whose only job is picking,
          a 16px target in the corner is the wrong size for the gesture. */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? 'Deselect this ad' : 'Select this ad'}
        className="relative block w-full bg-[var(--ws-surface-hover)] dark:bg-[#242424]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        {broken ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-center">
            <ImageOff className="h-5 w-5 text-[#9C8F7D] dark:text-[#6C7480]" />
            <span className={FAINT}>Image unavailable</span>
          </span>
        ) : (
          <img
            src={src}
            alt={copy.headline || 'Generated ad'}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-contain"
          />
        )}

        <span
          className={`absolute top-2 left-2 grid h-5 w-5 place-items-center rounded-md border transition-colors ${
            selected
              ? 'border-[#B87215] bg-[#B87215] text-white dark:border-[#15DCFF] dark:bg-[#15DCFF] dark:text-[#062024]'
              : 'border-white/70 bg-black/30 text-transparent group-hover:border-white'
          }`}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </button>

      <div className={`flex flex-1 flex-col gap-1.5 border-t px-3 py-2.5 ${RULE_BORDER}`}>
        {copy.headline && (
          <b className="line-clamp-2 text-[12px] leading-snug font-medium text-[#111827] dark:text-[#ECEFF3]">
            {copy.headline}
          </b>
        )}
        {copy.primaryText && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-[#6B7280] dark:text-[#AFB6C0]">
            {copy.primaryText}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-10 inline-flex min-w-0 truncate rounded-md bg-[#B87215] px-2 py-0.5 font-semibold text-white dark:bg-[#ECEFF3] dark:text-[#0A0A0A]">
            {callToAction}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <TileAction onClick={onPreview} title="Preview this ad">
              <Eye className="h-3.5 w-3.5" />
            </TileAction>
            <TileAction
              onClick={() => dispatch(downloadMediaFromUrl(src, 'image'))}
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </TileAction>
          </span>
        </div>
      </div>
    </article>
  );
}

// A slot that has been asked for and not yet delivered. Deliberately the same
// frame, aspect ratio and footer height as a real tile — a placeholder whose
// dimensions differ from the thing it stands in for makes the whole grid jump
// when it resolves.
function SkeletonTile({ ratio }) {
  return (
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div
        className="relative grid animate-pulse place-items-center bg-[var(--ws-surface-hover)] dark:bg-[#202020]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <Loader2 className="h-4 w-4 animate-spin text-[#9C8F7D] dark:text-[#6C7480]" />
      </div>
      <div className={`flex flex-col gap-2 border-t px-3 py-2.5 ${RULE_BORDER}`}>
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-[#EFE6D8] dark:bg-[#22272F]" />
        <span className="h-2 w-full animate-pulse rounded bg-[#EFE6D8] dark:bg-[#22272F]" />
        <span className={`mt-1 ${FAINT}`}>Generating…</span>
      </div>
    </article>
  );
}

// A small icon action on a tile. Same hairline-and-label vocabulary as
// BTN_GHOST, sized for a card footer rather than a form.
function TileAction({ onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-7 w-7 place-items-center rounded-md border border-[var(--ws-border)] text-[var(--ws-text-secondary)] transition-colors hover:border-[var(--ws-border-strong)] hover:text-[var(--ws-text-primary)] dark:border-[#2A2A2A] dark:text-[#AFAFAF] dark:hover:border-[#3A3A3A] dark:hover:text-[#F4F4F5]"
    >
      {children}
    </button>
  );
}
