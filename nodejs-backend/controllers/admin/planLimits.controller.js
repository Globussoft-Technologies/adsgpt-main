const PlanLimit = require("../../Module/admin/planLimit");
const { fetchAmemberProducts } = require("./adminDashboard.controller");
const { invalidatePlanLimitsCache } = require("../../utils/planLimits");
const {
  serializePlanLimits,
  getPlanLimitDef,
  resolvePlanLimitValues,
} = require("../../config/planLimitsRegistry");

/**
 * Is an aMember boolean-ish flag set?
 *
 * aMember's REST API is inconsistent about how it serialises tinyint columns
 * — `"1"` (string) in some responses, `1` (number) in others, occasionally a
 * real boolean. The rest of this codebase compares strictly against `"1"`
 * (see mobileController.js), which silently treats a numeric `1` as NOT set:
 * `1 !== "1"` is true, so a disabled product passes straight through the
 * filter. That's how disabled/archived plans were still reaching the admin
 * Plans page. Normalise instead of trusting the type.
 */
function isAmemberFlagSet(value) {
  return value === 1 || value === "1" || value === true;
}

// GET /adsgpt/admin/plans — every active aMember plan, joined with whatever
// limits have been configured for it, plus the limit REGISTRY itself so the
// admin panel renders its columns generically. Adding a limit to
// config/planLimitsRegistry.js makes a new column appear here with no change
// to this controller or the page.
exports.listPlans = async (req, res) => {
  try {
    const products = await fetchAmemberProducts();
    const docs = await PlanLimit.find({}).lean();
    const byPlanId = new Map(docs.map((doc) => [doc.planId, doc]));

    // Only plans a new subscriber could actually be on. Scoped to THIS
    // endpoint, not fetchAmemberProducts() itself — the Users-page plan
    // filter (adminDashboard.controller.js) deliberately keeps disabled/
    // archived plans, since an existing user can still be sitting on one
    // and needs to stay filterable.
    const activeProducts = products.filter(
      (product) => !isAmemberFlagSet(product?.is_disabled) && !isAmemberFlagSet(product?.is_archived),
    );

    // Loud enough to diagnose "why is an archived plan still listed?" from
    // the logs without adding a debug endpoint, quiet enough not to spam:
    // one line per admin page load.
    if (activeProducts.length !== products.length) {
      console.log(
        `[plans] ${products.length - activeProducts.length} of ${products.length} aMember products filtered out as disabled/archived`,
      );
    } else if (products.length) {
      console.log(
        `[plans] ${products.length} aMember products, none flagged disabled/archived`,
      );
    }

    const plans = activeProducts
      .map((product) => {
        const planId = String(product.product_id);
        return {
          planId,
          planName: product.title || product.name || planId,
          // Always a full key→value map (null = unlimited), so the UI never
          // has to distinguish "never configured" from "explicitly cleared".
          limits: resolvePlanLimitValues(byPlanId.get(planId)),
        };
      })
      .sort((a, b) => a.planName.localeCompare(b.planName));

    return res.json({ success: true, limits: serializePlanLimits(), plans });
  } catch (error) {
    console.error("List plans error:", error);
    return res.status(500).json({ success: false, message: "Failed to load plans" });
  }
};

// Accepts "", null, or a non-negative integer. "" / null both mean
// "unlimited" — the number input is cleared to submit that, not 0 (0 would
// mean the plan can manage nothing at all, a real but different state).
// Returns `undefined` for input that isn't valid at all.
function parseLimitValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return undefined;
  return parsed;
}

// PATCH /adsgpt/admin/plans/:planId — body: { limits: { "<key>": n|null } }
exports.upsertPlanLimit = async (req, res) => {
  try {
    const { planId } = req.params;
    const { limits, planName } = req.body || {};

    if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
      return res.status(400).json({ success: false, message: "`limits` object is required" });
    }

    // Dotted-path $set/$unset rather than replacing the whole `limits` map:
    // a PATCH naming one limit must not silently wipe limits it didn't
    // mention (the admin UI saves one row at a time, and a future bulk tool
    // or a second admin editing concurrently would otherwise clobber).
    const $set = {};
    const $unset = {};

    for (const [key, rawValue] of Object.entries(limits)) {
      const def = getPlanLimitDef(key);
      if (!def) {
        return res.status(400).json({ success: false, message: `Unknown limit "${key}"` });
      }
      const parsed = parseLimitValue(rawValue);
      if (parsed === undefined) {
        return res.status(400).json({
          success: false,
          message: `"${def.label}" must be a non-negative whole number, or empty for unlimited`,
        });
      }
      if (parsed === null) {
        // Unlimited is stored as ABSENCE of the key, not as a null value —
        // keeps resolvePlanLimitValues' `stored ?? legacy` precedence honest.
        $unset[`limits.${key}`] = 1;
      } else {
        $set[`limits.${key}`] = parsed;
      }
      // Whichever way it went, the pre-map column for this limit must go —
      // otherwise clearing a limit to "unlimited" would fall back to a stale
      // legacy value and silently keep enforcing the old number.
      if (def.legacyField) $unset[def.legacyField] = 1;
    }

    if (planName) $set.planName = planName;

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: "Nothing to update" });
    }

    const doc = await PlanLimit.findOneAndUpdate({ planId: String(planId) }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }).lean();
    invalidatePlanLimitsCache(String(planId));

    return res.json({
      success: true,
      planId: doc.planId,
      limits: resolvePlanLimitValues(doc),
    });
  } catch (error) {
    console.error("Upsert plan limit error:", error);
    return res.status(500).json({ success: false, message: "Failed to save plan limit" });
  }
};
