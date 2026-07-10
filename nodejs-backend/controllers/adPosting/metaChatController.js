const { v4: uuidv4 } = require("uuid");

const MetaChatSession = require("../../Module/metaChat/metaChatSession");
const MetaChatAuditLog = require("../../Module/metaChat/metaChatAuditLog");
const { getAccessTokenForAccount } = require("../../config/autopilotConfig");
const { createMcpClient } = require("../../services/metaChat/mcpClient");
const {
  createChat,
  loadTools,
  sendAndProcess,
  resumeAfterConfirmation,
  trimHistory,
} = require("../../services/metaChat/geminiMcpBridge");
const logger = require("../../utils/logger");

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
  }));
  sendEvent(res, "confirm_action", {
    sessionId,
    actions,
    toolName: actions[0]?.toolName,
    args: actions[0]?.args,
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
      session.pendingAction = outcome.pendingAction;
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
    } else {
      session.history = trimHistory(outcome.history);
      session.pendingAction = null;
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
            transcript: transcript.slice(-MAX_TRANSCRIPT_ENTRIES),
          },
        }
      );
      emitConfirm(res, sessionId, outcome.pendingAction);
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
      pendingAction: session.pendingAction,
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
