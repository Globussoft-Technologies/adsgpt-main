import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, Rocket, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { PrimaryBtn, GhostBtn } from './Panel';
import { useMotionPresets } from './_motion';
import { CARD, FAINT, MUTED, NUM, RULE_BORDER, SECTION } from './_tokens';

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

// ─── What this card still does, and what moved ───────────────────────────────
//
// Both of these are OFF because the right rail and the gallery now own the same
// jobs, better — not because the code was wrong. Flip either to true and the
// old behaviour comes back exactly as it was; nothing below was deleted.
//
// SHOW_INLINE_LIST — the collapsible "Show list" grid of ad cards.
//   Superseded by "See all generations", which shows every run at once rather
//   than one at a time, previews each ad in Ad Factory's phone frame, and is
//   the only place a selection can be posted. Kept collapsed by default, this
//   header was a control whose entire function was "open the worse version of
//   the gallery".
//
// SHOW_REGENERATE — the "Regenerate all · ~N credits" button.
//   The rail's Generate button is the same action, sitting on the card that
//   prices it, next to the stepper that sets how many. Two buttons doing one
//   thing, one of them quoting a number the other one owns.
//
// What is left is the part neither of those covers: how many ads are ready,
// how many credits are held against them, and the way through to the schedule.
const SHOW_INLINE_LIST = false;
const SHOW_REGENERATE = false;

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
  onShip,
  shipping = false,
  regenerating = false,
  creditsHeld,
  estimate = null,
  ratio = '4:5',
  readOnly = false,
  showActions = true,
}) {
  const M = useMotionPresets();
  const [collapsed, setCollapsed] = useState(true);
  const pairs = run?.pairs || [];
  const pending = run?.pending || 0;
  const failed = run?.failed || 0;
  const running = run?.status === 'running';
  const ready = pairs.length;

  if (!running && ready === 0 && failed === 0) return null;

  const title = readOnly
    ? `${ready} ${ready === 1 ? 'ad' : 'ads'} from this run`
    : running && ready === 0
      ? 'Making your ads...'
      : ready > 0
        ? `${ready} ${ready === 1 ? 'ad' : 'ads'} ready`
        : 'Generation finished';

  return (
    <section className="flex flex-col gap-3">
      {SHOW_INLINE_LIST && (
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${RULE_BORDER} bg-[var(--ws-surface)] hover:bg-[var(--ws-surface-hover)] dark:bg-[#171717] dark:hover:bg-[#202020]`}
        >
          <div className="min-w-0">
            <h3 className={`text-15 tracking-[-0.013em] ${SECTION}`}>{title}</h3>
            {running && (
              <span className={MUTED}>
                This takes a couple of minutes - you can leave and come back.
              </span>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 text-[12px] text-[#7A6F62] dark:text-[#AFB6C0]">
            <span>{collapsed ? 'Show list' : 'Hide list'}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            />
          </span>
        </button>
      )}

      {SHOW_INLINE_LIST && !collapsed && (
        <motion.div
          layout={!M.reduce}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {pairs.map((pair, i) => (
              <motion.div key={pair.imageUrl || `pair-${i}`} layout={!M.reduce} {...M.fadeUp}>
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
      )}

      {failed > 0 && (
        <div className="text-13 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3.5 py-3 text-[#92400E] dark:text-[#E8A33D]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {failed} didn&apos;t come out this time.
            {ready > 0 ? " You're only charged for the ones that worked." : ''}
          </span>
        </div>
      )}

      <div
        className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 ${CARD} px-5 py-3.5`}
      >
        {/* With the list header off, this is the only place the run reports
            itself — so the reassurance that used to sit up there comes down
            here rather than disappearing with it. */}
        <div className="flex min-w-0 flex-col gap-0.5">
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
                <span className={NUM}>{creditsHeld}</span> credits held, settled on what lands
              </>
            )}
          </p>
          {running && (
            <span className={FAINT}>
              This takes a couple of minutes - you can leave and come back.
            </span>
          )}
        </div>

        {showActions && !running && ready > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            {SHOW_REGENERATE && (
              <GhostBtn onClick={onRegenerate} disabled={regenerating}>
                <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
                <span>
                  Regenerate all
                  {estimate != null && (
                    <span className={`ml-1 font-normal ${FAINT}`}>~{estimate} credits</span>
                  )}
                </span>
              </GhostBtn>
            )}
            {onShip && (
              <GhostBtn onClick={onShip} disabled={shipping}>
                <Rocket className="h-3.5 w-3.5" />
                <span>Post these ads</span>
              </GhostBtn>
            )}
            <PrimaryBtn icon={Sparkles} onClick={onContinue}>
              Keep these coming {'->'}
            </PrimaryBtn>
          </div>
        )}
      </div>
    </section>
  );
}

function Card({ pair, ratio, callToAction, onRegenerate }) {
  const copy = pair.copy || {};
  return (
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div className="group flex flex-col text-left">
        <div
          className="relative bg-[var(--ws-surface-hover)] dark:bg-[#242424]"
          style={{ aspectRatio: aspectOf(ratio) }}
        >
          <img
            src={srcOf(pair.imageUrl)}
            alt={copy.headline || 'Generated ad'}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
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
            <p className="text-13 line-clamp-3 leading-relaxed text-[#6B7280] dark:text-[#AFB6C0]">
              {copy.primaryText}
            </p>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <span className="inline-flex min-w-0 max-w-full items-center rounded-md border border-[var(--ws-border)] bg-[var(--ws-surface-hover)] px-2.5 py-1 text-[11px] font-medium tracking-tight text-[var(--ws-text-primary)] shadow-2xs transition-colors dark:border-[#333] dark:bg-[#202020] dark:text-[#ECEFF3]">
              <span className="truncate">{(callToAction || 'Shop now').replace(/_/g, ' ')}</span>
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
      </div>
    </article>
  );
}

function SkeletonCard({ ratio }) {
  return (
    <article className={`flex flex-col overflow-hidden ${CARD}`}>
      <div
        className="relative animate-pulse bg-[var(--ws-surface-hover)] dark:bg-[#202020]"
        style={{ aspectRatio: aspectOf(ratio) }}
      >
        <RatioBadge ratio={ratio} />
      </div>
      <div className={`flex flex-col gap-2 border-t px-3.5 py-3 ${RULE_BORDER}`}>
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className="h-2 w-full animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className="h-2 w-2/3 animate-pulse rounded bg-[#F3F4F6] dark:bg-[#22272F]" />
        <span className={`mt-1 ${FAINT}`}>Generating...</span>
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
