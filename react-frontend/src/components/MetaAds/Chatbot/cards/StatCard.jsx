import React from 'react';
import { ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';

// Delta chip — green up / red down, mirrors the dashboard's ChangeChip.
const DeltaChip = ({ delta }) => {
  if (delta == null || Number.isNaN(delta) || delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
        up ? 'text-emerald-500' : 'text-red-500'
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(delta).toFixed(1)}%
    </span>
  );
};

const toneClass = (tone) =>
  tone === 'good'
    ? 'text-emerald-500 dark:text-emerald-400'
    : tone === 'bad'
      ? 'text-red-500 dark:text-red-400'
      : 'text-gray-900 dark:text-white';

// Tiny inline trend line — raw SVG polyline rather than recharts, since at
// this size (a stat tile) a charting library is overkill.
const Sparkline = ({ points = [] }) => {
  if (points.length < 2) return null;
  const w = 56;
  const h = 18;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
      <polyline
        points={coords}
        fill="none"
        stroke={up ? '#10b981' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Titled grid of headline metrics. Values arrive display-ready from the model.
// When `badge` is set it becomes a glowing hero card (the "TOP PERFORMER"
// look), themed to the app's cyan→violet accent.
const StatCard = ({ title, subtitle, badge, stats = [] }) => {
  const hero = Boolean(badge);
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-3 ${
        hero
          ? 'border-[#15DCFF]/30 bg-gradient-to-br from-[#15DCFF]/[0.08] via-transparent to-[#6b72f8]/[0.10] dark:border-[#15DCFF]/20'
          : 'border-gray-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]'
      }`}
    >
      {hero && (
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-40 blur-2xl"
          style={{ background: 'radial-gradient(circle, #6b72f8, transparent 70%)' }}
        />
      )}

      <div className="relative">
        {badge && (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#15DCFF]/20 to-[#6b72f8]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0a8fb0] dark:text-[#15DCFF]">
            <Sparkles className="h-3 w-3" />
            {badge}
          </span>
        )}
        {(title || subtitle) && (
          <div className="mb-2.5">
            {title && (
              <p className={`font-semibold text-gray-900 dark:text-white ${hero ? 'text-[15px]' : 'text-sm'}`}>
                {title}
              </p>
            )}
            {subtitle && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {stats.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-100 bg-gray-50/80 px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.03]"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {s.label}
              </p>
              <div className="mt-0.5 flex items-center justify-between gap-1.5">
                <div className="flex items-baseline gap-1">
                  <span className={`text-[15px] font-semibold ${toneClass(s.tone)}`}>{s.value}</span>
                  <DeltaChip delta={s.delta} />
                </div>
                <Sparkline points={s.trend} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default StatCard;
