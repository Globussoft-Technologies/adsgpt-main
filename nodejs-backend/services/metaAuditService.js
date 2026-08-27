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
  getAutopilotInsightsFields,
  getCampaignFields,
} = require("../utils/metaHelpers");
const { getEffectiveSettings } = require("../config/autopilotConfig");
const { evaluateRules } = require("./autopilot/ruleEvaluator");
const {
  sharedRateLimiter,
  hashToken,
} = require("./autopilot/metaRateLimiter");

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function resolveInsightTimeOptions({
  lookbackDays = 14,
  prevLookbackDays = 14,
  lookbackPreset,
  now = dayjs(),
} = {}) {
  if (lookbackPreset === "maximum") {
    return {
      isMaximumLookback: true,
      current: { date_preset: "maximum" },
      previous: null,
    };
  }

  return {
    isMaximumLookback: false,
    current: {
      time_range: {
        since: now.subtract(lookbackDays - 1, "day").format("YYYY-MM-DD"),
        until: now.format("YYYY-MM-DD"),
      },
    },
    previous: {
      since: now
        .subtract(lookbackDays + prevLookbackDays - 1, "day")
        .format("YYYY-MM-DD"),
      until: now.subtract(lookbackDays, "day").format("YYYY-MM-DD"),
    },
  };
}

/**
 * Page through a facebook-nodejs-business-sdk Cursor and return one flat
 * array of every record across every page.
 *
 * Why this exists: `account.getAds(fields)` (and siblings) return a Cursor
 * that, by itself, only carries Meta's FIRST PAGE — default ~25 entities.
 * Awaiting the cursor does NOT auto-paginate. On any ad account with more
 * than 25 active ads, the audit silently never saw ads 26+ — they got
 * never-flagged regardless of how badly they breached threshold. Same
 * trap with `getInsights` (one row per entity per time bucket; >25 active
 * entities → page-2 rows invisible).
 *
 * We page with `cursor.hasNext()` / `cursor.next()` until the cursor is
 * drained. A safety `maxPages` cap prevents a runaway against a pathological
 * account (or an SDK bug that never sets hasNext=false); 200 pages × 500
 * entities = 100k, well above any realistic active-entity count.
 *
 * @param {Promise<Cursor>} cursorPromise  e.g. account.getAds(fields, params)
 * @param {Object} [opts]
 * @param {string} [opts.label]   short tag for the maxPages warning log
 * @param {number} [opts.maxPages=200]
 * @returns {Promise<Array>}
 */
async function fetchAllPages(
  cursorPromise,
  { label = "page", maxPages = 200 } = {},
) {
  const cursor = await cursorPromise;
  if (!cursor) return [];
  // Cursor extends Array — spread to snapshot the first page.
  const all = [...cursor];
  let pages = 1;
  while (typeof cursor.hasNext === "function" && cursor.hasNext()) {
    if (pages >= maxPages) {
      try {
        require("../utils/logger").warn(
          `[autopilot audit] ${label} pagination hit maxPages=${maxPages} — truncating (account is very large; consider raising the cap)`,
        );
      } catch {
        /* logger optional in test envs */
      }
      break;
    }
    await cursor.next();
    all.push(...cursor);
    pages += 1;
  }
  return all;
}

/**
 * Feed Meta's rate-limit headers to the shared limiter, and self-throttle
 * before each request when a bucket says we should.
 *
 * The SDK hides response headers unless `setShowHeader(true)` is on, and even
 * then it attaches them ONTO THE RESPONSE BODY (`response.data.headers`),
 * which would leak an unexpected key into everything downstream. So we enable
 * it and wrap `api.call` to strip the key back off after reading it —
 * downstream sees exactly the shape it saw before.
 *
 * Wrapping `call` also gives us the pre-flight hook: every request waits for
 * whatever delay the limiter computed from the PREVIOUS response's headers.
 * That is what turns "discover the limit by failing" into "slow down before
 * reaching it".
 *
 * Costs no extra API calls — it reads headers off requests we already make,
 * unlike a separate probe.
 */
