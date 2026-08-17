import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ----------------------------------------------------------------------------
// CadencePills — the schedule, as a sentence you can edit.
//
//   EVERY [week]  AT [9:00 AM] [IST]  [3] pairs per run
//
// These four values used to be rendered as static pills. They LOOKED like
// controls, sat inside a card headed "Keep these coming", and none of them did
// anything: hour and timezone came from schema defaults nothing ever set, so
// every schedule in the product ran at 9:00 UTC. A user in India picking their
// delivery time got ads at 2:30 PM and no way to change it.
//
// One component, used in two places — the setup card before activation and the
// deliveries screen after it. That sameness is the point: the control that
// creates the schedule is the control that edits it, so there is no second
// implementation to drift.
// ----------------------------------------------------------------------------

const FREQUENCIES = [
  { value: 'daily', label: 'day' },
  { value: 'weekly', label: 'week' },
  { value: 'every_weekday', label: 'weekday' },
  { value: 'every_weekend', label: 'weekend' },
  { value: 'monthly', label: 'month' },
];

// Matches the server's clamp in briefToJobPatch. Offering 200 in a dropdown
// would be offering someone a way to spend a fortune by misclicking.
const PAIR_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10];

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function clock(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

export function shortZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || String(tz).split('/').pop();
  } catch {
    return String(tz).split('/').pop();
  }
}

function offsetLabel(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  } catch {
    return 'GMT';
  }
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function CadencePills({
  frequency = 'weekly',
  hour = 9,
  timezone,
  pairsPerCycle = 3,
  onChange,
  disabled = false,
}) {
  const tz = timezone || browserTimezone();

  const set = (patch) => onChange?.(patch);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill label="EVERY">
        <PillSelect
          value={frequency}
          onValueChange={(v) => set({ frequency: v })}
          disabled={disabled}
          options={FREQUENCIES}
          width="w-auto"
        />
      </Pill>

      <Pill label="AT">
        <PillSelect
          value={String(hour)}
          onValueChange={(v) => set({ hour: Number(v) })}
          disabled={disabled}
          options={HOURS.map((h) => ({ value: String(h), label: clock(h) }))}
        />
        <TimezonePicker value={tz} onChange={(v) => set({ timezone: v })} disabled={disabled} />
      </Pill>

      <Pill>
        <PillSelect
          value={String(pairsPerCycle)}
          onValueChange={(v) => set({ pairsPerCycle: Number(v) })}
          disabled={disabled}
          options={PAIR_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
        />
        <span className="text-gray-400 dark:text-white/45">pairs per run</span>
      </Pill>
    </div>
  );
}

function Pill({ label, children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-13 text-gray-900 dark:border-white/10 dark:bg-white/6 dark:text-white">
      {label && (
        <span className="text-10 font-extrabold tracking-wider text-gray-400 dark:text-white/45">
          {label}
        </span>
      )}
      {children}
    </span>
  );
}

// The project's own Select, trimmed to sit INSIDE the pill: the pill already
// draws the border and background, so the trigger contributes neither. A native
// <select> here rendered an OS-drawn list that ignored the dark palette.
function PillSelect({ value, onValueChange, options, disabled }) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="h-auto! w-auto gap-1.5 border-0 bg-transparent p-0 text-13 font-bold text-gray-900 shadow-none focus:ring-0 disabled:opacity-60 dark:text-white">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-9999 max-h-72 border border-black/10 bg-white text-gray-900 dark:border-white/20 dark:bg-[#14181D] dark:text-white">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-13 dark:focus:bg-white/10">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Searchable IANA picker. ~400 zones is far past what a plain Select can
 * usefully show, so this is the Popover + Command combobox the rest of the app
 * uses for long lists.
 */
function TimezonePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);

  const zones = useMemo(() => {
    let list = [];
    try {
      list = Intl.supportedValuesOf('timeZone') || [];
    } catch {
      list = [];
    }
    // `supportedValuesOf` returns what the linked ICU build calls canonical,
    // and that set OMITS names browsers really do report — Asia/Kolkata (it
    // offers Asia/Calcutta), Europe/Kyiv, and UTC itself. Without this union a
    // user in India could not find their own timezone in the timezone picker.
    const extra = [value, browserTimezone(), 'UTC'].filter(Boolean);
    return Array.from(new Set([...extra, ...list]));
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className="inline-flex items-center gap-1 text-13 font-bold text-gray-900 outline-none disabled:opacity-60 dark:text-white"
      >
        <span>{shortZone(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400 dark:text-white/45" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="z-9999 w-72 border border-black/10 bg-white p-0 text-gray-900 dark:border-white/20 dark:bg-[#14181D] dark:text-white"
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search city or offset…" className="text-13" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-5 text-center text-xs text-gray-400 dark:text-white/45">
              No timezone matches that.
            </CommandEmpty>
            <CommandGroup>
              {zones.map((zone) => (
                <CommandItem
                  key={zone}
                  // Searching the offset too — "GMT+5:30" is how plenty of
                  // people know their own zone.
                  value={`${zone} ${offsetLabel(zone)}`}
                  onSelect={() => {
                    onChange?.(zone);
                    setOpen(false);
                  }}
                  className="gap-2 text-13 dark:aria-selected:bg-white/10"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/40" />
                  <span className="truncate">{zone}</span>
                  <span className="ml-auto shrink-0 text-xs text-gray-400 dark:text-white/40">
                    {offsetLabel(zone)}
                  </span>
                  {zone === value && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
