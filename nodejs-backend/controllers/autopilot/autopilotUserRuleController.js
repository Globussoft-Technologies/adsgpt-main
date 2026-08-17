const AutopilotUserRule = require("../../Module/autopilot/autopilotUserRule");
const {
  createRuleSchema,
  updateRuleSchema,
} = require("../../Validations/autopilotUserRule.validator");
const {
  normalizeAdAccountId,
  parseAdAccountIdFilter,
} = require("../../config/autopilotConfig");
const {
  listTemplates,
} = require("../../config/autopilotRuleTemplates");
const logger = require("../../utils/logger");
const { trackBackendGA4Event } = require("../../utils/ga4");

/**
 * HTTP layer for user-defined Autopilot rules.
 *
 *   GET    /meta-ads/autopilot/rules           list current user's rules
 *   POST   /meta-ads/autopilot/rules           create
 *   PATCH  /meta-ads/autopilot/rules/:id       update (ownership checked)
 *   DELETE /meta-ads/autopilot/rules/:id       delete (ownership checked)
 *   POST   /meta-ads/autopilot/rules/:id/test  dry-run preview against
 *                                              current Meta state — no
 *                                              autopilotActionLog rows
 *                                              are written.
 *
 * Ownership is enforced on every read/write by always filtering on
 * `userId: req.user.user_id`. There is no admin override.
 */

// Stamp every attachment with the canonical `act_<id>` shape so the cron
// (which compares against /me/campaigns response) doesn't have to handle
// bare ids on top of prefixed ones.
function normalizeAttachments(attachments = []) {
  return attachments.map((a) => ({
    ...a,
    adAccountId: normalizeAdAccountId(a.adAccountId),
    // Defensive — never let users set the orphan flag from the client.
    orphan: false,
    orphanedAt: null,
  }));
}

/**
 * Plan gate for rule attachments.
 *
 * Rules attach to specific campaigns and carry their own `evaluateOn`
 * (campaign | adset | ad), so gating the ATTACHMENT is sufficient — the cron
 * only ever evaluates attached campaigns, and never has to resolve an ad
 * set's or ad's parent at execution time.
 *
 * Returns null when allowed, or `{status, body}` naming the offending
 * campaigns. Fails open, like every other plan check.
 */
async function attachmentsOutsidePlan(userId, attachments = []) {
  try {
    const {
      getCampaignLimit,
      listManagedCampaignIds,
    } = require("../../services/managedCampaigns");
    if ((await getCampaignLimit(userId)) === null) return null;

    const managed = await listManagedCampaignIds(userId);
    const blocked = attachments
      .map((a) => String(a.campaignId))
      .filter((id) => !managed.has(id));
    if (blocked.length === 0) return null;

    return {
      status: 403,
      body: {
        status: false,
        code: "CAMPAIGN_NOT_MANAGED",
        error:
          blocked.length === 1
            ? "That campaign isn't one you're managing on your plan. Add it from the Campaigns list first, or pick a different campaign."
            : `${blocked.length} of the selected campaigns aren't ones you're managing on your plan. Add them from the Campaigns list first, or pick different campaigns.`,
        campaignIds: blocked,
      },
    };
  } catch (err) {
    logger.warn(`[autopilot] attachment plan check failed, allowing: ${err.message}`);
    return null;
  }
}

class AutopilotUserRuleController {
  constructor() {
    this.list = this.list.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.remove = this.remove.bind(this);
    this.test = this.test.bind(this);
    this.templates = this.templates.bind(this);
  }

