import React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

// ----------------------------------------------------------------------------
// BriefList — everything you've made here before.
//
// Quick setup had no equivalent of the campaign list Full control opens on, so
// a brief was reachable only by its URL: close the tab and the work was gone.
// This sits under the front door rather than replacing it — starting something
// new is still the primary action, and the list is what you scroll to when you
// came back for something specific.
//
// Status is shown as a word, not a colour alone: "Live" and "Draft" mean
// different things to a user deciding which card to open, and a coloured dot on
// its own makes them guess.
// ----------------------------------------------------------------------------

import { useMotionPresets } from './_motion';

const STATUS = {
  live: { label: 'Live', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  paused: { label: 'Paused', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  previewing: { label: 'Ads ready', cls: 'bg-[#6b72f8]/15 text-[#5E66F5] dark:text-[#aeb6ff]' },
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/55' },
  needs_input: { label: 'Needs input', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  inferring: { label: 'Reading…', cls: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/55' },
  failed: { label: 'Failed', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  ended: { label: 'Ended', cls: 'bg-gray-100 text-gray-500 dark:bg-white/8 dark:text-white/55' },
};

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
};

const when = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function BriefList({ briefs = [], loading = false, onOpen, onDelete }) {
  const M = useMotionPresets();

  if (loading && briefs.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400 dark:text-white/45" />
      </div>
    );
  }

  // No history is the normal first-run state, not an empty state worth
  // apologising for — the front door above is already the whole instruction.
  if (briefs.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-4">
      <h3 className="mb-3 text-center text-10 font-extrabold tracking-wider text-gray-400 uppercase dark:text-white/40">
        Your briefs
      </h3>

      {/* `list-none` and `m-0` finally do something. App.css styles every `ul`
          with `list-style-type: disc; margin-left: 34px` and was UNLAYERED,
          which beats Tailwind utilities in `@layer utilities` no matter the
          specificity — so these classes were inert and every card carried a
          bullet and a 34px indent. App.css now declares that rule inside
          `@layer base`; see the note there.

          The tracks are fixed-width and centred rather than stretched across
          the row. With auto-fit + 1fr, one brief became a single card spanning
          the full width under a centred hero; now a partial row sits under the
          hero instead of hugging the left edge. */}
      <motion.ul
        {...M.stagger()}
        className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(230px,266px))] justify-center gap-3 p-0"
      >
        {briefs.map((b) => {
          const status = STATUS[b.status] || STATUS.draft;
          const label = b.brand?.name || hostOf(b.source?.url) || 'Untitled brief';
          return (
            <motion.li key={b._id} {...M.staggerItem}>
              {/* The card is the button. A row of small targets inside a
                  clickable row makes it ambiguous what opens what. */}
              <div className="group relative flex h-full flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3.5 transition hover:border-gray-300 dark:border-white/10 dark:bg-[#14181D] dark:hover:border-white/25">
                <button
                  type="button"
                  onClick={() => onOpen?.(b._id)}
                  className="flex flex-1 flex-col gap-2.5 text-left"
                >
                  <span className="flex items-center gap-2.5">
                    {b.brand?.logoUrls?.[0] ? (
                      <img
                        src={b.brand.logoUrls[0]}
                        alt=""
                        className="size-7 shrink-0 rounded-lg bg-gray-100 object-contain dark:bg-white/10"
                      />
                    ) : (
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-[#15DCFF]/20 to-[#6b72f8]/20 text-11 font-extrabold text-[#6b72f8] dark:text-[#aeb6ff]">
                        {label.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-13 font-bold text-gray-900 dark:text-white">
                      {label}
                    </span>
                  </span>

                  {b.source?.url && (
                    <span className="truncate text-11 text-gray-400 dark:text-white/40">
                      {hostOf(b.source.url)}
                    </span>
                  )}

                  <span className="mt-auto flex items-center gap-2 pt-1">
                    <span className={`rounded-full px-2 py-0.5 text-10 font-bold ${status.cls}`}>
                      {status.label}
                    </span>
                    <span className="text-10 text-gray-400 dark:text-white/40">
                      {when(b.updatedAt || b.createdAt)}
                    </span>
                  </span>
                </button>

                {onDelete && (
                  <button
                    type="button"
                    aria-label={`Delete ${label}`}
                    onClick={() => onDelete(b._id, label)}
                    className="absolute top-2.5 right-2.5 rounded-lg p-1.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-gray-100 hover:text-red-600 focus-visible:opacity-100 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
