const AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");
const AutopilotSettings = require("../../Module/autopilot/autopilotSettings");
const { defaultSettings } = require("../../Module/autopilot/autopilotSettings");
const AdRotationDraft = require("../../Module/autopilot/adRotationDraft");
const { autoPauseForAccount } = require("../../services/autopilot/autoPauseService");
const {
  runAutopilotCycle,
} = require("../../services/autopilot/autopilotOrchestrator");
// v4 orchestrator — drives the cron AND the /run-cycle on-demand endpoint.
// The legacy v3 `runAutopilotCycle` import above is still used by the
// `/audit/run` HTTP endpoint to trigger the 37-rule audit on demand.
const {
  runUserRuleCycle,
} = require("../../services/autopilot/userRuleOrchestrator");
const {
  proposeHookRenamesForAccount,
} = require("../../services/autopilot/adRenameService");
const {
  rotateForAccount,
} = require("../../services/autopilot/rotationService");
const {
  postSlack,
  buildSlackPayload,
  sendEmail,
  parseEmailRecipients,
  buildPlainTextSummary,
  postTelegram,
  buildTelegramHtml,
} = require("../../services/autopilot/alertService");
const {
  getAccessTokenForAccount,
  accounts: configuredAccounts,
  isLiveActionsAllowed,
} = require("../../config/autopilotConfig");
const { runAuditForAccount } = require("../../services/metaAuditService");
const {
  updateSettingsSchema,
} = require("../../Validations/autopilotSettings.validator");
const {
  resolveRunOptions,
} = require("../../services/autopilot/runOptions");
const { listAuditRulesForUI } = require("../../config/auditRuleMetadata");
const logger = require("../../utils/logger");
const {
  getFacebookIdFromRequest,
} = require("../../utils/metaConnection");

/**
 * Thin HTTP layer over services/autopilot/*. All routes assume authenticateJWT
 * has populated `req.user.user_id` (the AdsGPT user id).
 */
class AutopilotController {
  constructor() {
    this.runNow = this.runNow.bind(this);
    this.runCycle = this.runCycle.bind(this);
    this.renameByHook = this.renameByHook.bind(this);
    this.testSlack = this.testSlack.bind(this);
    this.testEmail = this.testEmail.bind(this);
    this.testTelegram = this.testTelegram.bind(this);
    this.listLog = this.listLog.bind(this);
    this.getSummary = this.getSummary.bind(this);
    this.getRunDetail = this.getRunDetail.bind(this);
    this.getSettings = this.getSettings.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    this.rotate = this.rotate.bind(this);
    this.getConfig = this.getConfig.bind(this);
    this.getRotationQueue = this.getRotationQueue.bind(this);
    this.approveGenerated = this.approveGenerated.bind(this);
    this.runAudit = this.runAudit.bind(this);
    this.getAuditRules = this.getAuditRules.bind(this);
  }

