import React from 'react';
import { History } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BTN_LINK, CONTROL, CONTROL_H, FAINT, MENU, MENU_ITEM } from './_tokens';

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

export default function RunPicker({
  history = [],
  value = CURRENT,
  onChange,
  currentCount = 0,
  currentPending = 0,
}) {
  if (!history.length) return null;

  const selected = history.find((h) => String(h.version) === String(value));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <History className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF] dark:text-[#8B939E]" />

      <Select value={String(value)} onValueChange={(v) => onChange?.(v)}>
        <SelectTrigger className={`${CONTROL_H}! w-auto min-w-56 gap-2 ${CONTROL} px-3 text-13 shadow-none`}>
          <SelectValue />
        </SelectTrigger>

        <SelectContent className={`z-9999 ${MENU}`}>
          {/* Mid-run this counted only the ads that had ARRIVED, so a run of
              three reported "1 ad" while three cards were on screen — one
              finished and two still generating. The count is only a final
              answer once the run is; until then it says both numbers. */}
          <SelectItem value={CURRENT} className={MENU_ITEM}>
            Latest run ·{' '}
            {currentPending > 0
              ? `${currentCount} of ${currentCount + currentPending} · generating`
              : plural(currentCount)}
          </SelectItem>
          {history.map((h) => (
            <SelectItem
              key={h.version}
              value={String(h.version)}
              className={MENU_ITEM}
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
        <span className={FAINT}>everything before history started</span>
      )}

      {value !== CURRENT && (
        <button
          type="button"
          onClick={() => onChange?.(CURRENT)}
          className={BTN_LINK}
        >
          Back to latest
        </button>
      )}
    </div>
  );
}
