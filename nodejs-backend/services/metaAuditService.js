/**
 * metaAuditService — audit-engine core, callable without an HTTP request.
 *
 * Two public entry points:
 *
 *   runAuditForAccount({ userId, adAccountId, accessToken, options })
 *     Fetches Meta data, normalises it, runs rules, returns the same
 *     response shape the /meta-ads/audit controller used to build inline.
 *
 *   evaluateRules(dataset, entity, { thresholdOverrides, adAccountId })
 *     Pure function: given a normalised dataset, run the rule engine.
 *     Exported separately so unit tests (and Autopilot callers with
 *     pre-fetched data) can exercise it without touching Meta.
 *
 * Phase 1 of the Autopilot PRD extracts this from
 * controllers/adPosting/metaAdLauncher.js runAudit(req, res). The
 * controller becomes a thin wrapper around `runAuditForAccount`.
 *
 * IMPORTANT: The HTTP flow passes `options = {}`, which means no caller
 * overrides and no age/spend guards. Combined with rule `defaults` matching
 * the previously-hardcoded literals, output is byte-identical to pre-refactor.
 */

const bizSdk = require("facebook-nodejs-business-sdk");
const dayjs = require("dayjs");
const AdAccount = bizSdk.AdAccount;

const {
  getAdFields,
  getAdSetFields,
  getInsightsFields,
  getCampaignFields,
} = require("../utils/metaHelpers");
const { getEffectiveSettings } = require("../config/autopilotConfig");
const { evaluateRules } = require("./autopilot/ruleEvaluator");

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

const getActionValue = (actions, type) => {
  if (!actions) return 0;
  const a = actions.find((x) => x.action_type === type);
  return a ? parseFloat(a.value) : 0;
};

const getRoas = (roas) => {
  if (!roas) return 0;
  const r = roas.find((x) => x.action_type === "purchase");
  return r ? parseFloat(r.value) : 0;
};

// ---------------------------------------------------------------------------
// Normalisers (pure — ported verbatim from metaAdLauncher.runAudit)
// ---------------------------------------------------------------------------

