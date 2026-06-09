import { useEffect, useState } from 'react';
// `motion` aliased to a capitalised name so the project's no-unused-vars
// rule (which doesn't track JSX-as-usage) accepts member-access calls like
// <Motion.p>.
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { LifestyleShell } from '../LifestyleShell';
import { Loader } from '../components/Loader';

// Cycled while the website is being analysed (no explicit `label` prop). The
// autofill round-trip can take a while so we rotate copy to reassure the user.
const ANALYZING_MESSAGES = [
  'Analysing your website',
  'Fetching your website data',
  'Understanding your Brand Identity',
  'Preparing your brand information',
];
const MESSAGE_INTERVAL_MS = 2500;

export function LoadingStep({ label, title, onCancel }) {
  // When the parent passes an explicit label (e.g., "Generating your ads…")
  // we use it as-is. Without one we cycle the analysing copy.
  const cycle = label == null;
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!cycle) return;
    const id = setInterval(
      () => setIdx((i) => (i + 1) % ANALYZING_MESSAGES.length),
      MESSAGE_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [cycle]);
  const message = cycle ? ANALYZING_MESSAGES[idx] : label;

  return (
    <LifestyleShell title={title}>
      <div
        className="
          relative flex w-full max-w-[950px] 2xl:max-w-[1100px] flex-col items-center justify-center gap-5
          rounded-[30px] bg-gray-50 dark:bg-[#303030]/30 px-8 py-20 backdrop-blur-md
          sm:py-24 lg:py-[160px] h-[78vh] 2xl:h-[64vh]
        "
      >
        <Loader size={50} />
        <div className="mt-3 min-h-[36px] text-center">
          <AnimatePresence mode="wait">
            <Motion.p
              key={message}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="text-[clamp(20px,2.4vw,28px)] font-normal leading-[1.2] tracking-wide text-gray-500 dark:text-white/75"
            >
              {message}
            </Motion.p>
          </AnimatePresence>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="absolute bottom-6 right-7 rounded-full px-3 py-1.5 text-sm text-gray-500 dark:text-white/60 transition-colors hover:text-black/80 dark:hover:text-white/80"
          >
            Cancel
          </button>
        )}
      </div>
    </LifestyleShell>
  );
}
