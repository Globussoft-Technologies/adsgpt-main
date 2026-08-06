/**
 * Managed-campaign slot endpoints — the user picking WHICH campaigns their
 * plan's allowance is spent on. See services/managedCampaigns.js for the
 * model and the gate every campaign-scoped mutation runs.
 *
 * Kept out of metaAdLauncher.js deliberately: this is plan/billing state, not
 * a Meta API surface, and that controller is already ~4700 lines.
 */
const Joi = require("joi");
const {
  countManagedCampaigns,
  listManagedCampaignIds,
  getCampaignLimit,
  claimCampaign,
  releaseCampaign,
} = require("../../services/managedCampaigns");

const claimSchema = Joi.object({
  campaignId: Joi.string().required(),
  adAccountId: Joi.string().required(),
});

const releaseSchema = Joi.object({
  campaignId: Joi.string().required(),
});

// GET /meta-ads/managed-campaigns
// -> { limit, current, campaignIds }. `limit: null` means the plan is
//    uncapped and the frontend should show no lock UI at all.
exports.list = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const limit = await getCampaignLimit(userId);
    if (limit === null) {
      return res.json({ status: true, limit: null, current: 0, campaignIds: [] });
    }
    const campaignIds = [...(await listManagedCampaignIds(userId))];
    return res.json({
      status: true,
      limit,
      current: campaignIds.length,
      campaignIds,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ status: false, error: "Failed to load managed campaigns" });
  }
};

// POST /meta-ads/managed-campaigns — claim a slot for one campaign.
exports.claim = async (req, res) => {
  const { error, value } = claimSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ status: false, error: error.details[0].message });
  }
  const userId = req.user.user_id;
  const result = await claimCampaign(userId, {
    campaignId: value.campaignId,
    adAccountId: value.adAccountId,
    facebookId: req.headers?.["x-facebook-id"] || undefined,
    source: "select",
  });

  if (!result.ok) {
    // At the limit → 403 carrying the same shape as every other plan block.
    return res.status(result.status || 400).json({
      status: false,
      code: result.code,
      limitKey: result.limitKey,
      error: result.error,
      limit: result.limit,
      current: result.current,
    });
  }

  return res.status(200).json({
    status: true,
    campaignId: value.campaignId,
    current: await countManagedCampaigns(userId),
    limit: await getCampaignLimit(userId),
  });
};

// DELETE /meta-ads/managed-campaigns — release a slot.
// Releasing does NOT touch the campaign in Meta; it only stops AdsGPT from
// managing it, which is the whole point of the free-tier model.
exports.release = async (req, res) => {
  const { error, value } = releaseSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ status: false, error: error.details[0].message });
  }
  const userId = req.user.user_id;
  const result = await releaseCampaign(userId, value.campaignId);
  if (!result.ok) {
    return res.status(500).json({ status: false, error: result.error });
  }
  return res.status(200).json({
    status: true,
    campaignId: value.campaignId,
    current: await countManagedCampaigns(userId),
    limit: await getCampaignLimit(userId),
  });
};
