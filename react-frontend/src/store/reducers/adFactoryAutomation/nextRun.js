// ----------------------------------------------------------------------------
// Frequency → next-run-Date resolver + cycle counter
//
// Pure helpers so they're trivially testable. The single-page AutomationForm
// emits frequency shapes like:
//   { preset: 'does_not_repeat', startDate }
//   { preset: 'daily',           startDate, endDate? }
//   { preset: 'weekday',         startDate, endDate? }
//   { preset: 'weekend',         startDate, endDate? }
//   { preset: 'custom',          startDate, endDate?, custom: { interval, unit, daysOfWeek? } }
//
// Conventions:
//   * All schedule fires default to 09:00 local time on the target day.
//   * `endDate` is optional. When omitted on a recurring preset the schedule
//     runs indefinitely (countCyclesBetween returns null, which the UI maps
//     to "until credits run out").
//   * For 'does_not_repeat' the run happens once on startDate and that's it.
// ----------------------------------------------------------------------------

const FIRE_HOUR = 9;

const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

const asDate = (input) => {
  if (!input) return null;
  const d = input instanceof Date ? new Date(input) : new Date(input);
  return isDate(d) ? d : null;
};

const atFireHour = (d) => {
  const c = new Date(d);
  c.setHours(FIRE_HOUR, 0, 0, 0);
  return c;
};

const addDays = (d, n) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

const isWeekday = (d) => {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
};

const isWeekend = (d) => {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
};

const stripTime = (d) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

const daysBetweenInclusive = (start, end) =>
  Math.floor((stripTime(end) - stripTime(start)) / (1000 * 60 * 60 * 24)) + 1;

// ----------------------------------------------------------------------------
// computeNextRunAt
// ----------------------------------------------------------------------------

export function computeNextRunAt(frequency, fromInput) {
  if (!frequency || !frequency.preset) return null;

  const from = asDate(fromInput) || new Date();
  const start = asDate(frequency.startDate);
  const end = asDate(frequency.endDate); // may be null

  // Past the explicit end date → schedule is done.
  if (end && stripTime(from) > stripTime(end)) return null;

  // Anchor point — never fire before the start date.
  const anchor = start && start > from ? start : from;

  let candidate = null;

  switch (frequency.preset) {
    case 'does_not_repeat': {
      // Single shot at startDate (defaults to today if omitted).
      if (!start) return null;
      // If start is in the future → fire then; if it has passed → already done.
      candidate = stripTime(start) >= stripTime(from) ? atFireHour(start) : null;
      break;
    }

    case 'daily': {
      candidate = atFireHour(anchor);
      // If anchor === from (today) and today's fire time has passed, jump to tomorrow.
      if (start && stripTime(start) <= stripTime(from)) {
        candidate = atFireHour(addDays(from, 1));
      }
      break;
    }

    case 'weekday': {
      candidate = atFireHour(anchor);
      // If anchor is today and we've already passed today's slot, start tomorrow.
      if (!start || stripTime(start) <= stripTime(from)) {
        candidate = atFireHour(addDays(from, 1));
      }
      while (!isWeekday(candidate)) candidate = addDays(candidate, 1);
      break;
    }

    case 'weekend': {
      candidate = atFireHour(anchor);
      if (!start || stripTime(start) <= stripTime(from)) {
        candidate = atFireHour(addDays(from, 1));
      }
      while (!isWeekend(candidate)) candidate = addDays(candidate, 1);
      break;
    }

    case 'custom': {
      const custom = frequency.custom || {};
      const interval = Math.max(1, Number(custom.interval) || 1);
      const unit = custom.unit === 'day' ? 'day' : 'week';

      if (unit === 'day') {
        // Every N days, starting from the start date (or today).
        const base = atFireHour(anchor);
        if (!start || stripTime(start) <= stripTime(from)) {
          candidate = addDays(base, interval);
        } else {
          candidate = base;
        }
        break;
      }

      // Weekly with optional days-of-week multi-select.
      const daysOfWeek = Array.isArray(custom.daysOfWeek)
        ? custom.daysOfWeek.map(Number).sort((a, b) => a - b)
        : [];

      if (daysOfWeek.length === 0) {
        // No specific days picked → fire on the same DOW as start, every N weeks.
        const base = atFireHour(anchor);
        if (!start || stripTime(start) <= stripTime(from)) {
          candidate = addDays(base, interval * 7);
        } else {
          candidate = base;
        }
        break;
      }

      // Scan forward day-by-day up to interval*7 days to find the next match.
      const scanStart = !start || stripTime(start) <= stripTime(from)
        ? addDays(atFireHour(from), 1)
        : atFireHour(start);
      for (let i = 0; i < interval * 7 + 1; i += 1) {
        const probe = addDays(scanStart, i);
        if (daysOfWeek.includes(probe.getDay())) {
          candidate = probe;
          break;
        }
      }
      break;
    }

    default:
      return null;
  }

  if (!candidate) return null;
  if (end && stripTime(candidate) > stripTime(end)) return null;
  return candidate;
}

