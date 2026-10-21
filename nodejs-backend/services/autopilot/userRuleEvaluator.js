/**
 * userRuleEvaluator — pure boolean evaluation of a v4 user-rule against a
 * single normalized entity (campaign / adset / ad).
 *
 * Pure function: no I/O, no globals, no side effects. Identical inputs
 * always produce identical outputs, which makes it trivially testable
 * and safe to call from the cron without worrying about ordering.
 *
 * Failure semantics:
 *   - Missing field on entity → that condition fails (no match), never
 *     throws. Saves us from the "entity has no `prev_cpa` because there
 *     wasn't a prior period" branch landing on the user.
 *   - Type mismatch on value → that condition fails. Validator should
 *     have caught it on save, but the cron stays robust if a stale
 *     rule + a schema change collide.
 *   - Null/undefined entity → returns false.
 *
 * Currently supports:
 *   - operator: 'AND' (every condition must match)
 *   - ops: '>', '<', '>=', '<=', '==', '!='
 *
 * 'OR' / nested groups are deferred to v2.
 */

const {
  findUnguardedConditions,
} = require("../../config/zeroFilledMetrics");

const NUMERIC_OPS = new Set([">", "<", ">=", "<=", "==", "!="]);
const STRING_OPS = new Set(["==", "!="]);

/**
 * Evaluate a single condition row against an entity.
 * @returns {boolean} true if the condition holds, false otherwise.
 */
function evaluateCondition(cond, entity) {
  if (!cond || !entity) return false;
  const { field, op, value } = cond;
  if (!field || !op) return false;

  const lhs = entity[field];

  // Missing field on the entity — condition can't be checked, fails safely.
  if (lhs === undefined || lhs === null) return false;

  // Decide ops by the LHS type. We don't trust the schema here because a
  // legacy rule + a schema change could land mismatched types. Fail
  // closed (return false) rather than throw.
  if (typeof lhs === "number") {
    if (typeof value !== "number") return false;
    if (!NUMERIC_OPS.has(op)) return false;
    switch (op) {
      case ">":
        return lhs > value;
      case "<":
        return lhs < value;
      case ">=":
        return lhs >= value;
      case "<=":
        return lhs <= value;
      case "==":
        return lhs === value;
      case "!=":
        return lhs !== value;
      default:
        return false;
    }
  }

  if (typeof lhs === "string") {
    if (typeof value !== "string") return false;
    if (!STRING_OPS.has(op)) return false;
    switch (op) {
      case "==":
        return lhs === value;
      case "!=":
        return lhs !== value;
      default:
        return false;
    }
  }

  // Booleans / objects / etc. — not part of the user-rule surface today.
  return false;
}

/**
 * Evaluate a full rule against one entity.
 * @param {Object} rule  An autopilotUserRule document (or .toObject()).
 * @param {Object} entity  A normalized entity row (campaign/adset/ad).
 * @returns {boolean} true if ALL conditions match (AND semantics).
 */
function evaluateRule(rule, entity) {
  if (!rule || !entity) return false;
  const conds = rule.conditions?.rules;
  if (!Array.isArray(conds) || conds.length === 0) return false;

  // operator is currently always 'AND'; defensive check in case the schema
  // grows OR support before this evaluator does.
  const operator = rule.conditions?.operator || "AND";
  if (operator !== "AND") return false;

  // A `<` / `<=` on a metric that is 0 when its denominator is 0 also
  // matches every entity that HAS no denominator — `cpi <= 50` is satisfied
  // by an ad with no installs at all. The validator refuses to save such a
  // condition unguarded, but rules stored before that existed keep running,
  // and one of them resumed 153 ads of which 103 had zero installs.
  //
  // So the same judgement is applied here, and narrowly:
  //   - only to conditions the validator would reject, i.e. ones with NO
  //     condition on the matching denominator. An author who wrote
  //     `installs > 0` or `installs == 0` has said what they meant and is
  //     left completely alone.
  //   - it fails CLOSED. An entity with no installs is one we have no
  //     evidence about, so a "cheap installs" test should not pass on it.
  //
  // Keeping this in step with the validator is the point: a rule must not
  // mean one thing in the form and another in the cron.
  const unguarded = findUnguardedConditions(conds);
  for (const u of unguarded) {
    const denom = Number(entity[u.denominator]);
    // Absent is as unproven as zero — fail closed either way.
    if (!Number.isFinite(denom) || denom <= 0) return false;
  }

  for (const c of conds) {
    if (!evaluateCondition(c, entity)) return false;
  }
  return true;
}

/**
 * Convenience helper: evaluate a rule against a list of entities, return
 * the matched ones. Cron uses this when iterating over an account's
 * campaigns/adsets/ads at the rule's evaluation level.
 */
function evaluateRuleAgainstMany(rule, entities) {
  if (!Array.isArray(entities)) return [];
  return entities.filter((e) => evaluateRule(rule, e));
}

module.exports = {
  evaluateRule,
  evaluateRuleAgainstMany,
  // Exported for unit tests; not part of the public API.
  _internals: { evaluateCondition, NUMERIC_OPS, STRING_OPS, findUnguardedConditions },
};