function buildNormalisers({
  currency,
  campaignMap,
  adSetMap,
  adMap,
  prevCampaignMap,
  prevAdsetMap,
  prevAdMap,
  campaignInsights,
  adInsights,
  account_avg_cpa,
  ageGuard, // { enabled, min_age_hours } or null
  spendFloor, // number (0 = disabled)
}) {
  const getBudgetPacing = (insightSpend, campaign) => {
    const budget =
      parseFloat(campaign?.daily_budget || 0) ||
      parseFloat(campaign?.lifetime_budget || 0) / 14;
    if (!budget) return 0;
    const expectedSpend = budget * 14;
    return insightSpend / expectedSpend;
  };

  const getPacingDate = (insightSpend, campaign) => {
    const budget =
      parseFloat(campaign?.daily_budget || 0) ||
      parseFloat(campaign?.lifetime_budget || 0) / 14;
    if (!budget || insightSpend === 0) return "unknown";
    const dailySpend = insightSpend / 14;
    const daysLeft = budget / dailySpend;
    return dayjs().add(Math.floor(daysLeft), "day").format("YYYY-MM-DD");
  };

  const failsAgeGuard = (createdTime) => {
    if (!ageGuard || !ageGuard.enabled || !createdTime) return false;
    const created = dayjs(createdTime);
    if (!created.isValid()) return false;
    const ageHours = dayjs().diff(created, "hour");
    return ageHours < ageGuard.min_age_hours;
  };

  // Pick the larger of Meta's two install action_types instead of summing
  // them. `mobile_app_install` is the legacy single-platform count;
  // `omni_app_install` is the omnichannel-aware version that attributes
  // installs across all Meta surfaces (FB / IG / Messenger / AN / Reels).
  // For most campaigns these report the SAME conversions twice — summing
  // them double-counted installs and made CPI look ~half of reality.
  // Math.max handles every case cleanly:
  //   - only mobile present → use mobile
  //   - only omni present   → use omni
  //   - both present (same) → use that value
  //   - neither (non-app)   → 0
  const getInstallCount = (actions) =>
    Math.max(
      getActionValue(actions, "mobile_app_install"),
      getActionValue(actions, "omni_app_install"),
    );

  // CPI comes from Meta's `cost_per_action_type` array — the authoritative
  // value Ads Manager surfaces. Computing it ourselves as `spend/installs`
  // drifts from Meta because attribution windows + dedup + rounding don't
  // always match, and we'd silently disagree with what the advertiser sees.
  // We still pick max(mobile, omni) to mirror the install-count dedup
  // logic above (the two action types describe the same conversions, so
  // their cost values typically agree; max is defensive against
  // intermittent reporting where one is missing).
  const getCpi = (costPerActionType) => {
    if (!Array.isArray(costPerActionType)) return 0;
    const find = (t) => {
      const row = costPerActionType.find((x) => x.action_type === t);
      return row ? parseFloat(row.value) : 0;
    };
    return Math.max(find("mobile_app_install"), find("omni_app_install"));
  };

  const normalizeCampaign = (i) => {
    const spend = parseFloat(i.spend || 0);
    const clicks = parseFloat(i.clicks || 0);
    const impressions = parseFloat(i.impressions || 0);
    const purchases = getActionValue(i.actions, "purchase");
    const addToCart = getActionValue(i.actions, "add_to_cart");
    const installs = getInstallCount(i.actions);
    const cpi = getCpi(i.cost_per_action_type);
    const roas = getRoas(i.purchase_roas);
    const ctr = parseFloat(i.ctr || 0);
    const cpc = parseFloat(i.cpc || 0);
    const cpm = parseFloat(i.cpm || 0);
    const cpa = purchases > 0 ? spend / purchases : 0;
    const conversions = purchases;
    const engagement_rate =
      impressions > 0
        ? (getActionValue(i.actions, "post_engagement") / impressions) * 100
        : 0;

    const campaign = campaignMap.get(i.campaign_id);
    const budget_pacing = getBudgetPacing(spend, campaign);

    const prev = prevCampaignMap.get(i.campaign_id);
    const prev_spend = prev ? parseFloat(prev.spend || 0) : null;
    const prev_purchases = prev
      ? getActionValue(prev.actions, "purchase")
      : null;
    const prev_installs = prev ? getInstallCount(prev.actions) : null;
    const prev_cpi = prev ? getCpi(prev.cost_per_action_type) : null;
    const prev_ctr = prev ? parseFloat(prev.ctr || 0) : null;
    const prev_cpc = prev ? parseFloat(prev.cpc || 0) : null;
    const prev_cpm = prev ? parseFloat(prev.cpm || 0) : null;
    const prev_roas = prev ? getRoas(prev.purchase_roas) : null;
    const prev_conversions = prev_purchases;
    const prev_conversion_rate =
      prev && parseFloat(prev.clicks || 0) > 0
        ? (prev_purchases / parseFloat(prev.clicks)) * 100
        : null;

    return {
      campaign_id: i.campaign_id,
      campaign_name: i.campaign_name,

      spend,
      currency,
      impressions,
      clicks,
      ctr,
      cpc,
      cpm,
      roas,
      cpa,
      // App-install metrics — populated for app-promotion campaigns;
      // zero on every other objective (where the install actions
      // don't fire). User rules like `cpi > 50` simply won't match
      // on non-app campaigns rather than throwing.
      installs,
      cpi,
      conversions,
      purchases,
      add_to_cart: addToCart,
      conversion_rate: clicks > 0 ? (purchases / clicks) * 100 : 0,
      engagement_rate,

      budget_pacing,
      pacing_date: getPacingDate(spend, campaign),

      status: campaign?.status || "UNKNOWN",

      account_avg_cpa,

      prev_spend,
      prev_conversions,
      prev_installs,
      prev_cpi,
      prev_ctr,
      prev_cpc,
      prev_cpm,
      prev_roas,
      prev_conversion_rate,

      // Guard metadata (consumed by caller / autopilot; HTTP path ignores)
      _created_time: campaign?._data?.created_time || null,
      _age_gate_failed: failsAgeGuard(campaign?._data?.created_time),
      _below_spend_floor: spendFloor > 0 && spend < spendFloor,

      entity: "campaign",
    };
  };

  const normalizeAdset = (i) => {
    const spend = parseFloat(i.spend || 0);
    const clicks = parseFloat(i.clicks || 0);
    const purchases = getActionValue(i.actions, "purchase");
    const installs = getInstallCount(i.actions);
    const cpa = purchases > 0 ? spend / purchases : 0;
    const cpi = getCpi(i.cost_per_action_type);
    const frequency = parseFloat(i.frequency || 0);

    const adSet = adSetMap.get(i.adset_id);

    const prev = prevAdsetMap.get(i.adset_id);
    const prev_cpa = prev
      ? (() => {
          const ps = parseFloat(prev.spend || 0);
          const pp = getActionValue(prev.actions, "purchase");
          return pp > 0 ? ps / pp : null;
        })()
      : null;
    const prev_installs = prev ? getInstallCount(prev.actions) : null;
    const prev_cpi = prev ? getCpi(prev.cost_per_action_type) : null;

    return {
      campaign_id: i.campaign_id,
      campaign_name: i.campaign_name,
      adset_id: i.adset_id,
      adset_name: i.adset_name,

      spend,
      currency,
      clicks,
      purchases,
      cpa,
      installs,
      cpi,
      frequency,

      status: adSet?.status || "UNKNOWN",

      historical_roas: prev ? getRoas(prev.purchase_roas) : 0,

      learning_status: adSet?._data?.learning_stage_info?.status || null,

      audience_size: adSet?._data?.targeting?.age_min ? null : null,

      prev_cpa,
      prev_installs,
      prev_cpi,

      _created_time: adSet?._data?.created_time || null,
      _age_gate_failed: failsAgeGuard(adSet?._data?.created_time),
      _below_spend_floor: spendFloor > 0 && spend < spendFloor,

      entity: "adset",
    };
  };

  const normalizeAd = (i) => {
    const spend = parseFloat(i.spend || 0);
    const ctr = parseFloat(i.ctr || 0);
    const impressions = parseFloat(i.impressions || 0);
    const engagement = getActionValue(i.actions, "post_engagement");
    const installs = getInstallCount(i.actions);
    const cpi = getCpi(i.cost_per_action_type);
    console.log(`Ad ${i.ad_id} name="${i.ad_name}" cpi=${cpi} spend=${spend} installs=${installs}`);
    const engagement_rate =
      impressions > 0 ? (engagement / impressions) * 100 : 0;

    const ad = adMap.get(i.ad_id);

    const campaignTotalSpend = adInsights
      .filter((x) => x.campaign_id === i.campaign_id)
      .reduce((s, x) => s + parseFloat(x.spend || 0), 0);

    const ad_spend_share =
      campaignTotalSpend > 0 ? spend / campaignTotalSpend : null;

    const campaignAds = adInsights.filter(
      (x) => x.campaign_id === i.campaign_id,
    );
    const maxCtr = Math.max(
      ...campaignAds.map((x) => parseFloat(x.ctr || 0)),
    );
    const is_top_performer = ctr === maxCtr && campaignAds.length > 1;

    // Prev-window ad metrics for week-over-week deltas (AUD-36 fatigue +
    // future trend rules). May be null if Meta returns no prior data.
    const prev = prevAdMap ? prevAdMap.get(i.ad_id) : null;
    const prev_spend = prev ? parseFloat(prev.spend || 0) : null;
    const prev_ctr = prev ? parseFloat(prev.ctr || 0) : null;
    const prev_impressions = prev ? parseFloat(prev.impressions || 0) : null;
    const prev_installs = prev ? getInstallCount(prev.actions) : null;
    const prev_cpi = prev ? getCpi(prev.cost_per_action_type) : null;

    return {
      campaign_id: i.campaign_id,
      campaign_name: i.campaign_name,
      adset_id: i.adset_id,
      adset_name: i.adset_name,
      ad_id: i.ad_id,
      ad_name: i.ad_name,

      spend,
      currency,
      ctr,
      impressions,
      engagement_rate,
      installs,
      cpi,
      ad_spend_share,
      is_top_performer,

      // Underlying configured status (ACTIVE|PAUSED). Distinct from
      // review_status / effective_status which fold in adset + campaign state.
      status: ad?._data?.status || ad?.status || null,

      review_status: ad?._data?.effective_status || null,

      relevance_score: ad?._data?.quality_ranking || null,

      prev_spend,
      prev_ctr,
      prev_impressions,
      prev_installs,
      prev_cpi,

      _created_time: ad?._data?.created_time || null,
      _age_gate_failed: failsAgeGuard(ad?._data?.created_time),
      _below_spend_floor: spendFloor > 0 && spend < spendFloor,

      entity: "ad",
    };
  };

  return { normalizeCampaign, normalizeAdset, normalizeAd };
}

