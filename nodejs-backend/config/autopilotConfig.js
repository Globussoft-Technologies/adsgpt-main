/**
 * Autopilot configuration — global defaults, optional per-account threshold
 * pins, and the live-write safety gate.
 *
 * Consumed by services/metaAuditService.js, the orchestrator (cron), and the
 * HTTP controllers. The HTTP /meta-ads/audit endpoint deliberately does NOT
 * apply rule overrides, to preserve byte-identical output of the existing
 * audit contract.
 *
 * Merge order at runtime (lowest to highest precedence):
 *   rule.defaults
 *     < autopilotConfig.accounts[acct].overrides[ruleId]   (ops-level pin)
 *     < autopilotSettings.perAccountOverrides              (per-user pref)
 *     < caller-provided thresholdOverrides                  (per-request)
 *
 * Token policy (v3): Autopilot is multi-tenant. Targets are discovered at
 * runtime from `facebookUsers` ∩ `autopilotSettings.enabled === true` (see
 * services/autopilot/targetDiscovery.js); per-user OAuth tokens come from
 * the FacebookUsers collection. There is no "owner mapping" and no system
 * token. The previous hardcoded `accounts` whitelist + `ownerUserId` fallback
 * have been removed.
 *
 * Live-write safety gate: governed by a single global env var
 * `AUTOPILOT_LIVE_ACTIONS_ALLOWED` (default false) — see
 * `isLiveActionsAllowed()` below. Per-user `enabled: false` (the schema
 * default) is the per-tenant opt-in gate that runs in front of this.
 */

// Lazy-loaded inside getAccessTokenForAccount so this config module stays
// pure for unit tests (no mongoose / no crypto module needed at import).
let _resolveFacebookConnection;

const defaults = {
  // Ads younger than this are never acted on — protects Meta's learning phase.
  // Ported from Pipeboard's pause_ads_v2.py min_age_hours guard.
  min_age_hours: 24,

  // Spend floor before an ad is even evaluated. Prevents judging new/low-volume
  // ads whose metrics haven't stabilised. In the account's native currency.
  // Ported from Pipeboard's min_spend_before_eval.
  min_spend_before_eval: 0,

  // Lookback windows for insights (in days).
  lookback_days: 14,
  prev_lookback_days: 14,
};

/**
 * Optional ops-level threshold pins. Empty by default — every Autopilot
 * action runs against the rule defaults unless an entry is added here.
 *
 * Shape:
 *   'act_xxx': {
 *     min_age_hours:      <override>,
 *     min_spend_before_eval: <override>,
 *     overrides: {
 *       'AUD-01': { min_spend: 100000 },
 *       ...
 *     },
 *   }
 *
 * This map is *not* the list of accounts the cron acts on — that comes from
 * targetDiscovery. It's only consulted to compute thresholds for whichever
 * (user, ad-account) pair discovery surfaces. Add an entry only when an
 * account needs different rule thresholds than the defaults.
 */
const accounts = {};

/**
 * Canonical Meta-API shape for an ad-account id: always `act_<digits>`.
 * Action services call this on entry so action-log rows are stored with a
 * single shape regardless of whether the caller passed `'715702414895109'`
 * or `'act_715702414895109'`. Without this, the cron path (which uses
 * `act_*`) and the UI's single-account dry-run path (which used to send
 * the bare id) wrote rows in two different shapes — making the per-account
 * filter in the Action log silently miss half its results.
 */
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return adAccountId;
  const s = String(adAccountId);
  return s.startsWith("act_") ? s : `act_${s}`;
}

/**
 * Return the account block for `adAccountId`, or null if not configured.
 * Accepts both `'act_123'` and `'123'` shapes.
 */
function getAccountConfig(adAccountId) {
  if (!adAccountId) return null;
  const key = normalizeAdAccountId(adAccountId);
  return accounts[key] || null;
}

/**
 * Compute effective thresholds for a rule, given its declared defaults,
 * optional per-account overrides, and optional caller-supplied overrides.
 *
 * @param {Object} ruleDefaults  - rule.defaults from auditRulesConfig
 * @param {string} ruleId
 * @param {string} adAccountId   - 'act_xxx' or raw numeric id
 * @param {Object} [callerOverrides] - caller-supplied {ruleId: {...}} map
 * @returns {Object} merged thresholds
 */
