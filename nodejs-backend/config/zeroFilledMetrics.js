/**
 * zeroFilledMetrics — the metrics whose `0` means "no denominator", not
 * "genuinely zero", and the guard a rule needs before comparing one with
 * `<` or `<=`.
 *
 * WHAT WENT WRONG. A live rule read `cpi <= 50`, meaning "resume ads whose
 * installs are cheap". `getCpi` returns 0 when Meta reports no install-cost
 * row at all — i.e. when the ad produced NO installs — and `0 <= 50` is
 * true. In one production cycle that rule resumed 153 ads, and 103 of them
 * had zero installs: ads that had each spent ₹100-140 and converted nothing.
 * The rule meant to revive the efficient ads revived the worst ones.
 *
 * WHY THIS CANNOT BE FIXED IN THE NORMALISER. The obvious repair is to emit
 * `null` instead of `0` so the evaluator's existing null check fails the
 * condition closed. It would break a rule that is also in production: one
 * named "ZERO PURCHASES" uses `roas < 3` and depends on `roas` being 0 for
 * ads with no revenue. Both readings of a zero are legitimate, and they are
 * held by two different rules on the same account — so the data cannot pick
 * a side. Only the rule's author can, which is what this module makes them
 * do.
 *
 * WHY `>` IS LEFT ALONE. `cpa > 500` does not fire on a zero, so the
 * ambiguity costs nothing there; that is why the normalisers chose 0 over
 * Infinity in the first place. Only the `<` family inverts.
 *
 * Pure data + one pure function: the HTTP validator enforces it, the rule
 * form mirrors it (see ruleFieldsCatalog.js), and the tests read it.
 */

/**
 * metric → the field whose value decides whether the metric has any meaning.
 * A rule comparing the metric with `<` / `<=` must also carry SOME condition
 * on that denominator, in either direction:
 *
 *   installs > 0   → "only ads that actually installed"  (the usual intent)
 *   installs == 0  → "only ads that installed nothing"   (the ZERO-* rules)
 *
 * Either makes the author's meaning explicit, which is the whole point. We
 * deliberately do not demand a particular operator.
 */
const DENOMINATOR_BY_METRIC = Object.freeze({
  cpi: "installs",
  cpa: "purchases",
  roas: "purchases",
  cpc: "clicks",
  cpm: "impressions",
  conversion_rate: "clicks",
  // Previous-period variants carry the identical hazard: Meta omits the same
  // rows for the prior window, so they zero-fill the same way.
  prev_cpi: "prev_installs",
  prev_cpa: "purchases",
  prev_roas: "purchases",
  prev_cpc: "clicks",
  prev_cpm: "impressions",
  prev_conversion_rate: "clicks",
});

/** Operators that a zero-filled metric silently satisfies. */
const INVERTING_OPS = Object.freeze(["<", "<="]);

/**
 * A denominator condition may be expressed against the current-period field
 * even when guarding a `prev_*` metric — an author guarding `prev_cpi` with
 * `installs > 0` has still said something meaningful, and refusing it would
 * be pedantry. So each metric accepts its mapped denominator OR the
 * non-prefixed form of it.
 */
function acceptableGuards(metric) {
  const denom = DENOMINATOR_BY_METRIC[metric];
  if (!denom) return [];
  const bare = denom.replace(/^prev_/, "");
  return bare === denom ? [denom] : [denom, bare];
}

/**
 * Which conditions in this rule compare a zero-filled metric with `<` / `<=`
 * and have no condition on the matching denominator to disambiguate them?
 *
 * @param {Array<{field:string, op:string, value:any}>} conditions
 * @returns {Array<{field:string, op:string, value:any, denominator:string}>}
 *          one entry per unguarded condition; empty when the rule is safe.
 */
function findUnguardedConditions(conditions) {
  const list = Array.isArray(conditions) ? conditions : [];
  const present = new Set(
    list.map((c) => c && c.field).filter((f) => typeof f === "string"),
  );
  const out = [];
  for (const cond of list) {
    if (!cond || typeof cond.field !== "string") continue;
    if (!DENOMINATOR_BY_METRIC[cond.field]) continue;
    if (!INVERTING_OPS.includes(cond.op)) continue;
    if (acceptableGuards(cond.field).some((g) => present.has(g))) continue;
    out.push({
      field: cond.field,
      op: cond.op,
      value: cond.value,
      denominator: DENOMINATOR_BY_METRIC[cond.field],
    });
  }
  return out;
}

/** The message a human needs: what is wrong, and the exact way out. */
function explain({ field, op, value, denominator }) {
  return (
    `"${field} ${op} ${value}" also matches entities with no ${denominator} at all, ` +
    `because ${field} is 0 when there are none. Add a condition on ${denominator} ` +
    `to say which you mean — "${denominator} > 0" for entities that have some, ` +
    `or "${denominator} == 0" if you really do want the ones with none.`
  );
}

module.exports = {
  DENOMINATOR_BY_METRIC,
  INVERTING_OPS,
  acceptableGuards,
  findUnguardedConditions,
  explain,
};
