const { v4: uuidv4 } = require("uuid");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

const MetaChatSession = require("../../Module/metaChat/metaChatSession");
const MetaChatAuditLog = require("../../Module/metaChat/metaChatAuditLog");
const { getAccessTokenForAccount } = require("../../config/autopilotConfig");
const { createMcpClient } = require("../../services/metaChat/mcpClient");
const { s3Client } = require("../../storage/s3");
const {
  createChat,
  loadTools,
  sendAndProcess,
  resumeAfterConfirmation,
  resumeAfterMediaPick,
  trimHistory,
} = require("../../services/metaChat/geminiMcpBridge");
const logger = require("../../utils/logger");

// Public host that serves objects written to app storage (same host the media
// library's URLs resolve against — see react-frontend VITE_S3_BASE_URL). The
// creative-media upload endpoint returns absolute URLs anchored here so the
// Meta MCP tools (ads_upload_ad_image / ads_create_ad_creative) can fetch them.
// Read lazily (not at module load) to avoid any dotenv-ordering fragility —
// same hardening as mcpClient.js's lazy env reads.
const mediaViewBase = () => (process.env.AWS_IMAGE_VIEW_URL || "").replace(/\/$/, "");

const CHAT_MEDIA_MIME = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "video/quicktime": { ext: "mov", kind: "video" },
  "video/webm": { ext: "webm", kind: "video" },
};
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024; // matches Meta's image cap
const MAX_CHAT_VIDEO_BYTES = 100 * 1024 * 1024; // practical web-upload cap

// Independent of trimHistory's turn cap on the raw Gemini history — this
// bounds the frontend-shaped transcript the same way (2 entries per turn:
// one user, one assistant), so a very long-lived session's doc size stays
// bounded even though the two arrays are trimmed by different rules.
const MAX_TRANSCRIPT_ENTRIES = 200;

function openSse(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Stop nginx (and similar reverse proxies) from buffering the stream, which
  // would otherwise hold events until the response closes and defeat SSE.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  // A client that navigates away mid-turn destroys the socket; without a
  // listener a late write's 'error' would go unhandled and crash the process.
  res.on("error", () => {});
}