// ---------------------------------------------------------------------------
// Public: data fetch + orchestration
// ---------------------------------------------------------------------------

/**
 * Fetch audit data for one ad account and return the findings response.
 *
 * @param {Object} args
 * @param {string} args.userId       AdsGPT user id (for logging only)
 * @param {string} args.adAccountId  numeric id ('475821441756869') or 'act_…'
 * @param {string} args.accessToken  decrypted Meta token
 * @param {Object} [args.options]
 * @param {number} [args.options.lookbackDays=14]
 * @param {number} [args.options.prevLookbackDays=14]
 * @param {Object} [args.options.thresholdOverrides]  per-rule map
 * @param {boolean} [args.options.enforceAgeGuard=false]  filter out young ads
 * @param {boolean} [args.options.enforceSpendFloor=false]  filter low-spend
 *
 * @returns {Promise<{status, account_name, summary, findings}>}
 *    Same shape the controller used to produce inline.
 */
async function runAuditForAccount({
  userId,
  adAccountId,
  accessToken,
  options = {},
} = {}) {
  if (!adAccountId) throw new Error("adAccountId is required");
  if (!accessToken) throw new Error("accessToken is required");

  const {
    lookbackDays = 14,
    prevLookbackDays = 14,
    thresholdOverrides,
    enforceAgeGuard = false,
    enforceSpendFloor = false,
  } = options;

  // Resolve per-account settings (age/spend guards only consulted if the
  // caller opts in — HTTP endpoint does not)
  const acctSettings = getEffectiveSettings(adAccountId);
  const ageGuard = enforceAgeGuard
    ? { enabled: true, min_age_hours: acctSettings.min_age_hours }
    : null;
  const spendFloor = enforceSpendFloor
    ? acctSettings.min_spend_before_eval || 0
    : 0;

  const api = bizSdk.FacebookAdsApi.init(accessToken);
  bizSdk.FacebookAdsApi.setDefaultApi(api);

  const acctKey = adAccountId.startsWith("act_")
    ? adAccountId
    : `act_${adAccountId}`;
  const account = new AdAccount(acctKey);
  const accountInfo = await account.read(["currency", "name"]);
  const currency = accountInfo.currency;

  // Time ranges — current = `lookbackDays`-long window ENDING TODAY
  // (today inclusive); prev = the equivalent window immediately before.
  // Today's data is partial (Meta still ingesting events through the day),
  // so CPI/ROAS/CTR will wobble a bit between hourly runs. We accept that
  // tradeoff to match Ads Manager's "Last N days" semantics — users were
  // confused when our 30-day window stopped a day short of theirs.
  const currentRange = {
    since: dayjs()
      .subtract(lookbackDays - 1, "day")
      .format("YYYY-MM-DD"),
    until: dayjs().format("YYYY-MM-DD"),
  };
  const prevRange = {
    since: dayjs()
      .subtract(lookbackDays + prevLookbackDays - 1, "day")
      .format("YYYY-MM-DD"),
    until: dayjs().subtract(lookbackDays, "day").format("YYYY-MM-DD"),
  };

  // Filter insights to ACTIVE entities only — paused / archived /
  // deleted entities don't deliver new data within the lookback, and a
  // pause-action rule against a PAUSED entity is a no-op anyway. Cuts
  // both the API payload size AND the work done in the per-target loop
  // downstream.
  //
  // Important: the entity reads (`getCampaigns`, `getAdSets`, `getAds`)
  // are intentionally LEFT UNFILTERED. Two reasons:
  //   1. The campaign roster powers orphan-attachment detection — we
  //      need to know "does this campaign exist on Meta at all?",
  //      including paused ones, so a paused-then-resumed campaign isn't
  //      false-flagged as orphan.
  //   2. The status / learning_status / budget metadata read off the
  //      entity is used inside the normalizer (e.g. `budget_pacing`
  //      consults `daily_budget` on the campaign object).
  const activeOnlyFiltering = (entityPrefix) => [
    {
      field: `${entityPrefix}.effective_status`,
      operator: "IN",
      value: ["ACTIVE"],
    },
  ];

  const [
    campaigns,
    adSets,
    ads,
    campaignInsights,
    adsetInsights,
    adInsights,
    campaignInsightsPrev,
    adsetInsightsPrev,
    adInsightsPrev,
  ] = await Promise.all([
    account.getCampaigns(getCampaignFields()),
    account.getAdSets(getAdSetFields()),
    account.getAds(getAdFields()),

    account.getInsights(getInsightsFields(), {
      level: "campaign",
      time_range: currentRange,
      filtering: activeOnlyFiltering("campaign"),
    }),
    account.getInsights(getInsightsFields(), {
      level: "adset",
      time_range: currentRange,
      filtering: activeOnlyFiltering("adset"),
    }),
    account.getInsights(getInsightsFields(), {
      level: "ad",
      time_range: currentRange,
      filtering: activeOnlyFiltering("ad"),
    }),

    account.getInsights(getInsightsFields(), {
      level: "campaign",
      time_range: prevRange,
      filtering: activeOnlyFiltering("campaign"),
    }),
    account.getInsights(getInsightsFields(), {
      level: "adset",
      time_range: prevRange,
      filtering: activeOnlyFiltering("adset"),
    }),
    account.getInsights(getInsightsFields(), {
      level: "ad",
      time_range: prevRange,
      filtering: activeOnlyFiltering("ad"),
    }),
  ]);

  const prevCampaignMap = new Map(
    campaignInsightsPrev.map((i) => [i.campaign_id, i]),
  );
  const prevAdsetMap = new Map(
    adsetInsightsPrev.map((i) => [i.adset_id, i]),
  );
  const prevAdMap = new Map(
    adInsightsPrev.map((i) => [i.ad_id, i]),
  );
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
  const adSetMap = new Map(adSets.map((s) => [s.id, s]));
  const adMap = new Map(ads.map((a) => [a.id, a]));

  const allSpend = campaignInsights.reduce(
    (s, i) => s + parseFloat(i.spend || 0),
    0,
  );
  const allConversions = campaignInsights.reduce(
    (s, i) => s + getActionValue(i.actions, "purchase"),
    0,
  );
  const account_avg_cpa =
    allConversions > 0 ? allSpend / allConversions : 0;

  const { normalizeCampaign, normalizeAdset, normalizeAd } = buildNormalisers({
    currency,
    campaignMap,
    adSetMap,
    adMap,
    prevCampaignMap,
    prevAdsetMap,
    prevAdMap,
    campaignInsights,
    adInsights,
    account_avg_cpa,
    ageGuard,
    spendFloor,
  });

  let campaignData = campaignInsights.map(normalizeCampaign);
  let adsetData = adsetInsights.map(normalizeAdset);
  let adData = adInsights.map(normalizeAd);

  // Apply age/spend guards only if caller opted in (HTTP does not)
  const guardFilter = (row) =>
    !row._age_gate_failed && !row._below_spend_floor;
  if (ageGuard || spendFloor > 0) {
    campaignData = campaignData.filter(guardFilter);
    adsetData = adsetData.filter(guardFilter);
    adData = adData.filter(guardFilter);
  }

  const findings = [
    ...evaluateRules(campaignData, "campaign", {
      adAccountId: acctKey,
      thresholdOverrides,
    }),
    ...evaluateRules(adsetData, "adset", {
      adAccountId: acctKey,
      thresholdOverrides,
    }),
    ...evaluateRules(adData, "ad", {
      adAccountId: acctKey,
      thresholdOverrides,
    }),
  ];

  const uniqueFindings = Array.from(
    new Map(findings.map((f) => [`${f.rule_id}-${f.entity_id}`, f])).values(),
  );

  const severityScores = { critical: 3, warning: 2, opportunity: 1 };
  const sortedFindings = uniqueFindings.sort(
    (a, b) => severityScores[b.severity] - severityScores[a.severity],
  );

  // Account-level total daily budget — used by autoScaleService's per-account
  // cap (PRD §6 / AUD-37). Sum of every campaign + adset that carries a
  // daily_budget. In smallest currency unit (paise/cents). Note: a campaign
  // and its child adsets shouldn't both have daily_budget set (CBO-mode
  // mutual-exclusivity), but if Meta has both we just sum — overcounting is
  // safer than undercounting for a cap.
  let accountDailyBudget = 0;
  for (const c of campaigns) {
    const v = parseInt(c._data && c._data.daily_budget, 10);
    if (!Number.isNaN(v)) accountDailyBudget += v;
  }
  for (const s of adSets) {
    const v = parseInt(s._data && s._data.daily_budget, 10);
    if (!Number.isNaN(v)) accountDailyBudget += v;
  }

  return {
    status: true,
    account_name: accountInfo.name,
    summary: {
      critical: sortedFindings.filter((f) => f.severity === "critical").length,
      warning: sortedFindings.filter((f) => f.severity === "warning").length,
      opportunity: sortedFindings.filter((f) => f.severity === "opportunity")
        .length,
    },
    findings: sortedFindings,
    accountDailyBudget,
    // Normalized entity rows — exposed so the v4 user-rule orchestrator can
    // re-use this fetch+normalize pipeline without rebuilding it. Each row
    // is the same shape `evaluateRules` consumes, which is also exactly
    // what `userRuleEvaluator.evaluateRule` consumes.
    //
    // `campaigns` / `adsets` / `ads` are insight-bearing only — campaigns
    // that didn't deliver in the lookback window are absent. For
    // existence checks (e.g. orphan-attachment detection in the v4
    // orchestrator), use `allCampaignIds` instead, which is the
    // authoritative list of campaign ids on Meta regardless of delivery.
    entities: {
      campaigns: campaignData,
      adsets: adsetData,
      ads: adData,
      allCampaignIds: campaigns.map((c) => String(c.id)),
    },
  };
}

module.exports = {
  runAuditForAccount,
  evaluateRules,
  // internals exported for tests:
  _internals: {
    getActionValue,
    getRoas,
    buildNormalisers,
  },
};
