import React from 'react';
import { History } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ----------------------------------------------------------------------------
// RunPicker — which batch of ads you are looking at.
//
// Replaces the "Earlier runs" strip that sat UNDER the cards as a collapsible
// list of thumbnails. Two things were wrong with that: previous batches were
// reduced to thumbnails rather than being viewable as the ads they are, and it
// sat below the fold of the thing it described.
//
// As a picker above the cards, one batch is on screen at a time and the current
// run is just the newest entry. Nothing is hidden and nothing is duplicated.
//
// Renders nothing when there is no history — a brief generated once has one
// batch, and a picker with a single option is a control that cannot do
// anything.
// ----------------------------------------------------------------------------

export const CURRENT = 'current';

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

const plural = (n) => `${n} ${n === 1 ? 'ad' : 'ads'}`;

export default function RunPicker({ history = [], value = CURRENT, onChange, currentCount = 0 }) {
  if (!history.length) return null;

  const selected = history.find((h) => String(h.version) === String(value));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <History className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />

      <Select value={String(value)} onValueChange={(v) => onChange?.(v)}>
        <SelectTrigger className="h-9! w-auto min-w-56 gap-2 rounded-xl border border-gray-200 bg-gray-100 px-3 text-13 text-gray-900 shadow-none dark:border-white/10 dark:bg-white/6 dark:text-white">
          <SelectValue />
        </SelectTrigger>

        <SelectContent className="z-9999 border border-black/10 bg-white text-gray-900 dark:border-white/20 dark:bg-[#14181D] dark:text-white">
          <SelectItem value={CURRENT} className="text-13 dark:focus:bg-white/10">
            Latest run · {plural(currentCount)}
          </SelectItem>
          {history.map((h) => (
            <SelectItem
              key={h.version}
              value={String(h.version)}
              className="text-13 dark:focus:bg-white/10"
            >
              Run {h.version} · {when(h.at)} · {plural(h.adCount)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* The oldest bucket predates history — the first snapshot is written
          before the SECOND generate, so whatever was already in the campaign by
          then may be several runs merged. Saying so beats quietly labelling it
          as one run. */}
      {selected?.partial && (
        <span className="text-xs text-gray-400 dark:text-white/40">
          everything before history started
        </span>
      )}

      {value !== CURRENT && (
        <button
          type="button"
          onClick={() => onChange?.(CURRENT)}
          className="text-xs font-semibold text-[#6b72f8] underline underline-offset-2 dark:text-[#aeb6ff]"
        >
          Back to latest
        </button>
      )}
    </div>
  );
}
