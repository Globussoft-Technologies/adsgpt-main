/**
 * ruleEvaluator — pure rule-engine function, no Meta SDK or DB deps.
 *
 * Split out of metaAuditService so unit tests can exercise it without
 * installing node_modules or mocking the Facebook Business SDK.
 */

const rules = require("../../config/auditRulesConfig");
const { getEffectiveThresholds } = require("../../config/autopilotConfig");

// Logger is loaded lazily so this module stays importable in test/minimal
// environments that don't have Winston installed. Falls back to console.
let _logger;
function getLogger() {
  if (_logger) return _logger;
  try {
    _logger = require("../../utils/logger");
  } catch {
    _logger = console;
  }
  return _logger;
}

/**
 * Evaluate every rule against a normalised dataset for one entity level.
 * Returns findings (unsorted, undeduped — caller handles aggregation).
 *
 * @param {Array<Object>} dataset    normalised campaign/adset/ad rows
 * @param {'campaign'|'adset'|'ad'} entity
 * @param {Object} [opts]
 * @param {string} [opts.adAccountId]          enables per-account overrides
 * @param {Object} [opts.thresholdOverrides]   { 'AUD-01': { min_spend: 1000 } }
 */
function evaluateRules(dataset, entity, opts = {}) {
  const { adAccountId, thresholdOverrides } = opts;
  const findings = [];

  for (const data of dataset) {
    for (const rule of rules) {
      if (rule.entity !== entity) continue;

      const thresholds = getEffectiveThresholds(
        rule.defaults,
        rule.id,
        adAccountId,
        thresholdOverrides,
      );

      try {
        if (rule.check(data, thresholds)) {
          findings.push({
            rule_id: rule.id,
            severity: rule.severity,
            entity_type: entity,
            entity_id:
              entity === "campaign"
                ? data.campaign_id
                : entity === "adset"
                  ? data.adset_id
                  : data.ad_id,
            entity_name:
              entity === "campaign"
                ? data.campaign_name
                : entity === "adset"
                  ? data.adset_name
                  : data.ad_name,
            message: rule.message(data, thresholds),
            // The full normalised entity row that triggered the rule. Action
            // services stash a sanitised subset on autopilotActionLog.
            // metricsSnapshot so the UI can answer "why was this paused?"
            // without re-querying Meta. The HTTP /meta-ads/audit response
            // also gets it; existing consumers ignore unknown fields.
            data,
          });
        }
      } catch (err) {
        getLogger().error(
          `Rule ${rule.id} failed for entity ${entity}: ${err.message}`,
        );
      }
    }
  }

  return findings;
}

module.exports = { evaluateRules };
