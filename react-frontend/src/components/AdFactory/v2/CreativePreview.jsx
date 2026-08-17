import React from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { PrimaryBtn, GhostBtn } from './Panel';
import { useMotionPresets } from './_motion';

// ----------------------------------------------------------------------------
// CreativePreview — the ads, which are the point of the screen.
//
// Rendered as soon as generation STARTS, not once results exist. Pressing a
// button and watching nothing change for two minutes is the worst possible
// answer, so pending slots render as skeletons from the first moment and each
// card resolves in place as Python answers.
//
// The pairs arrive already paired, already filtered to the latest cycle, from
// services/adFactory/briefGenerationView. The client does no slicing of its
// own — the rules about which array entries belong to this run are subtle
// (they accumulate across cycles, with pre-pushed empty slots) and belong in
// one tested place, not spread across a component.
// ----------------------------------------------------------------------------

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

// Python returns either an absolute URL or an S3 key beginning with a slash.
// "1:1" -> 1, "4:5" -> 0.8, "1.91:1" -> 1.91. The card must be shaped like the
// creative it holds: a 1:1 image in a hardcoded 4/5 box gets its sides cropped
// by object-cover, which ate the left edge of every headline — "POWERADSPY"
// rendered as "OWERADSPY". The ratio badge said 1:1 while the frame said
// otherwise.
const aspectOf = (ratio) => {
  const [w, h] = String(ratio || '')
    .split(':')
    .map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${w} / ${h}` : '4 / 5';
};

const srcOf = (data) => {
  const s = String(data || '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${S3}${s}`;
};

export default function CreativePreview({
  run,
  callToAction = 'Learn more',
  onRegenerate,
  onRegenerateOne,
  onContinue,
  regenerating = false,
  creditsHeld,
  ratio = '4:5',
  readOnly = false,
}) {
  const M = useMotionPresets();
  const pairs = run?.pairs || [];
  const pending = run?.pending || 0;
  const failed = run?.failed || 0;
  const running = run?.status === 'running';
  const ready = pairs.length;

  if (!running && ready === 0 && failed === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          {readOnly
            ? `${ready} ${ready === 1 ? 'ad' : 'ads'} from this run`
            : running && ready === 0
              ? 'Making your ads…'
              : ready > 0
                ? `${ready} ${ready === 1 ? 'ad' : 'ads'} ready`
                : 'Generation finished'}
        </h3>
        {running && (
          <span className="text-xs text-gray-500 dark:text-white/55">
            This takes a couple of minutes — you can leave and come back.
          </span>
        )}
      </div>

      {/* Each card animates in as Python answers, because these arrive without
          the user doing anything — over a couple of minutes, one at a time. A
          card that simply blinks into existence is easy to miss; the fade is
          what says "another one just landed".

          Keyed by imageUrl so a finished card is never re-animated by the
          next poll. `popLayout` lets the remaining skeletons slide up into the
          gap instead of the grid jumping. */}
      <motion.div
        layout={!M.reduce}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {pairs.map((pair, i) => (
            <motion.div
              key={pair.imageUrl || `pair-${i}`}
              layout={!M.reduce}
              {...M.fadeUp}
            >
              <Card
                pair={pair}
                ratio={ratio}
                callToAction={callToAction}
                onRegenerate={!readOnly && onRegenerateOne ? () => onRegenerateOne(i) : undefined}
              />
            </motion.div>
          ))}
          {Array.from({ length: pending }).map((_, i) => (
            <motion.div
              key={`pending-${i}`}
              layout={!M.reduce}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={M.fadeUp.transition}
            >
              <SkeletonCard ratio={ratio} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {failed > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {failed} didn&apos;t come out this time.
            {ready > 0 ? " You're only charged for the ones that worked." : ''}
          </span>
        </div>
      )}

      {/* The status bar. State on the left, actions on the right — one strip
          rather than a floating pair of buttons, so what just happened and what
          to do next are read together.

          "Keep these coming" appears only once an ad exists: offering it sooner
          asks the user to commit to something they haven't seen. */}
      {!readOnly && (running || ready > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#14181D]">
          <p className="text-xs text-gray-500 dark:text-white/55">
            {running ? (
              <>
                <b className="text-gray-900 tabular-nums dark:text-white/90">{ready}</b> of{' '}
                <span className="tabular-nums">{ready + pending}</span> ready
              </>
            ) : (
              <>
                <b className="text-gray-900 tabular-nums dark:text-white/90">{ready}</b>{' '}
                {ready === 1 ? 'ad' : 'ads'} ready
              </>
            )}
            {creditsHeld != null && (
              <>
                {' · '}
                <span className="tabular-nums">{creditsHeld}</span> credits held, settled on
                what lands
              </>
            )}
          </p>

          {!running && ready > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              <GhostBtn onClick={onRegenerate} disabled={regenerating}>
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>Regenerate all</span>
              </GhostBtn>
              <PrimaryBtn icon={Sparkles} onClick={onContinue}>
                Keep these coming →
              </PrimaryBtn>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Card({ pair, ratio, callToAction, onRegenerate }) {
  const copy = pair.copy || {};
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#101316]">
      <div
        className="relative bg-gray-100 dark:bg-white/5"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <img
          src={srcOf(pair.imageUrl)}
          alt={copy.headline || 'Generated ad'}
          loading="lazy"
          // `contain`, not `cover`. These are finished ads with text baked into
          // the pixels — cropping one to fill a box removes words the user is
          // being asked to approve. Letterboxing is the honest failure mode.
          className="h-full w-full object-contain"
        />
        <RatioBadge ratio={ratio} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 border-t border-gray-200 px-3 py-2.5 dark:border-white/10">
        {copy.headline && (
          <b className="text-13 leading-snug font-bold text-gray-900 dark:text-white">
            {copy.headline}
          </b>
        )}
        {copy.primaryText && (
          <p className="line-clamp-3 text-xs leading-relaxed text-gray-500 dark:text-white/60">
            {copy.primaryText}
          </p>
        )}
        {/* CTA left, per-card regenerate right. One card being wrong is the
            common case — far more common than wanting a whole new batch — so
            the fix sits on the card rather than only at the bottom of the page. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="inline-flex rounded-md bg-gray-900 px-2.5 py-1 text-10 font-bold text-white dark:bg-white/90 dark:text-[#05070A]">
            {callToAction}
          </span>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="text-10 font-semibold text-gray-400 transition hover:text-gray-900 dark:text-white/45 dark:hover:text-white"
            >
              Regenerate
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function SkeletonCard({ ratio }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#101316]">
      <div
        className="relative animate-pulse bg-gray-100 dark:bg-white/5"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <RatioBadge ratio={ratio} />
      </div>
      <div className="flex flex-col gap-2 border-t border-gray-200 px-3 py-3 dark:border-white/10">
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-gray-100 dark:bg-white/8" />
        <span className="h-2 w-full animate-pulse rounded bg-gray-100 dark:bg-white/8" />
        <span className="h-2 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-white/8" />
        <span className="mt-1 text-10 font-semibold text-gray-400 dark:text-white/40">
          Generating…
        </span>
      </div>
    </article>
  );
}

function RatioBadge({ ratio }) {
  if (!ratio) return null;
  return (
    <span className="absolute top-2.5 right-2.5 rounded-md border border-white/15 bg-black/50 px-1.5 py-0.5 text-[9.5px] text-white/75">
      {ratio}
    </span>
  );
}
