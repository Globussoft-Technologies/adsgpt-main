/**
 * Per-plan limit resolution + enforcement.
 *
 * Every limit is declared in config/planLimitsRegistry.js; nothing in this
 * file is specific to Meta (or to any one product surface). Two entry points
 * matter to callers:
 *
 *   checkPlanLimit(userId, "meta:campaigns")
 *     → the gate. Call at a mutation point; return its `error` on !ok.
 *
 *   getPlanUsage(userId, ["meta:campaigns"])
 *     → the readout. Attach to a GET response so the UI can show usage and
 *       pre-disable an action.
 *
 * Both FAIL OPEN: a Mongo hiccup, a missing counter, or a throwing counter
 * degrades to "no limit applies" and logs a warning, never to a blocked user.
 * Blocking a paying customer because a database blinked is strictly worse
 * than briefly not enforcing a cap.
 */
const PlanLimit = require("../Module/admin/planLimit");
const UserProfile = require("../Module/user/userProfileModel");
const {
  getPlanLimitDef,
  resolvePlanLimitCounter,
  resolvePlanLimitValues,
  buildPlanLimitMessage,
  PLAN_LIMIT_KEYS,
} = require("../config/planLimitsRegistry");
const logger = require("./logger");

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // planId -> { value, expiresAt }

// Every registry key mapped to null (unlimited). Rebuilt per call rather than
// shared, so a caller mutating the result can't poison the next lookup.
function unlimited() {
  return Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, null]));
}

/** `{ [limitKey]: number | null }` for a plan. null means unlimited. */
async function getLimitsForPlan(planId) {
  const key = String(planId || "").trim();
  if (!key) return unlimited();

  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return { ...cached.value };

  const doc = await PlanLimit.findOne({ planId: key }).lean();
  const value = doc ? resolvePlanLimitValues(doc) : unlimited();

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...value };
}

// Called by the admin controller right after a save, so a changed limit takes
// effect immediately instead of waiting out the cache TTL.
function invalidatePlanLimitsCache(planId) {
  if (planId) cache.delete(String(planId));
  else cache.clear();
}

/**
 * Resolves a user straight to their plan's limits — the one lookup both the
 * gate and the readout share. A user with no active base plan
 * (`subscription_plan_id` empty, the same field requireBasePlan checks) gets
 * unlimited here rather than blocked: this feature caps managed volume for
 * paying tiers, it is not a base-plan gate.
 */
async function getLimitsForUser(userId) {
  if (!userId) return unlimited();
  const user = await UserProfile.findOne(
    { user_id: userId },
    { subscription_plan_id: 1 },
  ).lean();
  if (!user?.subscription_plan_id) return unlimited();
  return getLimitsForPlan(user.subscription_plan_id);
}

/**
 * The gate. Returns `{ ok: true }` when the action is allowed (under the
 * limit, unlimited, or anything went wrong), or `{ ok: false, ... }` with a
 * ready-to-return error payload when the limit is reached.
 *
 * Counting only runs when a limit is actually configured, so plans with no
 * cap cost one cached Mongo read and nothing else.
 */
async function checkPlanLimit(userId, limitKey) {
  try {
    const def = getPlanLimitDef(limitKey);
    if (!def) {
      logger.warn(`checkPlanLimit: unknown limit key "${limitKey}" — allowing through`);
      return { ok: true };
    }

    const limits = await getLimitsForUser(userId);
    const limit = limits[limitKey];
    if (limit === null || limit === undefined) return { ok: true };

    const counter = resolvePlanLimitCounter(def);
    if (!counter) {
      logger.warn(`checkPlanLimit: "${limitKey}" has no usable counter — allowing through`);
      return { ok: true };
    }

    const current = await counter(userId);
    if (current < limit) return { ok: true, limit, current };

    return {
      ok: false,
      status: 403,
      code: "PLAN_LIMIT_REACHED",
      limitKey,
      limit,
      current,
      error: buildPlanLimitMessage(def, { limit, current }),
    };
  } catch (err) {
    logger.warn(`checkPlanLimit(${limitKey}): failed, allowing through: ${err.message}`);
    return { ok: true };
  }
}

/**
 * The readout. `{ "meta:campaigns": { limit, current } }` for whichever of
 * `limitKeys` the user's plan actually caps; keys with no limit are omitted
 * entirely, so a plan with no caps produces `{}` and costs zero counting.
 *
 * Attach to GET responses via a helper that runs AFTER any cache read — these
 * numbers change independently of whatever entity list is being cached, so
 * folding them into a cached payload makes an admin's config change invisible
 * until the TTL expires (a bug this feature actually shipped and fixed; see
 * the meta-ads-manager skill's cache-strategy.md).
 */
async function getPlanUsage(userId, limitKeys) {
  const out = {};
  try {
    const limits = await getLimitsForUser(userId);
    for (const limitKey of limitKeys || []) {
      const limit = limits[limitKey];
      if (limit === null || limit === undefined) continue;
      const def = getPlanLimitDef(limitKey);
      const counter = def && resolvePlanLimitCounter(def);
      if (!counter) continue;
      out[limitKey] = { limit, current: await counter(userId) };
    }
  } catch (err) {
    logger.warn(`getPlanUsage: failed, omitting usage info: ${err.message}`);
  }
  return out;
}

module.exports = {
  getLimitsForPlan,
  getLimitsForUser,
  invalidatePlanLimitsCache,
  checkPlanLimit,
  getPlanUsage,
};
