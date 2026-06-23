import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { Card, NumberBadge, PriorityBadge, SectionTitle } from './_atoms';
import { priorityRank } from './helpers';

// BLOCK 4 — Improvement Ideas. Same row UI as the Top Priority Issues panel:
// one card, border-separated rows (number · title · category · priority), with
// each row expanding to reveal its detail.
export default function ImprovementIdeas({ report }) {
  const ideas = [...(report?.sections || [])].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.number - b.number,
  );
  // Accordion — only one row open at a time.
  const [openNumber, setOpenNumber] = useState(null);

  return (
    <>
      <SectionTitle hint="Prioritized, highest-impact fixes first.">
        Improvement Ideas
      </SectionTitle>

      <Card className="flex flex-col overflow-hidden">
        {ideas.map((idea, i) => (
          <IdeaRow
            key={idea.number}
            idea={idea}
            isFirst={i === 0}
            open={openNumber === idea.number}
            onToggle={() => setOpenNumber((cur) => (cur === idea.number ? null : idea.number))}
          />
        ))}
      </Card>
    </>
  );
}

function IdeaRow({ idea, isFirst, open, onToggle }) {
  return (
    <div className={isFirst ? '' : 'border-t border-gray-100 dark:border-white/6'}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3.5 px-6 py-4 text-left transition-colors ${
          open ? 'bg-gray-100 dark:bg-white/5' : 'hover:bg-gray-50 dark:hover:bg-white/2.5'
        }`}
      >
        {/* <NumberBadge>{idea.number}</NumberBadge> */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {idea.number}.
          <span className="text-[13px] 2xl:text-15 min-w-0 flex-1 leading-snug font-semibold text-gray-900 dark:text-white">
            {idea.title}
          </span>
        </div>
        {idea.name && (
          <span className="hidden text-[11px] font-bold tracking-wide text-gray-400 uppercase sm:inline dark:text-white/45">
            {idea.name}
          </span>
        )}
        <PriorityBadge priority={idea.priority} />
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-white/40 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="pr-6 py-5 pl-11 text-xs 2xl:text-sm leading-relaxed text-gray-500 dark:text-white/60">
              {idea.detail}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
