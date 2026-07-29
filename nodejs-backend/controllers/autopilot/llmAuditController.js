/**
 * llmAuditController — on-demand LLM-driven audit + fix flow.
 *
 * Mounted at /meta-ads/autopilot/llm-audit/* (see Router/autopilot/autopilotRoutes.js).
 * The continuous 37-rule cron audit is in services/autopilot/autopilotcrontor.js;
 * THIS controller is the user-initiated lane: a user clicks "Run AI Audit" and
 * Gemini analyses 30 days of insights, returning findings plus an executable
 * fix per finding. Fixes go through `applyFix` with the same global
 * `AUTOPILOT_LIVE_ACTIONS_ALLOWED` safety gate that the cron actions honour.
 *
 * Collection names (MetaAuditFinding, MetaFixLog) are unchanged from the
 * pre-merge structure to avoid orphaning historical data.
 */

const bizSdk = require("facebook-nodejs-business-sdk");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const AdAccount = bizSdk.AdAccount;
const Campaign = bizSdk.Campaign;
const AdSet = bizSdk.AdSet;
const Ad = bizSdk.Ad;

const MetaAuditFinding = require("../../Module/adPosting/metaAuditFinding");
const MetaFixLog = require("../../Module/adPosting/metaFixLog");
const AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");

const logger = require("../../utils/logger");
const { redisClient } = require("../../db/redis");
const {
  getFacebookIdFromRequest,
} = require("../../utils/metaConnection");

const {
  getAdFields,
  getAdSetFields,
  getCampaignFields,
  getInsightsFields,
} = require("../../utils/metaHelpers");

const { applyFixSchema } = require("../../Validations/meta.validator");

const {
  getAction,
  validateFixParams,
  clampBudget,
} = require("../../config/metaFixActions");

const {
  buildPrompt,
  responseSchema,
} = require("../../AI/metaAuditPrompt");

const {
  getAccessTokenForAccount,
  effectiveDryRun,
  getAccountConfig,
} = require("../../config/autopilotConfig");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
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

const bustAccountCaches = async (userId, adAccountId) => {
  try {
    const patterns = [
      `metaDashboard:${userId}:${adAccountId}:*`,
      `metaAnalytics:${userId}:${adAccountId}:*`,
      `metaCampaigns:${userId}:${adAccountId}`,
      `metaAdsets:${userId}:${adAccountId}:*`,
      `metaCampaignAds:${userId}:*`,
      `metaAdSetAds:${userId}:*`,
      `metaInsights:${userId}:${adAccountId}:*`,
      `metaAudit:${userId}:${adAccountId}`,
    ];
    for (const pattern of patterns) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) await redisClient.del(keys);
    }
  } catch (err) {
    logger.error(`Cache bust failed: ${err.message}`);
  }
};

const initFbApi = (accessToken) => {
  const api = bizSdk.FacebookAdsApi.init(accessToken);
  bizSdk.FacebookAdsApi.setDefaultApi(api);
  return api;
};

const getEntityObject = (level, id) => {
  if (level === "campaign") return new Campaign(id);
  if (level === "adset") return new AdSet(id);
  if (level === "ad") return new Ad(id);
  throw new Error(`Unsupported level: ${level}`);
};

// Map LLM action_type → autopilotActionLog `action` enum, so the unified
// log can show LLM applies alongside cron rows. Falls back to 'alert_only'
// for actions that don't fit the existing taxonomy (e.g., NARROW_AUDIENCE).
const ACTION_TYPE_TO_LOG_ACTION = {
  PAUSE_ENTITY: "pause",
  ACTIVATE_ENTITY: "resume",
  ADJUST_BUDGET: "scale_budget",
  ADJUST_BID: "scale_budget",
  EXTEND_SCHEDULE: "alert_only",
  END_EARLY: "alert_only",
  NARROW_AUDIENCE: "alert_only",
  BROADEN_AUDIENCE: "alert_only",
  CHANGE_OPTIMIZATION_GOAL: "alert_only",
  DUPLICATE_AND_MODIFY: "rotate_creative",
  SWAP_CREATIVE: "rotate_creative",
};

// Inject authoritative entity refs from the finding's top-level entity fields
// into fix.params, based on the action_type's param shape.
const fillEntityRefs = (params, actionType, entityType, entityId) => {
  const p = { ...(params || {}) };
  const levelShaped = [
    "PAUSE_ENTITY",
    "ACTIVATE_ENTITY",
    "ADJUST_BUDGET",
    "EXTEND_SCHEDULE",
    "END_EARLY",
  ];
  if (levelShaped.includes(actionType)) {
    if (!p.level) p.level = entityType;
    if (!p.id) p.id = entityId;
  }
  if (actionType === "ADJUST_BID" && entityType === "adset") {
    if (!p.adset_id) p.adset_id = entityId;
  }
  if (
    (actionType === "NARROW_AUDIENCE" || actionType === "BROADEN_AUDIENCE") &&
    entityType === "adset"
  ) {
    if (!p.adset_id) p.adset_id = entityId;
  }
  if (actionType === "CHANGE_OPTIMIZATION_GOAL" && entityType === "adset") {
    if (!p.adset_id) p.adset_id = entityId;
  }
  if (actionType === "SWAP_CREATIVE" && entityType === "ad") {
    if (!p.ad_id) p.ad_id = entityId;
  }
  if (actionType === "DUPLICATE_AND_MODIFY") {
    if (!p.source_level) p.source_level = entityType;
    if (!p.source_id) p.source_id = entityId;
  }
  return p;
};

