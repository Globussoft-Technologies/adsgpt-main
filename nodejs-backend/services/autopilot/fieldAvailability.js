/**
 * fieldAvailability — which metrics actually exist at which entity level.
 *
 * WHY THIS HAS TO EXIST. The rule builder offers every field for every level,
 * but the audit's three normalisers emit three different shapes. A rule whose
 * field is absent at its level does not error — `userRuleEvaluator` fails a
 * condition closed on `undefined`, so the rule simply never matches, forever,
 * with no log line and no failed run. That is the worst possible failure mode
 * for an automation product: the customer believes it is watching their ads.
 *
 * It has already happened. Eight of one account's ten enabled rules were
 * ad-level rules on `cpa` / `purchases` — fields `normalizeAd` did not emit —
 * and every one sat at zero fires while looking perfectly healthy in the UI.
 *
 * KEEP THIS IN SYNC WITH THE NORMALISERS. The lists below mirror the `return`
 * blocks of normalizeCampaign / normalizeAdset / normalizeAd in
 * services/metaAuditService.js. `test/autopilot/fieldAvailability.test.js`
 * parses that file and fails if the two drift, so this cannot silently rot.
 *
 * Excluded on purpose:
 *   - `currency`, `pacing_date`, `account_avg_cpa`, `is_top_performer` —
 *     emitted, but not offered as rule fields.
 *   - `audience_size` — emitted at adset level but hardcoded to null (see
 *     normalizeAdset), so a rule on it can never match. Listing it as
 *     available would recreate exactly the bug this module prevents.
 */

const CAMPAIGN_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "roas",
  "cpa",
  "installs",
  "cpi",
  "purchases",
  "add_to_cart",
  "conversion_rate",
  "engagement_rate",
  "budget_pacing",
  "status",
  "prev_spend",
  "prev_installs",
  "prev_cpi",
  "prev_ctr",
  "prev_cpc",
  "prev_cpm",
  "prev_roas",
  "prev_conversion_rate",
];

const ADSET_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "roas",
  "cpa",
  "installs",
  "cpi",
  "purchases",
  "add_to_cart",
  "conversion_rate",
  "engagement_rate",
  "frequency",
  "status",
  "historical_roas",
  "learning_status",
  "prev_cpa",
  "prev_installs",
  "prev_cpi",
];

const AD_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "roas",
  "cpa",
  "installs",
  "cpi",
  "purchases",
  "add_to_cart",
  "conversion_rate",
  "engagement_rate",
  "frequency",
  "ad_spend_share",
  "status",
  "review_status",
  "effective_status",
  "relevance_score",
  "prev_spend",
  "prev_ctr",
  "prev_installs",
  "prev_cpi",
  "prev_cpc",
  "prev_cpm",
  "prev_roas",
  "prev_cpa",
  "prev_conversion_rate",
];

const FIELDS_BY_LEVEL = {
  campaign: new Set(CAMPAIGN_FIELDS),
  adset: new Set(ADSET_FIELDS),
  ad: new Set(AD_FIELDS),
};

/** Every field usable at `level`, sorted. Unknown level → empty array. */
function fieldsForLevel(level) {
  const set = FIELDS_BY_LEVEL[level];
  return set ? [...set].sort() : [];
}

/**
 * @returns {boolean} whether `field` is produced at `level`.
 *
 * An unknown level returns true rather than false: this is a guard against
 * building unusable rules, not an authorisation check, and refusing every
 * field for a level someone adds later would be worse than allowing them.
 */
function isFieldAvailable(field, level) {
  const set = FIELDS_BY_LEVEL[level];
  if (!set) return true;
  return set.has(field);
}

/**
 * The fields in `conditions` that cannot work at `level`.
 *
 * @param {Object} conditions  { rules: [{ field, ... }] }
 * @param {string} level       evaluateOn
 * @returns {string[]} unavailable field names, deduped, in first-seen order
 */
function unavailableFields(conditions, level) {
  const rules = conditions && Array.isArray(conditions.rules)
    ? conditions.rules
    : [];
  const seen = new Set();
  const out = [];
  for (const r of rules) {
    const field = r && r.field;
    if (!field || seen.has(field)) continue;
    seen.add(field);
    if (!isFieldAvailable(field, level)) out.push(field);
  }
  return out;
}

module.exports = {
  FIELDS_BY_LEVEL,
  fieldsForLevel,
  isFieldAvailable,
  unavailableFields,
  _lists: { CAMPAIGN_FIELDS, ADSET_FIELDS, AD_FIELDS },
};