  /**
   * GET /rule-templates — static catalog of curated user-rule starting
   * points. Frontend renders the gallery; "Use this template" clones the
   * `template` object straight into the create form.
   *
   * No per-user data, no auth gating beyond JWT. Safe to cache aggressively
   * client-side; restart the server when the seed file changes.
   */
  async templates(req, res) {
    try {
      return res
        .status(200)
        .json({ status: true, templates: listTemplates() });
    } catch (err) {
      logger.error(`[autopilot] /rule-templates GET error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to load rule templates",
        details: err.message,
      });
    }
  }

  /**
   * GET /rules — list this user's rules, sorted newest first.
   *
   * Optional `adAccountId` (single id or comma-separated list) scopes the
   * list to rules that touch at least one of those ad accounts — a rule's
   * `attachments[]` can span several accounts, so this is an "any attachment
   * matches" filter, not an exact-owner one.
   */
  async list(req, res) {
    try {
      const userId = req.user.user_id;
      const adAccountIdFilter = parseAdAccountIdFilter(req.query?.adAccountId);
      const query = { userId };
      if (adAccountIdFilter) query["attachments.adAccountId"] = adAccountIdFilter;
      const rules = await AutopilotUserRule.find(query)
        .sort({ updatedAt: -1 })
        .lean();
      return res.status(200).json({ status: true, rules });
    } catch (err) {
      logger.error(`[autopilot] /rules GET error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to list rules",
        details: err.message,
      });
    }
  }

  /**
   * POST /rules — create a new rule.
   * Body validated by `createRuleSchema`. `attachments[i].adAccountId`
   * gets canonicalised to `act_<id>` shape on write.
   */
  async create(req, res) {
    try {
      const userId = req.user.user_id;
      const { error, value } = createRuleSchema.validate(req.body || {}, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        return res.status(400).json({
          status: false,
          error: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const attachments = normalizeAttachments(value.attachments);
      const blocked = await attachmentsOutsidePlan(userId, attachments);
      if (blocked) return res.status(blocked.status).json(blocked.body);

      const doc = await AutopilotUserRule.create({
        ...value,
        userId,
        attachments,
      });

      trackBackendGA4Event("ads_manager", {
        user_id: userId,
        feature: "ads_manager",
        action_name: "ads_manager_autopilot_added_new_rule",
        source: "autopilot_settings",
        success: true,
      });

      return res.status(201).json({ status: true, rule: doc.toObject() });
    } catch (err) {
      logger.error(`[autopilot] /rules POST error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to create rule",
        details: err.message,
      });
    }
  }

  /**
   * PATCH /rules/:id — partial update. Joi enforces "≥1 field present"
   * so empty PATCH bodies don't silently no-op.
   */
  async update(req, res) {
    try {
      const userId = req.user.user_id;
      const { id } = req.params;
      const { error, value } = updateRuleSchema.validate(req.body || {}, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (error) {
        return res.status(400).json({
          status: false,
          error: "Validation failed",
          details: error.details.map((d) => d.message),
        });
      }

      const patch = { ...value };
      if (patch.attachments) {
        patch.attachments = normalizeAttachments(patch.attachments);
        const blocked = await attachmentsOutsidePlan(userId, patch.attachments);
        if (blocked) return res.status(blocked.status).json(blocked.body);
      }

      // findOneAndUpdate with ownership filter — a forged :id from
      // another user can't reach this user's document.
      const updated = await AutopilotUserRule.findOneAndUpdate(
        { _id: id, userId },
        { $set: patch },
        { new: true, runValidators: true },
      ).lean();

      if (!updated) {
        return res
          .status(404)
          .json({ status: false, error: "Rule not found" });
      }
      return res.status(200).json({ status: true, rule: updated });
    } catch (err) {
      logger.error(`[autopilot] /rules PATCH error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to update rule",
        details: err.message,
      });
    }
  }

  /**
   * DELETE /rules/:id — hard delete. Ownership enforced via the filter.
   */
  async remove(req, res) {
    try {
      const userId = req.user.user_id;
      const { id } = req.params;
      const result = await AutopilotUserRule.findOneAndDelete({
        _id: id,
        userId,
      }).lean();
      if (!result) {
        return res
          .status(404)
          .json({ status: false, error: "Rule not found" });
      }
      return res.status(200).json({ status: true, deletedId: id });
    } catch (err) {
      logger.error(`[autopilot] /rules DELETE error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to delete rule",
        details: err.message,
      });
    }
  }

  /**
   * POST /rules/:id/test — dry-run preview. Wired in Phase 4 once the
   * evaluator + cron data-fetch helpers exist. For Phase 1 we accept
   * the request and return a stub response so the route shape is in
   * place; the frontend can build against this contract immediately.
   *
   * Phase 4 will replace the stub with: fetch attached campaigns from
   * Meta, evaluate at the rule's level, return per-entity match details.
   */
  async test(req, res) {
    try {
      const userId = req.user.user_id;
      const { id } = req.params;
      const rule = await AutopilotUserRule.findOne({
        _id: id,
        userId,
      }).lean();
      if (!rule) {
        return res
          .status(404)
          .json({ status: false, error: "Rule not found" });
      }
      // Stub response — Phase 4 fills this in with real evaluation.
      return res.status(200).json({
        status: true,
        ruleId: id,
        // Empty results array signals "preview not yet implemented" to
        // the frontend, which will render an "Evaluation preview will
        // appear here once Phase 4 ships" placeholder.
        evaluations: [],
        notImplemented: true,
      });
    } catch (err) {
      logger.error(`[autopilot] /rules/:id/test error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to test rule",
        details: err.message,
      });
    }
  }
}

module.exports = new AutopilotUserRuleController();
