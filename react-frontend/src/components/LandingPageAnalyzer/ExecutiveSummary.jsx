import { AlertTriangle, ClipboardList, Lock, Smartphone, Unlock, Zap } from 'lucide-react';
import { Card, SectionTitle, CardCaption } from './_atoms';
import ScoreGauge from './ScoreGauge';
import { deriveKeySignals, scoreBand, SEV_HEX } from './helpers';

const SIGNAL_ICONS = { zap: Zap, smartphone: Smartphone, lock: Lock, unlock: Unlock, alert: AlertTriangle };

// BLOCK 1 — Hero (compact, in-card). Top: score ring + caption/summary side by
// side. Bottom: Key Signals as a 2×2 grid. `bare` skips the Card wrapper so it
// can share a container with Page Overview. `showCaption=false` drops the in-card
// heading (when the heading is rendered by a parent container instead).
export default function ExecutiveSummary({ report, bare = false, showCaption = true }) {
  const overall = report?.overall || {};
  const band = scoreBand(overall.score);
  const signals = deriveKeySignals(report);

  const content = (
    <>
      {showCaption && <CardCaption className="mb-5">Executive Summary</CardCaption>}

      <div className="grid flex-1 gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
        {/* score panel */}
        <div className="flex flex-col items-center gap-3 text-center sm:border-r sm:border-gray-200 sm:pr-6 dark:sm:border-white/10">
          <ScoreGauge score={overall.score} band={band} size={150} stroke={9} />
          <span className={`inline-flex items-center gap-1.5 text-base font-extrabold ${band.text}`}>
            <AlertTriangle className="h-4 w-4" />
            {overall.grade || band.label}
          </span>
          {/* <span className="text-13 text-gray-400 dark:text-white/45">Overall Score</span> */}
        </div>

        {/* summary */}
        {overall.summary && (
          <p className="text-sm 2xl:text-15 -mt-3 leading-relaxed text-gray-700 dark:text-[#dcdce2]">
            {overall.summary}
          </p>
        )}
      </div>

      {/* Key Signals — 2×2 */}
      <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {signals.map((sig) => (
          <StatTile key={sig.label} sig={sig} />
        ))}
      </div>
    </>
  );

  if (bare) return <div className="flex h-full flex-col p-6 2xl:p-7">{content}</div>;
  return <Card className="flex h-full flex-col p-6 2xl:p-7">{content}</Card>;
}

function StatTile({ sig }) {
  const c = SEV_HEX[sig.sev] || '#9ca3af';
  const Icon = SIGNAL_ICONS[sig.icon] || Zap;
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/2.5">
      <div className="flex items-center gap-1.5 text-gray-400 dark:text-white/45">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-bold uppercase tracking-wide">{sig.label}</span>
      </div>
      <div
        className="mt-2 text-2xl font-extrabold leading-none tracking-tight"
        style={{ color: c }}
      >
        {sig.value}
      </div>
      <div className="mt-1.5 text-13 text-gray-500 dark:text-white/55">{sig.sub}</div>
    </div>
  );
}
