/**
 * actionBudget — how much Autopilot is allowed to DO to one ad account in
 * one cron tick.
 *
 * Separate from whether an action is *justified*. A rule decides that. This
 * decides how many justified actions may actually land before the engine
 * stops for the hour, and it is not user-editable: it is blast-radius
 * control on an hourly job that moves real money.
 *
 * Three kinds share one mechanism, but only SCALE is capped by default.
 *
 *   - SCALE is capped at 10. The risk is obvious and compounding: fifty
 *     simultaneous winners at +20% each is a very different event from one,
 *     and budget moves stack across ticks.
 *   - PAUSE and RESUME are UNCAPPED by default (2026-09-08, deliberate — see
 *     below). The mechanism still exists for them, so an operator can impose
 *     a ceiling from the environment without a deploy.
 *
 * WHY PAUSE AND RESUME ARE UNCAPPED. A cap on these does not prevent a bad
 * outcome, it paces one. If a rule is mis-tuned, capping at 25 still makes 25
 * wrong pauses and then makes 25 more next tick — it converts a fast problem
 * into a slow one, and only actually helps if a human reads the digest and
 * intervenes inside the hour. Against that, the cost is immediate: pausing
 * stops spend, so a half-actioned account burns money for an hour on ads the
 * user's own rule already called losers. Rule quality is the right place to
 * fix bad pauses — thresholds, validation, the firing probe — not throttling
 * execution of what the user asked for.
 *
 * THE COLD START THIS GIVES UP, stated plainly because it is real. The resume
 * pass looks back 30 days for pauses to retry. The first tick after enabling
 * `autoResume` on an account that has been pausing for weeks sees EVERY such
 * pause become a candidate at once — most past their trial cycle, so the rule
 * no longer matches and they all qualify. Uncapped, that is one tick
 * restarting hundreds of ads, each resuming spend. Nothing in the resume
 * logic is wrong; it is a cold-start condition no unit test surfaces, because
 * tests always start from an empty log. Enable `autoResume` on a quiet
 * account first, or set AUTOPILOT_MAX_RESUME_ACTIONS_PER_RUN for the first
 * few ticks.
 *
 * Budgets are per (account × cycle). A fresh tick gets a fresh budget, so a
 * capped backlog drains over hours instead of landing at once.
 */

// 0 (or any non-positive value, here or in the environment) means UNLIMITED.
// Chosen over `null`/`Infinity` because these values arrive as env strings,
// and "0 means no ceiling" survives `parseInt` without a special case at
// every call site.
const UNLIMITED = 0;

const DEFAULTS = {
  // Scale actions per account per cycle. Matches the v3 default.
  scale: 10,
  // Uncapped: Autopilot should execute the user's rules, and a pause is the
  // reversible direction. See the module header.
  pause: UNLIMITED,
  // Uncapped by request, accepting the cold-start risk in the module header.
  resume: UNLIMITED,
};

// Existing v3 env name for scale so any deployment already tuning it keeps
// working. Pause and resume get matching names in the same family — set
// either to a positive integer to impose a ceiling without a deploy.
const ENV_BY_KIND = {
  scale: "AUTOPILOT_MAX_SCALE_ACTIONS_PER_RUN",
  pause: "AUTOPILOT_MAX_PAUSE_ACTIONS_PER_RUN",
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
 *
 * Returns `Infinity` for an unlimited kind, so every caller can compare with
 * `>` and `-` and get the right answer without asking "is this one capped?".
 * The `UNLIMITED` sentinel stays at the configuration boundary; past here the
 * concept is just a very large number.
 *
 * @param {'scale'|'pause'|'resume'} kind
 * @returns {number} a positive integer, or Infinity when uncapped
 */
function limitFor(kind) {
  const fallback = DEFAULTS[kind];
  if (fallback === undefined) {
    throw new Error(`actionBudget: unknown action kind '${kind}'`);
  }
  const resolved = envInt(ENV_BY_KIND[kind], fallback);
  // Non-positive means uncapped — both as a default above and as an operator
  // clearing a ceiling by setting the env var to 0.
  if (resolved <= 0) return Infinity;
  return resolved;
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
  const limits = {
    scale: limitFor("scale"),
    pause: limitFor("pause"),
    resume: limitFor("resume"),
  };
  const used = { scale: 0, pause: 0, resume: 0 };
  // Whether the "budget exhausted" notice has already been emitted for this
  // kind on this account this cycle. See `claimExhaustionLog`.
  const logged = { scale: false, pause: false, resume: false };

  return {
    limits,
    /**
     * Remaining actions of this kind for this account this cycle.
     * `Infinity` when the kind is uncapped.
     */
    remaining(kind) {
      const limit = limits[kind] ?? 0;
      if (limit === Infinity) return Infinity;
      return Math.max(0, limit - (used[kind] ?? 0));
    },
    /** True while this kind still has room. Always true when uncapped. */
    canSpend(kind) {
      return this.remaining(kind) > 0;
    },
    /**
     * Consume one unit. Returns false when exhausted so the caller can log a
     * distinct "budget reached" reason instead of a generic skip.
     *
     * Still counts for uncapped kinds — `used` is what the run summary
     * reports, and "how many did we do" is worth knowing whether or not there
     * was a ceiling.
     */
    spend(kind) {
      if (!this.canSpend(kind)) return false;
      used[kind] += 1;
      return true;
    },
    /**
     * "Have we already announced that this kind ran out?" — false the first
     * time, true thereafter.
     *
     * Lives here because the budget is the only object scoped to exactly one
     * (account × cycle), which is the scope the announcement needs. Callers
     * loop rule-by-rule and entity-by-entity, so a flag local to any of them
     * would fire once per rule — and the point is to say it once per account
     * instead of once per skipped entity.
     */
    claimExhaustionLog(kind) {
      if (logged[kind]) return true;
      logged[kind] = true;
      return false;
    },
    /**
     * For the cycle summary / logs.
     *
     * `limit` is `null` rather than `Infinity` for an uncapped kind: this ends
     * up in log rows and JSON payloads, where `Infinity` serialises to `null`
     * anyway — better to say so deliberately than to let JSON.stringify decide.
     */
    snapshot() {
      const one = (kind) => ({
        used: used[kind],
        limit: limits[kind] === Infinity ? null : limits[kind],
      });
      return { scale: one("scale"), pause: one("pause"), resume: one("resume") };
    },
  };
}

module.exports = {
  createActionBudget,
  limitFor,
  DEFAULTS,
  ENV_BY_KIND,
  UNLIMITED,
};
