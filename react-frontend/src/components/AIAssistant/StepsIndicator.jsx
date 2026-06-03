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
            className="flex items-center gap-2 text-[13px] text-white/55"
          >
            <Check className="h-3 w-3 text-white/45" />
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
          className="flex items-center gap-2 text-[13px] text-white/85"
        >
          <Loader2 className="h-3 w-3 animate-spin text-white/70" />
          <span>{activeLabel}</span>
        </motion.div>
      )}

      {completedLabel && !activeLabel && (
        <p className="mt-1 text-[12px] text-white/40">{completedLabel}</p>
      )}
    </div>
  );
};

export default StepsIndicator;
