import { AlertTriangle, ClipboardList, Lock, Smartphone, Zap } from 'lucide-react';
import { Card, SectionTitle } from './_atoms';
import ScoreGauge from './ScoreGauge';
import { deriveKeySignals, scoreBand, SEV_HEX } from './helpers';

const SIGNAL_ICONS = { zap: Zap, smartphone: Smartphone, lock: Lock, alert: AlertTriangle };

// BLOCK 1 — Hero. Left: score ring + verdict. Right: summary + Key Signals.
export default function ExecutiveSummary({ report }) {
  const overall = report?.overall || {};
  const band = scoreBand(overall.score);
  const signals = deriveKeySignals(report);
  const categories = (report?.dimensions || []).length;

  return (
    <>
      <SectionTitle icon={ClipboardList} hint="The headline read on this page's conversion readiness.">
        Executive Summary
      </SectionTitle>

      <Card className="p-8">
        <div className="grid gap-8 md:grid-cols-[300px_1px_1fr] md:items-stretch">
          {/* score panel */}
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <span className="text-13 font-extrabold tracking-[0.16em] text-gray-400 dark:text-white/45">
              CONVERSION SCORE
            </span>
            <ScoreGauge score={overall.score} band={band} />
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-6 py-2.5 text-base font-extrabold ${band.bg} ${band.ring} ${band.text}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
              {overall.grade || band.label}
            </span>
            {categories > 0 && (
              <span className="text-sm text-gray-400 dark:text-white/45">
                {categories} categories scored
              </span>
            )}
          </div>

          {/* divider */}
          <div className="hidden bg-gray-200 dark:bg-white/10 md:block" />

          {/* summary + signals */}
          <div className="flex flex-col justify-center gap-7">
            {overall.summary && (
              <div className="relative pl-5 text-[17px] leading-relaxed text-gray-700 dark:text-[#dcdce2]">
                <span className="absolute inset-y-0.5 left-0 w-1 rounded bg-linear-to-b from-[#15DCFF] to-[#6b72f8]" />
                {overall.summary}
              </div>
            )}

            <div>
              <div className="mb-4 text-13 font-extrabold tracking-widest text-gray-400 dark:text-white/45">
                KEY SIGNALS
              </div>
              <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
                {signals.map((sig) => (
                  <StatTile key={sig.label} sig={sig} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}

function StatTile({ sig }) {
  const c = SEV_HEX[sig.sev] || '#9ca3af';
  const Icon = SIGNAL_ICONS[sig.icon] || Zap;
  return (
    <div className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-4.5 dark:border-white/10 dark:bg-white/2.5">
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c }} />
      <div className="flex items-center gap-1.5 text-gray-400 dark:text-white/45">
        <Icon className="h-4 w-4" style={{ color: c }} />
        <span className="text-[11px] font-bold tracking-wide uppercase">{sig.label}</span>
      </div>
      <div className="text-[32px] font-extrabold leading-none tracking-tight" style={{ color: c }}>
        {sig.value}
      </div>
      <div className="text-sm text-gray-500 dark:text-white/55">{sig.sub}</div>
    </div>
  );
}
