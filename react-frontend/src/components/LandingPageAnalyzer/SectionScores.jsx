import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  Eye,
  Gauge,
  Gem,
  LayoutPanelTop,
  MousePointerClick,
  PenLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Card, Pill, SectionTitle } from './_atoms';
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

// How many bullet points to show before "View details" expands the rest.
const COLLAPSED_POINTS = 4;

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
        ['severity', 'Worst First'],
        ['category', 'By Category'],
      ].map(([k, lbl]) => (
        <button
          key={k}
          type="button"
          onClick={() => setSort(k)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            sort === k
              ? 'bg-white text-gray-900 shadow-sm dark:bg-white/12 dark:text-white'
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
      <SectionTitle hint="Scored across 60+ conversion criteria." right={sortToggle}>
        Your Score Breakdown
      </SectionTitle>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
  const points = dim.points || [];
  const [expanded, setExpanded] = useState(false);
  const hasMore = points.length > COLLAPSED_POINTS;
  const visible = expanded ? points : points.slice(0, COLLAPSED_POINTS);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      <Card className="flex h-full min-h-[250px] 2xl:min-h-[300px] flex-col">
        <div className="flex flex-1 flex-col gap-4 py-6 px-5">
          <div className="flex items-center gap-2.5">
            {/* Larger icon in a neutral chip. */}
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white">
              <Icon className="h-5 w-5" />
            </span>
            <span className="text-15 flex-1 truncate font-bold text-gray-900 dark:text-white">
              {dim.label}
            </span>
            <Pill band={band}>{dim.rating}</Pill>
          </div>

          <div className="flex items-baseline gap-1">
            <span
              className="text-[35px] leading-none font-bold tracking-tight tabular-nums"
              style={{ color: band.stroke }}
            >
              {dim.score}
            </span>
            <span className="text-sm font-bold text-gray-400 dark:text-white/40">/ 100</span>
          </div>

          <div className="scrollbar-thin mt-1 flex max-h-35 2xl:max-h-44 flex-col gap-2 overflow-y-auto pr-4">
            <ul className="mt-1 ml-6! flex flex-1 flex-col gap-2">
              {visible.map((p, i) => {
                const { text } = parsePoint(p);
                return (
                  <li
                    key={i}
                    className="text-left text-xs 2xl:text-sm leading-snug text-gray-500 dark:text-white/60"
                  >
                    {text}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 self-start text-sm font-semibold text-[#0fafcb] transition-colors hover:text-[#15DCFF] dark:text-[#15DCFF] dark:hover:text-[#7c93ff]"
            >
              {expanded ? 'Show less' : 'View details'}
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          )} */}
        </div>
      </Card>
    </motion.div>
  );
}