function sendEvent(res, event, data) {
  // The turn's async loop keeps running after the client disconnects; skip
  // writes once the response is no longer writable rather than throwing.
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Emit the confirmation card. `actions` lists every write call in the paused
// batch (usually one); `toolName`/`args` mirror the first for single-action
// consumers. The user's approve/cancel decision applies to the whole batch.
function emitConfirm(res, sessionId, pendingAction) {
  const actions = (pendingAction.calls || []).map((c) => ({
    toolName: c.name,
    args: c.args,
    displayName: c.displayName,
  }));
  sendEvent(res, "confirm_action", {
    sessionId,
    actions,
    toolName: actions[0]?.toolName,
    args: actions[0]?.args,
  });
}

// A delete-campaign tool call deliberately accepts only an immutable campaign
// ID, so its raw arguments do not carry the human-readable name needed by the
// confirmation UI. Fetch it immediately before displaying the card. This is a
// best-effort read: a lookup failure must never block a user from reviewing or
// cancelling a pending action, and the card still shows the exact ID.
function campaignNameFromToolResult(result) {
  for (const part of result?.content || []) {
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    try {
      const parsed = JSON.parse(part.text);
      if (typeof parsed?.name === "string" && parsed.name.trim()) return parsed.name.trim();
    } catch {
      const match = part.text.match(/^Campaign:\s*(.+)$/m);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return null;
}

async function addPendingActionDisplayNames(pendingAction, mcpClient) {
  const calls = pendingAction?.calls || [];
  await Promise.all(
    calls.map(async (call) => {
      if (call.name !== "ads_delete_campaign" || !call.args?.campaign_id || call.displayName) return;
      try {
        const result = await mcpClient.callTool({
          name: "ads_get_campaign_details",
          arguments: { campaign_id: call.args.campaign_id, fields: ["id", "name"] },
        });
        call.displayName = campaignNameFromToolResult(result);
      } catch (err) {
        logger.warn(`metaChat campaign-name lookup failed: ${err.message}`);
      }
    })
  );
  return pendingAction;
}

// Emit the media-picker card. Only the slim {mediaType, purpose} is sent to
// the client — the rest of pendingInput (carried tool responses, raw Gemini
// history) is an internal resume detail the UI never needs.
function emitPickMedia(res, sessionId, pendingInput) {
  const args = pendingInput?.inputCall?.args || {};
  sendEvent(res, "pick_media", {
    sessionId,
    mediaType: args.media_type === "video" ? "video" : "image",
    purpose: args.purpose || null,
  });
}

async function logToolExecution({
  sessionId,
  userId,
  adAccountId,
  name,
  args,
  readOnly,
  outcome,
  result,
  error,
  confirmedBy,
}) {
  try {
    await MetaChatAuditLog.create({
      sessionId,
      userId,
      adAccountId,
      toolName: name,
      toolArgs: args,
      readOnly,
      outcome,
      result,
      error,
      confirmedBy: confirmedBy || null,
      confirmedAt: confirmedBy ? new Date() : null,
    });
  } catch (err) {
    logger.error(`metaChat audit log write failed: ${err.message}`);
  }
}

// `cards`, if passed, collects every card payload emitted this turn (in
// addition to forwarding it over SSE as usual) so the caller can persist it
// into the session's transcript for later resume — the SSE stream itself is
// not replayable once the response closes.
function makeOnEvent({ res, sessionId, userId, adAccountId, confirmedBy, cards }) {
  return (type, data) => {
    if (type === "token") {
      sendEvent(res, "token", { delta: data.delta });
      return;
    }
    if (type === "card") {
      sendEvent(res, "card", data);
      cards?.push(data);
      return;
    }
    if (type === "tool_call") {
      sendEvent(res, "tool_call", { name: data.name, auto: data.auto });
      return;
    }
    if (type === "tool_result") {
      sendEvent(res, "tool_result", { name: data.name });
      logToolExecution({
        sessionId,
        userId,
        adAccountId,
        name: data.name,
        args: data.args,
        readOnly: data.auto !== false,
        outcome: "success",
        result: data.result,
        confirmedBy: data.auto === false ? confirmedBy : null,
      });
      return;
    }
    if (type === "tool_declined") {
      sendEvent(res, "tool_declined", { name: data.name });
      logToolExecution({
        sessionId,
        userId,
        adAccountId,
        name: data.name,
        args: data.args,
        readOnly: false,
        outcome: "declined",
        confirmedBy,
      });
    }
  };
}

/**
 * POST /meta-ads/chat/stream
 * Body: { sessionId?: string, adAccountId: string, message: string }
 * Starts a new session (if sessionId is omitted) or continues an existing
 * one, streaming progress over SSE until the turn finishes or pauses for a
 * write-tool confirmation.
 */
exports.streamChat = async (req, res) => {
  const userId = req.user.user_id;
  const { adAccountId, message, currency, campaignId, adSetId, adId } = req.body || {};
  let { sessionId } = req.body || {};

  if (!adAccountId || !message) {
    res.status(400).json({ error: "adAccountId and message are required." });
    return;
  }

  openSse(res);
  sendEvent(res, "session", { sessionId: sessionId || null });

  let mcpClient;
  try {
    const { accessToken } = await getAccessTokenForAccount({
      adAccountId,
      callerUserId: userId,
    });

    let session = sessionId
      ? await MetaChatSession.findOne({ sessionId, userId })
      : null;

    if (!session) {
      sessionId = uuidv4();
      session = await MetaChatSession.create({
        sessionId,
        userId,
        adAccountId,
        currency,
        campaignId: campaignId || null,
        adSetId: adSetId || null,
        adId: adId || null,
        history: [],
      });
      sendEvent(res, "session", { sessionId });
    } else {
      // Scope is resent on every turn from the dashboard's current URL state
      // (see MetaAdsChatPanel), so it stays in sync as the user drills
      // around underneath an open chat without starting a new conversation.
      session.campaignId = campaignId || null;
      session.adSetId = adSetId || null;
      session.adId = adId || null;
    }

    if (session.pendingAction) {
      sendEvent(res, "error", {
        detail:
          "This session has a write action awaiting confirmation. Confirm or cancel it before sending a new message.",
      });
      res.end();
      return;
    }

    if (session.pendingInput) {
      sendEvent(res, "error", {
        detail:
          "This session is waiting for you to choose creative media. Pick or cancel it before sending a new message.",
      });
      res.end();
      return;
    }

    mcpClient = await createMcpClient(accessToken);
    const { toolMap, functionDeclarations, localHandlers } = await loadTools(mcpClient);
    const scope = { campaignId: session.campaignId, adSetId: session.adSetId, adId: session.adId };
    const chat = createChat({
      adAccountId,
      currency: session.currency,
      scope,
      history: session.history,
      functionDeclarations,
    });

    const turnCards = [];
    const onEvent = makeOnEvent({ res, sessionId, userId, adAccountId, cards: turnCards });
    const ctx = { onEvent, mcpClient, localHandlers, userId, adAccountId, accessToken, sessionId };
    const outcome = await sendAndProcess({ chat, toolMap, message, ctx });

    session.transcript.push({ role: "user", text: message, ts: Date.now() });

    if (outcome.status === "pending_confirmation") {
      await addPendingActionDisplayNames(outcome.pendingAction, mcpClient);
      session.pendingAction = outcome.pendingAction;
      session.pendingInput = null;
      if (outcome.text || turnCards.length) {
        session.transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      session.transcript = session.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
      await session.save();
      emitConfirm(res, sessionId, outcome.pendingAction);
    } else if (outcome.status === "pending_input") {
      session.pendingInput = outcome.pendingInput;
      session.pendingAction = null;
      if (outcome.text || turnCards.length) {
        session.transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      session.transcript = session.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
      await session.save();
      emitPickMedia(res, sessionId, outcome.pendingInput);
    } else {
      session.history = trimHistory(outcome.history);
      session.pendingAction = null;
      session.pendingInput = null;
      session.transcript.push({
        role: "assistant",
        text: outcome.text,
        cards: turnCards,
        ts: Date.now(),
      });
      session.transcript = session.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
      await session.save();
      sendEvent(res, "message", { text: outcome.text });
    }

    sendEvent(res, "done", { sessionId });
    res.end();
  } catch (err) {
    logger.error(`metaChat streamChat failed: ${err.message}`);
    sendEvent(res, "error", { detail: err.message });
    res.end();
  } finally {
    if (mcpClient) await mcpClient.close().catch(() => {});
  }
};

/**
 * POST /meta-ads/chat/confirm
 * Body: { sessionId: string, approve: boolean }
 * Resumes a session paused on a write-tool confirmation card.
 *
 * The pending action is claimed atomically (findOneAndUpdate clears it) BEFORE
 * the write runs, so a double-clicked / retried / two-tab confirm can't
 * execute the same write twice, and a failure can't leave the session wedged
 * awaiting a confirmation that will never resolve.
 */
exports.confirmAction = async (req, res) => {
  const userId = req.user.user_id;
  const { sessionId, approve } = req.body || {};

  if (!sessionId || typeof approve !== "boolean") {
    res.status(400).json({ error: "sessionId and approve (boolean) are required." });
    return;
  }

  openSse(res);

  let mcpClient;
  let claimedAction = null;
  let adAccountId = null;
  try {
    const existing = await MetaChatSession.findOne({ sessionId, userId });
    if (!existing || !existing.pendingAction) {
      sendEvent(res, "error", { detail: "No pending action for this session." });
      res.end();
      return;
    }
    adAccountId = existing.adAccountId;

    // Resolve the token BEFORE claiming, so a token failure leaves the pending
    // action intact for a later retry rather than silently dropping it.
    const { accessToken } = await getAccessTokenForAccount({
      adAccountId,
      callerUserId: userId,
    });

    // Atomic claim: only the request that flips pendingAction from set→null
    // proceeds; a concurrent confirm gets no document and bails out.
    const claimed = await MetaChatSession.findOneAndUpdate(
      { sessionId, userId, pendingAction: { $ne: null } },
      { $set: { pendingAction: null } },
      { new: false }
    );
    if (!claimed || !claimed.pendingAction) {
      sendEvent(res, "error", {
        detail: "This action is already being processed or was already resolved.",
      });
      res.end();
      return;
    }
    claimedAction = claimed.pendingAction;

    mcpClient = await createMcpClient(accessToken);
    const { toolMap, functionDeclarations, localHandlers } = await loadTools(mcpClient);

    const turnCards = [];
    const onEvent = makeOnEvent({
      res,
      sessionId,
      userId,
      adAccountId,
      confirmedBy: userId,
      cards: turnCards,
    });

    const ctx = { onEvent, mcpClient, localHandlers, userId, adAccountId, accessToken, sessionId };
    const outcome = await resumeAfterConfirmation({
      toolMap,
      functionDeclarations,
      adAccountId,
      currency: existing.currency,
      scope: {
        campaignId: existing.campaignId,
        adSetId: existing.adSetId,
        adId: existing.adId,
      },
      pendingAction: claimedAction,
      approved: approve,
      ctx,
    });

    // No new "user" transcript entry here — approve/cancel isn't a chat
    // message, it's a decision on the turn already recorded by streamChat.
    // Re-fetch so we append to (rather than overwrite) transcript entries
    // written concurrently since the atomic claim above.
    const forTranscript = await MetaChatSession.findOne({ sessionId, userId }).select("transcript");
    const transcript = forTranscript?.transcript || [];

    if (outcome.status === "pending_confirmation") {
      await addPendingActionDisplayNames(outcome.pendingAction, mcpClient);
      if (outcome.text || turnCards.length) {
        transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            pendingAction: outcome.pendingAction,
            pendingInput: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      emitConfirm(res, sessionId, outcome.pendingAction);
    } else if (outcome.status === "pending_input") {
      if (outcome.text || turnCards.length) {
        transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            pendingInput: outcome.pendingInput,
            pendingAction: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      emitPickMedia(res, sessionId, outcome.pendingInput);
    } else {
      transcript.push({
        role: "assistant",
        text: outcome.text,
        cards: turnCards,
        ts: Date.now(),
      });
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            history: trimHistory(outcome.history),
            pendingAction: null,
            pendingInput: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      sendEvent(res, "message", { text: outcome.text });
    }

    sendEvent(res, "done", { sessionId });
    res.end();
  } catch (err) {
    logger.error(`metaChat confirmAction failed: ${err.message}`);
    // The action was already claimed (pendingAction cleared), so the session
    // is not wedged. Record the failure so a confirmed-but-failed write is
    // auditable rather than silently lost.
    if (claimedAction && approve) {
      for (const call of claimedAction.calls || []) {
        await logToolExecution({
          sessionId,
          userId,
          adAccountId,
          name: call.name,
          args: call.args,
          readOnly: false,
          outcome: "failed",
          error: err.message,
          confirmedBy: userId,
        });
      }
    }
    sendEvent(res, "error", { detail: err.message });
    res.end();
  } finally {
    if (mcpClient) await mcpClient.close().catch(() => {});
  }
};

/**
 * POST /meta-ads/chat/media-pick
 * Body: { sessionId, url?, mediaType?, cancel? }
 * Resumes a session paused on a media-picker (pick_creative_media). The chosen
 * media's public URL (or a cancellation) is fed back to the model as the
 * picker call's function-response; the model then typically proceeds to build
 * the creative, which surfaces as a normal write-confirmation.
 *
 * Mirrors confirmAction's atomic-claim pattern: pendingInput is flipped
 * set→null by exactly one request, so a double-submit / two-tab pick can't
 * resume the same turn twice or wedge the session.
 */
exports.pickMedia = async (req, res) => {
  const userId = req.user.user_id;
  const { sessionId, url, mediaType, cancel } = req.body || {};

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const cancelled = cancel === true;
  if (!cancelled) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url) || url.length > 2048) {
      res.status(400).json({ error: "A valid media url (or cancel:true) is required." });
      return;
    }
    if (mediaType !== "image" && mediaType !== "video") {
      res.status(400).json({ error: "mediaType must be 'image' or 'video'." });
      return;
    }
  }

  openSse(res);

  let mcpClient;
  try {
    const existing = await MetaChatSession.findOne({ sessionId, userId });
    if (!existing || !existing.pendingInput) {
      sendEvent(res, "error", { detail: "No pending media selection for this session." });
      res.end();
      return;
    }
    const adAccountId = existing.adAccountId;

    // Resolve the token BEFORE claiming, so a token failure leaves the pending
    // input intact for a later retry rather than silently dropping it.
    const { accessToken } = await getAccessTokenForAccount({
      adAccountId,
      callerUserId: userId,
    });

    // Atomic claim: only the request that flips pendingInput set→null proceeds.
    const claimed = await MetaChatSession.findOneAndUpdate(
      { sessionId, userId, pendingInput: { $ne: null } },
      { $set: { pendingInput: null } },
      { new: false }
    );
    if (!claimed || !claimed.pendingInput) {
      sendEvent(res, "error", {
        detail: "This media selection is already being processed or was already resolved.",
      });
      res.end();
      return;
    }
    const claimedInput = claimed.pendingInput;

    mcpClient = await createMcpClient(accessToken);
    const { toolMap, functionDeclarations, localHandlers } = await loadTools(mcpClient);

    const turnCards = [];
    const onEvent = makeOnEvent({
      res,
      sessionId,
      userId,
      adAccountId,
      confirmedBy: userId,
      cards: turnCards,
    });

    const ctx = { onEvent, mcpClient, localHandlers, userId, adAccountId, accessToken, sessionId };
    const outcome = await resumeAfterMediaPick({
      toolMap,
      functionDeclarations,
      adAccountId,
      currency: existing.currency,
      scope: {
        campaignId: existing.campaignId,
        adSetId: existing.adSetId,
        adId: existing.adId,
      },
      pendingInput: claimedInput,
      mediaUrl: cancelled ? null : url,
      mediaType: cancelled ? null : mediaType,
      ctx,
    });

    // Re-fetch so we append to (rather than overwrite) transcript entries
    // written concurrently since the atomic claim above. No new "user" entry —
    // picking media, like approve/cancel, is a decision on the turn already
    // recorded by streamChat, not a chat message.
    const forTranscript = await MetaChatSession.findOne({ sessionId, userId }).select("transcript");
    const transcript = forTranscript?.transcript || [];

    if (outcome.status === "pending_confirmation") {
      await addPendingActionDisplayNames(outcome.pendingAction, mcpClient);
      if (outcome.text || turnCards.length) {
        transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            pendingAction: outcome.pendingAction,
            pendingInput: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      emitConfirm(res, sessionId, outcome.pendingAction);
    } else if (outcome.status === "pending_input") {
      if (outcome.text || turnCards.length) {
        transcript.push({
          role: "assistant",
          text: outcome.text || "",
          cards: turnCards,
          pending: true,
          ts: Date.now(),
        });
      }
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            pendingInput: outcome.pendingInput,
            pendingAction: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      emitPickMedia(res, sessionId, outcome.pendingInput);
    } else {
      transcript.push({
        role: "assistant",
        text: outcome.text,
        cards: turnCards,
        ts: Date.now(),
      });
      await MetaChatSession.updateOne(
        { sessionId, userId },
        {
          $set: {
            history: trimHistory(outcome.history),
            pendingAction: null,
            pendingInput: null,
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      sendEvent(res, "message", { text: outcome.text });
    }

    sendEvent(res, "done", { sessionId });
    res.end();
  } catch (err) {
    logger.error(`metaChat pickMedia failed: ${err.message}`);
    // pendingInput was already claimed (cleared), so the session isn't wedged —
    // the user can simply re-ask. Surface the failure.
    sendEvent(res, "error", { detail: err.message });
    res.end();
  } finally {
    if (mcpClient) await mcpClient.close().catch(() => {});
  }
};

/**
 * POST /meta-ads/chat/media/upload  (multipart: field "file")
 * Stores a user-uploaded image/video in app storage and returns its public
 * URL. This is PURE app storage — it never touches Meta. The model still does
 * the Meta-side upload itself via the MCP tools (ads_upload_ad_image /
 * ads_upload_ad_video / ads_create_ad_creative), which fetch this public URL.
 */
exports.uploadCreativeMedia = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const file = req.file;
    if (!file || !file.buffer?.length) {
      return res.status(400).json({ error: "No file uploaded (field name must be 'file')." });
    }

    const spec = CHAT_MEDIA_MIME[file.mimetype];
    if (!spec) {
      return res.status(400).json({
        error: "Unsupported file type. Use JPG, PNG, WEBP, GIF (image) or MP4, MOV, WEBM (video).",
      });
    }
    const maxBytes = spec.kind === "video" ? MAX_CHAT_VIDEO_BYTES : MAX_CHAT_IMAGE_BYTES;
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      return res.status(400).json({ error: `File too large. Max ${maxMb} MB for ${spec.kind}s.` });
    }

    if (process.env.UPLOAD_TO_S3 !== "true") {
      return res
        .status(500)
        .json({ error: "Media upload is not configured on this server (UPLOAD_TO_S3)." });
    }
    const viewBase = mediaViewBase();
    if (!viewBase) {
      return res.status(500).json({ error: "Media view host is not configured (AWS_IMAGE_VIEW_URL)." });
    }

    const key = `creatives/${userId}/chat/${Date.now()}-${uuidv4()}.${spec.ext}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    return res.json({ url: `${viewBase}/${key}`, mediaType: spec.kind });
  } catch (err) {
    logger.error(`metaChat uploadCreativeMedia failed: ${err.message}`);
    return res.status(500).json({ error: "Failed to upload media." });
  }
};

/**
 * GET /meta-ads/chat/history/:sessionId
 */
exports.getHistory = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { sessionId } = req.params;

    const session = await MetaChatSession.findOne({ sessionId, userId });
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    res.json({
      sessionId: session.sessionId,
      adAccountId: session.adAccountId,
      currency: session.currency,
      campaignId: session.campaignId,
      adSetId: session.adSetId,
      adId: session.adId,
      // `transcript` is what the frontend renders on resume — the
      // frontend-shaped {role, text, cards, ts} record of the conversation.
      // `history` (raw Gemini Content[]) is intentionally NOT returned here;
      // it's an internal rehydration detail for the model, not a UI concern.
      transcript: session.transcript,
      // Slim shapes only — the frontend needs the pending write's tool
      // name+args to render the confirmation card, and the media pick's
      // type+purpose to render the picker. The rest of each pending object
      // (carried tool responses, raw Gemini history) is an internal resume
      // detail the UI never reads, so it's kept off the wire.
      pendingAction: session.pendingAction
        ? {
            calls: (session.pendingAction.calls || []).map((c) => ({
              name: c.name,
              args: c.args,
              displayName: c.displayName,
            })),
          }
        : null,
      pendingInput: session.pendingInput
        ? {
            mediaType:
              session.pendingInput.inputCall?.args?.media_type === "video"
                ? "video"
                : "image",
            purpose: session.pendingInput.inputCall?.args?.purpose || null,
          }
        : null,
      updatedAt: session.updatedAt,
    });
  } catch (err) {
    logger.error(`metaChat getHistory failed: ${err.message}`);
    res.status(500).json({ error: "Failed to load chat history." });
  }
};

/**
 * GET /meta-ads/chat/sessions?adAccountId=...
 * Optionally scoped to one ad account — the chat widget only ever wants
 * "past sessions for the account I have open right now".
 */
exports.listSessions = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { adAccountId } = req.query || {};
    // 'transcript.0': { $exists: true } excludes sessions with nothing to show —
    // notably every session created before the transcript field existed. Those
    // still have a `history` (raw Gemini Content[]) but no frontend-shaped
    // record, so resuming them would silently render a blank chat.
    const filter = {
      userId,
      "transcript.0": { $exists: true },
      ...(adAccountId ? { adAccountId } : {}),
    };

    const sessions = await MetaChatSession.find(filter)
      .sort({ updatedAt: -1 })
      .select("sessionId adAccountId updatedAt createdAt transcript")
      .limit(50);

    res.json({
      sessions: sessions.map((s) => {
        const firstUserTurn = (s.transcript || []).find((t) => t.role === "user");
        return {
          sessionId: s.sessionId,
          adAccountId: s.adAccountId,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          preview: firstUserTurn?.text?.slice(0, 80) || null,
        };
      }),
    });
  } catch (err) {
    logger.error(`metaChat listSessions failed: ${err.message}`);
    res.status(500).json({ error: "Failed to list chat sessions." });
  }
};
