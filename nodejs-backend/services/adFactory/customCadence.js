/**
 * customCadence — the `customFrequency` block, normalised.
 *
 * PURE. No DB, no network.
 *
 * Shared by BOTH the create path (briefToJobPayload) and the edit path
 * (briefToJobPatch), which is the whole reason it is its own module rather than
 * living in either: a cadence that meant "every 2 weeks on Tuesdays" at
 * activation and something else at the next edit would be worse than not
 * supporting custom at all. It also breaks the import cycle the two would
 * otherwise form.
 *
 * `scheduleSchema` REQUIRES this block whenever the frequency is `custom`, so
 * every field is filled in — there is no partial version of it that validates.
 */

const plain = (v) => (v && typeof v.toObject === "function" ? v.toObject() : v || {});

const UNITS = new Set(["day", "week"]);

// Lowercase names, matching the queue's own DOW_MAP keys.
const DAYS = Object.freeze([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);
const DAY_SET = new Set(DAYS);

/**
 * @param {object} briefCustom  brief.delivery.frequency.custom
 * @param {object} [fallback]   the job's existing customFrequency, so a partial
 *                              edit cannot blank the fields it didn't touch
 * @returns {{repeatEvery: number, repeatUnit: string, repeatOnDays: string[]}}
 */
function normalizeCustom(briefCustom, fallback = {}) {
  const c = plain(briefCustom);
  const f = plain(fallback);

  const every = Number(c.repeatEvery ?? f.repeatEvery);
  const unit = String(c.repeatUnit ?? f.repeatUnit ?? "week");
  const days = Array.isArray(c.repeatOnDays) ? c.repeatOnDays : f.repeatOnDays;

  return {
    // Clamped, not rejected: the control cannot produce an out-of-range value,
    // so one arriving means a hand-crafted request, and 52 weeks is a year.
    repeatEvery: Number.isFinite(every) ? Math.min(52, Math.max(1, Math.round(every))) : 1,
    repeatUnit: UNITS.has(unit) ? unit : "week",
    // Filtered rather than trusted. The queue maps names through DOW_MAP and
    // drops what it doesn't recognise; a list of only-invalid names would
    // collapse there to "Mondays" without saying so. Handing over just the
    // names that survive keeps the stored cadence and the running one identical.
    //
    // An EMPTY list is legitimate and left alone — the queue resolves it to the
    // start date's own weekday, which is the sensible reading of "every 2 weeks"
    // with no day picked.
    repeatOnDays: (Array.isArray(days) ? days : [])
      .map((d) => String(d || "").toLowerCase())
      .filter((d) => DAY_SET.has(d)),
  };
}

/** Value equality, for deciding whether an edit actually changed the cadence. */
const sameCustom = (a, b = {}) => {
  const x = normalizeCustom(a);
  const y = normalizeCustom(b);
  return (
    x.repeatEvery === y.repeatEvery &&
    x.repeatUnit === y.repeatUnit &&
    x.repeatOnDays.join(",") === y.repeatOnDays.join(",")
  );
};

module.exports = { normalizeCustom, sameCustom, DAYS };
