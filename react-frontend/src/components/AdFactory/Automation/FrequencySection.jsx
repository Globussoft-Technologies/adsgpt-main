import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, Check, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { Calendar } from 'react-date-range';
import { format } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import { describeFrequency } from '@/store/reducers/adFactoryAutomation/nextRun';
import TimezoneSelect from './TimezoneSelect';

// ----------------------------------------------------------------------------
// FrequencySection
//   Presets: Does not repeat / Daily / Every weekday / Every weekend / Custom
//   Custom expands a panel with:
//     - Repeat every [N] [day|week]
//     - When unit=week: SMTWTFS multi-select
//     - Start date (defaults today)
//     - End date (optional — empty = run indefinitely)
//
// The container owns the `value` shape; this component is presentational and
// emits patches via `onChange`.
// ----------------------------------------------------------------------------

const PRESET_OPTIONS = [
  { value: 'does_not_repeat', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekday', label: 'Every weekday (Mon–Fri)' },
  { value: 'weekend', label: 'Every weekend (Sat & Sun)' },
  { value: 'custom', label: 'Custom…' },
];

const UNIT_OPTIONS = [
  { value: 'day', label: 'day' },
  { value: 'week', label: 'week' },
];

// Hour-of-day options for the autopilot schedule. Backend stores `hour` as
// 0–23 UTC after timezone conversion; we surface a 12-hour label to the user
// to match the GMT pill aesthetic. Order matters — value drives the dropdown.
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: hourLabel(h),
}));

function hourLabel(h) {
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
}

// Returns the current hour (0–23) in the given IANA timezone. Falls back to
// the browser's local zone when `timezone` is omitted or invalid. Used to
// filter out past hours when the user picks today as the start date.
function currentHourInTimezone(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone || undefined,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    if (!Number.isInteger(h)) return 0;
    // Intl can return "24" in some locales when it crosses midnight; clamp.
    return h % 24;
  } catch {
    return new Date().getHours();
  }
}

const DOW = [
  { value: 0, short: 'S', full: 'Sunday' },
  { value: 1, short: 'M', full: 'Monday' },
  { value: 2, short: 'T', full: 'Tuesday' },
  { value: 3, short: 'W', full: 'Wednesday' },
  { value: 4, short: 'T', full: 'Thursday' },
  { value: 5, short: 'F', full: 'Friday' },
  { value: 6, short: 'S', full: 'Saturday' },
];

