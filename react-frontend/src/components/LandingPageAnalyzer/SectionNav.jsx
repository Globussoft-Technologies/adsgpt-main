import { motion } from 'framer-motion';

// Sticky scroll-spy tab bar. Active tab glides a cyan underline via layoutId.
// Click → page handles smooth scrollIntoView.
export default function SectionNav({ sections, activeId, onSelect }) {
  return (
    <div className="sticky top-11 z-20 mx-2 mb-8 border-b border-gray-200 dark:border-white/10 2xl:-mx-6 2xl:px-6">
      <div className="flex max-w-300 2xl:max-w-375 gap-8 overflow-x-auto scrollbar-hide">
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`relative whitespace-nowrap pb-4 pt-4.5 text-base transition-colors ${
                active
                  ? 'font-bold text-gray-900 dark:text-white'
                  : 'font-medium text-gray-500 hover:text-gray-800 dark:text-white/55 dark:hover:text-white/85'
              }`}
            >
              {s.label}
              {active && (
                <motion.span
                  layoutId="lpa-tab-underline"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#15DCFF]"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