const readEntityState = async (level, id) => {
  const fields =
    level === "campaign"
      ? ["id", "name", "status", "daily_budget", "lifetime_budget", "stop_time"]
      : level === "adset"
        ? [
            "id",
            "name",
            "status",
            "daily_budget",
            "lifetime_budget",
            "bid_amount",
            "optimization_goal",
            "end_time",
            "targeting",
          ]
        : ["id", "name", "status", "effective_status", "creative"];
  const obj = getEntityObject(level, id);
  const fresh = await obj.read(fields);
  return fresh._data || fresh;
};

// ─────────────────────────────────────────────────────────────
// Normalization (same shape as the rule-based runAudit)
// ─────────────────────────────────────────────────────────────
const normalizeForLLM = ({
  campaignInsights,
  adsetInsights,
  adInsights,
  campaignInsightsPrev,
  adsetInsightsPrev,
  campaigns,
  adSets,
  ads,
  currency,
}) => {
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
  const adSetMap = new Map(adSets.map((s) => [s.id, s]));
  const adMap = new Map(ads.map((a) => [a.id, a]));
  const prevCampaignMap = new Map(
    campaignInsightsPrev.map((i) => [i.campaign_id, i]),
  );
  const prevAdsetMap = new Map(
    adsetInsightsPrev.map((i) => [i.adset_id, i]),
  );

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

  const getBudgetPacing = (insightSpend, campaign) => {
    // Window-length must match the insights `currentRange` below (30 days).
    // If the time-range changes, update both this divisor and the
    // multiplier below so "pacing = actual / expected over the window"
    // stays accurate.
    const budget =
      parseFloat(campaign?.daily_budget || 0) ||
      parseFloat(campaign?.lifetime_budget || 0) / 30;
    if (!budget) return 0;
    return insightSpend / (budget * 30);
  };

  const campaignData = campaignInsights.map((i) => {
    const spend = parseFloat(i.spend || 0);
    const clicks = parseFloat(i.clicks || 0);
    const impressions = parseFloat(i.impressions || 0);
    const purchases = getActionValue(i.actions, "purchase");
    const addToCart = getActionValue(i.actions, "add_to_cart");
    const campaign = campaignMap.get(i.campaign_id);
    const prev = prevCampaignMap.get(i.campaign_id);
    return {
      campaign_id: i.campaign_id,
      campaign_name: i.campaign_name,
      status: campaign?.status || "UNKNOWN",
      objective: campaign?.objective,
      daily_budget_minor: parseFloat(campaign?.daily_budget || 0) || null,
      lifetime_budget_minor: parseFloat(campaign?.lifetime_budget || 0) || null,
      spend,
      currency,
      impressions,
      clicks,
      ctr: parseFloat(i.ctr || 0),
      cpc: parseFloat(i.cpc || 0),
      cpm: parseFloat(i.cpm || 0),
      roas: getRoas(i.purchase_roas),
      cpa: purchases > 0 ? spend / purchases : 0,
      purchases,
      add_to_cart: addToCart,
      conversion_rate: clicks > 0 ? (purchases / clicks) * 100 : 0,
      budget_pacing: getBudgetPacing(spend, campaign),
      account_avg_cpa,
      prev_spend: prev ? parseFloat(prev.spend || 0) : null,
      prev_ctr: prev ? parseFloat(prev.ctr || 0) : null,
      prev_cpc: prev ? parseFloat(prev.cpc || 0) : null,
      prev_cpm: prev ? parseFloat(prev.cpm || 0) : null,
      prev_roas: prev ? getRoas(prev.purchase_roas) : null,
      prev_purchases: prev ? getActionValue(prev.actions, "purchase") : null,
    };
  });

  const adsetData = adsetInsights.map((i) => {
    const spend = parseFloat(i.spend || 0);
    const purchases = getActionValue(i.actions, "purchase");
    const adSet = adSetMap.get(i.adset_id);
    const prev = prevAdsetMap.get(i.adset_id);
    const prev_spend = prev ? parseFloat(prev.spend || 0) : null;
    const prev_purchases = prev ? getActionValue(prev.actions, "purchase") : null;
    return {
      campaign_id: i.campaign_id,
      adset_id: i.adset_id,
      adset_name: i.adset_name,
      status: adSet?.status || "UNKNOWN",
      optimization_goal: adSet?.optimization_goal,
      billing_event: adSet?.billing_event,
      daily_budget_minor: parseFloat(adSet?.daily_budget || 0) || null,
      lifetime_budget_minor: parseFloat(adSet?.lifetime_budget || 0) || null,
      end_time: adSet?.end_time || null,
      spend,
      currency,
      clicks: parseFloat(i.clicks || 0),
      purchases,
      cpa: purchases > 0 ? spend / purchases : 0,
      frequency: parseFloat(i.frequency || 0),
      learning_status: adSet?._data?.learning_stage_info?.status || null,
      prev_spend,
      prev_purchases,
      prev_cpa:
        prev && prev_purchases > 0 ? prev_spend / prev_purchases : null,
    };
  });

  const adData = adInsights.map((i) => {
    const spend = parseFloat(i.spend || 0);
    const ctr = parseFloat(i.ctr || 0);
    const impressions = parseFloat(i.impressions || 0);
    const ad = adMap.get(i.ad_id);
    const campaignTotal = adInsights
      .filter((x) => x.campaign_id === i.campaign_id)
      .reduce((s, x) => s + parseFloat(x.spend || 0), 0);
    const ad_spend_share = campaignTotal > 0 ? spend / campaignTotal : null;
    return {
      campaign_id: i.campaign_id,
      adset_id: i.adset_id,
      ad_id: i.ad_id,
      ad_name: i.ad_name,
      status: ad?.status || "UNKNOWN",
      effective_status: ad?.effective_status || null,
      quality_ranking: ad?._data?.quality_ranking || null,
      spend,
      currency,
      ctr,
      impressions,
      engagement_rate:
        impressions > 0
          ? (getActionValue(i.actions, "post_engagement") / impressions) * 100
          : 0,
      ad_spend_share,
    };
  });

  return { campaignData, adsetData, adData };
};

