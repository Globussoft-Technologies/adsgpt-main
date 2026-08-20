import React from 'react';
import { AlertTriangle, RefreshCw, Rocket, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { PrimaryBtn, GhostBtn } from './Panel';
import { useMotionPresets } from './_motion';
import { CARD, FAINT, MUTED, NUM, RULE_BORDER, SECTION } from './_tokens';

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
  // The manual half. Sits here rather than in a card of its own because the
  // two things you can do with a finished batch — ship it, or subscribe to
  // more of it — belong to the batch, and this strip is the batch's own row.
  onShip,
  shipping = false,
  regenerating = false,
  creditsHeld,
  // What ANOTHER run would cost, as opposed to what the last one held.
  estimate = null,
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
        <h3 className={`text-[15px] tracking-[-0.013em] ${SECTION}`}>
          {readOnly
            ? `${ready} ${ready === 1 ? 'ad' : 'ads'} from this run`
            : running && ready === 0
              ? 'Making your ads…'
              : ready > 0
                ? `${ready} ${ready === 1 ? 'ad' : 'ads'} ready`
                : 'Generation finished'}
        </h3>
        {running && (
          <span className={MUTED}>
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
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3.5 py-3 text-13 text-[#92400E] dark:text-[#E8A33D]">
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
        <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ${CARD} px-5 py-3.5`}>
          <p className={MUTED}>
            {running ? (
              <>
                <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>{ready}</b>{' '}
                of <span className={NUM}>{ready + pending}</span> ready
              </>
            ) : (
              <>
                <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>{ready}</b>{' '}
                {ready === 1 ? 'ad' : 'ads'} ready
              </>
            )}
            {creditsHeld != null && (
              <>
                {' · '}
                <span className={NUM}>{creditsHeld}</span> credits held, settled on
                what lands
              </>
            )}
          </p>

          {!running && ready > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Regenerating costs the same as generating did. The credits
                  line above reports what the LAST run held; this says what
                  pressing the button again will cost, before it is pressed. */}
              <GhostBtn onClick={onRegenerate} disabled={regenerating}>
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>
                  Regenerate all
                  {estimate != null && (
                    <span className={`ml-1 font-normal ${FAINT}`}>~{estimate} credits</span>
                  )}
                </span>
              </GhostBtn>
              {/* Two futures for this batch, and neither is the obvious
                  default — posting once is the smaller commitment, scheduling
                  is the bigger one, so posting is the ghost and scheduling
                  keeps the solid button. */}
              {onShip && (
                <GhostBtn onClick={onShip} disabled={shipping}>
                  <Rocket className="h-3.5 w-3.5" />
                  <span>Post these ads</span>
                </GhostBtn>
              )}
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
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div
        className="relative bg-[#F9FAFB] dark:bg-[#22272F]"
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
      <div className={`flex flex-1 flex-col gap-1.5 border-t px-3.5 py-3 ${RULE_BORDER}`}>
        {copy.headline && (
          <b className="text-13 leading-snug font-medium text-[#111827] dark:text-[#ECEFF3]">
            {copy.headline}
          </b>
        )}
        {copy.primaryText && (
          <p className="line-clamp-3 text-13 leading-relaxed text-[#6B7280] dark:text-[#AFB6C0]">
            {copy.primaryText}
          </p>
        )}
        {/* CTA left, per-card regenerate right. One card being wrong is the
            common case — far more common than wanting a whole new batch — so
            the fix sits on the card rather than only at the bottom of the page. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="inline-flex rounded-md bg-[#111827] px-2.5 py-1 text-10 font-semibold text-white dark:bg-[#ECEFF3] dark:text-[#0A0A0A]">
            {callToAction}
          </span>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="text-13 text-[#9CA3AF] transition-colors hover:text-[#111827] dark:text-[#6C7480] dark:hover:text-[#ECEFF3]"
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
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div
        className="relative animate-pulse bg-[#F3F4F6] dark:bg-[#191E24]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <RatioBadge ratio={ratio} />
      </div>
      <div className={`flex flex-col gap-2 border-t px-3.5 py-3 ${RULE_BORDER}`}>
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className="h-2 w-full animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className="h-2 w-2/3 animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className={`mt-1 ${FAINT}`}>Generating…</span>
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