// ----------------------------------------------------------------------------
// countCyclesBetween
//   Returns the total number of fires expected between startDate and endDate.
//   Returns null when the schedule is recurring AND endDate is omitted
//   (caller renders this as "until credits run out").
// ----------------------------------------------------------------------------

export function countCyclesBetween(frequency) {
  if (!frequency || !frequency.preset) return 0;

  const start = asDate(frequency.startDate);
  const end = asDate(frequency.endDate);

  if (!start) return 0;

  if (frequency.preset === 'does_not_repeat') return 1;
  if (!end) return null; // open-ended recurring

  if (stripTime(end) < stripTime(start)) return 0;

  const totalDays = daysBetweenInclusive(start, end);

  switch (frequency.preset) {
    case 'daily':
      return totalDays;

    case 'weekday': {
      let count = 0;
      for (let i = 0; i < totalDays; i += 1) {
        if (isWeekday(addDays(start, i))) count += 1;
      }
      return count;
    }

    case 'weekend': {
      let count = 0;
      for (let i = 0; i < totalDays; i += 1) {
        if (isWeekend(addDays(start, i))) count += 1;
      }
      return count;
    }

    case 'custom': {
      const custom = frequency.custom || {};
      const interval = Math.max(1, Number(custom.interval) || 1);
      const unit = custom.unit === 'day' ? 'day' : 'week';

      if (unit === 'day') {
        return Math.floor((totalDays - 1) / interval) + 1;
      }

      // Weekly
      const daysOfWeek = Array.isArray(custom.daysOfWeek) ? custom.daysOfWeek.map(Number) : [];
      if (daysOfWeek.length === 0) {
        const weeks = Math.floor((totalDays - 1) / 7) + 1;
        return Math.floor((weeks - 1) / interval) + 1;
      }

      let count = 0;
      for (let i = 0; i < totalDays; i += 1) {
        const probe = addDays(start, i);
        const weekIndex = Math.floor(i / 7);
        if (weekIndex % interval !== 0) continue;
        if (daysOfWeek.includes(probe.getDay())) count += 1;
      }
      return count;
    }

    default:
      return 0;
  }
}

// ----------------------------------------------------------------------------
// describeFrequency — short human label for the active node + summary row.
// ----------------------------------------------------------------------------

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeFrequency(frequency) {
  if (!frequency || !frequency.preset) return '';
  switch (frequency.preset) {
    case 'does_not_repeat':
      return 'Runs once';
    case 'daily':
      return 'Every day';
    case 'weekday':
      return 'Every weekday';
    case 'weekend':
      return 'Every weekend';
    case 'custom': {
      const c = frequency.custom || {};
      const n = c.interval || 1;
      const unit = c.unit === 'day' ? 'day' : 'week';
      if (unit === 'week' && Array.isArray(c.daysOfWeek) && c.daysOfWeek.length > 0) {
        const days = [...c.daysOfWeek]
          .map(Number)
          .sort((a, b) => a - b)
          .map((d) => DOW_SHORT[d])
          .join(', ');
        return `Every ${n} week${n > 1 ? 's' : ''} on ${days}`;
      }
      return `Every ${n} ${unit}${n > 1 ? 's' : ''}`;
    }
    default:
      return '';
  }
}

// ----------------------------------------------------------------------------
// summarizeCycles — packaged for the form's live summary row.
// ----------------------------------------------------------------------------

export function summarizeCycles({
  frequency,
  pairsPerCycle,
  creditsPerImage = 7,   // mirrors ServicesForm cost
  availableCredits = 0,
}) {
  const scheduled = countCyclesBetween(frequency); // number | null
  const costPerCycle = Math.max(0, Number(pairsPerCycle) || 0) * creditsPerImage;
  const affordable = costPerCycle > 0 ? Math.floor(availableCredits / costPerCycle) : 0;

  // Cycles that will actually run before credits are exhausted.
  const runnable = scheduled == null ? affordable : Math.min(scheduled, affordable);
  const isOpenEnded = scheduled == null;
  const exceedsCredits = scheduled != null && scheduled > affordable;
  const totalCost = runnable * costPerCycle;

  return {
    scheduled,        // number | null (null = indefinite)
    affordable,       // integer cycles fit in remaining credits
    runnable,         // integer cycles that will actually fire
    costPerCycle,     // credits used per cycle
    totalCost,        // credits used across runnable cycles
    isOpenEnded,      // true → no end date on a recurring preset
    exceedsCredits,   // true → schedule wants more cycles than credits cover
  };
}
