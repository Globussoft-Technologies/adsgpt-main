import React, { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Notice, Panel, PanelBody, PanelHeader } from './Panel';
import { FieldBlock } from './briefFields';

// ----------------------------------------------------------------------------
// InferringWithBudget — the ~35-second wait, spent productively.
//
// Reading a page takes about 35s cold (measured). That is long enough that a
// bare spinner reads as "broken".
//
// Autofill is a single synchronous POST and emits no progress events, so there
// is NO honest per-field signal to show. Two rules follow, both load-bearing:
//
//   1. Never fake per-field progress.
//   2. Show real elapsed time against the measured estimate, and say so plainly
//      when it overruns instead of parking at 99%.
//
// The flow needs a budget anyway, so we ask for it here. The wait stops being
// dead time and becomes input 2 of 2.
// ----------------------------------------------------------------------------

const ESTIMATE_MS = 35_000;

export default function InferringWithBudget({
  host,
  startedAt,
  budget,
  onBudgetChange,
  onStartOver,
  currencySymbol = '₹',
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const from = startedAt || Date.now();
    const tick = () => setElapsed(Date.now() - from);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Capped just short of full: the bar must never sit at 100% while we're
  // still waiting, because that's the moment it starts lying.
  const pct = Math.min(96, Math.round((elapsed / ESTIMATE_MS) * 100));
  const overrunning = elapsed > ESTIMATE_MS;
  const remaining = Math.max(0, Math.ceil((ESTIMATE_MS - elapsed) / 1000));

  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <Panel>
        <PanelHeader
          title={`Reading ${host || 'your page'}…`}
          subtitle={
            overrunning
              ? "This page is taking longer than usual. We're still going — you can keep filling in the budget below."
              : "We're pulling out your brand, audience and objective. Nothing to do while you wait — except the one thing below."
          }
          right={
            <span className="shrink-0 text-xs text-gray-500 tabular-nums dark:text-white/60">
              {overrunning ? `${Math.round(elapsed / 1000)}s` : `~${remaining}s left`}
            </span>
          }
        />

        <PanelBody className="flex flex-col gap-5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Reading your page"
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-[#15DCFF] to-[#6b72f8] transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>

          <FieldBlock
            label="While we read — what's your daily budget?"
            hint="nothing spends until you launch"
          >
            <div className="flex h-9 w-44 items-center gap-1.5 rounded-xl border border-gray-300 bg-gray-100 px-3 transition-colors focus-within:border-[#15DCFF]/40 dark:border-white/12 dark:bg-white/6">
              <span className="text-xs text-gray-400 dark:text-white/45 2xl:text-13">{currencySymbol}</span>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={budget ?? ''}
                onChange={(e) => onBudgetChange?.(e.target.value)}
                placeholder="800"
                className="w-full min-w-0 bg-transparent text-xs text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-white/45 2xl:text-13"
              />
              <span className="shrink-0 text-10 text-gray-400 dark:text-white/45">/day</span>
            </div>
          </FieldBlock>

          {overrunning && (
            <Notice tone="warn" icon={AlertCircle}>
              Some pages are slower to read than others — heavy sites, or ones behind a
              redirect. You can keep waiting, or start over below.
            </Notice>
          )}

          {/* The way out, available from the first second rather than appearing
              only once the estimate overruns. A wait with no visible exit reads
              as a trap, and the user who pasted the wrong URL knows it long
              before we do. */}
          {onStartOver && (
            <div className="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-white/10 dark:text-white/60">
              Wrong page, or taking too long?{' '}
              <button
                type="button"
                onClick={onStartOver}
                className="font-semibold text-[#6b72f8] underline underline-offset-2 hover:text-[#8c93ff] dark:text-[#aeb6ff]"
              >
                Start over
              </button>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
