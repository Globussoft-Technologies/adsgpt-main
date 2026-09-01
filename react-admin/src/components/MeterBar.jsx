/**
 * A Meta rate-limit meter, shown as a bar against a fixed 0-100 scale.
 *
 * WHY A FIXED SCALE AND NOT A RELATIVE ONE. These are percentages of a
 * ceiling Meta enforces, not quantities to compare against each other. A
 * chart that scaled to the largest value would render a quiet day at 3% as a
 * full bar and make every day look identical — the whole signal here is
 * distance from 100, so the axis has to be 100.
 *
 * The thresholds match services/autopilot/metaRateLimiter.js exactly: below
 * 75 the limiter does nothing, 75-95 it slows down, above 95 it waits hard.
 * Keeping the page and the engine on the same numbers means an amber bar is
 * literally "the point where we started throttling ourselves", not a
 * designer's guess.
 */
import { cn } from "@/lib/utils";

export const METER_OK = 75;
export const METER_HOT = 95;

export function meterTone(pct) {
  const n = Number(pct) || 0;
  if (n >= METER_HOT) return "rose";
  if (n >= METER_OK) return "amber";
  return "emerald";
}

const FILL = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};
const TEXT = {
  emerald: "text-emerald-700",
  amber: "text-amber-700",
  rose: "text-rose-700",
};

export default function MeterBar({ label, hint, value, scope }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = meterTone(pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {scope ? (
            <span
              className={cn(
                "ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                scope === "app"
                  ? "bg-violet-100 text-violet-700"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              {scope === "app" ? "shared" : "per account"}
            </span>
          ) : null}
        </div>
        <span className={cn("text-sm font-semibold tabular-nums", TEXT[tone])}>
          {pct.toFixed(0)}%
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all", FILL[tone])}
          style={{ width: `${pct}%` }}
        />
        {/* Where self-throttling begins, so a bar can be read against it. */}
        <div
          aria-hidden
          className="absolute top-0 h-full w-px bg-slate-300"
          style={{ left: `${METER_OK}%` }}
        />
      </div>

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
