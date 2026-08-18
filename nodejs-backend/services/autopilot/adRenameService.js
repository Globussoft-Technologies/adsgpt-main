/**
 * adRenameService — Phase 7a.
 *
 * Extract a "hook" (opening line / first sentence) from each active ad's
 * creative.body and propose a rename like `[Hook] <first-line>`. Optionally
 * apply the rename via Meta.
 *
 * Port of pipeboard/hook_rename.py. Phase 7b (Whisper video transcription)
 * is NOT in this service — that needs a Python worker.
 *
 * Always reads; only writes if dryRun=false.
 */

const { randomUUID } = require("node:crypto");

let _bizSdk;
let _AutopilotActionLog;
function bizSdk() {
  if (!_bizSdk) _bizSdk = require("facebook-nodejs-business-sdk");
  return _bizSdk;
}
function AutopilotActionLog() {
  if (!_AutopilotActionLog)
    _AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");
  return _AutopilotActionLog;
}
let _logger;
function getLogger() {
  if (_logger) return _logger;
  _logger = require("../../utils/logger");
  return _logger;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Extract a hook from ad creative body copy:
 *   1. First non-empty line.
 *   2. If >maxChars, try first sentence of that line.
 *   3. Still too long → word-boundary truncate + ellipsis.
 *
 * Matches the pipeboard python implementation (hook_rename.py:extract_hook).
 */
function extractHook(body, maxChars = 80) {
  if (!body || typeof body !== "string") return "";
  const firstLine = body.split("\n")[0].trim();
  if (!firstLine) return "";
  if (firstLine.length <= maxChars) return firstLine;

  // try first sentence
  const m = firstLine.split(/(?<=[.!?])\s+/);
  if (m[0] && m[0].length > 10 && m[0].length <= maxChars) return m[0];

  // hard-truncate on word boundary
  const cut = firstLine.slice(0, maxChars).replace(/\s\S*$/, "");
  return (cut || firstLine.slice(0, maxChars)) + "…";
}

/**
 * Assemble the proposed name. Returns empty string if no hook derivable,
 * so the caller can skip. Caps total length at maxTotal.
 */
function proposeName(hook, { prefix = "[Hook]", maxTotal = 120 } = {}) {
  if (!hook) return "";
  let name = `${prefix} ${hook}`.trim();
  if (name.length > maxTotal) name = name.slice(0, maxTotal - 1).trimEnd() + "…";
  return name;
}

// ---------------------------------------------------------------------------
// Meta write
// ---------------------------------------------------------------------------

async function renameAd({ adId, newName }) {
  const sdk = bizSdk();
  const ad = new sdk.Ad(adId);
  await ad.update([sdk.Ad.Fields.name], {
    [sdk.Ad.Fields.name]: newName,
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.adAccountId
 * @param {string} args.accessToken
 * @param {boolean} [args.dryRun=true]
 * @param {string}  [args.prefix='[Hook]']
 * @param {number}  [args.maxChars=80]       hook length cap
 * @param {number}  [args.maxTotal=120]      full name length cap
 * @param {number}  [args.limit]             max ads to process (safety)
 * @param {string}  [args.runId]
 */
async function proposeHookRenamesForAccount({
  userId,
  adAccountId: rawAdAccountId,
  accessToken,
  dryRun = true,
  prefix = "[Hook]",
  maxChars = 80,
  maxTotal = 120,
  limit = 500,
  runId,
} = {}) {
  if (!userId) throw new Error("userId is required");
  if (!rawAdAccountId) throw new Error("adAccountId is required");
  if (!accessToken) throw new Error("accessToken is required");

  // Canonical `act_<id>` shape on entry — see autoPauseService for rationale.
  const {
    effectiveDryRun,
    normalizeAdAccountId,
  } = require("../../config/autopilotConfig");
  const adAccountId = normalizeAdAccountId(rawAdAccountId);

  const logger = getLogger();
  const finalRunId = runId || randomUUID();
  const started = Date.now();
  const Log = AutopilotActionLog();

  // Safety gate — same as autoPauseService.
  const gated = effectiveDryRun({ adAccountId, requestedDryRun: dryRun });
  const finalDryRun = gated.dryRun;
  const safetyOverride = gated.forced;
  if (safetyOverride) {
    logger.info(
      `[autopilot] rename acct=${adAccountId} SAFETY OVERRIDE → forced dryRun=true`,
    );
  }

  const sdk = bizSdk();
  const api = sdk.FacebookAdsApi.init(accessToken);
  sdk.FacebookAdsApi.setDefaultApi(api);

  const acctKey = adAccountId.startsWith("act_")
    ? adAccountId
    : `act_${adAccountId}`;
  const account = new sdk.AdAccount(acctKey);

  // Pull the account name once so every log row carries it — without this
  // the Action log column renders `—` for rename rows because no audit
  // runs in this code path. One extra Meta call, paid once per cycle.
  let adAccountName = null;
  try {
    const meta = await account.read(["name"]);
    adAccountName = meta?._data?.name || meta?.name || null;
  } catch (err) {
    logger.warn(
      `[autopilot] rename: account name lookup failed for ${acctKey}: ${err.message}`,
    );
  }

  // Fetch ads with creative.body expanded. Matches hook_rename.py's query.
  const fields = [
    sdk.Ad.Fields.id,
    sdk.Ad.Fields.name,
    sdk.Ad.Fields.effective_status,
    sdk.Ad.Fields.created_time,
    "creative{id,body,title,thumbnail_url}",
  ];
  const ads = await account.getAds(fields, {
    effective_status: JSON.stringify(["ACTIVE"]),
    limit: Math.min(500, limit),
  });

  let processed = 0;
  let renamed = 0;
  let would_rename = 0;
  let failed = 0;
  let skipped_no_body = 0;
  let skipped_unchanged = 0;
  const actions = [];

  for (const ad of ads) {
    if (processed >= limit) break;
    const creative = ad._data.creative || {};
    const body = (creative.body || "").trim();
    if (!body) {
      skipped_no_body += 1;
      continue;
    }
    const hook = extractHook(body, maxChars);
    const proposed = proposeName(hook, { prefix, maxTotal });
    const current = ad._data.name || "";
    if (!proposed || proposed === current) {
      skipped_unchanged += 1;
      continue;
    }

    processed += 1;
    const attemptStart = Date.now();
    let outcome = "success";
    let error = null;
    if (!finalDryRun) {
      try {
        await renameAd({ adId: ad._data.id, newName: proposed });
      } catch (err) {
        outcome = "failed";
        error = err && err.message ? err.message : String(err);
        logger.error(
          `[autopilot] rename failed | ad=${ad._data.id}: ${error}`,
        );
      }
    }

    if (outcome === "success") {
      if (finalDryRun) would_rename += 1;
      else renamed += 1;
    } else failed += 1;

    try {
      await Log.create({
        runId: finalRunId,
        userId,
        adAccountId,
        adAccountName,
        level: "ad",
        entityId: ad._data.id,
        entityName: current,
        ruleId: "RENAME-HOOK-COPY",
        ruleSeverity: "opportunity",
        ruleMessage: `Rename by hook from creative.body`,
        action: "rename",
        actionPayload: {
          prev_name: current,
          proposed_name: proposed,
          hook,
          source: "creative.body",
        },
        dryRun: finalDryRun,
        outcome,
        error,
        metaApiLatencyMs: Date.now() - attemptStart,
        runAt: new Date(),
        pausedBy: "autopilot",
      });
    } catch (logErr) {
      logger.error(
        `[autopilot] rename log write failed: ${logErr.message}`,
      );
    }

    actions.push({
      adId: ad._data.id,
      prev_name: current,
      proposed_name: proposed,
      hook,
      outcome,
      ...(error ? { error } : {}),
    });
  }

  const durationMs = Date.now() - started;
  logger.info(
    `[autopilot] rename end | runId=${finalRunId} acct=${adAccountId} ` +
      `total_ads=${ads.length} proposed=${processed} renamed=${renamed} ` +
      `would_rename=${would_rename} failed=${failed} ` +
      `skipped_no_body=${skipped_no_body} skipped_unchanged=${skipped_unchanged} ` +
      `dur=${durationMs}ms`,
  );

  return {
    runId: finalRunId,
    adAccountId,
    dryRun: finalDryRun,
    total_ads_scanned: ads.length,
    proposed: processed,
    renamed,
    would_rename,
    failed,
    skipped_no_body,
    skipped_unchanged,
    actions,
    durationMs,
  };
}

module.exports = {
  proposeHookRenamesForAccount,
  // exported for tests
  extractHook,
  proposeName,
  _internals: { renameAd },
};
