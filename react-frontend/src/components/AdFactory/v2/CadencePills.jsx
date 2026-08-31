import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CalendarDays, ChevronDown, Globe, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Calendar } from 'react-date-range';
import { format } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

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
import { CONTROL, FAINT, LABEL, MENU, MENU_ITEM, NUM, VALUE } from './_tokens';

// ----------------------------------------------------------------------------
// CadencePills — the schedule, as a sentence you can edit.
//
//   EVERY [week]  AT [9:00 AM] [IST]  [3] ads each run
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
  { value: 'custom', label: 'custom…' },
];

// Lowercase names, matching the queue's own DOW_MAP keys. Sent verbatim.
const DAYS = [
  ['monday', 'M'],
  ['tuesday', 'T'],
  ['wednesday', 'W'],
  ['thursday', 'T'],
  ['friday', 'F'],
  ['saturday', 'S'],
  ['sunday', 'S'],
];

const UNITS = [
  { value: 'day', label: 'days' },
  { value: 'week', label: 'weeks' },
];

// v1's PairsPerCycleSection caps at 50 (MAX_ADS), so this stopped 40 short of
// what Full control offers for the same setting. The job model's own clamp is
// 200, which is not a number anyone should reach by misclicking a dropdown —
// 50 is the product's limit, and the ladder thins out so the list stays usable.
const PAIR_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50];

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
  custom,
  startDate,
  endDate,
  onChange,
  disabled = false,
}) {
  const tz = timezone || browserTimezone();
  const isCustom = frequency === 'custom';

  const set = (patch) => onChange?.(patch);

  // The block the API REQUIRES alongside a custom frequency. Defaults live here
  // so switching to "custom…" produces something valid immediately rather than
  // a half-built cadence the server has to guess at.
  const c = {
    repeatEvery: custom?.repeatEvery ?? 1,
    repeatUnit: custom?.repeatUnit ?? 'week',
    repeatOnDays: custom?.repeatOnDays ?? [],
  };

  const toggleDay = (day) => {
    const next = c.repeatOnDays.includes(day)
      ? c.repeatOnDays.filter((d) => d !== day)
      : [...c.repeatOnDays, day];
    set({ custom: { ...c, repeatOnDays: next } });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pill label="Every">
          <PillSelect
            value={frequency}
            onValueChange={(v) =>
              // Switching INTO custom carries the block with it, so the very
              // first PATCH is already valid.
              set(v === 'custom' ? { frequency: v, custom: c } : { frequency: v })
            }
            disabled={disabled}
            options={FREQUENCIES}
          />
        </Pill>

        <Pill label="At">
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
          {/* "ads each run" rather than "pairs per run": Adjust has its own
              "Ads per generate" and the two were both reading "per run" with
              different numbers on different screens. */}
          <span className={LABEL}>ads each run</span>
        </Pill>

        <Pill label="Starting">
          <DatePillField
            value={startDate ? String(startDate).slice(0, 10) : ''}
            disabled={disabled}
            onChange={(value) => set({ startDate: value || null })}
            placeholder="today"
            align="end"
          />
          {startDate && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ startDate: null })}
              className="text-[#9CA3AF] transition-colors hover:text-[#111827] dark:text-[#8B939E] dark:hover:text-[#ECEFF3]"
              aria-label="Clear start date"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Pill>

        {/* Optional, and it says so. An end date is the difference between a
            campaign and a standing order, and without one there was no way to
            express "run this for a month". */}
        <Pill label="Until">
          <DatePillField
            value={endDate ? String(endDate).slice(0, 10) : ''}
            disabled={disabled}
            onChange={(value) => set({ endDate: value || null })}
            min={startDate ? String(startDate).slice(0, 10) : undefined}
            placeholder="no end"
            align="start"
          />
          {endDate && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ endDate: null })}
              className="text-[#9CA3AF] transition-colors hover:text-[#111827] dark:text-[#8B939E] dark:hover:text-[#ECEFF3]"
              aria-label="Clear end date"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Pill>
      </div>

      {/* Custom unfolds under the sentence rather than inside it — three more
          controls on the same line stops reading as a sentence at all. */}
      <AnimatePresence initial={false}>
        {isCustom && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Pill label="Repeat every">
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={c.repeatEvery}
                  disabled={disabled}
                  onChange={(e) =>
                    set({
                      custom: {
                        ...c,
                        repeatEvery: Math.min(52, Math.max(1, Number(e.target.value) || 1)),
                      },
                    })
                  }
                  className={`w-10 bg-transparent outline-none disabled:opacity-60 ${VALUE} ${NUM}`}
                />
                <PillSelect
                  value={c.repeatUnit}
                  onValueChange={(v) => set({ custom: { ...c, repeatUnit: v } })}
                  disabled={disabled}
                  options={UNITS}
                />
              </Pill>

              {/* Day selection only means something for a weekly recurrence —
                  "every 3 days on Tuesdays" is not a cadence. */}
              {c.repeatUnit === 'week' && (
                <Pill label="On">
                  <span className="flex items-center gap-1">
                    {DAYS.map(([day, letter], i) => {
                      const active = c.repeatOnDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleDay(day)}
                          aria-pressed={active}
                          aria-label={day}
                          className={`size-6 rounded-md text-10 font-semibold transition-colors disabled:opacity-60 ${active
                            ? 'bg-[#B87215] text-white dark:bg-[#15DCFF] dark:text-[#062024]'
                            : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB] dark:bg-[#22272F] dark:text-[#AFB6C0] dark:hover:bg-[#2E353E]'
                            }`}
                        >
                          {/* Two Tuesdays' worth of "T" and two "S" — the
                              aria-label carries the real name for screen
                              readers, and the key is the day, not the letter. */}
                          <span aria-hidden>{letter}</span>
                          <span className="sr-only">{DAYS[i][0]}</span>
                        </button>
                      );
                    })}
                  </span>
                </Pill>
              )}
            </div>

            {c.repeatUnit === 'week' && c.repeatOnDays.length === 0 && (
              <p className={`pt-1.5 ${FAINT}`}>
                No days picked — it&apos;ll run on the same weekday it starts.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DatePillField({ value, onChange, min, disabled, placeholder, align = 'center' }) {
  const [open, setOpen] = useState(false);
  const dateObj = parseInputDate(value);
  const minDate = parseInputDate(min);
  const display = dateObj ? format(dateObj, 'd MMM yyyy') : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 bg-transparent outline-none disabled:opacity-60 cursor-pointer ${
            dateObj ? VALUE : FAINT
          }`}
        >
          <span>{display}</span>
          <CalendarDays className="h-3.5 w-3.5 text-[#9CA3AF] dark:text-[#8B939E]" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        sideOffset={6}
        collisionPadding={20}
        className="w-auto p-0 border border-[#E5E7EB] bg-white rounded-xl shadow-2xl dark:border-[#2A2A2A] dark:bg-[#1A1A1A] z-[99999] overflow-hidden"
      >
        <div className="adsgpt-cal-pop p-1">
          <Calendar
            date={dateObj || minDate || new Date()}
            onChange={(date) => {
              onChange?.(toInputDate(date));
              setOpen(false);
            }}
            minDate={minDate || undefined}
            color="#5867EB"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseInputDate(value) {
  if (!value || typeof value !== 'string') return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toInputDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function Pill({ label, children }) {
  return (
    <span className={`inline-flex h-9 items-center gap-2 px-3 ${CONTROL}`}>
      {label && <span className={LABEL}>{label}</span>}
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
      <SelectTrigger
        className={`h-auto! w-auto gap-1.5 border-0 bg-transparent p-0 shadow-none focus:ring-0 disabled:opacity-60 ${VALUE}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={`z-9999 max-h-72 ${MENU}`}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className={MENU_ITEM}>
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
        className={`inline-flex items-center gap-1 outline-none disabled:opacity-60 ${VALUE}`}
      >
        <span>{shortZone(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] dark:text-[#8B939E]" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className={`z-9999 w-72 p-0 ${MENU}`}
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search city or offset…" className="text-13" />
          <CommandList className="max-h-64">
            <CommandEmpty className={`py-5 text-center ${FAINT}`}>
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
                  className="gap-2 text-13 dark:aria-selected:bg-[#272D35]"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF] dark:text-[#8B939E]" />
                  <span className="truncate">{zone}</span>
                  <span className={`ml-auto shrink-0 ${FAINT}`}>
                    {offsetLabel(zone)}
                  </span>
                  {zone === value && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#5867EB] dark:text-[#15DCFF]" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
