/**
 * Managed-campaign slots — which campaigns a user may operate on.
 *
 * On a plan that caps `meta:campaigns`, connecting an ad account is
 * unrestricted but only N campaigns can be viewed in detail, edited, paused,
 * resumed, or automated. This module owns that selection: claiming a slot,
 * releasing it, counting it (the plan limit's counter), and the gate every
 * campaign-scoped mutation runs.
 *
 * On an UNCAPPED plan every function here is effectively a no-op — the gate
 * returns ok, and nothing is ever locked. That's the property that keeps this
 * invisible to paying tiers.
 *
 * Everything FAILS OPEN, matching utils/planLimits.js: a Mongo error must
 * degrade to "allowed", never to a user locked out of their own campaigns.
 */
const ManagedCampaign = require("../Module/adPosting/managedCampaign");
const { getLimitsForUser } = require("../utils/planLimits");
const logger = require("../utils/logger");

const LIMIT_KEY = "meta:campaigns";

/** The plan limit's counter — cheap, unlike walking Meta account-by-account. */
async function countManagedCampaigns(userId) {
  if (!userId) return 0;
  return ManagedCampaign.countDocuments({ userId });
}

/** Set of campaign ids the user manages. Set, not array — callers do lookups. */
async function listManagedCampaignIds(userId) {
  if (!userId) return new Set();
  const rows = await ManagedCampaign.find({ userId }, { campaignId: 1 }).lean();
  return new Set(rows.map((row) => row.campaignId));
}

async function isCampaignManaged(userId, campaignId) {
  if (!userId || !campaignId) return false;
  const row = await ManagedCampaign.exists({ userId, campaignId: String(campaignId) });
  return !!row;
}

/** null when the plan doesn't cap campaigns at all. */
async function getCampaignLimit(userId) {
  const limits = await getLimitsForUser(userId);
  const limit = limits?.[LIMIT_KEY];
  return limit === undefined ? null : limit;
}

/**
 * Claim a slot for a campaign.
 *
 * `force` is for the create path: a campaign the user just made in AdsGPT is
 * theirs by definition, and creation is already gated by checkPlanLimit
 * upstream, so re-checking here would double-count the slot it's about to
 * occupy.
 *
 * Returns { ok, alreadyManaged?, limit?, current? }.
 */
async function claimCampaign(userId, { campaignId, adAccountId, facebookId, source = "select", force = false } = {}) {
  try {
    if (!userId || !campaignId) return { ok: false, error: "userId and campaignId are required" };
    const id = String(campaignId);

    if (await isCampaignManaged(userId, id)) return { ok: true, alreadyManaged: true };

    if (!force) {
      const limit = await getCampaignLimit(userId);
      if (limit !== null) {
        const current = await countManagedCampaigns(userId);
        if (current >= limit) {
          return {
            ok: false,
            status: 403,
            code: "PLAN_LIMIT_REACHED",
            limitKey: LIMIT_KEY,
            limit,
            current,
            error: `You're managing ${current} of ${limit} campaigns allowed on your plan. Release one to manage this campaign instead, or upgrade your plan.`,
          };
        }
      }
    }

    // The unique (userId, campaignId) index is what makes a double-click safe.
    // A genuine race between two concurrent claims on the LAST slot can still
    // land both (count-then-insert isn't atomic); worst case a user briefly
    // holds limit+1. Accepted: the alternative is a transaction for a
    // low-stakes UI action, and the count self-corrects on the next release.
    await ManagedCampaign.updateOne(
      { userId, campaignId: id },
      { $setOnInsert: { userId, campaignId: id, adAccountId: String(adAccountId || ""), facebookId, source } },
      { upsert: true },
    );
    return { ok: true };
  } catch (err) {
    // Duplicate key = someone else claimed it in the same instant. Same
    // outcome the caller wanted, so report success.
    if (err?.code === 11000) return { ok: true, alreadyManaged: true };
    logger.warn(`claimCampaign(${campaignId}) failed: ${err.message}`);
    return { ok: false, error: "Could not update managed campaigns" };
  }
}

async function releaseCampaign(userId, campaignId) {
  try {
    if (!userId || !campaignId) return { ok: false, error: "userId and campaignId are required" };
    await ManagedCampaign.deleteOne({ userId, campaignId: String(campaignId) });
    return { ok: true };
  } catch (err) {
    logger.warn(`releaseCampaign(${campaignId}) failed: ${err.message}`);
    return { ok: false, error: "Could not update managed campaigns" };
  }
}

/**
 * The gate. Run before any campaign-scoped mutation.
 *
 * Returns { ok: true } when the plan is uncapped, the campaign is managed, or
 * anything went wrong. `campaignId` may legitimately be absent on endpoints
 * that only carry an ad set / ad id — those are unreachable through the UI for
 * an unmanaged campaign (drill-down is blocked), so we allow rather than pay
 * for a Meta lookup to resolve the parent. See docs/META_ADS_PLAN_LIMITS_QA.md.
 */
async function requireManagedCampaign(userId, campaignId) {
  try {
    const limit = await getCampaignLimit(userId);
    if (limit === null) return { ok: true };
    if (!campaignId) return { ok: true };

    if (await isCampaignManaged(userId, campaignId)) return { ok: true };

    return {
      ok: false,
      status: 403,
      code: "CAMPAIGN_NOT_MANAGED",
      limitKey: LIMIT_KEY,
      limit,
      campaignId: String(campaignId),
      error: `This campaign isn't one of the ${limit} you're managing on your plan. Add it from the Campaigns list (releasing another if you're at the limit), or upgrade your plan.`,
    };
  } catch (err) {
    logger.warn(`requireManagedCampaign(${campaignId}) failed, allowing through: ${err.message}`);
    return { ok: true };
  }
}

/**
 * Drop slots held by campaigns that no longer exist in Meta.
 *
 * Deleting a campaign directly in Meta Ads Manager would otherwise leave its
 * slot consumed forever. Called with a FRESHLY fetched campaign list for ONE
 * ad account — scoping the delete to that `adAccountId` is load-bearing:
 * filtering only by `userId` would wipe every managed campaign belonging to
 * the user's OTHER ad accounts, since they're absent from this list by
 * definition rather than by deletion.
 */
async function pruneMissingForAccount(userId, adAccountId, liveCampaignIds) {
  try {
    if (!userId || !adAccountId || !Array.isArray(liveCampaignIds)) return 0;
    const res = await ManagedCampaign.deleteMany({
      userId,
      adAccountId: String(adAccountId),
      campaignId: { $nin: liveCampaignIds.map(String) },
    });
    if (res.deletedCount) {
      logger.info(
        `pruneMissingForAccount: released ${res.deletedCount} managed campaign slot(s) for act_${adAccountId} (deleted outside AdsGPT)`,
      );
    }
    return res.deletedCount || 0;
  } catch (err) {
    logger.warn(`pruneMissingForAccount(${adAccountId}) failed: ${err.message}`);
    return 0;
  }
}

module.exports = {
  LIMIT_KEY,
  countManagedCampaigns,
  listManagedCampaignIds,
  isCampaignManaged,
  getCampaignLimit,
  claimCampaign,
  releaseCampaign,
  requireManagedCampaign,
  pruneMissingForAccount,
};
