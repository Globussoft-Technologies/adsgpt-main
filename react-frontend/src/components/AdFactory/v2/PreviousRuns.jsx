import React, { useState } from 'react';
import { History } from 'lucide-react';
import { motion } from 'framer-motion';

import { useMotionPresets } from './_motion';

// ----------------------------------------------------------------------------
// PreviousRuns — the batches this brief made before the current one.
//
// Full control has versioned campaigns since long before Quick setup existed:
// regenerating a campaign that already succeeded snapshots the whole thing into
// CampaignHistory first. Quick setup wrote no snapshot and showed no history,
// so each regenerate quietly replaced the last batch with no way back to it.
//
// Deliberately understated. The current ads are the page; this is a strip you
// scroll past unless you are looking for it, and it renders nothing at all
// until there IS a previous run — a brief generated once should not carry a
// history control that only ever says "nothing yet".
// ----------------------------------------------------------------------------

const S3 = import.meta.env.VITE_S3_BASE_URL || '';

const srcOf = (data) => {
  const s = String(data || '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${S3}${s}`;
};

const when = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function PreviousRuns({ history = [] }) {
  const M = useMotionPresets();
  const [open, setOpen] = useState(false);

  if (!history.length) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#14181D]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <History className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />
        <span className="text-13 font-semibold text-gray-900 dark:text-white">
          Earlier runs
        </span>
        <span className="text-xs text-gray-400 dark:text-white/40">
          {history.length} {history.length === 1 ? 'batch' : 'batches'} before this one
        </span>
        <span className="ml-auto text-xs text-gray-400 dark:text-white/40">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <motion.ol {...M.stagger(0.04)} className="m-0 flex list-none flex-col p-0">
          {history.map((h) => (
            <motion.li
              key={h.version}
              {...M.staggerItem}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-200 px-4 py-3 dark:border-white/10"
            >
              <span className="text-xs font-semibold text-gray-900 dark:text-white/90">
                Run {h.version}
              </span>
              <span className="text-xs text-gray-500 dark:text-white/50">{when(h.at)}</span>
              <span className="text-xs text-gray-400 dark:text-white/40">
                {h.adCount} {h.adCount === 1 ? 'ad' : 'ads'}
              </span>

              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                {(h.images || []).slice(0, 6).map((src, i) => (
                  <img
                    key={src || i}
                    src={srcOf(src)}
                    alt=""
                    loading="lazy"
                    className="h-11 w-9 rounded-md border border-gray-200 object-cover dark:border-white/10"
                  />
                ))}
                {(h.images || []).length > 6 && (
                  <span className="text-10 text-gray-400 dark:text-white/40">
                    +{h.images.length - 6}
                  </span>
                )}
              </span>
            </motion.li>
          ))}
        </motion.ol>
      )}
    </section>
  );
}