  /**
   * GET /meta-ads/autopilot/audit-rules
   *
   * Static catalog of every audit rule (AUD-01 … AUD-37) with each rule's
   * description, defaults, and the editable threshold metadata (label, hint,
   * type, step). Used by the Settings UI to render the per-account rule
   * overrides editor without hardcoding rule shapes on the frontend.
   *
   * Pure metadata read — no per-user data; safe to cache aggressively client-
   * side. Restart the server when auditRulesConfig.js changes for the
   * payload to refresh.
   */
  async getAuditRules(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Catalog of audit rules with their tunable thresholds — drives the Settings UI rule-overrides editor.'
    */
    try {
      return res.status(200).json({ status: true, rules: listAuditRulesForUI() });
    } catch (err) {
      logger.error(`[autopilot] /audit-rules GET error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to load audit rule catalog",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/audit/run?adAccountId=...
   *
   * On-demand rule-based audit (the deterministic 37-rule engine). Uses
   * the caller's own FB OAuth token from the FacebookUsers collection.
   * Returns findings WITHOUT taking any action — this is the read-only
   * counterpart to the cron's hourly action loop. The frontend's "Run Rule
   * Audit" button hits this.
   */
  async runAudit(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'On-demand rule audit (37 rules). Read-only — returns findings, takes no actions.'
    */
    try {
      const source = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
      const adAccountId = source.adAccountId;
      if (!adAccountId) {
        return res
          .status(400)
          .json({ status: false, error: "adAccountId is required" });
      }
      const userId = req.user.user_id;

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

      const audit = await runAuditForAccount({
        userId,
        adAccountId,
        accessToken: resolved.accessToken,
        options: { enforceAgeGuard: true, enforceSpendFloor: true },
      });

      return res.status(200).json({
        status: true,
        tokenSource: resolved.source,
        ...audit,
      });
    } catch (err) {
      logger.error(`[autopilot] /audit/run error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Rule audit failed",
        details: err.message,
      });
    }
  }

  /**
   * GET /meta-ads/autopilot/summary?windowDays=7
   *
   * Aggregates autopilotActionLog over the last N days for the calling user
   * (their own actions + the cron's SYSTEM rows so the dashboard reflects
   * the full picture). Returns the same shape `summaryService.buildSummary`
   * produces — counts by action/severity/outcome/dry-run, top firing rules,
   * by-account breakdown, first/last run timestamps.
   *
   * Query:
   *   windowDays  default 7, max 90
   */
  async getSummary(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Per-user windowed Autopilot summary aggregations.'
    */
    try {
      const userId = req.user.user_id;
      const windowDays = Math.min(
        90,
        Math.max(1, parseInt(req.query.windowDays || "7", 10) || 7),
      );

      // Two date modes, in order of precedence:
      //   1. Explicit `from` / `to` ISO range — Overview + Action log date
      //      pickers send these. `to` is optional (defaults to "now").
      //   2. Fallback rolling `now − windowDays` window for any caller that
      //      hasn't migrated to from/to yet (preserves back-compat).
      const fromRaw = req.query.from ? new Date(req.query.from) : null;
      const toRaw = req.query.to ? new Date(req.query.to) : null;
      const hasFrom = fromRaw && !Number.isNaN(fromRaw.getTime());
      const hasTo = toRaw && !Number.isNaN(toRaw.getTime());
      const since = hasFrom
        ? fromRaw
        : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const runAtQuery = { $gte: since };
      if (hasTo) runAtQuery.$lte = toRaw;

      // Pull rows the user can see: their own + the scheduler's SYSTEM rows.
      // Lean for speed; no projection limit so summary has full row context.
      const rows = await AutopilotActionLog.find(
        {
          userId: { $in: [userId, "SYSTEM"] },
          runAt: runAtQuery,
        },
        {
          // Modest projection — we don't need the full metricsSnapshot for
          // aggregations and it can be large.
          metricsSnapshot: 0,
          actionPayload: 0,
        },
      )
        .sort({ runAt: -1 })
        .limit(5000) // hard cap to keep memory bounded; well above realistic
        .lean();

      const {
        buildSummary,
      } = require("../../services/autopilot/summaryService");
      const summary = buildSummary(rows);

      return res.status(200).json({
        status: true,
        windowDays,
        windowStart: since.toISOString(),
        windowEnd: hasTo ? toRaw.toISOString() : null,
        ...summary,
      });
    } catch (err) {
      logger.error(`[autopilot] /summary error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to build autopilot summary",
        details: err.message,
      });
    }
  }

  /**
   * GET /meta-ads/autopilot/log/:runId
   *
   * Per-run drilldown — returns the full row set for a single orchestrator
   * tick plus its rollup. Used by the "click into a run" UX.
   */
  async getRunDetail(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Per-run drilldown of the autopilot action log.'
    */
    try {
      const runId = req.params.runId;
      if (!runId) {
        return res
          .status(400)
          .json({ status: false, error: "runId is required" });
      }
      const userId = req.user.user_id;
      const rows = await AutopilotActionLog.find({
        runId,
        userId: { $in: [userId, "SYSTEM"] },
      })
        .sort({ runAt: 1 })
        .lean();

      const {
        buildRunDetail,
      } = require("../../services/autopilot/summaryService");
      const detail = buildRunDetail({ runId, rows });

      return res.status(200).json({ status: true, ...detail });
    } catch (err) {
      logger.error(`[autopilot] /log/:runId error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to read run detail",
        details: err.message,
      });
    }
  }

  /**
   * GET /meta-ads/autopilot/config
   *
   * Read-only view of the global Autopilot config the frontend cares about:
   * the live-write safety gate and any ops-level threshold pins. The set
   * of accounts the cron acts on is no longer hardcoded — it's discovered
   * per-tick from each user's own FB OAuth + their `autopilotSettings`.
   */
  async getConfig(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Read-only Autopilot config — global live-actions flag + any ops-level threshold pins.'
    */
    try {
      // accountOverrides is the optional per-account threshold pin map
      // (config/autopilotConfig.js `accounts`). Empty by default in v3.
      const accountOverrides = Object.entries(configuredAccounts).map(
        ([id, cfg]) => ({
          adAccountId: id,
          rawId: id.startsWith("act_") ? id.slice(4) : id,
          overrides: cfg.overrides || {},
          min_spend_before_eval: cfg.min_spend_before_eval ?? null,
          min_age_hours: cfg.min_age_hours ?? null,
        }),
      );
      return res.status(200).json({
        status: true,
        // Global live-write safety gate (env-driven, default false). When
        // false every action is forced to dryRun regardless of caller intent.
        liveActionsAllowed: isLiveActionsAllowed(),
        // Empty by default. Populated only when an account needs different
        // rule thresholds than the defaults.
        accountOverrides,
      });
    } catch (err) {
      logger.error(`[autopilot] /config error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to read autopilot config",
        details: err.message,
      });
    }
  }

  /**
   * GET /meta-ads/autopilot/rotation-queue
   *
   * Lists rotation drafts for an account so the Phase 4 UI Rotation Queue
   * tab can display queue depth + pending review. Optionally filtered by
   * adsetId. Excludes already-used drafts by default.
   *
   * Query: adAccountId (required), adsetId, includeUsed=false, limit=50
   */
  async getRotationQueue(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'List rotation drafts for an ad account.'
    */
    try {
      const adAccountId = req.query.adAccountId;
      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }
      const includeUsed =
        String(req.query.includeUsed || "false").toLowerCase() === "true";
      const limit = Math.min(
        200,
        Math.max(1, parseInt(req.query.limit || "50", 10) || 50),
      );
      const q = { adAccountId };
      if (req.query.adsetId) q.adsetId = req.query.adsetId;
      if (!includeUsed) q.usedByAutopilotAt = null;

      const drafts = await AdRotationDraft.find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      // Counts give the UI a cheap "queue depth" summary at a glance.
      const counts = {
        total: drafts.length,
        rotationReady: drafts.filter((d) => d.rotationReady).length,
        autoGeneratedAwaitingReview: drafts.filter(
          (d) => d.autoGenerated && !d.rotationReady,
        ).length,
      };

      return res.status(200).json({
        status: true,
        adAccountId,
        counts,
        drafts,
      });
    } catch (err) {
      logger.error(`[autopilot] /rotation-queue error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to read rotation queue",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/approve-generated/:draftId
   *
   * Phase 10 review flow: human flips a Phase-10-auto-generated draft to
   * `rotationReady: true` so the next rotation cycle can pick it up. Idempotent
   * — re-approving a ready draft is a no-op. Refuses to approve a draft that
   * has already been used by autopilot.
   */
  async approveGenerated(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Approve an auto-generated rotation draft for live use (Phase 10).'
    */
    try {
      const draftId = req.params.draftId;
      if (!draftId) {
        return res
          .status(400)
          .json({ status: false, error: "draftId is required" });
      }
      const draft = await AdRotationDraft.findById(draftId);
      if (!draft) {
        return res
          .status(404)
          .json({ status: false, error: "draft not found" });
      }
      if (draft.usedByAutopilotAt) {
        return res.status(409).json({
          status: false,
          error: "draft already used by a prior rotation; cannot re-approve",
        });
      }
      draft.rotationReady = true;
      await draft.save();
      return res.status(200).json({ status: true, draft: draft.toObject() });
    } catch (err) {
      logger.error(`[autopilot] /approve-generated error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to approve generated draft",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/rotate
   *
   * Manual single-account rotation trigger. Same code path the orchestrator
   * uses (when AUTOPILOT_ROTATION_ENABLED=true) but for one account at a
   * time. Useful for previewing what would happen on a fatigued ad before
   * flipping the env gate. Honours `dryRun` (default true) and the global
   * `AUTOPILOT_LIVE_ACTIONS_ALLOWED` safety gate.
   *
   * Body / query:
   *   adAccountId  required
   *   dryRun       default true
   */
  async rotate(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Manually trigger creative rotation for one ad account. Dry-run by default.'
    */
    try {
      const source = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
      const adAccountId = source.adAccountId;
      const dryRun = String(source.dryRun ?? "true").toLowerCase() !== "false";

      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }

      const userId = req.user.user_id;
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

      const result = await rotateForAccount({
        userId,
        adAccountId,
        accessToken: resolved.accessToken,
        dryRun,
      });
      result.tokenSource = resolved.source;
      return res.status(200).json({ status: true, ...result });
    } catch (err) {
      logger.error(`[autopilot] /rotate error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Autopilot rotation failed",
        details: err.message,
      });
    }
  }

  /**
   * Load AutopilotSettings for a user, or fall back to defaults if no row
   * exists yet. Pure-ish wrapper so runNow / runCycle share one resolution
   * path. Returns the settings doc shape (lean object).
   */
  async _loadSettings(userId) {
    const doc = await AutopilotSettings.findOne({ userId }).lean();
    return doc || defaultSettings(userId);
  }

  /**
   * GET /meta-ads/autopilot/settings
   *
   * Returns the requesting user's Autopilot settings. If no document exists
   * yet, returns a default shape without creating a row — the UI can render
   * the form and the first PATCH will upsert.
   */
  async getSettings(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Read the current user\'s Autopilot settings; returns defaults if nothing is saved yet.'
    */
    try {
      const userId = req.user.user_id;
      const doc = await AutopilotSettings.findOne({ userId }).lean();
      const settings = doc || defaultSettings(userId);
      return res.status(200).json({ status: true, settings });
    } catch (err) {
      logger.error(`[autopilot] /settings GET error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to read autopilot settings",
        details: err.message,
      });
    }
  }

  /**
   * PATCH /meta-ads/autopilot/settings
   *
   * Merge-update. Every field in the body is optional; only provided keys
   * are changed. Upserts — a brand-new user gets their row created here.
   * The `alerts` subdoc is merged shallowly (individual alert fields can be
   * updated without wiping the others).
   */
  async updateSettings(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Merge-update the current user\'s Autopilot settings.'
    */
    try {
      const userId = req.user.user_id;
      const { error, value } = updateSettingsSchema.validate(req.body || {}, {
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

      // Build a $set payload that handles the alerts subdoc properly: setting
      // top-level `alerts` would wipe the other alert fields, so flatten it
      // into `alerts.slackWebhookUrl` / `alerts.emailTo` / `alerts.alertOn`.
      const setPayload = {};
      for (const [key, val] of Object.entries(value)) {
        if (key === "alerts" && val && typeof val === "object") {
          for (const [aKey, aVal] of Object.entries(val)) {
            setPayload[`alerts.${aKey}`] = aVal;
          }
        } else {
          setPayload[key] = val;
        }
      }

      const doc = await AutopilotSettings.findOneAndUpdate(
        { userId },
        { $set: setPayload, $setOnInsert: { userId } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      return res.status(200).json({ status: true, settings: doc });
    } catch (err) {
      logger.error(`[autopilot] /settings PATCH error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to update autopilot settings",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/test-slack
   *
   * Post a sample Autopilot summary to the calling user's saved Slack
   * webhook (`autopilotSettings.alerts.slackWebhookUrl`). Useful for
   * verifying the webhook before the first real cron tick.
   */
  async testSlack(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = "Send a sample Autopilot summary to the calling user's saved Slack webhook."
    */
    try {
      const userId = req.user.user_id;
      const settingsDoc = await AutopilotSettings.findOne({ userId }).lean();
      const webhookUrl =
        settingsDoc && settingsDoc.alerts && settingsDoc.alerts.slackWebhookUrl;
      if (!webhookUrl) {
        return res.status(400).json({
          status: false,
          error:
            "No Slack webhook saved on your Autopilot settings. Add one in Settings → Slack webhook URL and try again.",
        });
      }
      const sample = buildSampleSummary();
      const result = await postSlack(buildSlackPayload(sample), { webhookUrl });
      return res.status(result.sent ? 200 : 500).json({
        status: result.sent,
        ...result,
      });
    } catch (err) {
      logger.error(`[autopilot] /test-slack error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Slack test failed",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/test-email
   *
   * Send a sample Autopilot summary to the calling user's saved
   * `autopilotSettings.alerts.emailTo`. Bypasses the per-user throttle —
   * test sends are explicit user actions and shouldn't be silenced.
   */
  async testEmail(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = "Send a sample Autopilot summary to the calling user's saved email recipient."
    */
    try {
      const userId = req.user.user_id;
      const settingsDoc = await AutopilotSettings.findOne({ userId }).lean();
      const emailTo =
        settingsDoc && settingsDoc.alerts && settingsDoc.alerts.emailTo;
      const recipients = parseEmailRecipients(emailTo);
      if (!recipients.length) {
        return res.status(400).json({
          status: false,
          error:
            "No email address saved on your Autopilot settings. Add one (or up to 5, comma-separated) in Settings → Email and try again.",
        });
      }
      const sample = buildSampleSummary();
      const result = await sendEmail({
        to: recipients,
        subject: `AdsGPT Autopilot — sample cycle (test)`,
        text: buildPlainTextSummary(sample),
      });
      return res.status(result.sent ? 200 : 500).json({
        status: result.sent,
        to: recipients,
        ...result,
      });
    } catch (err) {
      logger.error(`[autopilot] /test-email error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Email test failed",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/test-telegram
   *
   * Post a sample Autopilot summary to the calling user's saved chat id
   * via the shared AdsGPT bot (token in env). Useful for verifying the
   * chat id is correct + that they actually added the bot to the group
   * before the first real cron tick. Bypasses the per-user throttle.
   *
   * Failure modes:
   *  - `AUTOPILOT_TELEGRAM_BOT_TOKEN` not set → 503 (ops/config issue, not
   *    the user's fault — surfaced separately from "you didn't fill in
   *    your chat id" so support can triage faster).
   *  - User hasn't saved a chat id yet → 400 with onboarding hint.
   *  - Telegram API returns `ok: false` (chat doesn't exist, bot not in
   *    group, etc.) → 500 with Telegram's `description` so the UI can
   *    surface the exact cause.
   */
  async testTelegram(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = "Send a sample Autopilot summary to the calling user's saved Telegram chat id (via the shared AdsGPT bot)."
    */
    try {
      const userId = req.user.user_id;
      const botToken = process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(503).json({
          status: false,
          error:
            "Telegram alerts aren't configured on this server. Ask your AdsGPT admin to set AUTOPILOT_TELEGRAM_BOT_TOKEN.",
        });
      }
      const settingsDoc = await AutopilotSettings.findOne({ userId }).lean();
      const chatId =
        settingsDoc && settingsDoc.alerts && settingsDoc.alerts.telegramChatId;
      if (!chatId) {
        return res.status(400).json({
          status: false,
          error:
            "No Telegram chat ID saved. Add @adsgpt_autopilot_bot to your group (or DM it) — the bot will greet you with the chat id. Paste that into Settings → Telegram.",
        });
      }
      const sample = buildSampleSummary();
      const result = await postTelegram({
        text: buildTelegramHtml(sample),
        botToken,
        chatId,
      });
      return res.status(result.sent ? 200 : 500).json({
        status: result.sent,
        chatId,
        ...result,
      });
    } catch (err) {
      logger.error(`[autopilot] /test-telegram error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Telegram test failed",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/rename-by-hook
   *
   * Propose (or apply) `[Hook] ...` renames for every active ad on the account.
   * Uses creative.body as the source. Video transcription (Phase 7b) is a
   * separate endpoint once the Python Whisper worker ships.
   */
  async renameByHook(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Propose (or apply) hook-based ad renames from creative body copy.'
    */
    try {
      const source = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
      const adAccountId = source.adAccountId;
      const dryRun = String(source.dryRun ?? "true").toLowerCase() !== "false";
      const prefix = source.prefix || "[Hook]";
      const maxChars = parseInt(source.maxChars || "80", 10) || 80;
      const limit = parseInt(source.limit || "500", 10) || 500;

      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }

      const userId = req.user.user_id;
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

      const result = await proposeHookRenamesForAccount({
        userId,
        adAccountId,
        accessToken: resolved.accessToken,
        dryRun,
        prefix,
        maxChars,
        limit,
      });
      return res.status(200).json({ status: true, ...result });
    } catch (err) {
      logger.error(`[autopilot] /rename-by-hook error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Hook rename failed",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/run-cycle
   *
   * Manually fire the full v4 user-rule orchestrator cycle scoped to the
   * caller. Same code path the hourly scheduler uses — useful for preview
   * runs before flipping AUTOPILOT_DRY_RUN=false in prod.
   *
   * v4 cutover note: previously this endpoint ran the v3 37-rule audit
   * pipeline. It now runs `runUserRuleCycle` (the v4 user-defined rules
   * orchestrator) so the on-demand "Run cycle" button in the UI evaluates
   * the same rules the cron does. The legacy v3 audit pipeline is still
   * reachable via POST /meta-ads/autopilot/audit/run if needed.
   *
   * Query:
   *   dryRun         default true (v4 orchestrator decides per-user)
   *   force          if 'true', bypass the Redis lock (use with care)
   */
  async runCycle(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Manually trigger one Autopilot v4 user-rule cycle scoped to the calling user.'
    */
    try {
      const source = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
      const force = String(source.force ?? "false").toLowerCase() === "true";
      const dryRun =
        String(source.dryRun ?? "true").toLowerCase() !== "false";

      const userId = req.user.user_id;

      // v4 orchestrator handles its own per-user enabled/dryRunGlobal gates
      // (see userRuleOrchestrator.js — settings.enabled=false skips the user
      // entirely). No need to pre-check here.
      const result = await runUserRuleCycle({
        dryRun,
        force,
        userIds: [userId],
      });
      return res.status(200).json({ status: true, ...result });
    } catch (err) {
      logger.error(`[autopilot] /run-cycle error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Autopilot cycle failed",
        details: err.message,
      });
    }
  }

  /**
   * POST /meta-ads/autopilot/run
   *
   * Query/body params:
   *   adAccountId     required — numeric or 'act_…'
   *   dryRun          default true; pass 'false' to actually pause
   *   severityFloor   default 'critical'; 'critical'|'warning'|'opportunity'
   *
   * Manual trigger for a single account. The hourly scheduler (Phase 3) will
   * call the underlying service directly, not through this endpoint.
   */
  async runNow(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Run Autopilot auto-pause for one ad account. Dry-run by default. Honours the caller\'s saved AutopilotSettings (severityFloor, dryRunGlobal, enabled).'
       #swagger.parameters['adAccountId'] = { description: 'Meta Ad Account ID', type: 'string', required: true }
       #swagger.parameters['dryRun'] = { description: 'When set to false, actually pause. Defaults from settings.dryRunGlobal (true if unset).', type: 'string' }
       #swagger.parameters['severityFloor'] = { description: 'critical|warning|opportunity. Defaults from settings.severityFloor.', type: 'string' }
    */
    try {
      const source = Object.keys(req.body || {}).length > 0 ? req.body : req.query;
      const adAccountId = source.adAccountId;

      if (!adAccountId) {
        return res.status(400).json({
          status: false,
          error: "adAccountId is required",
        });
      }

      const userId = req.user.user_id;

      // Phase 4 settings plumbing: caller-supplied query params still win
      // (so the UI's "Run dry-run" button keeps explicit control), but when
      // a param is absent we fall back to the user's saved preferences.
      const settings = await this._loadSettings(userId);
      const opts = resolveRunOptions(source, settings);
      const { dryRun, severityFloor, refusedDisabled, settingsApplied } = opts;

      // Master switch — refuse live runs when the user has not enabled
      // Autopilot. Dry-runs are still allowed so the user can preview before
      // flipping the switch.
      if (refusedDisabled) {
        return res.status(409).json({
          status: false,
          error:
            "Autopilot is disabled in your settings. Enable it from the Settings tab, or run with dryRun=true to preview.",
        });
      }

      // Token resolution: caller's per-user FB OAuth token from the
      // facebookUsers collection.
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

      const result = await autoPauseForAccount({
        userId,
        adAccountId,
        accessToken: resolved.accessToken,
        dryRun,
        severityFloor,
      });

      result.tokenSource = resolved.source;
      result.settingsApplied = settingsApplied;

      return res.status(200).json({ status: true, ...result });
    } catch (err) {
      logger.error(`[autopilot] /run error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Autopilot run failed",
        details: err.message,
      });
    }
  }

  /**
   * GET /meta-ads/autopilot/log
   *
   * Query params (all optional, combined with AND):
   *   adAccountId, runId, entityId, action, outcome
   *   from, to      ISO dates; filter on runAt
   *   page          default 1
   *   limit         default 20, max 100
   *
   * Scoped to the requesting user — cannot see other users' log rows.
   */
  async listLog(req, res) {
    /* #swagger.tags = ['Autopilot']
       #swagger.description = 'Paginated Autopilot action log for the current user.'
    */
    try {
      const userId = req.user.user_id;
      const {
        adAccountId,
        runId,
        entityId,
        action,
        outcome,
        from,
        to,
      } = req.query;

      const page = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
      // Cap raised from 100 → 1000 so a date-scoped action-log view (the UI
      // now requires a from/to range, defaulting to the current month) can
      // actually return every action in that range instead of silently
      // truncating after 100 rows. 1000 is well below any memory concern for
      // a single account+month and matches the FE's KPI-cards-over-full-range
      // model.
      const limit = Math.min(
        1000,
        Math.max(1, parseInt(req.query.limit || "20", 10) || 20),
      );

      const q = { userId };
      if (adAccountId) q.adAccountId = adAccountId;
      if (runId) q.runId = runId;
      if (entityId) q.entityId = entityId;
      if (action) q.action = action;
      if (outcome) q.outcome = outcome;
      if (from || to) {
        q.runAt = {};
        if (from) q.runAt.$gte = new Date(from);
        if (to) q.runAt.$lte = new Date(to);
      }

      const [rows, total] = await Promise.all([
        AutopilotActionLog.find(q)
          .sort({ runAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        AutopilotActionLog.countDocuments(q),
      ]);

      return res.status(200).json({
        status: true,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        rows,
      });
    } catch (err) {
      logger.error(`[autopilot] /log error: ${err.message}`);
      return res.status(500).json({
        status: false,
        error: "Failed to read autopilot log",
        details: err.message,
      });
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────
// Sample cycle summary used by both /test-slack and /test-email so the
// fixture stays in one place. Single account, dry-run shape, one of each
// counter populated so the formatter emits something meaningful.
function buildSampleSummary() {
  return {
    runId: "test-" + Date.now(),
    dryRun: true,
    severityFloor: "critical",
    durationMs: 1234,
    accounts: [
      {
        adAccountId: "act_test",
        name: "Test Account",
        ok: true,
        pause: {
          findings_count: 5,
          actionable_count: 2,
          paused: 0,
          would_pause: 2,
          failed: 0,
        },
        resume: {
          evaluated: 3,
          resumed: 0,
          would_resume: 1,
          skipped: 2,
          failed: 0,
        },
      },
    ],
  };
}

module.exports = new AutopilotController();
