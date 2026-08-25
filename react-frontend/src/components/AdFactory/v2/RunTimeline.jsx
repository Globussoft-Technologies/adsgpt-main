import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  EllipsisVertical,
  ExternalLink,
  Loader2,
  MessageCircle,
  Share2,
  ThumbsUp,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { AnimatePresence, motion } from 'framer-motion';

import { Panel, PanelBody, PanelHeader, GhostBtn } from './Panel';
import { useMotionPresets } from './_motion';
import { CONTROL, FAINT, LABEL, MUTED, NUM } from './_tokens';

// ----------------------------------------------------------------------------
// RunTimeline — deliveries, which are the home of a live brief.
//
// Three numbers first, then the cycles. `runHistory[]` is already a
// chronological log carrying per-run status, creatives, ad ids, deep links and
// errors, so this renders it as what it is rather than animating a graph edge
// over it.
//
// Every row states an outcome in words before it shows anything else — "2 ads
// live", "1 live · 1 failed", "scheduled" — because the question a user opens
// this screen with is "did it work", not "what happened".
//
// A failed run is the only place this surface raises its voice, and it always
// comes with the reason and a way to act on it.
// ----------------------------------------------------------------------------

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

const srcOf = (data) => {
  const s = String(data || '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${S3}${s}`;
};

const when = (value, { withTime = true } = {}) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (!withTime) return day;
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

export default function RunTimeline({
  summary,
  rows = [],
  loading = false,
  onRetry,
  brandName,
  pairsPerCycle,
}) {
  const M = useMotionPresets();
  const live = summary?.status === 'active';
  const nextRunAt = summary?.nextRunAt ? new Date(summary.nextRunAt) : null;
  const remaining = useCountdown(nextRunAt, live);

  if (loading && rows.length === 0) {
    return (
      <section className="flex w-full justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[#9CA3AF] dark:text-[#8B939E]" />
      </section>
    );
  }

  // A brief nobody has scheduled yet is the normal case, not an error.
  if (!summary && rows.length === 0) return null;

  const cadence = [
    summary?.frequency,
    Number.isInteger(summary?.hour) ? clock(summary.hour) : null,
    summary?.timezone ? shortZone(summary.timezone) : null,
    pairsPerCycle ? `${pairsPerCycle} pairs per run` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Panel>
      {/* Named after the brand, not the feature. This is the screen a returning
          user lands on, and "Deliveries" tells them nothing they didn't know —
          which brand is running is the useful fact. */}
      <PanelHeader
        title={brandName || 'Deliveries'}
        subtitle={cadence || 'Not scheduled yet'}
        // Pause / Resume / Stop live on SchedulePanel directly above this, next
        // to the cadence they act on. They were here too, which put two copies
        // of the same control on one screen — the thing that made "Keep these
        // coming" confusing the first time round.
        right={
          <span
            className={`rounded-md px-2 py-0.5 text-13 font-medium ${
              live
                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                : 'bg-[#F3F4F6] text-[#6B7280] dark:bg-[#22272F] dark:text-[#AFB6C0]'
            }`}
          >
            {live ? 'Live' : sentence(summary?.status || 'paused')}
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-5">
        {/* The three numbers worth knowing at a glance. */}
        <div className="grid grid-cols-3 gap-2.5">
          <Metric label="Ads live" value={summary?.adsPublished ?? 0} />
          <Metric label="Cycles run" value={summary?.totalRuns ?? 0} />
          <Metric
            label={live && nextRunAt ? 'Next cycle' : 'Next run'}
            value={
              live && nextRunAt
                ? remaining || '—'
                : summary?.nextRunAt
                  ? when(summary.nextRunAt)
                  : '—'
            }
            subtext={live && nextRunAt ? when(summary.nextRunAt) : null}
            highlight={live && !!remaining}
            small
          />
        </div>

        <motion.ol {...M.stagger(0.05)} className="m-0 flex list-none flex-col p-0">
          {rows.map((row, i) => (
            <Cycle
              key={row.runId || i}
              row={row}
              last={i === rows.length - 1}
              onRetry={onRetry}
              motionProps={M.staggerItem}
            />
          ))}
        </motion.ol>
      </PanelBody>
    </Panel>
  );
}

function Metric({ label, value, subtext = null, small = false, highlight = false }) {
  return (
    <div className={`flex flex-col gap-1.5 px-3.5 py-3 ${CONTROL}`}>
      <span className={LABEL}>{label}</span>
      <b
        className={`font-semibold tracking-[-0.017em] ${NUM} ${
          small ? 'text-13' : 'text-[17px]'
        } ${highlight ? 'text-[#15DCFF]' : ''}`}
      >
        {value}
      </b>
      {subtext && <span className={`text-[11px] ${MUTED}`}>{subtext}</span>}
    </div>
  );
}

function useCountdown(target, running) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, target]);

  if (!target) return '';
  const diff = target.getTime() - now;
  if (diff <= 0) return 'Any moment now';

  const totalSeconds = Math.floor(diff / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

function pad(n) {
  return n.toString().padStart(2, '0');
}

const BULLET = {
  live: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
  part: 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
  fail: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]',
  next: 'border-2 border-[#D1D5DB] bg-transparent dark:border-[#3D4650]',
};