// Resolve a friendly account name for an LLM-audit log row.
//
// `getAccountConfig` only knows about the ops-level pin map in
// autopilotConfig.js, which is empty by default in v3 — so the previous
// approach left every LLM-audit row with `(unnamed)` in the Action log.
// The Redis cache `metaAdAccounts:${userId}` holds the user's full Meta
// /me/adaccounts response (populated by both the cron's targetDiscovery
// and the UI's /get-ad-accounts endpoint), which has the friendly name
// against the bare numeric id. Read from there; fall back gracefully if
// the cache hasn't been warmed yet.
async function resolveAdAccountName({ userId, adAccountId }) {
  // 1. Ops-level config (v3 default = empty, but honor any explicit pin).
  const acct = getAccountConfig(adAccountId);
  if (acct?.name) return acct.name;

  // 2. Redis cache — set by targetDiscovery + the HTTP /get-ad-accounts
  //    endpoint. Bare id without `act_` prefix is the lookup key.
  try {
    const { redisClient } = require("../../db/redis");
    const cached = await redisClient.get(`metaAdAccounts:${userId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      const bareId = String(adAccountId).replace(/^act_/, "");
      const hit = (parsed?.adAccounts || []).find((a) => a.id === bareId);
      if (hit?.name) return hit.name;
    }
  } catch {
    // Cache miss / parse failure / Redis down — fall through.
  }

  return null;
}

// Stamp an LLM apply / attempt / undo into autopilotActionLog so the
// unified Autopilot Action Log shows it alongside cron rows.
// `actionPayload.source` ("llm-audit" vs "llm-audit-undo") tags the
// origin; `kind` ("apply" / "undo") makes the intent explicit on the
// row without forcing the consumer to parse `ruleId`.
async function logToActionLog({
  finding,
  outcome,
  dryRun,
  forced,
  forcedReason,
  beforeState,
  afterState,
  errorMessage,
  isUndo = false,
}) {
  try {
    const action = ACTION_TYPE_TO_LOG_ACTION[finding.fix.action_type] || "alert_only";
    const adAccountName = await resolveAdAccountName({
      userId: finding.userId,
      adAccountId: finding.adAccountId,
    });
    await AutopilotActionLog.create({
      runId: `llm-${finding.auditId}`,
      userId: finding.userId,
      adAccountId: finding.adAccountId,
      adAccountName,
      level: finding.entity_type,
      entityId: finding.entity_id,
      entityName: finding.entity_name,
      // Distinct ruleId prefix so undos are filterable / identifiable
      // in the unified log (and don't collide with the original apply
      // row's ruleId).
      ruleId: `LLM-${isUndo ? "UNDO_" : ""}${finding.fix.action_type}`,
      ruleSeverity: finding.severity,
      ruleMessage: isUndo ? `Reverted: ${finding.title}` : finding.title,
      action,
      actionPayload: {
        source: isUndo ? "llm-audit-undo" : "llm-audit",
        kind: isUndo ? "undo" : "apply",
        action_type: finding.fix.action_type,
        params: finding.fix.params,
        risk_level: finding.fix.risk_level,
        reversible: finding.fix.reversible,
        beforeState,
        afterState,
        forcedDryRun: forced || false,
        forcedReason: forcedReason || undefined,
      },
      dryRun,
      outcome,
      error: errorMessage,
      pausedBy: "llm-audit",
    });
  } catch (err) {
    // Logging shouldn't break the apply / undo; swallow but warn.
    logger.warn(`[llm-audit] action log write failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────
class LLMAuditController {
  constructor() {
    this.runLLMAudit = this.runLLMAudit.bind(this);
    this.listAudits = this.listAudits.bind(this);
    this.getFindings = this.getFindings.bind(this);
    this.applyFix = this.applyFix.bind(this);
    this.dismissFinding = this.dismissFinding.bind(this);
    this.undoFix = this.undoFix.bind(this);
    this.getFixLog = this.getFixLog.bind(this);
  }

  // * POST /meta-ads/autopilot/llm-audit
  async runLLMAudit(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Run an LLM-powered audit (Gemini) that returns findings with executable fix actions.'
    */
    try {
      const { adAccountId } = req.query;
      const userId = req.user.user_id;

      if (!adAccountId)
        return res.status(400).json({ error: "adAccountId is required" });

      // Use the unified token resolver — caller's per-user FB OAuth token
      // from the facebookUsers collection.
      let resolved;
      try {
        resolved = await getAccessTokenForAccount({
          adAccountId,
          callerUserId: userId,
          facebookId: getFacebookIdFromRequest(req),
        });
      } catch (err) {
        return res.status(404).json({ status: false, error: err.message });
      }
      initFbApi(resolved.accessToken);

      const account = new AdAccount(`act_${adAccountId.replace(/^act_/, "")}`);
      const accountInfo = await account.read(["currency", "name"]);

      // 30-day lookback (excluding today, which has partial Meta data).
      // Previous period is the 30 days immediately before, so Gemini can
      // reason about month-over-month trends. If you change the window
      // length, also update the `30` divisor + multiplier in
      // `getBudgetPacing` above — they must stay in sync.
      const currentRange = {
        since: dayjs().subtract(30, "day").format("YYYY-MM-DD"),
        until: dayjs().subtract(1, "day").format("YYYY-MM-DD"),
      };
      const prevRange = {
        since: dayjs().subtract(60, "day").format("YYYY-MM-DD"),
        until: dayjs().subtract(31, "day").format("YYYY-MM-DD"),
      };

      const [
        campaigns,
        adSets,
        ads,
        campaignInsights,
        adsetInsights,
        adInsights,
        campaignInsightsPrev,
        adsetInsightsPrev,
      ] = await Promise.all([
        account.getCampaigns(getCampaignFields()),
        account.getAdSets(getAdSetFields()),
        account.getAds(getAdFields()),
        account.getInsights(getInsightsFields(), {
          level: "campaign",
          time_range: currentRange,
        }),
        account.getInsights(getInsightsFields(), {
          level: "adset",
          time_range: currentRange,
        }),
        account.getInsights(getInsightsFields(), {
          level: "ad",
          time_range: currentRange,
        }),
        account.getInsights(getInsightsFields(), {
          level: "campaign",
          time_range: prevRange,
        }),
        account.getInsights(getInsightsFields(), {
          level: "adset",
          time_range: prevRange,
        }),
      ]);

      const { campaignData, adsetData, adData } = normalizeForLLM({
        campaignInsights,
        adsetInsights,
        adInsights,
        campaignInsightsPrev,
        adsetInsightsPrev,
        campaigns,
        adSets,
        ads,
        currency: accountInfo.currency,
      });

      // ─── Call Gemini ─────────────────────────────────────────
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-pro",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.3,
        },
      });

      const prompt = buildPrompt({
        accountName: accountInfo.name,
        currency: accountInfo.currency,
        campaignData,
        adsetData,
        adData,
      });

      const llmResult = await model.generateContent(prompt);
      const rawText = llmResult?.response?.text?.() || "";

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        logger.error(`LLM output parse failed: ${err.message}`);
        return res.status(502).json({
          status: false,
          error: "LLM returned non-JSON output",
          details: err.message,
        });
      }

      const rawFindings = Array.isArray(parsed?.findings) ? parsed.findings : [];

      // ─── Validate + persist findings ─────────────────────────
      const auditId = crypto.randomUUID();
      const accepted = [];
      const rejected = [];

      for (const f of rawFindings) {
        try {
          const fix = f.fix || {};
          let params;
          try {
            params = JSON.parse(fix.params_json || "{}");
          } catch (e) {
            rejected.push({ title: f.title, reason: "params_json not valid JSON" });
            continue;
          }

          const action = getAction(fix.action_type);
          if (!action) {
            rejected.push({ title: f.title, reason: `Unknown action_type: ${fix.action_type}` });
            continue;
          }
          if (!action.entities.includes(f.entity_type)) {
            rejected.push({ title: f.title, reason: `${fix.action_type} not allowed for entity ${f.entity_type}` });
            continue;
          }

          params = fillEntityRefs(params, fix.action_type, f.entity_type, f.entity_id);

          const { error, value: validParams } = validateFixParams(
            fix.action_type,
            params,
          );
          if (error) {
            rejected.push({ title: f.title, reason: `Params invalid: ${error}` });
            continue;
          }

          accepted.push({
            auditId,
            userId,
            adAccountId,
            severity: f.severity,
            entity_type: f.entity_type,
            entity_id: f.entity_id,
            entity_name: f.entity_name,
            title: f.title,
            reasoning: f.reasoning,
            fix: {
              action_type: fix.action_type,
              params: validParams,
              risk_level: fix.risk_level || action.risk,
              reversible:
                typeof fix.reversible === "boolean"
                  ? fix.reversible
                  : action.reversible,
            },
            status: "pending",
          });
        } catch (err) {
          rejected.push({ title: f?.title || "(unknown)", reason: err.message });
        }
      }

      const saved = accepted.length
        ? await MetaAuditFinding.insertMany(accepted)
        : [];

      const severityOrder = { critical: 3, warning: 2, opportunity: 1 };
      const sorted = saved.sort(
        (a, b) => severityOrder[b.severity] - severityOrder[a.severity],
      );

      return res.status(200).json({
        status: true,
        auditId,
        account_name: accountInfo.name,
        tokenSource: resolved.source,
        summary: {
          critical: sorted.filter((f) => f.severity === "critical").length,
          warning: sorted.filter((f) => f.severity === "warning").length,
          opportunity: sorted.filter((f) => f.severity === "opportunity").length,
        },
        findings: sorted,
        rejected,
      });
    } catch (error) {
      logger.error(`LLM audit error: ${error.stack || error.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to run LLM audit",
        details: error.message,
      });
    }
  }

  // * GET /meta-ads/autopilot/llm-audit/audits?adAccountId=...
  async listAudits(req, res) {
    try {
      const userId = req.user.user_id;
      const { adAccountId } = req.query;
      if (!adAccountId)
        return res.status(400).json({ error: "adAccountId is required" });

      const audits = await MetaAuditFinding.aggregate([
        { $match: { userId, adAccountId } },
        {
          $group: {
            _id: "$auditId",
            adAccountId: { $first: "$adAccountId" },
            createdAt: { $min: "$createdAt" },
            expiresAt: { $max: "$expiresAt" },
            total: { $sum: 1 },
            critical: {
              $sum: { $cond: [{ $eq: ["$severity", "critical"] }, 1, 0] },
            },
            warning: {
              $sum: { $cond: [{ $eq: ["$severity", "warning"] }, 1, 0] },
            },
            opportunity: {
              $sum: { $cond: [{ $eq: ["$severity", "opportunity"] }, 1, 0] },
            },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            applied: {
              $sum: { $cond: [{ $eq: ["$status", "applied"] }, 1, 0] },
            },
            dismissed: {
              $sum: { $cond: [{ $eq: ["$status", "dismissed"] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
            },
            stale: {
              $sum: { $cond: [{ $eq: ["$status", "stale"] }, 1, 0] },
            },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 50 },
        {
          $project: {
            _id: 0,
            auditId: "$_id",
            adAccountId: 1,
            createdAt: 1,
            expiresAt: 1,
            total: 1,
            summary: {
              critical: "$critical",
              warning: "$warning",
              opportunity: "$opportunity",
            },
            statusBreakdown: {
              pending: "$pending",
              applied: "$applied",
              dismissed: "$dismissed",
              failed: "$failed",
              stale: "$stale",
            },
          },
        },
      ]);

      return res
        .status(200)
        .json({ status: true, count: audits.length, audits });
    } catch (error) {
      logger.error(`List audits error: ${error.message}`);
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // * GET /meta-ads/autopilot/llm-audit/findings/:auditId
  async getFindings(req, res) {
    try {
      const { auditId } = req.params;
      const userId = req.user.user_id;
      const findings = await MetaAuditFinding.find({ auditId, userId }).sort({
        severity: 1,
        createdAt: -1,
      });
      return res.status(200).json({
        status: true,
        auditId,
        count: findings.length,
        findings,
      });
    } catch (error) {
      logger.error(`Get findings error: ${error.message}`);
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // * POST /meta-ads/autopilot/llm-audit/apply-fix/:findingId
  async applyFix(req, res) {
    try {
      const { findingId } = req.params;
      const userId = req.user.user_id;

      const { error, value } = applyFixSchema.validate(req.body || {});
      if (error)
        return res
          .status(400)
          .json({ status: false, error: error.details[0].message });
      const { acknowledgeRisk, paramOverrides } = value;

      const finding = await MetaAuditFinding.findOne({ _id: findingId, userId });
      if (!finding)
        return res.status(404).json({ status: false, error: "Finding not found" });

      if (finding.status !== "pending")
        return res.status(409).json({
          status: false,
          error: `Finding is ${finding.status}, cannot apply`,
        });

      const action = getAction(finding.fix.action_type);
      if (!action)
        return res
          .status(500)
          .json({ status: false, error: "Unknown action_type in finding" });

      if (action.risk === "high" && !acknowledgeRisk)
        return res.status(400).json({
          status: false,
          error:
            "This is a high-risk fix. Resubmit with { acknowledgeRisk: true } to proceed.",
          risk_level: action.risk,
        });

      // Merge any frontend overrides (e.g., user tweaks budget slider)
      const mergedParams = { ...finding.fix.params, ...paramOverrides };
      const { error: paramErr, value: validParams } = validateFixParams(
        finding.fix.action_type,
        mergedParams,
      );
      if (paramErr)
        return res
          .status(400)
          .json({ status: false, error: `Param override invalid: ${paramErr}` });

      // ─── Safety gate ────────────────────────────────────────
      // Honour the global `AUTOPILOT_LIVE_ACTIONS_ALLOWED` env flag. When
      // off, we DO NOT touch Meta — the apply becomes a recorded dry-run
      // with `dryRun: true` on the action log row. The finding itself
      // stays `pending` so the user can retry once live writes are enabled.
      const dr = effectiveDryRun({
        adAccountId: finding.adAccountId,
        requestedDryRun: false, // applyFix is always intended to write
      });
      if (dr.dryRun && dr.forced) {
        await logToActionLog({
          finding,
          outcome: "skipped",
          dryRun: true,
          forced: true,
          forcedReason: dr.reason,
          beforeState: null,
          afterState: null,
        });
        await MetaFixLog.create({
          findingId: finding._id,
          auditId: finding.auditId,
          userId,
          adAccountId: finding.adAccountId,
          action_type: finding.fix.action_type,
          params: validParams,
          entity_type: finding.entity_type,
          entity_id: finding.entity_id,
          status: "failed",
          error: `safety-gate: ${dr.reason}`,
        });
        return res.status(423).json({
          status: false,
          error:
            "Autopilot live writes are disabled (AUTOPILOT_LIVE_ACTIONS_ALLOWED is not 'true'). Fix recorded as dry-run.",
          dryRun: true,
          forcedReason: dr.reason,
        });
      }

      // ─── Init Meta API with the unified token resolver ──────
      let resolved;
      try {
        resolved = await getAccessTokenForAccount({
          adAccountId: finding.adAccountId,
          callerUserId: userId,
          facebookId: getFacebookIdFromRequest(req),
        });
      } catch (err) {
        return res.status(404).json({ status: false, error: err.message });
      }
      initFbApi(resolved.accessToken);

      // ─── Dispatch by action_type ────────────────────────────
      const context = {
        finding,
        params: validParams,
        userId,
        adAccountId: finding.adAccountId,
      };
      const handler = this._dispatch(finding.fix.action_type);
      if (!handler)
        return res.status(500).json({
          status: false,
          error: `No handler for action ${finding.fix.action_type}`,
        });

      let result;
      try {
        result = await handler.call(this, context);
      } catch (err) {
        finding.status = "failed";
        finding.lastError = err.message;
        await finding.save();
        await MetaFixLog.create({
          findingId: finding._id,
          auditId: finding.auditId,
          userId,
          adAccountId: finding.adAccountId,
          action_type: finding.fix.action_type,
          params: validParams,
          entity_type: finding.entity_type,
          entity_id: finding.entity_id,
          status: "failed",
          error: err.message,
        });
        await logToActionLog({
          finding,
          outcome: "failed",
          dryRun: false,
          beforeState: null,
          afterState: null,
          errorMessage: err.message,
        });
        logger.error(
          `Apply fix failed (${finding.fix.action_type}): ${err.stack || err.message}`,
        );
        return res.status(500).json({
          status: false,
          error: "Failed to apply fix",
          details: err.message,
        });
      }

      finding.status = "applied";
      finding.appliedAt = new Date();
      finding.beforeState = result.beforeState;
      finding.afterState = result.afterState;
      await finding.save();

      await MetaFixLog.create({
        findingId: finding._id,
        auditId: finding.auditId,
        userId,
        adAccountId: finding.adAccountId,
        action_type: finding.fix.action_type,
        params: validParams,
        entity_type: finding.entity_type,
        entity_id: finding.entity_id,
        beforeState: result.beforeState,
        afterState: result.afterState,
        status: "success",
      });
      await logToActionLog({
        finding,
        outcome: "success",
        dryRun: false,
        beforeState: result.beforeState,
        afterState: result.afterState,
      });

      await bustAccountCaches(userId, finding.adAccountId);

      return res.status(200).json({
        status: true,
        message: `${finding.fix.action_type} applied to ${finding.entity_type} ${finding.entity_id}`,
        finding,
      });
    } catch (error) {
      logger.error(`Apply fix error: ${error.stack || error.message}`);
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // * POST /meta-ads/autopilot/llm-audit/dismiss/:findingId
  async dismissFinding(req, res) {
    try {
      const { findingId } = req.params;
      const userId = req.user.user_id;
      const finding = await MetaAuditFinding.findOne({ _id: findingId, userId });
      if (!finding)
        return res.status(404).json({ status: false, error: "Finding not found" });
      if (finding.status !== "pending")
        return res.status(409).json({
          status: false,
          error: `Cannot dismiss a ${finding.status} finding`,
        });
      finding.status = "dismissed";
      finding.dismissedAt = new Date();
      await finding.save();
      return res.status(200).json({ status: true, finding });
    } catch (error) {
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // * POST /meta-ads/autopilot/llm-audit/undo/:findingId
  async undoFix(req, res) {
    try {
      const { findingId } = req.params;
      const userId = req.user.user_id;
      const finding = await MetaAuditFinding.findOne({ _id: findingId, userId });
      if (!finding)
        return res.status(404).json({ status: false, error: "Finding not found" });
      if (finding.status !== "applied")
        return res.status(409).json({
          status: false,
          error: `Cannot undo a ${finding.status} finding`,
        });

      const action = getAction(finding.fix.action_type);
      if (!action?.reversible)
        return res
          .status(400)
          .json({ status: false, error: "This action is not reversible" });

      if (!finding.beforeState)
        return res
          .status(400)
          .json({ status: false, error: "No before-state stored for undo" });

      let resolved;
      try {
        resolved = await getAccessTokenForAccount({
          adAccountId: finding.adAccountId,
          callerUserId: userId,
          facebookId: getFacebookIdFromRequest(req),
        });
      } catch (err) {
        return res.status(404).json({ status: false, error: err.message });
      }
      initFbApi(resolved.accessToken);

      const restored = await this._restoreEntity(
        finding.entity_type,
        finding.entity_id,
        finding.beforeState,
      );

      // Capture both states BEFORE saving to the finding doc so the
      // log row's beforeState reflects the post-apply value (what
      // the entity looked like at undo-time) and afterState reflects
      // the restored value. Same orientation as `applyFix`.
      const undoBeforeState = finding.afterState;
      const undoAfterState = restored;

      finding.status = "pending";
      finding.afterState = restored;
      await finding.save();

      await MetaFixLog.create({
        findingId: finding._id,
        auditId: finding.auditId,
        userId,
        adAccountId: finding.adAccountId,
        action_type: `UNDO_${finding.fix.action_type}`,
        params: finding.beforeState,
        entity_type: finding.entity_type,
        entity_id: finding.entity_id,
        beforeState: undoBeforeState,
        afterState: undoAfterState,
        status: "reverted",
        revertedAt: new Date(),
      });

      // Mirror the apply path: write to autopilotActionLog so the
      // unified Action log surfaces the revert event, not just the
      // original apply. Without this, users see the apply row but
      // nothing for the revert — leading them to think autopilot
      // didn't actually undo anything.
      await logToActionLog({
        finding,
        outcome: "success",
        dryRun: false,
        beforeState: undoBeforeState,
        afterState: undoAfterState,
        isUndo: true,
      });

      await bustAccountCaches(userId, finding.adAccountId);

      return res
        .status(200)
        .json({ status: true, message: "Fix reverted", finding });
    } catch (error) {
      logger.error(`Undo fix error: ${error.stack || error.message}`);
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // * GET /meta-ads/autopilot/llm-audit/fix-log
  async getFixLog(req, res) {
    try {
      const userId = req.user.user_id;
      const { limit = 50, auditId } = req.query;
      const query = { userId };
      if (auditId) query.auditId = auditId;
      const logs = await MetaFixLog.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(parseInt(limit, 10) || 50, 200));
      return res.status(200).json({ status: true, count: logs.length, logs });
    } catch (error) {
      return res
        .status(500)
        .json({ status: false, error: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Dispatch
  // ─────────────────────────────────────────────────────────────
  _dispatch(action_type) {
    return {
      PAUSE_ENTITY: this._applyPauseOrActivate("PAUSED"),
      ACTIVATE_ENTITY: this._applyPauseOrActivate("ACTIVE"),
      ADJUST_BUDGET: this._applyAdjustBudget,
      ADJUST_BID: this._applyAdjustBid,
      NARROW_AUDIENCE: this._applyTargetingPatch,
      BROADEN_AUDIENCE: this._applyTargetingPatch,
      EXTEND_SCHEDULE: this._applyScheduleChange,
      END_EARLY: this._applyScheduleChange,
      CHANGE_OPTIMIZATION_GOAL: this._applyChangeOptimizationGoal,
      DUPLICATE_AND_MODIFY: this._applyDuplicateAndModify,
      SWAP_CREATIVE: this._applySwapCreative,
    }[action_type];
  }

  // ─── Handlers ────────────────────────────────────────────────

  _applyPauseOrActivate(targetStatus) {
    return async function ({ params }) {
      const { level, id } = params;
      const before = await readEntityState(level, id);
      const obj = getEntityObject(level, id);
      await obj.update([], { status: targetStatus });
      const after = await readEntityState(level, id);
      return { beforeState: before, afterState: after };
    };
  }

  async _applyAdjustBudget({ params }) {
    const { level, id, new_daily_budget, new_lifetime_budget } = params;
    const before = await readEntityState(level, id);

    const update = {};
    if (new_daily_budget != null) {
      const current = parseFloat(before.daily_budget || 0);
      const clamped = current
        ? Math.round(clampBudget(new_daily_budget, current))
        : Math.round(new_daily_budget);
      update.daily_budget = clamped;
    }
    if (new_lifetime_budget != null) {
      const current = parseFloat(before.lifetime_budget || 0);
      const clamped = current
        ? Math.round(clampBudget(new_lifetime_budget, current))
        : Math.round(new_lifetime_budget);
      update.lifetime_budget = clamped;
    }

    const obj = getEntityObject(level, id);
    await obj.update([], update);
    const after = await readEntityState(level, id);
    return { beforeState: before, afterState: after };
  }

  async _applyAdjustBid({ params }) {
    const { adset_id, new_bid_amount } = params;
    const before = await readEntityState("adset", adset_id);
    const obj = new AdSet(adset_id);
    await obj.update([], { bid_amount: Math.round(new_bid_amount) });
    const after = await readEntityState("adset", adset_id);
    return { beforeState: before, afterState: after };
  }

  async _applyTargetingPatch({ params }) {
    const { adset_id, targeting_patch } = params;
    const before = await readEntityState("adset", adset_id);
    const currentTargeting = before.targeting || {};
    const merged = { ...currentTargeting, ...targeting_patch };
    const obj = new AdSet(adset_id);
    await obj.update([], { targeting: merged });
    const after = await readEntityState("adset", adset_id);
    return { beforeState: before, afterState: after };
  }

  async _applyScheduleChange({ params }) {
    const { level, id, new_stop_time } = params;
    const before = await readEntityState(level, id);
    const obj = getEntityObject(level, id);
    const field = level === "campaign" ? "stop_time" : "end_time";
    await obj.update([], { [field]: new_stop_time });
    const after = await readEntityState(level, id);
    return { beforeState: before, afterState: after };
  }

  async _applyChangeOptimizationGoal({ params }) {
    const { adset_id, new_goal } = params;
    const before = await readEntityState("adset", adset_id);
    const obj = new AdSet(adset_id);
    await obj.update([], { optimization_goal: new_goal });
    const after = await readEntityState("adset", adset_id);
    return { beforeState: before, afterState: after };
  }

  async _applyDuplicateAndModify({ params }) {
    const { source_level, source_id, overrides } = params;
    const before = await readEntityState(source_level, source_id);
    const obj = getEntityObject(source_level, source_id);

    const copy = await obj.createCopy(["id"], overrides || {});
    const newId = copy?.id || copy?._data?.id;

    return {
      beforeState: { source: before },
      afterState: { duplicated_id: newId, overrides },
    };
  }

  async _applySwapCreative({ params }) {
    const { ad_id, new_creative_id } = params;
    const before = await readEntityState("ad", ad_id);
    const obj = new Ad(ad_id);
    await obj.update([], { creative: { creative_id: new_creative_id } });
    const after = await readEntityState("ad", ad_id);
    return { beforeState: before, afterState: after };
  }

  // Restore a subset of fields from a captured beforeState
  async _restoreEntity(level, id, before) {
    const update = {};
    if (before.status != null) update.status = before.status;
    if (before.daily_budget != null)
      update.daily_budget = parseInt(before.daily_budget, 10);
    if (before.lifetime_budget != null)
      update.lifetime_budget = parseInt(before.lifetime_budget, 10);
    if (before.bid_amount != null)
      update.bid_amount = parseInt(before.bid_amount, 10);
    if (before.optimization_goal)
      update.optimization_goal = before.optimization_goal;
    if (before.stop_time) update.stop_time = before.stop_time;
    if (before.end_time) update.end_time = before.end_time;
    if (before.targeting) update.targeting = before.targeting;
    if (level === "ad" && before.creative?.id)
      update.creative = { creative_id: before.creative.id };

    const obj = getEntityObject(level, id);
    await obj.update([], update);
    return await readEntityState(level, id);
  }
}

module.exports = new LLMAuditController();