function getEffectiveThresholds(
  ruleDefaults,
  ruleId,
  adAccountId,
  callerOverrides,
) {
  const merged = { ...(ruleDefaults || {}) };

  const acct = getAccountConfig(adAccountId);
  if (acct && acct.overrides && acct.overrides[ruleId]) {
    Object.assign(merged, acct.overrides[ruleId]);
  }

  if (callerOverrides && callerOverrides[ruleId]) {
    Object.assign(merged, callerOverrides[ruleId]);
  }

  return merged;
}

/**
 * SAFETY GATE — returns true only when live writes are globally enabled via
 * the `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env var (default false). The flag is
 * global, not per-account: either every (opted-in user, account) pair can
 * write, or none can.
 *
 * Action services call this and short-circuit to dryRun=true when it
 * returns false, regardless of what the caller asked for.
 *
 * The `adAccountId` arg is accepted for backward-compatibility with callers
 * but is no longer consulted.
 */
function isLiveActionsAllowed(_adAccountId) {
  return (
    String(process.env.AUTOPILOT_LIVE_ACTIONS_ALLOWED || "false")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * Compute the EFFECTIVE dryRun for an action. Promotes dryRun to true if
 * the global live-actions env flag is off. Returns both the result and the
 * reason (for logging). Pure; no side effects.
 */
function effectiveDryRun({ adAccountId, requestedDryRun }) {
  if (requestedDryRun) {
    return { dryRun: true, forced: false };
  }
  if (!isLiveActionsAllowed(adAccountId)) {
    return {
      dryRun: true,
      forced: true,
      reason:
        "live writes disabled globally (AUTOPILOT_LIVE_ACTIONS_ALLOWED is not 'true')",
    };
  }
  return { dryRun: false, forced: false };
}

/**
 * Get effective (non-rule) settings for an account — age gate, spend floor,
 * lookback windows. Unspecified fields fall back to `defaults`.
 */
function getEffectiveSettings(adAccountId) {
  const acct = getAccountConfig(adAccountId) || {};
  return {
    min_age_hours:
      acct.min_age_hours != null ? acct.min_age_hours : defaults.min_age_hours,
    min_spend_before_eval:
      acct.min_spend_before_eval != null
        ? acct.min_spend_before_eval
        : defaults.min_spend_before_eval,
    lookback_days:
      acct.lookback_days != null ? acct.lookback_days : defaults.lookback_days,
    prev_lookback_days:
      acct.prev_lookback_days != null
        ? acct.prev_lookback_days
        : defaults.prev_lookback_days,
  };
}

/**
 * Resolve the FB access token to use for `adAccountId` from an HTTP request.
 *
 * Used by the on-demand HTTP path (a logged-in AdsGPT user invoking
 * /autopilot/run, /autopilot/audit/run, /autopilot/rotate, or LLM apply-fix).
 * `callerUserId` is REQUIRED — there is no "owner" fallback. If the caller
 * doesn't have a FacebookUsers row, we throw.
 *
 * The cron path does NOT call this — it gets tokens directly from
 * targetDiscovery, which already loaded them when iterating opted-in users.
 *
 * @param {Object} args
 * @param {string} args.adAccountId
 * @param {string} args.callerUserId  AdsGPT user_id of the HTTP caller
 * @returns {Promise<{accessToken: string, userId: string, source: 'caller'}>}
 */
async function getAccessTokenForAccount({
  adAccountId,
  callerUserId,
  facebookId,
} = {}) {
  if (!callerUserId) {
    throw new Error(
      `Cannot resolve token: callerUserId is required (account ${adAccountId})`,
    );
  }
  if (!_resolveFacebookConnection) {
    _resolveFacebookConnection =
      require("../utils/metaConnection").resolveFacebookConnection;
  }
  const resolved = await _resolveFacebookConnection({
    userId: callerUserId,
    facebookId,
    allowSingleFallback: false,
  });
  return {
    accessToken: resolved.accessToken,
    userId: callerUserId,
    facebookId: resolved.facebookId,
    source: "caller",
  };
}

module.exports = {
  defaults,
  accounts,
  getAccountConfig,
  getEffectiveThresholds,
  getEffectiveSettings,
  isLiveActionsAllowed,
  effectiveDryRun,
  getAccessTokenForAccount,
  normalizeAdAccountId,
};
