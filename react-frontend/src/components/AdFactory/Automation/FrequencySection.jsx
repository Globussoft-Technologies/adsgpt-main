import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, Check, Pencil } from 'lucide-react';
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
      className={`flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">
            Schedule
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-10 tracking-wide text-[#AFAFAF] uppercase">
            {describeFrequency(value) || 'Set a frequency'}
          </span>
          {isCustom && !panelOpen && (
            <button
              type="button"
              onClick={handleEditCustom}
              disabled={disabled}
              title="Edit custom recurrence"
              className="flex size-5 items-center justify-center rounded-md border border-white/10 bg-white/3 text-[#AFAFAF] transition hover:border-[#15DCFF]/40 hover:bg-[#15DCFF]/10 hover:text-[#15DCFF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="size-2.5" />
            </button>
          )}
        </div>
      </div>

      {/* Preset dropdown + dates + timezone packed onto one row when width
          allows. items-end keeps the dropdowns' baselines aligned with the
          date inputs (which sit beneath their labels). */}
      <div className="grid grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-[minmax(10rem,11rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(7rem,8rem)_minmax(9rem,10rem)] sm:items-end">
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
        {!isOneTime ? (
          <DateField
            label="End date (optional)"
            value={endDate}
            min={startDate || todayInputValue(value?.timezone)}
            onChange={(v) => patch({ endDate: v || null })}
            disabled={disabled}
            placeholder="No end — runs until credits exhaust"
            allowClear
          />
        ) : (
          <div />
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[#AFAFAF]">Run at</label>
          <InputCommonDropdown
            label="Hour"
            options={HOUR_OPTIONS}
            value={hour}
            onChange={(v) => patch({ hour: Number(v) })}
            disabled={disabled}
          />
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
            <div className="mt-1 flex flex-col gap-4 rounded-lg border border-white/5 bg-[#0D0D0D]/40 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-[#AFAFAF]">Repeat every</label>
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
                      <label className="text-xs text-[#AFAFAF]">Repeat on</label>
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
                                  : 'border border-white/10 bg-white/4 text-[#AFAFAF] hover:border-white/20 hover:text-white'
                              }`}
                            >
                              {short}
                            </button>
                          );
                        })}
                      </div>
                      {(customDraft.daysOfWeek || []).length === 0 && (
                        <span className="text-[11px] text-[#AFAFAF]">
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
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#AFAFAF] transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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

function DateField({ label, value, onChange, min, disabled, placeholder, allowClear }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs text-[#AFAFAF]">{label}</label>
        {allowClear && value && (
          <button
            type="button"
            onClick={() => onChange?.('')}
            disabled={disabled}
            className="text-10 tracking-wide text-[#AFAFAF] uppercase transition hover:text-white disabled:opacity-50"
          >
            clear
          </button>
        )}
      </div>
      <input
        type="date"
        value={value || ''}
        min={min || undefined}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        style={{ colorScheme: 'dark' }}
        className="h-10 w-full rounded-lg border border-white/10 bg-[#0D0D0D]/40 px-3 text-sm text-white outline-none transition placeholder:text-[#666] focus:border-[#15DCFF]/60 disabled:cursor-not-allowed disabled:opacity-50"
      />
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
      className="h-10 w-20 rounded-lg border border-white/10 bg-[#0D0D0D]/40 px-3 text-center text-sm text-white outline-none transition focus:border-[#15DCFF]/60 disabled:cursor-not-allowed disabled:opacity-50"
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
