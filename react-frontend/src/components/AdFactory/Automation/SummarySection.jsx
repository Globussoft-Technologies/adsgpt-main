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
// Pure derivation: pulls `summarizeCycles` from the helper and renders the
// numbers. No mutations.
// ----------------------------------------------------------------------------

export default function SummarySection({
  frequency,
  pairsPerCycle,
  creditsPerImage,
  availableCredits,
}) {
  const summary = useMemo(
    () => summarizeCycles({ frequency, pairsPerCycle, creditsPerImage, availableCredits }),
    [frequency, pairsPerCycle, creditsPerImage, availableCredits]
  );

  const nextRun = useMemo(() => computeNextRunAt(frequency, new Date()), [frequency]);

  const isOneTime = frequency?.preset === 'does_not_repeat';

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-linear-to-br from-[#15DCFF]/5 via-[#0D0D0D]/40 to-[#6b72f8]/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sigma className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">Summary</h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[#AFAFAF]">
          <span>{describeFrequency(frequency)}</span>
          {frequency?.timezone && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5">
              <Globe className="size-3" />
              {getOffsetLabel(frequency.timezone)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={isOneTime ? 'Run on' : 'Next run'}
          value={nextRun ? formatNextRun(nextRun) : '—'}
        />
        <Stat
          label="Cycles scheduled"
          value={
            summary.scheduled == null ? (
              <span className="inline-flex items-center gap-1">
                <InfinityIcon className="size-3.5" /> Open-ended
              </span>
            ) : (
              summary.scheduled
            )
          }
        />
        <Stat label="Credits / cycle" value={summary.costPerCycle} />
        <Stat
          label="Cycles your credits cover"
          value={
            summary.costPerCycle === 0
              ? '—'
              : summary.affordable.toLocaleString()
          }
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-white/5 bg-[#0D0D0D]/40 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-[#AFAFAF]">
          <Coins className="size-3.5 text-[#15DCFF]" />
          Total credits used across runnable cycles
        </div>
        <span className="text-sm font-semibold text-white">
          {summary.totalCost.toLocaleString()} / {availableCredits.toLocaleString()}
        </span>
      </div>

      {summary.exceedsCredits && (
        <Warning>
          You've scheduled <strong>{summary.scheduled}</strong> cycles but your credits cover{' '}
          <strong>{summary.affordable}</strong>. Automation will pause when credits run out.
        </Warning>
      )}

      {summary.isOpenEnded && summary.affordable === 0 && (
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
    <div className="flex flex-col gap-0.5 rounded-lg border border-white/5 bg-[#0D0D0D]/40 px-3 py-2">
      <span className="text-10 tracking-wide text-[#AFAFAF] uppercase">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function Warning({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
      <p className="text-xs leading-relaxed text-red-200/90">{children}</p>
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