const PILL = {
  live: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  part: 'bg-[#F59E0B]/12 text-[#B45309] dark:text-[#E8A33D]',
  fail: 'bg-red-500/12 text-red-700 dark:text-red-400',
  next: 'bg-[#F3F4F6] text-[#6B7280] dark:bg-[#22272F] dark:text-[#AFB6C0]',
};

function Cycle({ row, last, onRetry, motionProps }) {
  const [open, setOpen] = useState(false);
  const [previewCreative, setPreviewCreative] = useState(null);
  const scheduled = row.scheduled || row.status === 'scheduled';
  const failedOnly = !scheduled && row.liveCount === 0 && row.failedCount > 0;
  const partial = row.liveCount > 0 && row.failedCount > 0;

  const tone = scheduled ? 'next' : failedOnly ? 'fail' : partial ? 'part' : 'live';

  // Sentence case, not caps. Every row carried a shouted label, and when
  // everything shouts the one row that actually failed no longer stands out.
  const label = scheduled
    ? 'Scheduled'
    : failedOnly
      ? 'Failed'
      : partial
        ? `${row.liveCount} live · ${row.failedCount} failed`
        : `${row.liveCount} ${row.liveCount === 1 ? 'ad' : 'ads'} live`;

  const link = (row.links || []).find((l) => l?.url);

  return (
    <motion.li {...motionProps} className="relative grid grid-cols-[16px_1fr] gap-3 pb-4">
      {!last && (
        <span className="absolute top-5 bottom-0 left-1.75 w-px bg-[#E5E7EB] dark:bg-[#252B33]" />
      )}
      <span className={`relative z-1 mx-0.75 mt-1.5 size-2.5 rounded-full ${BULLET[tone]}`} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <b className="text-sm font-semibold tracking-[-0.011em] text-[#0A0A0A] dark:text-[#ECEFF3]">
            Cycle {row.cycle ?? '—'}
          </b>
          <span className={MUTED}>{when(row.startedAt)}</span>
          <span className={`rounded-md px-2 py-0.5 text-13 font-medium ${PILL[tone]}`}>
            {label}
          </span>
          {link && (
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-13 text-[#6B7280] transition-colors hover:text-[#111827] dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]"
            >
              View on {link.platform || 'Meta'}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {scheduled && (
          <p className={`mt-1 ${FAINT}`}>Nothing to do — we&apos;ll run it for you.</p>
        )}

        {/* Thumbnails summarise; the expansion is the published-ads view.
            v1 had a 1000-line modal for this. The data was already on the row —
            what was missing was per-creative outcome, so a 3-pair run showed one
            "View on Meta" link built from `metaAdId` and said nothing about the
            other two, or about which one failed. */}
        {row.creatives?.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-2.5 flex w-full items-center gap-2 text-left"
            >
                <span className="flex flex-wrap items-center gap-2">
                  {row.creatives.slice(0, 6).map((c, i) => (
                    <img
                      key={c.creativeId || i}
                      src={srcOf(c.imageUrl)}
                      alt={c.headline || ''}
                      loading="lazy"
                      className={`h-12 w-10 rounded-md border object-cover ${
                        c.posted === false
                          ? 'border-red-500/40 opacity-50'
                          : 'border-[#E5E7EB] dark:border-[#2E353E]'
                      }`}
                    />
                ))}
              </span>
              <span className={`ml-auto inline-flex shrink-0 items-center gap-1 ${MUTED}`}>
                {open ? 'Hide ads' : `${row.creatives.length === 1 ? 'the ad' : 'all ads'}`}
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.ul
                  key="ads"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="m-0 mt-2.5 flex list-none flex-col gap-1.5 overflow-hidden p-0"
                >
                  {row.creatives.map((c, i) => (
                    <PublishedAd
                      key={c.creativeId || i}
                      creative={c}
                      onPreview={() => setPreviewCreative(c)}
                    />
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </>
        )}

        <TimelinePreviewDialog
          creative={previewCreative}
          open={Boolean(previewCreative)}
          onOpenChange={(next) => {
            if (!next) setPreviewCreative(null);
          }}
        />

        {row.error && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3 py-2.5 text-13 text-[#92400E] dark:text-[#E8A33D]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{row.error}</span>
            {onRetry && (
              <GhostBtn onClick={onRetry}>
                <span>Retry</span>
              </GhostBtn>
            )}
          </div>
        )}
      </div>
    </motion.li>
  );
}

// One published ad: what it says, whether it went live, and where to see it.
//
// `posted` is per-creative and comes from that creative's own `postedAdIds`, so
// a partial run shows exactly which pair failed rather than a count. `posted`
// is checked against `false` explicitly — an older timeline payload has no such
// field, and treating undefined as "failed" would mark every historical ad red.
function PublishedAd({ creative, onPreview }) {
  const failed = creative.posted === false;
  const link = (creative.adLinks || [])[0];

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview?.();
        }
      }}
      className={`flex cursor-pointer items-center gap-2.5 p-2 transition-colors hover:bg-white/3 ${CONTROL}`}
    >
      {creative.imageUrl ? (
        <img
          src={srcOf(creative.imageUrl)}
          alt=""
          loading="lazy"
          className="h-11 w-9 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="h-11 w-9 shrink-0 rounded-md bg-[#F3F4F6] dark:bg-[#22272F]" />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-13 font-medium text-[#111827] dark:text-[#ECEFF3]">
          {creative.headline || 'Untitled ad'}
        </b>
        {creative.message && (
          <span className={`truncate ${FAINT}`}>
            {creative.message}
          </span>
        )}
      </span>

      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-13 font-medium ${
          failed ? PILL.fail : PILL.live
        }`}
      >
        {failed ? 'Not posted' : 'Live'}
      </span>

      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex shrink-0 items-center gap-1 text-13 text-[#6B7280] transition-colors hover:text-[#111827] dark:text-[#AFB6C0] dark:hover:text-[#ECEFF3]"
        >
          View
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

const sentence = (v) => String(v || '').replace(/^./, (c) => c.toUpperCase());

// 9 -> "9:00 AM"; a cadence line reads as a sentence, not a setting.
function clock(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

function shortZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || String(tz).split('/').pop();
  } catch {
    return String(tz).split('/').pop();
  }
}

function TimelinePreviewDialog({ creative, open, onOpenChange }) {
  const failed = creative?.posted === false;
  const link = (creative?.adLinks || [])[0];
  const platformLabel = link?.platform || creative?.platform || 'Meta';
  const accountName = creative?.accountName || creative?.pageName || 'Preview account';
  const postedAt = creative?.postedAt || creative?.createdAt || creative?.timestamp;
  const initial = (creative?.brandName || creative?.headline || 'A').slice(0, 1).toUpperCase();
  const ctaLabel = formatCta(creative?.cta || creative?.callToAction);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,92vw)] max-w-[400px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0F1115] p-0 text-white shadow-2xl [&>button]:top-5 [&>button]:right-5 [&>button]:z-20 [&>button]:rounded-md [&>button]:border [&>button]:border-white/10 [&>button]:bg-[#171A20] [&>button]:p-1 [&>button]:text-white/80 [&>button]:opacity-100 [&>button]:transition-colors [&>button]:hover:bg-[#1E222B] [&>button]:hover:text-white [&>button]:focus:ring-0 [&>button_svg]:h-3.5 [&>button_svg]:w-3.5">
        <DialogHeader className="border-b border-white/8 px-5 py-4 pr-16 text-left">
          <DialogTitle className="text-[16px] font-semibold text-white">
            Ad Preview
          </DialogTitle>
        </DialogHeader>

        <div className="flex justify-center p-5">
          <div className="w-full max-w-[360px] overflow-hidden rounded-xl border border-white/10 bg-white text-gray-800 shadow-sm">
            <div className="flex items-start justify-between gap-2 px-3 pt-3">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#167beb] text-xs font-bold text-white">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[12px] leading-tight font-semibold text-gray-900">
                      {creative?.brandName || 'Brand'}
                    </span>
                    <span className="truncate rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      {platformLabel} · {accountName}
                    </span>
                  </div>
                  {postedAt && (
                    <div className="mt-0.5 truncate text-[10px] text-gray-500">
                      {formatPostedAt(postedAt)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow ${
                    failed ? 'bg-red-500' : 'bg-emerald-500'
                  }`}
                >
                  {failed ? (
                    <>
                      <AlertTriangle className="size-3" />
                      Failed
                    </>
                  ) : (
                    <>
                      <Check className="size-3" />
                      Posted
                    </>
                  )}
                </span>
                <EllipsisVertical className="size-4 text-gray-400" />
              </div>
            </div>

            <div className="mt-2 px-3 text-[11px] leading-snug text-gray-700">
              {creative?.message || (
                <span className="text-gray-500">No ad copy available</span>
              )}
            </div>

            <div className="mx-3 mt-2 aspect-square overflow-hidden rounded-md bg-[#E4E6EB]">
              {creative?.imageUrl ? (
                <img
                  src={srcOf(creative.imageUrl)}
                  alt={creative?.headline || 'Published ad'}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-500">
                  No image available
                </div>
              )}
            </div>

            <div className="m-3 flex items-center justify-between gap-2 rounded bg-[#F7F8FA] p-2">
              <div className="min-w-0">
                <div className="line-clamp-1 break-all text-[9px] text-gray-500">
                  {link?.url || creative?.linkUrl || 'No link'}
                </div>
                <div className="truncate text-[11px] leading-tight font-semibold text-gray-900">
                  {creative?.headline || 'Untitled ad'}
                </div>
              </div>
              <span className="shrink-0 rounded-md bg-[#E4E6EB] px-3 py-1.5 text-[10px] font-semibold text-[#191919]">
                {ctaLabel || 'Learn More'}
              </span>
            </div>

            <div className="mx-3 mb-3 flex items-center justify-around border-t border-gray-200 pt-2 text-gray-500">
              <span className="flex items-center gap-1 text-[10px] font-medium">
                <ThumbsUp className="size-3.5" />
                Like
              </span>
              <span className="flex items-center gap-1 text-[10px] font-medium">
                <MessageCircle className="size-3.5" />
                Comment
              </span>
              <span className="flex items-center gap-1 text-[10px] font-medium">
                <Share2 className="size-3.5" />
                Share
              </span>
            </div>

            {failed && creative?.runError && (
              <div className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-[10px] leading-tight text-red-700">
                <span className="font-semibold">Reason:</span> {creative.runError}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatPostedAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCta(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
