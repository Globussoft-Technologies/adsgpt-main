import React, { useMemo } from 'react';
import { Sigma, AlertTriangle, Infinity as InfinityIcon, Coins, Globe } from 'lucide-react';
import {
  summarizeCycles,
  computeNextRunAt,
  describeFrequency,
} from '@/store/reducers/adFactoryAutomation/nextRun';
import { getOffsetLabel } from './TimezoneSelect';

// ----------------------------------------------------------------------------
// SummarySection — live readout of what the user just configured.
//
// Source of truth:
//   1. `apiSummary` — POST /jobs/summary response. Used once the form is
//      valid enough for the Activate/Update button to be enabled.
//   2. Local `summarizeCycles` helper — fallback while the form is still
//      incomplete (so the panel never appears empty).
//
// All derived numbers are normalised into the same shape regardless of source,
// so the JSX below doesn't have to branch.
// ----------------------------------------------------------------------------

export default function SummarySection({
  frequency,
  pairsPerCycle,
  creditsPerImage,
  availableCredits,
  apiSummary,
  apiLoading,
  disabled,
}) {
  const localSummary = useMemo(
    () => summarizeCycles({ frequency, pairsPerCycle, creditsPerImage, availableCredits }),
    [frequency, pairsPerCycle, creditsPerImage, availableCredits]
  );

  const localNextRun = useMemo(() => computeNextRunAt(frequency, new Date()), [frequency]);

  // Adapt the API response (when present) to the same shape the rest of this
  // component expects. Falls back to local-derived numbers otherwise.
  const view = useMemo(() => {
    if (apiSummary) {
      const cyclesScheduled = apiSummary.cyclesScheduled; // number | null (open-ended)
      const affordable = Number.isFinite(Number(apiSummary.cyclesCredsCover))
        ? Number(apiSummary.cyclesCredsCover)
        : null;
      const costPerCycle = Number.isFinite(Number(apiSummary.creditsPerCycle))
        ? Number(apiSummary.creditsPerCycle)
        : null;
      const totalCost = Number.isFinite(Number(apiSummary.creditsUsedAcrossRunnable))
        ? Number(apiSummary.creditsUsedAcrossRunnable)
        : 0;
      const total = Number.isFinite(Number(apiSummary.remainingCredits))
        ? Number(apiSummary.remainingCredits)
        : availableCredits;
      const isOpenEnded = cyclesScheduled == null;
      return {
        scheduled: cyclesScheduled,
        affordable,
        costPerCycle,
        totalCost,
        totalCredits: total,
        exceedsCredits: costPerCycle != null && affordable != null && cyclesScheduled != null && affordable < cyclesScheduled,
        isOpenEnded,
        nextRun: apiSummary.nextRunAt ? new Date(apiSummary.nextRunAt) : null,
        source: 'api',
      };
    }
    return {
      scheduled: localSummary.scheduled,
      affordable: localSummary.affordable,
      costPerCycle: localSummary.costPerCycle,
      totalCost: localSummary.totalCost,
      totalCredits: availableCredits,
      exceedsCredits: localSummary.exceedsCredits,
      isOpenEnded: localSummary.isOpenEnded,
      nextRun: localNextRun,
      source: 'local',
    };
  }, [apiSummary, localSummary, localNextRun, availableCredits]);

  const isOneTime = frequency?.preset === 'does_not_repeat';

  return (
    <section
      className={`relative flex flex-col gap-2.5 rounded-xl border border-black/10 bg-linear-to-br from-[#15DCFF]/5 via-slate-200/70 to-[#6b72f8]/5 px-4 py-3 transition dark:border-white/10 dark:via-[#0D0D0D]/40 ${
        disabled ? 'pointer-events-none select-none' : ''
      }`}
    >
      {disabled && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-200/70 backdrop-blur-sm dark:bg-[#0D0D0D]/40">
          <span className="rounded-full border border-black/10 bg-slate-300/90 px-3 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-[#0D0D0D]/80 dark:text-[#AFAFAF]">
            Fill all required fields to see the summary
          </span>
        </div>
      )}
      <div className={`flex items-center justify-between ${disabled ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2">
          <Sigma className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-gray-900 2xl:text-base dark:text-white">Summary</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-[#AFAFAF]">
          <span>{describeFrequency(frequency)}</span>
          {frequency?.timezone && (
            <span className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.04] px-1.5 py-0.5 dark:border-white/10 dark:bg-white/5">
              <Globe className="size-3" />
              {getOffsetLabel(frequency.timezone)}
            </span>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 transition ${apiLoading ? 'opacity-70' : ''} ${disabled ? 'opacity-60' : ''}`}>
        <Stat
          label={isOneTime ? 'Run on' : 'Next run'}
          value={view.nextRun ? formatNextRun(view.nextRun) : '—'}
        />
        <Stat
          label="Cycles scheduled"
          value={
            view.scheduled == null ? (
              <span className="inline-flex items-center gap-1">
                <InfinityIcon className="size-3.5" /> Open-ended
              </span>
            ) : (
              view.scheduled
            )
          }
        />
        <Stat label="Credits / cycle" value={view.costPerCycle ?? '—'} />
        <Stat
          label="Cycles your credits cover"
          value={
            view.costPerCycle == null || view.costPerCycle === 0
              ? '—'
              : (view.affordable ?? 0).toLocaleString()
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2.5 dark:border-white/5 dark:bg-[#0D0D0D]/40">
        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-[#AFAFAF]">
          <Coins className="size-3.5 text-[#15DCFF]" />
          Total credits used across runnable cycles
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {view.totalCost.toLocaleString()} / {view.totalCredits == null ? '—' : view.totalCredits.toLocaleString()}
        </span>
      </div>

      {view.exceedsCredits && (
        <Warning>
          You've scheduled <strong>{view.scheduled}</strong> cycles but your credits cover{' '}
          <strong>{view.affordable}</strong>. Automation will pause when credits run out.
        </Warning>
      )}

      {view.isOpenEnded && view.affordable === 0 && view.costPerCycle != null && (
        <Warning>
          Your credits don't cover even one cycle at this configuration. Reduce pairs per cycle or
          top up credits.
        </Warning>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/5 dark:bg-[#0D0D0D]/40">
      <span className="text-10 tracking-wide text-gray-500 uppercase dark:text-[#AFAFAF]">{label}</span>
      <span className="text-sm font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function Warning({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500 dark:text-red-400" />
      <p className="text-xs leading-relaxed text-red-700 dark:text-red-200/90">{children}</p>
    </div>
  );
}

function formatNextRun(d) {
  try {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}
