import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';

import { AnimatePresence, motion } from 'framer-motion';

import { Panel, PanelBody, PanelHeader, GhostBtn } from './Panel';
import { useMotionPresets } from './_motion';

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

  if (loading && rows.length === 0) {
    return (
      <section className="flex w-full justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400 dark:text-white/45" />
      </section>
    );
  }

  // A brief nobody has scheduled yet is the normal case, not an error.
  if (!summary && rows.length === 0) return null;

  const live = summary?.status === 'active';
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
            className={`rounded-full px-2.5 py-1 text-10 font-extrabold tracking-wider ${
              live
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/55'
            }`}
          >
            {live ? 'LIVE' : String(summary?.status || 'paused').toUpperCase()}
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-5">
        {/* The three numbers worth knowing at a glance. */}
        <div className="grid grid-cols-3 gap-2.5">
          <Metric label="Ads live" value={summary?.adsPublished ?? 0} />
          <Metric label="Cycles run" value={summary?.totalRuns ?? 0} />
          <Metric
            label="Next run"
            value={summary?.nextRunAt ? when(summary.nextRunAt) : '—'}
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

function Metric({ label, value, small = false }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2.5 dark:border-white/10 dark:bg-white/6">
      <span className="text-10 font-extrabold tracking-wider text-gray-400 uppercase dark:text-white/40">
        {label}
      </span>
      <b
        className={`font-bold tracking-tight text-gray-900 tabular-nums dark:text-white ${
          small ? 'text-13' : 'text-lg'
        }`}
      >
        {value}
      </b>
    </div>
  );
}

const BULLET = {
  live: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
  part: 'bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
  fail: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]',
  next: 'border-2 border-gray-300 bg-transparent dark:border-white/30',
};

const PILL = {
  live: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  part: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400',
  next: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/50',
};

function Cycle({ row, last, onRetry, motionProps }) {
  const [open, setOpen] = useState(false);
  const scheduled = row.scheduled || row.status === 'scheduled';
  const failedOnly = !scheduled && row.liveCount === 0 && row.failedCount > 0;
  const partial = row.liveCount > 0 && row.failedCount > 0;

  const tone = scheduled ? 'next' : failedOnly ? 'fail' : partial ? 'part' : 'live';

  const label = scheduled
    ? 'SCHEDULED'
    : failedOnly
      ? 'FAILED'
      : partial
        ? `${row.liveCount} LIVE · ${row.failedCount} FAILED`
        : `${row.liveCount} ${row.liveCount === 1 ? 'AD' : 'ADS'} LIVE`;

  const link = (row.links || []).find((l) => l?.url);

  return (
    <motion.li {...motionProps} className="relative grid grid-cols-[16px_1fr] gap-3 pb-4">
      {!last && (
        <span className="absolute top-5 bottom-0 left-1.75 w-px bg-gray-200 dark:bg-white/10" />
      )}
      <span className={`relative z-1 mx-0.75 mt-1.5 size-2.5 rounded-full ${BULLET[tone]}`} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <b className="text-13 font-bold text-gray-900 dark:text-white">
            Cycle {row.cycle ?? '—'}
          </b>
          <span className="text-xs text-gray-500 dark:text-white/55">{when(row.startedAt)}</span>
          <span className={`rounded-full px-2 py-0.5 text-10 font-bold ${PILL[tone]}`}>
            {label}
          </span>
          {link && (
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:text-white/50 dark:hover:text-white"
            >
              View on {link.platform || 'Meta'}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {scheduled && (
          <p className="mt-1 text-xs text-gray-400 dark:text-white/40">Nothing to do — we&apos;ll run it for you.</p>
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
                        : 'border-gray-200 dark:border-white/10'
                    }`}
                  />
                ))}
              </span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-white/50">
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
                    <PublishedAd key={c.creativeId || i} creative={c} />
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </>
        )}

        {row.error && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
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
function PublishedAd({ creative }) {
  const failed = creative.posted === false;
  const link = (creative.adLinks || [])[0];

  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-100 p-2 dark:border-white/10 dark:bg-white/4">
      {creative.imageUrl ? (
        <img
          src={srcOf(creative.imageUrl)}
          alt=""
          loading="lazy"
          className="h-11 w-9 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="h-11 w-9 shrink-0 rounded-md bg-gray-200 dark:bg-white/10" />
      )}

      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-13 font-semibold text-gray-900 dark:text-white">
          {creative.headline || 'Untitled ad'}
        </b>
        {creative.message && (
          <span className="truncate text-xs text-gray-500 dark:text-white/50">
            {creative.message}
          </span>
        )}
      </span>

      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-bold ${
          failed ? PILL.fail : PILL.live
        }`}
      >
        {failed ? 'NOT POSTED' : 'LIVE'}
      </span>

      {link && (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:text-white/50 dark:hover:text-white"
        >
          View
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </li>
  );
}

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
