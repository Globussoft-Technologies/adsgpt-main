/**
 * scalePolicy — the engine-owned half of budget scaling.
 *
 * THE SPLIT THAT MATTERS: a user's rule decides *what counts as a winner*
 * ("ROAS above 2 and frequency under 2") and how big a step to ask for
 * ("+20%"). This module decides *how much is allowed to actually happen*.
 * Users must not be able to edit the ceilings — a rule author at 2am should
 * not be one form field away from +500% per hour across every ad set they
 * own.
 *
 * Why ceilings are load-bearing: the cron runs HOURLY. Compounding +20%
 * every hour is roughly x1000 in a day. There is also a Meta-side reason to
 * move gradually — a large budget jump destabilises delivery optimisation
 * and pushes the ad set back into learning, degrading performance exactly
 * when you were trying to buy more of it. The same is true downward: mass
 * throttling resets learning across an account.
 *
 * Harvested from autoScaleService (v3) minus its coupling to
 * `auditRulesConfig` AUD-35/AUD-37. Those were "policy rules" — entries in
 * the 37-rule config whose `check()` returns false and whose `entity` is
 * commented "arbitrary — never evaluated", existing only to carry two
 * numbers so they inherited per-account override plumbing. That made the v3
 * rule config a RUNTIME dependency of scaling and blocks its deletion. The
 * numbers live here now, and they are not overridable, because they are not
 * opinions about advertising.
 *
 * Env names are the pre-existing v3 ones, so nothing new needs to be set.
 *
 * UNITS: every budget figure here is in the account's SMALLEST currency unit
 * (paise / cents) because that is how Meta returns and accepts budgets.
 * Insight `spend` is the opposite — Meta reports that in MAJOR units. Never
 * mix them; that confusion is a bug this codebase has already paid for.
 */

const DEFAULTS = {
  // Per-action step used when a rule doesn't name one.
  stepPct: 20,
  // 7-day cumulative ceilings, as RATIOS against the entity's budget at the
  // start of the window. 2.0 = "may at most double in a week", 0.5 = "may at
  // most halve".
  maxRatio7d: 2.0,
  minRatio7d: 0.5,
  // Share of total account daily budget one cycle may add / remove.
  capAccountPct: 10,
};

// Ceiling on what a single rule may ask for in one action. A user can write
// 50; they cannot write 500. Exported so the Joi validator and the rule form
// share one number.
const MAX_RULE_STEP_PCT = 50;
const MIN_RULE_STEP_PCT = 1;

// The cumulative window. Deliberately FIXED, unlike resume's strike window
// which scales with the rule's lookback. Different quantity: this bounds
// budget-change velocity, which has nothing to do with how far back a rule
// looks when deciding. A 30-day-lookback rule still must not triple a budget
// in a week.
const CUMULATIVE_WINDOW_DAYS = 7;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Resolve the effective ceilings. No per-account overrides: these are
 * blast-radius controls, not preferences.
 */
function resolveScalePolicy() {
  const maxRatio7d = Math.max(
    1.01,
    envFloat("AUTOPILOT_SCALE_MAX_RATIO_7D", DEFAULTS.maxRatio7d),
  );
  const minRatio7d = Math.min(
    0.99,
    Math.max(0.01, envFloat("AUTOPILOT_SCALE_MIN_RATIO_7D", DEFAULTS.minRatio7d)),
  );
  return {
    defaultStepPct: Math.max(
      1,
      envInt("AUTOPILOT_SCALE_PCT_PER_RUN", DEFAULTS.stepPct),
    ),
    maxRatio7d,
    minRatio7d,
    capAccountPct: Math.max(
      1,
      envInt("AUTOPILOT_SCALE_PCT_CAP_ACCOUNT_PER_RUN", DEFAULTS.capAccountPct),
    ),
    cumulativeWindowDays: CUMULATIVE_WINDOW_DAYS,
  };
}

/**
 * Where an entity's budget sits now relative to the start of the cumulative
 * window.
 *
 * WHY A RATIO AND NOT A SUM OF PERCENTAGES: v3 summed `pct_change` over the
 * window, which is roughly fine while every step is positive. With both
 * directions in play it is simply wrong — +20% then -20% sums to zero, but
 * the budget is at 0.96x, and a rule pair could ratchet an entity down
 * indefinitely while the counter reads zero. Comparing the current budget to
 * the oldest `prev_budget` in the window is exact and needs no new data:
 * every scale row already logs `prev_budget`.
 *
 * A PROPERTY WORTH KNOWING: if a HUMAN moved the budget, that movement is
 * inside this ratio too, and Autopilot will decline to add more. That is
 * correct, not a misattribution — the ceiling means "this entity's budget
 * must not more than double in a week", regardless of who moved it.
 *
 * @param {number} currentBudget    budget now, minor units
 * @param {number|null} oldestPrevBudget  `prev_budget` of the oldest scale
 *        row inside the window, or null when there are none
 * @returns {number} ratio; 1 when there is no history to compare against
 */
