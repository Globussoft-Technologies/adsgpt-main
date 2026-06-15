import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Eye,
  Gauge,
  Gem,
  LayoutGrid,
  LayoutPanelTop,
  MousePointerClick,
  PenLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Card, Delta, Pill, SectionTitle } from './_atoms';
import { parsePoint, scoreBand } from './helpers';

const DIM_ICONS = {
  top_of_page: LayoutPanelTop,
  value_proposition: Gem,
  copywriting: PenLine,
  trust_credibility: ShieldCheck,
  design_ux: Eye,
  conversion: MousePointerClick,
  mobile_experience: Smartphone,
  page_speed: Gauge,
};

// BLOCK 2 — the scoring dimension cards, with a worst-first / by-category sort.
export default function SectionScores({ report }) {
  const dimensions = report?.dimensions || [];
  const [sort, setSort] = useState('severity');

  const cards = useMemo(() => {
    const arr = [...dimensions];
    return sort === 'severity' ? arr.sort((a, b) => (a.score || 0) - (b.score || 0)) : arr;
  }, [dimensions, sort]);

  const sortToggle = (
    <div className="inline-flex gap-0.5 rounded-10 border border-gray-200 bg-gray-100 p-1 dark:border-white/10 dark:bg-white/4">
      {[
        ['severity', 'Worst first'],
        ['category', 'By category'],
      ].map(([k, lbl]) => (
        <button
          key={k}
          type="button"
          onClick={() => setSort(k)}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            sort === k
              ? 'bg-linear-to-r from-[#15DCFF] to-[#6b72f8] text-black'
              : 'text-gray-500 hover:text-gray-800 dark:text-white/60 dark:hover:text-white'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <SectionTitle
        icon={LayoutGrid}
        hint="Scored across 60+ conversion criteria."
        right={sortToggle}
      >
        Your Score, Explained
      </SectionTitle>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((d, i) => (
          <ScoreCard key={d.key || i} dim={d} index={i} />
        ))}
      </div>
    </>
  );
}

function ScoreCard({ dim, index }) {
  const band = scoreBand(dim.score);
  const Icon = DIM_ICONS[dim.key] || Sparkles;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      <Card className="flex h-full flex-col overflow-hidden">
        {/* severity top bar */}
        <div className="h-1" style={{ backgroundColor: band.stroke }} />
        <div className="flex flex-1 flex-col gap-4 p-6">
          <div className="flex items-center gap-2">
            <Icon className="h-4.5 w-4.5 text-gray-400 dark:text-white/55" />
            <span className="flex-1 truncate text-lg font-bold text-gray-900 dark:text-white">
              {dim.label}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span
              className="text-[48px] font-extrabold leading-none tracking-tight tabular-nums"
              style={{ color: band.stroke }}
            >
              {dim.score}
            </span>
            <Pill band={band}>{dim.rating}</Pill>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.07]">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: band.stroke }}
              initial={{ width: 0 }}
              whileInView={{ width: `${Math.max(0, Math.min(100, dim.score))}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          <ul className="mt-1 flex flex-col gap-2.5">
            {(dim.points || []).map((p, i) => {
              const { text, value } = parsePoint(p);
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm leading-snug text-gray-500 dark:text-white/60"
                >
                  <span className="flex-1">{text}</span>
                  <Delta value={value} />
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    </motion.div>
  );
}
