/**
 * Date-range resolution for the Meta Ads insights endpoints.
 *
 * Turns a request's `{ datePreset }` OR `{ since, until }` into:
 *   - `current`  — what to send Meta for the requested window
 *   - `previous` — the immediately-preceding equal-length window, used for
 *                  the period-over-period "% change" chips
 *   - `token`    — a cache-key fragment (see utils/metaCacheKeys.js)
 *
 * ── Why `previous` is computed rather than mapped ────────────────────────
 * getAnalyticsData used to map preset → preset via a 6-entry `prevPresets`
 * table and fall back to "last_30d" for anything unmapped. Only 6 of the 16
 * presets the UI offers were in it — including, critically, NOT the default
 * `last_14d`. So the default dashboard compared 14 days against 30 days, and
 * `lifetime`/`maximum` compared against an arbitrary 30-day window. Every %
 * chip on the default view was wrong. Deriving a concrete preceding window
 * per preset fixes all 16 at once.
 *
 * ── Why `current` stays a preset ─────────────────────────────────────────
 * Only `previous` is converted to a time_range. Meta's presets carry
 * account-timezone and day-boundary semantics we don't replicate here, so
 * converting `current` too would shift the headline numbers every user sees
 * for reasons unrelated to fixing the comparison baseline. Presets in →
 * presets out.
 *
 * Known limitation: preceding windows are computed in server-local time, so
 * they can be off by a day against an ad account in a distant timezone. That
 * affects the comparison baseline only (never the headline number), and is
 * enormously better than the 14-vs-30 it replaces. Account-timezone-correct
 * windows are a follow-up (would need `account.read(['timezone_name'])`).
 *
 * Arithmetic mirrors services/metaAuditService.js's resolveInsightTimeOptions.
 * That service is deliberately NOT refactored to share this — its rule
 * thresholds are calibrated against its current behavior (see gotchas.md).
 */
const dayjs = require("dayjs");

const DATE_FMT = "YYYY-MM-DD";
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Meta rejects insights windows older than ~37 months.
const MAX_SPAN_MONTHS = 37;

/**
 * Length in days of each preset's window, for presets whose length is fixed.
 * Calendar-relative presets (this_month, last_quarter, …) are resolved
 * against `now` instead — see `presetWindow`.
 */
const FIXED_LENGTH_PRESETS = {
  today: 1,
  yesterday: 1,
  last_3d: 3,
  last_7d: 7,
  last_14d: 14,
  last_28d: 28,
  last_30d: 30,
  last_90d: 90,
};

// Presets with no meaningful preceding window — there is nothing before "all
// time". These return previous: null, which surfaces as change: null and
// renders as no chip at all (ChangeChip already returns null for non-numeric).
const NO_PREVIOUS_PRESETS = new Set(["lifetime", "maximum"]);

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = "INVALID_DATE_RANGE";
  return err;
}

/**
 * The concrete {since, until} window a preset denotes, as of `now`.
 * Returns null for presets with no bounded window (lifetime/maximum).
 */
function presetWindow(preset, now) {
  if (NO_PREVIOUS_PRESETS.has(preset)) return null;

  const fixed = FIXED_LENGTH_PRESETS[preset];
  if (fixed) {
    // `today` ends today; every other fixed window ends yesterday, matching
    // Meta's convention that rolling windows exclude the partial current day.
    const until = preset === "today" ? now : now.subtract(1, "day");
    return {
      since: until.subtract(fixed - 1, "day").format(DATE_FMT),
      until: until.format(DATE_FMT),
    };
  }

  const calendar = {
    this_month: [now.startOf("month"), now],
    last_month: [
      now.subtract(1, "month").startOf("month"),
      now.subtract(1, "month").endOf("month"),
    ],
    this_quarter: [now.startOf("month").subtract(now.month() % 3, "month"), now],
    last_quarter: (() => {
      const qStart = now.startOf("month").subtract(now.month() % 3, "month");
      return [qStart.subtract(3, "month"), qStart.subtract(1, "day")];
    })(),
    this_year: [now.startOf("year"), now],
    last_year: [
      now.subtract(1, "year").startOf("year"),
      now.subtract(1, "year").endOf("year"),
    ],
  };
  if (!preset || !Object.prototype.hasOwnProperty.call(calendar, preset)) return null;
  const pair = calendar[preset];
  if (!pair) return null;
  return { since: pair[0].format(DATE_FMT), until: pair[1].format(DATE_FMT) };
}

/** The equal-length window ending the day before `window` starts. */
function precedingWindow(window) {
  if (!window) return null;
  const since = dayjs(window.since);
  const until = dayjs(window.until);
  const lengthDays = until.diff(since, "day") + 1;
  const prevUntil = since.subtract(1, "day");
  return {
    since: prevUntil.subtract(lengthDays - 1, "day").format(DATE_FMT),
    until: prevUntil.format(DATE_FMT),
  };
}

/**
 * @param {{datePreset?: string, since?: string, until?: string}} query
 * @param {{now?: dayjs.Dayjs}} [opts]
 * @returns {{mode:'preset'|'range', current:object, previous:object|null, token:string,
 *            datePreset?:string, since?:string, until?:string}}
 * @throws  {Error} with statusCode 400 on invalid input
 */
function resolveDateRange(query = {}, opts = {}) {
  const now = opts.now ? dayjs(opts.now) : dayjs();
  const since = query.since ? String(query.since).trim() : "";
  const until = query.until ? String(query.until).trim() : "";

  // ── custom range ──
  if (since || until) {
    if (!since || !until) {
      throw validationError("Both `since` and `until` are required for a custom date range");
    }
    if (!STRICT_DATE.test(since) || !STRICT_DATE.test(until)) {
      throw validationError("`since` and `until` must be YYYY-MM-DD dates");
    }
    const s = dayjs(since);
    const u = dayjs(until);
    if (!s.isValid() || !u.isValid()) {
      throw validationError("`since` and `until` must be valid dates");
    }
    if (s.isAfter(u)) {
      throw validationError("`since` must be on or before `until`");
    }
    if (u.isAfter(now, "day")) {
      throw validationError("`until` cannot be in the future");
    }
    if (u.diff(s, "month", true) > MAX_SPAN_MONTHS) {
      throw validationError(`Date range cannot exceed ${MAX_SPAN_MONTHS} months`);
    }
    const window = { since, until };
    const prev = precedingWindow(window);
    return {
      mode: "range",
      since,
      until,
      current: { time_range: window },
      previous: { time_range: prev },
      token: `r:${since}_${until}`,
    };
  }

  // ── preset ──
  const preset = query.datePreset || "last_30d";
  const window = presetWindow(preset, now);
  const prev = precedingWindow(window);
  return {
    mode: "preset",
    datePreset: preset,
    // Deliberately a preset, not a time_range — see the file header.
    current: { date_preset: preset },
    previous: prev ? { time_range: prev } : null,
    token: `p:${preset}`,
  };
}

module.exports = {
  resolveDateRange,
  presetWindow,
  precedingWindow,
  FIXED_LENGTH_PRESETS,
  NO_PREVIOUS_PRESETS,
  MAX_SPAN_MONTHS,
};
