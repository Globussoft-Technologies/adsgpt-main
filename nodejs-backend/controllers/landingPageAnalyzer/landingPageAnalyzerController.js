const mongoose = require("mongoose");
const axios = require("axios");
const LandingPageAnalysis = require("../../Module/landingPageAnalyzer/landingPageAnalysis");
const logger = require("../../utils/logger");
const s3Storage = require("../../storage/s3");

// Ensure the URL has a protocol so python doesn't choke on bare domains.
function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Derive the S3 object key from a screenshot_url, which may be relative
// ("/creatives/…") or absolute ("https://contents.adsgpt.io/creatives/…").
function s3KeyFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  return path.replace(/^\/+/, "") || null;
}

// ─── POST url ──────────────────────────────────────────────────────────────────
// FE pastes a URL → we create the analysis doc (status: pending), then hand the
// doc's _id to python as `sessionId` so every later webhook/event maps back here.
// Python replies instantly with an acknowledgment (not the result); on success we
// flip the doc to `processing` and tell FE the scan has started.
exports.createAnalysis = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer']
    #swagger.summary = 'Start (or relaunch) a landing-page analysis'
    #swagger.description = 'Creates or reuses the analysis doc for this URL, triggers the python scan, and returns the sessionId the FE opens the live result view with. Dedupes by (user, url).'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.requestBody = {
      required: true,
      content: { "application/json": { schema: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', example: 'https://adsgpt.io' },
          forceRefresh: { type: 'boolean', example: false, description: 'Relaunch only — adds X-Force-Refresh so python bypasses its 24h cache.' }
        }
      } } }
    }
  */
  let analysis;
  let isNew = false;
  try {
    const userId = req.user.user_id;
    const inputUrl = normalizeUrl(req.body?.url);
    // Relaunch sends forceRefresh:true so python bypasses its 24h URL cache.
    const forceRefresh =
      req.body?.forceRefresh === true || req.body?.forceRefresh === "true";

    if (!inputUrl) {
      return res.status(400).json({ success: false, error: "url is required" });
    }

    // 1. One doc per (user, url). Reuse any existing analysis for this URL so
    //    repeat submits never pile up duplicate documents.
    analysis = await LandingPageAnalysis.findOne({ userId, inputUrl });

    // A scan is already in flight for this URL — just hand back the same doc.
    // Don't re-trigger python or create anything new.
    if (
      analysis &&
      (analysis.status === "pending" || analysis.status === "processing")
    ) {
      return res.status(200).json({
        success: true,
        message: "Processing has started",
        data: { sessionId: analysis._id.toString(), status: analysis.status },
      });
    }

    // First time for this URL → create a fresh doc (safe to delete on failure).
    // Existing completed/failed doc → reuse it (re-scan keeps the same _id) and
    // clear its old result/event so the FE shows the analysing monitor (not the
    // stale dashboard) for this fresh run, even on a reload mid-scan.
    if (!analysis) {
      isNew = true;
      analysis = await LandingPageAnalysis.create({ userId, inputUrl });
    } else {
      analysis.result = null;
      analysis.lastEvent = null;
    }

    // 2. Kick off the scan, keyed by this doc's _id. Python acks instantly.
    //    On a relaunch we add X-Force-Refresh so python re-scans instead of
    //    returning its cached report.
    const { data } = await axios.post(
      process.env.LANDING_PAGE_SCAN_API,
      {
        url: inputUrl,
        userId,
        sessionId: analysis._id.toString(),
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(forceRefresh ? { "X-Force-Refresh": "true" } : {}),
        },
        timeout: 30000,
      },
    );

    // 3. Python rejected the scan but still replied 2xx (success:false in body).
    //    Delete only docs we just created — never wipe an existing one (it may
    //    still hold a prior good result). Forward python's own message/errorCode
    //    so the FE can show the real reason.
    if (!data?.success) {
      if (isNew) await analysis.deleteOne();
      return res.status(502).json({
        success: false,
        error: data?.message || "Scan could not be started",
        errorCode: data?.errorCode,
      });
    }

    // 4. Accepted — (re)set to processing. The webhook overwrites result later.
    analysis.status = "processing";
    await analysis.save();

    return res.status(200).json({
      success: true,
      message: "Processing has started",
      data: {
        sessionId: analysis._id.toString(),
        status: analysis.status,
      },
    });
  } catch (error) {
    // axios throws on any non-2xx from python (e.g. 422 ADULT_CONTENT). The real
    // reason lives on error.response.data — surface it so the FE shows python's
    // message instead of a generic 500.
    const py = error.response?.data;
    logger.error(
      `Error in createAnalysis: ${error.message} ${py ? JSON.stringify(py) : ""}`,
    );
    // Best-effort: only delete a doc WE created this request — never an existing one.
    if (isNew && analysis?._id) {
      try {
        await analysis.deleteOne();
      } catch (_) {}
    }
    // Python replied with a structured rejection (4xx/5xx) → forward its message.
    if (py) {
      return res.status(502).json({
        success: false,
        error: py.message || "Scan could not be started",
        errorCode: py.errorCode,
      });
    }
    // No response (timeout / unreachable / misconfigured URL) → true server error.
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

// ─── GET all (FE) ───────────────────────────────────────────────────────────────
// Lists the signed-in user's analyses, newest first. Lean — but includes just the
// screenshot + headline score from the (otherwise excluded) result blob so the
// cards can render a thumbnail + score. Use GET :id for the full report.
exports.getAnalyses = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer']
    #swagger.summary = 'List the user\'s analyses (paginated)'
    #swagger.description = 'Newest-first, lean projection (incl. screenshot + headline score) for the cards. Returns { data, page, limit, total, hasMore }.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.parameters['page'] = { in: 'query', schema: { type: 'integer', default: 1 } }
    #swagger.parameters['limit'] = { in: 'query', description: 'Max 50.', schema: { type: 'integer', default: 12 } }
  */
  try {
    const userId = req.user.user_id;
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit, 10) || 12));
    const skip = (page - 1) * limit;
    const filter = { userId };

    const [data, total] = await Promise.all([
      LandingPageAnalysis.find(filter)
        .select(
          "inputUrl status createdAt updatedAt result.screenshot_url result.overall"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      LandingPageAnalysis.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      page,
      limit,
      total,
      hasMore: skip + data.length < total,
    });
  } catch (error) {
    logger.error(`Error in getAnalyses: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

// ─── GET :id (FE) ─────────────────────────────────────────────────────────────────
// Returns one full analysis (incl. result + lastEvent). Scoped to the owner so a
// user can't read someone else's analysis by guessing an id.
exports.getAnalysisById = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer']
    #swagger.summary = 'Get one full analysis by id'
    #swagger.description = 'Returns the full doc (result + lastEvent), owner-scoped.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.parameters['id'] = { in: 'path', required: true, description: 'The analysis _id (sessionId).', schema: { type: 'string' } }
  */
  try {
    const userId = req.user.user_id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, error: "Valid id is required" });
    }

    const analysis = await LandingPageAnalysis.findOne({
      _id: id,
      userId,
    }).lean();
    if (!analysis) {
      return res
        .status(404)
        .json({ success: false, error: "Analysis not found" });
    }

    return res.status(200).json({ success: true, data: analysis });
  } catch (error) {
    logger.error(`Error in getAnalysisById: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

// ─── DELETE :id (FE) ──────────────────────────────────────────────────────────────
// Removes an analysis the user owns. Deletes the screenshot from S3 first
// (best-effort), then the doc.
exports.deleteAnalysis = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer']
    #swagger.summary = 'Delete an analysis'
    #swagger.description = 'Owner-scoped. Removes the screenshot from S3, then deletes the doc.'
    #swagger.security = [{ "BearerAuth": [] }]
    #swagger.parameters['id'] = { in: 'path', required: true, schema: { type: 'string' } }
  */
  try {
    const userId = req.user.user_id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, error: "Valid id is required" });
    }

    const analysis = await LandingPageAnalysis.findOne({ _id: id, userId });
    if (!analysis) {
      return res
        .status(404)
        .json({ success: false, error: "Analysis not found" });
    }

    // 1. Remove the captured screenshot from S3 (best-effort — never blocks).
    const key = s3KeyFromUrl(analysis.result?.screenshot_url);
    if (key) await s3Storage.deleteFromS3(key);

    // 2. Remove the doc.
    await analysis.deleteOne();

    return res.status(200).json({ success: true, message: "Analysis deleted" });
  } catch (error) {
    logger.error(`Error in deleteAnalysis: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

// ─── POST result (python webhook) ───────────────────────────────────────────────
// Python calls this once the scan finishes, posting the full report. It echoes the
// `sessionId` we handed it at scan time so we can map the report back to its doc.
// A failed scan (success:false OR a non-empty `error`) is DELETED — we don't keep
// broken analyses around. A clean success is stored and the doc flips to completed.
// Either way we notify the open FE so it can render the report or the error.
// No JWT — trusted by sessionId.
exports.saveResult = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer (Webhooks)']
    #swagger.summary = 'Python webhook — deliver the final report'
    #swagger.description = 'Called by python when the scan finishes. Stores the report on success; deletes the doc on failure (success:false or a non-empty error). Emits the result to the user socket room. Secured by the x-secret-key header (no JWT).'
    #swagger.requestBody = {
      required: true,
      content: { "application/json": { schema: {
        type: 'object',
        required: ['sessionId', 'success'],
        properties: {
          sessionId: { type: 'string', example: '6a2bf50327a6eb1005f0fb6f' },
          success: { type: 'boolean', example: true },
          error: { type: 'string', example: '' },
          url: { type: 'string', example: 'https://adsgpt.io' },
          screenshot_url: { type: 'string' },
          overall: { type: 'object' },
          dimensions: { type: 'array', items: { type: 'object' } },
          sections: { type: 'array', items: { type: 'object' } },
          technical_seo: { type: 'array', items: { type: 'object' } },
          performance: { type: 'object' },
          top_fixes: { type: 'array', items: { type: 'string' } }
        }
      } } }
    }
  */
  try {
    logger.info(`Request body of Python: ${JSON.stringify(req.body)}`);
    // Pull sessionId out — it's our routing key, not part of the stored report.
    const { sessionId, ...report } = req.body || {};

    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res
        .status(400)
        .json({ success: false, error: "Valid sessionId is required" });
    }

    const analysis = await LandingPageAnalysis.findById(sessionId);
    if (!analysis) {
      return res
        .status(404)
        .json({ success: false, error: "Analysis not found" });
    }

    const hasError =
      typeof report.error === "string" && report.error.trim() !== "";

    // Failed scan → delete the doc (no lingering broken entries). Still push the
    // failure to the open FE so it can show the error + offer a retry.
    if (report.success !== true || hasError) {
      const userId = analysis.userId;
      await analysis.deleteOne();
      if (global.io) {
        global.io.to(userId).emit("landingPageAnalysisEvent", {
          sessionId,
          result: report,
          type: "result",
        });
      }
      return res
        .status(200)
        .json({ success: true, message: "Failed analysis removed" });
    }

    // Success → store the report and mark completed.
    analysis.result = report;
    analysis.status = "completed";
    await analysis.save();

    if (global.io) {
      global.io.to(analysis.userId).emit("landingPageAnalysisEvent", {
        sessionId,
        result: analysis.result,
        type: "result",
      });
    }

    return res.status(200).json({ success: true, message: "Result saved" });
  } catch (error) {
    logger.error(`Error in saveResult: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};

// ─── POST event (python webhook · live progress) ────────────────────────────────
// While the scan is running, python streams progress here. It echoes `sessionId`
// and a `event` object describing the current step. We persist ONLY the event
// (→ lastEvent) so a page reload can resume, then push it to the FE viewing this
// analysis via the socket room keyed by sessionId. No JWT — trusted by sessionId.
exports.saveLiveEvent = async (req, res) => {
  /*
    #swagger.tags = ['Landing Page Analyzer (Webhooks)']
    #swagger.summary = 'Python webhook — stream a live progress event'
    #swagger.description = 'Called by python during the scan. Persists everything except sessionId into lastEvent and emits it to the user socket room. progress:-1 signals an error event. Secured by the x-secret-key header (no JWT).'
    #swagger.requestBody = {
      required: true,
      content: { "application/json": { schema: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string', example: '6a2bf50327a6eb1005f0fb6f' },
          event: { type: 'string', example: 'SCRAPING_START' },
          message: { type: 'string', example: 'Connecting to page...' },
          progress: { type: 'integer', example: 15 },
          image: { type: 'string', example: '' }
        }
      } } }
    }
  */
  try {
    // Pull sessionId out (routing key); everything else is the live event we store.

    logger.info(`Request body of live event: ${JSON.stringify(req.body)}`);
    const { sessionId, ...lastEvent } = req.body || {};



    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res
        .status(400)
        .json({ success: false, error: "Valid sessionId is required" });
    }

    // Persist just the latest event. Status stays "processing" — the final
    // completed/failed flip happens in saveResult.
    const analysis = await LandingPageAnalysis.findByIdAndUpdate(
      sessionId,
      { lastEvent },
      { new: true },
    );
    if (!analysis) {
      return res
        .status(404)
        .json({ success: false, error: "Analysis not found" });
    }

    // Push the latest event to any FE in this analysis's room (room = sessionId).
    if (global.io) {
      global.io.to(analysis.userId).emit("landingPageAnalysisEvent", {
        sessionId,
        lastEvent,
        type: "event",
      });
    }

    return res.status(200).json({ success: true, message: "Event received" });
  } catch (error) {
    logger.error(`Error in saveLiveEvent: ${error.message}`);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};