export default function FrequencySection({ value, onChange, disabled }) {
  const preset = value?.preset || 'daily';
  const startDate = value?.startDate || '';
  const endDate = value?.endDate || '';
  // Hour-of-day (0–23) for the autopilot schedule. Defaults to 0 (midnight)
  // to match the backend default. Stored as a number; the dropdown coerces.
  const hour = Number.isInteger(value?.hour) ? value.hour : 0;
  const custom = value?.custom || { interval: 1, unit: 'week', daysOfWeek: [] };

  const patch = (partial) => onChange?.({ ...(value || {}), ...partial });

  // Hour options narrowed to "now+" when the user picks today as the start
  // date. Without this guard the form lets you schedule the first cycle in
  // the past — the backend's cron then rejects (or runs immediately, depending
  // on shape) and the user is left wondering why their job is firing at the
  // wrong hour. Refreshes on every minute change so the dropdown stays honest
  // if the form is left open across an hour boundary.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayStr = todayInputValue(value?.timezone);
  const isStartToday = startDate && startDate === todayStr;
  const hourOptions = React.useMemo(() => {
    if (!isStartToday) return HOUR_OPTIONS;
    const nowHour = currentHourInTimezone(value?.timezone);
    return HOUR_OPTIONS.filter((o) => o.value > nowHour);
    // nowTick is intentionally in the dep array so the list refreshes hourly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStartToday, value?.timezone, nowTick]);

  // If the currently selected hour just became invalid (user switched start
  // date to today, or the clock crossed the selected hour while the form was
  // open), nudge the selection to the first allowed hour. Skip when the
  // available set is empty — that's handled by the visible empty-state below
  // and bumping to undefined would re-trigger this effect in a loop.
  useEffect(() => {
    if (!isStartToday) return;
    if (hourOptions.length === 0) return;
    const isValid = hourOptions.some((o) => o.value === hour);
    if (!isValid) patch({ hour: hourOptions[0].value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStartToday, hourOptions.length, hour]);

  // The Custom recurrence panel stages its edits locally and only propagates
  // to the parent (and therefore the schedule label at top-right) when the
  // user clicks Apply. This avoids the label whirling around as the user
  // drags the interval up/down or toggles days of the week.
  const [customDraft, setCustomDraft] = useState(custom);
  const [panelOpen, setPanelOpen] = useState(true);
  // Remember the preset that was active just before the user picked Custom,
  // so Cancel can revert to it when nothing has been applied yet.
  const [previousPreset, setPreviousPreset] = useState(null);
  // Has the user clicked Apply at least once since entering Custom? Controls
  // whether Cancel reverts the preset or just closes the panel.
  const appliedSinceEntry = useRef(false);

  // When the user switches the preset INTO 'custom' from any other preset,
  // reset the draft to whatever was last applied and reopen the panel. The
  // dependency intentionally only watches `preset` — re-running on every
  // value change would clobber an in-progress draft.
  useEffect(() => {
    if (preset === 'custom') {
      setCustomDraft(value?.custom || { interval: 1, unit: 'week', daysOfWeek: [] });
      setPanelOpen(true);
      appliedSinceEntry.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const handlePresetChange = (next) => {
    // Capture the preset we're leaving so Cancel can restore it.
    if (next === 'custom' && preset !== 'custom') {
      setPreviousPreset(preset);
    }
    patch({ preset: next });
  };

  const patchDraft = (partial) => setCustomDraft((d) => ({ ...d, ...partial }));

  const toggleDayOfWeek = (dow) => {
    const set = new Set((customDraft.daysOfWeek || []).map(Number));
    if (set.has(dow)) set.delete(dow);
    else set.add(dow);
    patchDraft({ daysOfWeek: Array.from(set).sort((a, b) => a - b) });
  };

  const handleApplyCustom = () => {
    patch({ custom: customDraft });
    setPanelOpen(false);
    appliedSinceEntry.current = true;
  };

  const handleCancelCustom = () => {
    if (appliedSinceEntry.current) {
      // User has applied at least once this session — just close the panel,
      // leave the applied custom config alone.
      setPanelOpen(false);
    } else {
      // No Apply yet — restore the preset they came from.
      patch({ preset: previousPreset || 'daily' });
      setPanelOpen(false);
    }
  };

  const handleEditCustom = () => {
    setCustomDraft(value?.custom || { interval: 1, unit: 'week', daysOfWeek: [] });
    setPanelOpen(true);
  };

  const isOneTime = preset === 'does_not_repeat';
  const isCustom = preset === 'custom';
  const showWeekdays = isCustom && customDraft.unit === 'week';

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 transition dark:border-white/10 dark:bg-white/2 ${
        disabled ? 'pointer-events-none opacity-70 dark:opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-gray-900 2xl:text-base dark:text-white">
            Schedule
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-10 tracking-wide text-gray-500 uppercase dark:text-[#AFAFAF]">
            {describeFrequency(value) || 'Set a frequency'}
          </span>
          {isCustom && !panelOpen && (
            <button
              type="button"
              onClick={handleEditCustom}
              disabled={disabled}
              title="Edit custom recurrence"
              className="flex size-5 items-center justify-center rounded-md border border-black/10 bg-black/[0.03] text-gray-500 transition hover:border-[#15DCFF]/40 hover:bg-[#15DCFF]/10 hover:text-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/3 dark:text-[#AFAFAF]"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Two-row layout. Earlier we packed Frequency / Start / End / Hour /
          Timezone onto a single 5-column row, which forced Timezone into a
          ~140 px column where "(GMT+05:30) · Asia/Kolkata" got cropped to
          "GMT+…". Splitting into two rows gives every field room to breathe
          without sacrificing vertical compactness much. */}
      <div className="flex flex-col gap-2">
        <div
          className={`grid grid-cols-1 gap-x-2 gap-y-2 sm:items-end ${
            isOneTime
              ? 'sm:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)]'
              : 'sm:grid-cols-[minmax(10rem,12rem)_minmax(0,1fr)_minmax(0,1fr)]'
          }`}
        >
          <InputCommonDropdown
            label="Frequency"
            options={PRESET_OPTIONS}
            value={preset}
            onChange={handlePresetChange}
            disabled={disabled}
          />
          <DateField
            label={isOneTime ? 'Run on' : 'Start date'}
            value={startDate}
            min={todayInputValue(value?.timezone)}
            onChange={(v) => patch({ startDate: v })}
            disabled={disabled}
          />
          {!isOneTime && (
            <DateField
              label="End date"
              value={endDate}
              min={startDate || todayInputValue(value?.timezone)}
              onChange={(v) => patch({ endDate: v || null })}
              disabled={disabled}
              placeholder="Optional"
              allowClear
            />
          )}
        </div>
        <div className="grid grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-[minmax(8rem,10rem)_minmax(0,1fr)] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-gray-500 dark:text-[#AFAFAF]">Run at</label>
            <InputCommonDropdown
              label="Hour"
              options={hourOptions.length > 0 ? hourOptions : HOUR_OPTIONS}
              value={hour}
              onChange={(v) => patch({ hour: Number(v) })}
              disabled={disabled || (isStartToday && hourOptions.length === 0)}
            />
            {isStartToday && hourOptions.length === 0 && (
              <span className="text-[11px] text-amber-700 italic dark:text-amber-300/90">
                No hours left today — pick tomorrow as the start date.
              </span>
            )}
          </div>
          <TimezoneSelect
            value={value?.timezone}
            onChange={(tz) => {
              // When the user picks a new zone, recompute "today" in that
              // zone. If their currently-picked startDate is now in the past
              // for the new zone, bump it forward so the form stays valid.
              // Leave a future-dated startDate alone — the user picked it.
              const newToday = todayInputValue(tz);
              const patches = { timezone: tz };
              if (startDate && startDate < newToday) {
                patches.startDate = newToday;
              }
              patch(patches);
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Custom recurrence panel — staged. Edits accumulate locally on
          customDraft; only Apply commits them to the parent value and
          collapses the panel. */}
      <AnimatePresence initial={false}>
        {isCustom && panelOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 flex flex-col gap-4 rounded-lg border border-black/10 bg-black/[0.03] p-4 dark:border-white/5 dark:bg-[#0D0D0D]/40">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500 dark:text-[#AFAFAF]">Repeat every</label>
                <div className="flex items-center gap-2">
                  <NumberField
                    value={customDraft.interval || 1}
                    min={1}
                    max={365}
                    onChange={(n) => patchDraft({ interval: n })}
                    disabled={disabled}
                  />
                  <div className="min-w-32">
                    <InputCommonDropdown
                      label="Unit"
                      options={UNIT_OPTIONS}
                      value={customDraft.unit || 'week'}
                      onChange={(u) => patchDraft({ unit: u })}
                      disabled={disabled}
                    />
                  </div>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {showWeekdays && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-gray-500 dark:text-[#AFAFAF]">Repeat on</label>
                      <div className="flex flex-wrap gap-1.5">
                        {DOW.map(({ value: v, short, full }) => {
                          const active = (customDraft.daysOfWeek || []).map(Number).includes(v);
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => toggleDayOfWeek(v)}
                              disabled={disabled}
                              title={full}
                              aria-pressed={active}
                              className={`relative flex size-8 items-center justify-center rounded-full text-xs font-medium transition disabled:cursor-not-allowed ${
                                active
                                  ? 'bg-linear-to-br from-[#15DCFF] to-[#6b72f8] text-white shadow-md shadow-indigo-500/30'
                                  : 'border border-black/10 bg-black/[0.03] text-gray-600 hover:border-black/20 hover:text-gray-900 dark:border-white/10 dark:bg-white/4 dark:text-[#AFAFAF] dark:hover:border-white/20 dark:hover:text-white'
                              }`}
                            >
                              {short}
                            </button>
                          );
                        })}
                      </div>
                      {(customDraft.daysOfWeek || []).length === 0 && (
                        <span className="text-[11px] text-gray-500 dark:text-[#AFAFAF]">
                          No days selected — runs on the same weekday as your start date.
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelCustom}
                  disabled={disabled}
                  className="rounded-lg border border-black/10 px-3 py-1.5 text-xs text-gray-600 transition hover:bg-black/[0.04] hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-[#AFAFAF] dark:hover:bg-white/5 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyCustom}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-[#15DCFF] to-[#6b72f8] px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="size-3.5" />
                  Apply
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ----------------------------------------------------------------------------
// Inputs — small, styled to match the rest of the dark theme.
// ----------------------------------------------------------------------------

// Parse a YYYY-MM-DD form-state string into a local Date (midnight in the
// user's local zone). `new Date("YYYY-MM-DD")` would parse as UTC midnight,
// which can shift to the previous day in any UTC+N zone — exactly the trap
// `todayInputValue` avoids on the write path. Mirror it on the read path.
function parseInputDate(s) {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toInputDate(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function DateField({ label, value, onChange, min, disabled, placeholder, allowClear }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close the popover on any click that lands outside the field.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape so keyboard users aren't trapped.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const dateObj = parseInputDate(value);
  const minDate = parseInputDate(min);
  const display = dateObj ? format(dateObj, 'd MMM yyyy') : placeholder || 'Pick a date';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-gray-500 dark:text-[#AFAFAF]">{label}</label>
        {allowClear && value && (
          <button
            type="button"
            onClick={() => onChange?.('')}
            disabled={disabled}
            className="text-10 tracking-wide text-gray-500 uppercase transition hover:text-gray-900 disabled:opacity-50 dark:text-[#AFAFAF] dark:hover:text-white"
          >
            clear
          </button>
        )}
      </div>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-black/10 bg-gray-200 px-3 text-sm text-gray-900 outline-none transition hover:border-black/20 focus:border-[#15DCFF]/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-[#0D0D0D]/40 dark:text-white dark:hover:border-white/20 dark:disabled:opacity-50 ${
            open ? 'border-[#15DCFF]/60' : ''
          }`}
        >
          <span className={`truncate ${dateObj ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-[#666]'}`}>
            {display}
          </span>
          <CalendarDays className="size-4 shrink-0 text-gray-500 dark:text-[#AFAFAF]" />
        </button>

        {open && (
          <div
            className="adsgpt-cal-pop absolute top-full right-0 z-10000 mt-1 overflow-hidden rounded-lg border border-black/10 bg-[#eef1f3] shadow-xl dark:border-white/10 dark:bg-[#1a1a1a] dark:shadow-2xl"
          >
            <style>{`
              .adsgpt-cal-pop .rdrCalendarWrapper { background: #1a1a1a; color: #fff; font-size: 11px; }
              .adsgpt-cal-pop .rdrDateDisplayWrapper { display: none; }
              .adsgpt-cal-pop .rdrMonthAndYearWrapper { background: #1a1a1a; height: 44px; padding-top: 6px; }
              .adsgpt-cal-pop .rdrMonthAndYearPickers select { color: #fff; background: #0D0D0D; border-radius: 6px; padding: 2px 6px; }
              .adsgpt-cal-pop .rdrNextPrevButton { background: #2a2a2a; }
              .adsgpt-cal-pop .rdrNextPrevButton:hover { background: #3a3a3a; }
              .adsgpt-cal-pop .rdrPprevButton i { border-color: transparent #fff transparent transparent; }
              .adsgpt-cal-pop .rdrNextButton i { border-color: transparent transparent transparent #fff; }
              .adsgpt-cal-pop .rdrMonth { padding: 0 0.6em 0.6em; }
              .adsgpt-cal-pop .rdrWeekDay { color: #AFAFAF; font-size: 11px; }
              .adsgpt-cal-pop .rdrDay { color: #E3E3E3; }
              .adsgpt-cal-pop .rdrDayNumber span { color: #E3E3E3; font-size: 12px; }
              .adsgpt-cal-pop .rdrDayPassive .rdrDayNumber span { color: #555; }
              .adsgpt-cal-pop .rdrDayDisabled { background: transparent; }
              .adsgpt-cal-pop .rdrDayDisabled .rdrDayNumber span { color: #444; }
              .adsgpt-cal-pop .rdrDayToday .rdrDayNumber span::after { background: #15DCFF; }
              .adsgpt-cal-pop .rdrDayHovered .rdrDayNumber span { color: #fff; }
              .adsgpt-cal-pop .rdrSelected,
              .adsgpt-cal-pop .rdrDayStartPreview,
              .adsgpt-cal-pop .rdrDayEndPreview { color: #15DCFF !important; }
            `}</style>
            <Calendar
              date={dateObj || new Date()}
              onChange={(d) => {
                onChange?.(toInputDate(d));
                setOpen(false);
              }}
              minDate={minDate || undefined}
              color="#15DCFF"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function NumberField({ value, onChange, min = 1, max = 99, disabled }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isNaN(n)) return;
        onChange?.(Math.min(max, Math.max(min, n)));
      }}
      disabled={disabled}
      className="adfactory-automation-input h-10 w-20 rounded-lg border border-black/10 bg-gray-200 px-3 text-center text-sm text-gray-900 outline-none transition focus:border-[#15DCFF]/60 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-[#0D0D0D]/40 dark:text-white dark:disabled:opacity-50"
    />
  );
}

// Returns today's date as YYYY-MM-DD in the given IANA timezone. Falls back
// to the browser's local zone when `timezone` is omitted or invalid.
// We use Intl.DateTimeFormat (not toISOString) because the latter shifts
// local midnight back to the previous day in any UTC+N zone.
function todayInputValue(timezone) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const yyyy = parts.find((p) => p.type === 'year').value;
    const mm = parts.find((p) => p.type === 'month').value;
    const dd = parts.find((p) => p.type === 'day').value;
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
}
