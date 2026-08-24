/**
 * actionBudget — how much Autopilot is allowed to DO to one ad account in
 * one cron tick.
 *
 * Separate from whether an action is *justified*. A rule decides that. This
 * decides how many justified actions may actually land before the engine
 * stops for the hour, and it is not user-editable: it is blast-radius
 * control on an hourly job that moves real money.
 *
 * Two consumers, deliberately sharing one mechanism:
 *
 *   - SCALE, where the risk is obvious: fifty simultaneous winners at +20%
 *     each is a very different event from one.
 *   - RESUME, where the risk is a cold start. The resume pass looks back 30
 *     days for pauses to retry. On the first tick after a deploy into an
 *     account that has been pausing for weeks, EVERY such pause becomes a
 *     candidate at once — most of them past their trial cycle, so the rule
 *     no longer matches and they all qualify. Without a cap that is a single
 *     tick restarting hundreds of ads. Nothing in the resume logic is wrong;
 *     it is a cold-start condition no unit test surfaces, because tests
 *     always start from an empty log.
 *
 * Budgets are per (account × cycle). A fresh tick gets a fresh budget, so a
 * backlog drains over hours instead of landing at once — which is also what
 * makes a bad rollout observable before it is finished.
 */

const DEFAULTS = {
  // Scale actions per account per cycle. Matches the v3 default.
  scale: 10,
  // Resume actions per account per cycle. Deliberately small: resume
  // restarts spend, and a slow drain of a cold-start backlog is a feature —
  // it gives a human time to notice something is wrong.
  resume: 5,
};

// Existing v3 env name for scale so any deployment already tuning it keeps
// working. Resume gets a matching name in the same family.
const ENV_BY_KIND = {
  scale: "AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN",
  resume: "AUTOPILOT_MAX_RESUME_ACTIONS_PER_RUN",
};

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Resolve the per-cycle limit for one kind of action.
 * @param {'scale'|'resume'} kind
 */
function limitFor(kind) {
  const fallback = DEFAULTS[kind];
  if (fallback === undefined) {
    throw new Error(`actionBudget: unknown action kind '${kind}'`);
  }
  return Math.max(1, envInt(ENV_BY_KIND[kind], fallback));
}

/**
 * Create a budget for one account for one cycle.
 *
 * Usage is `spend(kind)` — call it only when an action is actually about to
 * be attempted, never when merely considered, or a run of skips would
 * exhaust the budget without anything happening.
 *
 * Dry-run ticks consume budget exactly like live ones. That is intentional:
 * a dry run should predict what a live run would do, and an uncapped dry run
 * would report a hundred resumes that a live run would never perform.
 */
function createActionBudget() {
  const limits = { scale: limitFor("scale"), resume: limitFor("resume") };
  const used = { scale: 0, resume: 0 };

  return {
    limits,
    /** Remaining actions of this kind for this account this cycle. */
    remaining(kind) {
      return Math.max(0, (limits[kind] ?? 0) - (used[kind] ?? 0));
    },
    /** True while this kind still has room. */
    canSpend(kind) {
      return this.remaining(kind) > 0;
    },
    /**
     * Consume one unit. Returns false when exhausted so the caller can log a
     * distinct "budget reached" reason instead of a generic skip.
     */
    spend(kind) {
      if (!this.canSpend(kind)) return false;
      used[kind] += 1;
      return true;
    },
    /** For the cycle summary / logs. */
    snapshot() {
      return {
        scale: { used: used.scale, limit: limits.scale },
        resume: { used: used.resume, limit: limits.resume },
      };
    },
  };
}

module.exports = {
  createActionBudget,
  limitFor,
  DEFAULTS,
  ENV_BY_KIND,
};