function cumulativeRatio(currentBudget, oldestPrevBudget) {
  const cur = Number(currentBudget);
  const base = Number(oldestPrevBudget);
  if (!Number.isFinite(cur) || cur <= 0) return 1;
  if (!Number.isFinite(base) || base <= 0) return 1;
  return cur / base;
}

/**
 * Clamp a requested step to the headroom left in its own direction.
 *
 * Returns `{allowed:false}` when the entity has already used up the window's
 * movement in that direction — NOT a clamped step of zero, so the caller can
 * log a distinct "cap reached" reason rather than a no-op scale.
 *
 * Note the two directions are independent: an entity that has fallen to 0.5x
 * has no further DOWN headroom but plenty of UP headroom, so a scale-up rule
 * can still act on it.
 *
 * @param {number} pctStep       signed request, e.g. 20 or -20
 * @param {number} ratioSoFar    from cumulativeRatio()
 * @param {number} maxRatio7d    upper ceiling, e.g. 2.0
 * @param {number} minRatio7d    lower ceiling, e.g. 0.5
 */
function computeStep({ pctStep, ratioSoFar, maxRatio7d, minRatio7d }) {
  const step = Number(pctStep);
  if (!Number.isFinite(step) || step === 0) {
    return { allowed: false, pctStep: 0, reason: "zero-step" };
  }
  const ratio = Number.isFinite(ratioSoFar) && ratioSoFar > 0 ? ratioSoFar : 1;

  if (step > 0) {
    // Multiplier this step would apply on top of where we already are.
    const headroom = maxRatio7d / ratio; // >1 means room to grow
    if (headroom <= 1) {
      return { allowed: false, pctStep: 0, reason: "cap-reached-up" };
    }
    const maxPct = (headroom - 1) * 100;
    return { allowed: true, pctStep: Math.min(step, maxPct) };
  }

  const headroom = minRatio7d / ratio; // <1 means room to shrink
  if (headroom >= 1) {
    return { allowed: false, pctStep: 0, reason: "cap-reached-down" };
  }
  const maxDownPct = (1 - headroom) * 100; // positive magnitude
  return { allowed: true, pctStep: -Math.min(Math.abs(step), maxDownPct) };
}

/**
 * Absolute per-cycle account ceiling, in minor units.
 *
 * @param {number} accountDailyBudget summed account daily budget (minor
 *        units) — `audit.accountDailyBudget`
 * @param {number} capAccountPct      from resolveScalePolicy()
 */
function accountCapAbsolute(accountDailyBudget, capAccountPct) {
  const total = Number(accountDailyBudget) || 0;
  if (total <= 0) return 0;
  return Math.floor((total * capAccountPct) / 100);
}

/**
 * Would committing this delta push the cycle past the account ceiling for
 * its direction?
 *
 * Up and down are tracked SEPARATELY because they guard different things:
 * the up cap protects the wallet, the down cap protects delivery. Netting
 * them would let a big raise and a big cut cancel out on paper while both
 * actually happened.
 *
 * A zero/absent account budget disables the check rather than blocking
 * everything — a lifetime-budget-only account has no meaningful daily total,
 * and the per-entity ceilings still apply.
 *
 * @param {number} accumulatedDelta  magnitude already spent this cycle in
 *        this direction (positive number, minor units)
 * @param {number} pendingDelta      signed delta this action would apply
 * @param {number} accountCapAbsolute ceiling, minor units
 */
function withinAccountCap({
  accumulatedDelta,
  pendingDelta,
  accountCapAbsolute: cap,
}) {
  if (!Number.isFinite(cap) || cap <= 0) {
    return { allowed: true, headroomDelta: Number.POSITIVE_INFINITY };
  }
  const magnitude = Math.abs(Number(pendingDelta) || 0);
  const already = Math.abs(Number(accumulatedDelta) || 0);
  const projected = already + magnitude;
  if (projected > cap) {
    return { allowed: false, headroomDelta: cap - already };
  }
  return { allowed: true, headroomDelta: cap - projected };
}

/**
 * Apply a signed step to a budget. Rounds to a whole minor unit — Meta
 * rejects fractional paise — and never returns a non-positive budget.
 */
function scaledBudget(prevBudget, pctStep) {
  const next = Math.round(Number(prevBudget) * (1 + Number(pctStep) / 100));
  return Math.max(1, next);
}

module.exports = {
  resolveScalePolicy,
  cumulativeRatio,
  computeStep,
  accountCapAbsolute,
  withinAccountCap,
  scaledBudget,
  MAX_RULE_STEP_PCT,
  MIN_RULE_STEP_PCT,
  CUMULATIVE_WINDOW_DAYS,
  DEFAULTS,
};