function attachRateLimiting(api, { adAccountId, accessToken, logger }) {
  const context = {
    tokenHash: hashToken(accessToken),
    accountId: String(adAccountId || "").replace(/^act_/, ""),
  };
  api.setShowHeader(true);
  const originalCall = api.call.bind(api);
  api.call = async (...args) => {
    await sharedRateLimiter.waitIfNeeded(context, logger);
    const response = await originalCall(...args);
    if (response && typeof response === "object" && response.headers) {
      sharedRateLimiter.updateFromHeaders(response.headers, context);
      // Put the shape back exactly as callers expect.
      delete response.headers;
    }
    return response;
  };
  return context;
}

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
 * @param {string[]} [args.options.campaignIds]  scope the fetch to these
 *    campaign ids only (Autopilot v4). Omit for a whole-account audit.
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
    lookbackPreset,
    thresholdOverrides,
    enforceAgeGuard = false,
    enforceSpendFloor = false,
    // Autopilot v4 passes the set of campaign ids its rules are attached to,
    // so we fetch ONLY those campaigns' entities + insights instead of the
    // whole account. This is what keeps a large account from tripping Meta's
    // "Please reduce the amount of data you're asking for" error — the
    // unscoped HTTP audit path leaves this undefined and still pulls the
    // full account (unchanged behavior).
    campaignIds,
    // Autopilot v4 only. Request the 16 raw fields its normalisers actually
    // read instead of the ~37 the shared list carries — see
    // `getAutopilotInsightsFields`. Everything omitted was being fetched,
    // parsed and discarded, and the omitted set is where the server-side cost
    // lives (video breakdowns, action-value aggregation). Business Use Case
    // rate limits meter `total_cputime`, so paying for unread fields is how a
    // handful of calls exhausts an account. Default false keeps the HTTP audit
    // path and every v3 service byte-identical.
    slimInsights = false,
    // Autopilot v4 only. The three `*-insights-prev` queries cost the same as
    // the current-period ones and exist solely to populate `prev_*` fields. If
    // no rule in this batch references a `prev_*` field, they are pure waste —
    // which is the common case, since most rules compare against absolute
    // thresholds rather than the previous period.
    needsPrevious = true,
  } = options;
  const scopeIds =
    Array.isArray(campaignIds) && campaignIds.length > 0
      ? campaignIds.map(String)
      : null;

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
  // Read Meta's five usage headers off every response and self-throttle when
  // any bucket runs hot. See services/autopilot/metaRateLimiter.js.
  const rateLimitContext = attachRateLimiting(api, {
    adAccountId,
    accessToken,
    logger: (() => {
      try {
        return require("../utils/logger");
      } catch {
        return null;
      }
    })(),
  });

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
  const {
    isMaximumLookback,
    current: currentInsightsRange,
    previous: prevRange,
  } = resolveInsightTimeOptions({
    lookbackDays,
    prevLookbackDays,
    lookbackPreset,
  });

  // Page size for the entity + insights reads.
  //
  // EVERY PAGE IS A SEPARATE API CALL, so this constant multiplies the whole
  // audit's request count. At the old value of 20, an account with ~200 ads
  // turned nine logical queries into roughly 45 calls — the ad-level insights
  // query alone was 10 pages, doubled for the previous period. That is a large
  // part of why a single account could exhaust its Business Use Case budget
  // while the App Dashboard's call bucket still looked idle.
  //
  // The old value was chosen defensively: large `limit` values combined with
  // the HEAVY shared field set (video breakdowns, action arrays, outbound
  // clicks, …) trip Meta's "Please reduce the amount of data you're asking
  // for" error (code 100). Two things have changed since:
  //
  //   1. The Autopilot path now requests 16 fields instead of ~37
  //      (`getAutopilotInsightsFields`), so each row is far smaller.
  //   2. These values match what `mcps/meta` already runs in production
  //      against these same accounts — insights at 500, entity lists at 100 —
  //      rather than being a fresh guess.
  //
  // Split because the two reads have very different row weights: an insights
  // row carries aggregations, a campaign row is a name and a status.
  const ENTITY_PAGE_LIMIT = 100;
  const INSIGHTS_PAGE_LIMIT = 500;

  // Insights are filtered to ACTIVE entities (paused/archived ones deliver
  // no new data in the lookback, and a pause against an already-paused
  // entity is a no-op). When the caller scopes to specific campaigns
  // (Autopilot v4), we ALSO constrain to those campaign ids — that scope
  // is the heavy lever: it turns a whole-account insights pull into "just
  // the attached campaigns", which is what stops large accounts tripping
  // Meta's data-volume ceiling.
  const insightsFiltering = (entityPrefix) => {
    const f = [
      {
        field: `${entityPrefix}.effective_status`,
        operator: "IN",
        value: ["ACTIVE"],
      },
    ];
    if (scopeIds) {
      f.push({ field: "campaign.id", operator: "IN", value: scopeIds });
    }
    return f;
  };

  // The CAMPAIGN entity read stays UNFILTERED-by-status (light payload, and
  // the full roster powers orphan-attachment detection — we must know
  // whether an attached campaign still exists on Meta at all, including
  // paused ones). The ADSET and AD entity reads are the heavy ones; when
  // scoping is in effect we constrain them to the attached campaigns so we
  // don't pull the whole account's ad metadata. All stay unscoped (full
  // account) on the HTTP audit path where `scopeIds` is null.
  // One decision, applied to all six insights queries below.
  const insightsFields = slimInsights
    ? getAutopilotInsightsFields()
    : getInsightsFields();
  // `maximum` has no previous period at all; otherwise the caller decides.
  const skipPrevious = isMaximumLookback || !needsPrevious;

  const adsetReadParams = { limit: ENTITY_PAGE_LIMIT };
  const adReadParams = { limit: ENTITY_PAGE_LIMIT };
  if (scopeIds) {
    const scopeFilter = [
      { field: "campaign.id", operator: "IN", value: scopeIds },
    ];
    adsetReadParams.filtering = scopeFilter;
    adReadParams.filtering = scopeFilter;
  }

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
    fetchAllPages(
      account.getCampaigns(getCampaignFields(), { limit: ENTITY_PAGE_LIMIT }),
      { label: "campaigns" },
    ),
    fetchAllPages(
      account.getAdSets(getAdSetFields(), adsetReadParams),
      { label: "adsets" },
    ),
    fetchAllPages(
      account.getAds(getAdFields(), adReadParams),
      { label: "ads" },
    ),

    fetchAllPages(
      account.getInsights(insightsFields, {
        level: "campaign",
        ...currentInsightsRange,
        filtering: insightsFiltering("campaign"),
        limit: INSIGHTS_PAGE_LIMIT,
      }),
      { label: "campaign-insights" },
    ),
    fetchAllPages(
      account.getInsights(insightsFields, {
        level: "adset",
        ...currentInsightsRange,
        filtering: insightsFiltering("adset"),
        limit: INSIGHTS_PAGE_LIMIT,
      }),
      { label: "adset-insights" },
    ),
    fetchAllPages(
      account.getInsights(insightsFields, {
        level: "ad",
        ...currentInsightsRange,
        filtering: insightsFiltering("ad"),
        limit: INSIGHTS_PAGE_LIMIT,
      }),
      { label: "ad-insights" },
    ),

    skipPrevious
      ? Promise.resolve([])
      : fetchAllPages(
          account.getInsights(insightsFields, {
            level: "campaign",
            time_range: prevRange,
            filtering: insightsFiltering("campaign"),
            limit: INSIGHTS_PAGE_LIMIT,
          }),
          { label: "campaign-insights-prev" },
        ),
    skipPrevious
      ? Promise.resolve([])
      : fetchAllPages(
          account.getInsights(insightsFields, {
            level: "adset",
            time_range: prevRange,
            filtering: insightsFiltering("adset"),
            limit: INSIGHTS_PAGE_LIMIT,
          }),
          { label: "adset-insights-prev" },
        ),
    skipPrevious
      ? Promise.resolve([])
      : fetchAllPages(
          account.getInsights(insightsFields, {
            level: "ad",
            time_range: prevRange,
            filtering: insightsFiltering("ad"),
            limit: INSIGHTS_PAGE_LIMIT,
          }),
          { label: "ad-insights-prev" },
        ),
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
      // Same purpose as allCampaignIds, for ad-set-level rule attachments:
      // an ad set that exists but didn't deliver in the window is absent
      // from `adsets`, and must not be mistaken for a deleted one.
      allAdsetIds: adSets.map((s) => String(s.id)),
    },
    // Worst live rate-limit bucket for this account after the fetch, so the
    // caller can log the real numbers rather than infer them.
    rateLimit: sharedRateLimiter.worstFor(rateLimitContext),
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
    resolveInsightTimeOptions,
  },
};
