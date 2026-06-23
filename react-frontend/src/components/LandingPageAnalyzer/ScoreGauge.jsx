import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

// Count from 0 → target with an ease-out so the number "lands" with the arc.
function useCountUp(target, duration = 1100) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf;
    let startTs = null;
    const tick = (ts) => {
      if (startTs === null) startTs = ts;
      const t = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// Conversion-score ring (report.jsx style): glowing arc + big number + "/100".
export default function ScoreGauge({ score = 0, band, size = 210, stroke = 16 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(score) || 0));
  const offset = c * (1 - pct / 100);
  const val = useCountUp(pct);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-gray-200 dark:stroke-white/[0.07]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={band.stroke}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${band.stroke}66)` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          {/* Number scales with the ring so the gauge reads well at any size. */}
          <div
            className="font-bold leading-none tracking-tight tabular-nums"
            style={{ color: band.stroke, fontSize: Math.round(size * 0.31) }}
          >
            {val}
          </div>
          <div className="mt-1.5 text-13 font-bold tracking-[0.2em] text-gray-400 dark:text-white/40">
            / 100
          </div>
        </div>
      </div>
    </div>
  );
}
