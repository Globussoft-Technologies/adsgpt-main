import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ListChecks } from 'lucide-react';
import { Card, NumberBadge, PriorityBadge, SectionTitle } from './_atoms';
import { priorityRank } from './helpers';

// BLOCK 4 — Improvement Ideas. Priority-sorted accordion; first row open.
export default function ImprovementIdeas({ report }) {
  const ideas = [...(report?.sections || [])].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.number - b.number,
  );

  return (
    <>
      <SectionTitle icon={ListChecks} hint="Prioritized, highest-impact fixes first.">
        Improvement Ideas
      </SectionTitle>

      <div className="flex flex-col gap-3">
        {ideas.map((idea) => (
          <IdeaRow key={idea.number} idea={idea} defaultOpen />
        ))}
      </div>
    </>
  );
}

function IdeaRow({ idea, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="rounded-xl!">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3.5 px-5 py-4 text-left"
      >
        <NumberBadge>{idea.number}</NumberBadge>
        <span className="min-w-0 flex-1 text-lg font-semibold leading-tight text-gray-900 dark:text-white">
          {idea.title}
        </span>
        <span className="hidden text-13 font-bold uppercase tracking-wide text-gray-400 sm:inline dark:text-white/45">
          {idea.name}
        </span>
        <PriorityBadge priority={idea.priority} />
        <ChevronDown
          className={`h-4.5 w-4.5 shrink-0 text-gray-400 transition-transform dark:text-white/45 ${
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
            <p className="px-5 pb-5 pl-16 text-sm leading-relaxed text-gray-500 dark:text-white/60">
              {idea.detail}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
