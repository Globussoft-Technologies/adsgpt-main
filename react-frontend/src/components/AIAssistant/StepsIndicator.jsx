import { Check, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const StepsIndicator = ({ doneLabels = [], activeLabel = null, completedLabel = null }) => {
  if (!doneLabels.length && !activeLabel && !completedLabel) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {doneLabels.map((label, idx) => (
          <motion.div
            key={`done-${idx}-${label}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 text-[13px] font-medium text-gray-700 dark:text-white/70"
          >
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{label}</span>
          </motion.div>
        ))}
      </AnimatePresence>

      {activeLabel && (
        <motion.div
          key={`active-${activeLabel}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900 dark:text-white"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#099794] dark:text-[#15DCFF]" />
          <span>{activeLabel}</span>
        </motion.div>
      )}

      {completedLabel && !activeLabel && (
        <p className="mt-1 text-[12px] font-medium text-gray-600 dark:text-white/60">{completedLabel}</p>
      )}
    </div>
  );
};

export default StepsIndicator;
