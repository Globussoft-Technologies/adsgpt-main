import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_AGENTIC_URL;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// -----------------------------------------------------------------------------
// Non-streaming chat. Useful for fallback / tests; the UI prefers streamChat.
// -----------------------------------------------------------------------------
export const sendChat = async ({ sessionId, message, attachments, enabledTools }) => {
  const { data } = await axios.post(
    `${BASE_URL}/chat`,
    {
      session_id: sessionId || null,
      message,
      attachments: attachments || null,
      enabled_tools: enabledTools?.length ? enabledTools : null,
    },
    { headers: headers() },
  );
  return data?.response;
};

// -----------------------------------------------------------------------------
// SSE streaming chat. EventSource cannot send Authorization headers, so we use
// fetch + ReadableStream and parse the SSE protocol ourselves.
//
// Caller passes onEvent(event, data) for each parsed event:
//   - 'session'  → { session_id }
//   - 'step'     → { label }
//   - 'token'    → { delta }
//   - 'image'    → { url }
//   - 'choice_form' → { form_id, title, subtitle?, fields[], submit_label?, estimated_credits? }
//                    Renders an inline picker; on submit the UI fires a new
//                    turn with body.form_response = { form_id, values }.
//   - 'done'     → { message_id, session_id, completed_label }
//   - 'error'    → { detail, status? }
// Returns the AbortController so the caller can cancel mid-stream.
// -----------------------------------------------------------------------------
export const streamChat = ({
  sessionId,
  message,
  attachments,
  enabledTools,
  formResponse,
  conceptResponse,
  quote,
  onEvent,
}) => {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          ...headers(),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          session_id: sessionId || null,
          message,
          attachments: attachments || null,
          enabled_tools: enabledTools?.length ? enabledTools : null,
          // When a ChoiceForm is submitted, the UI replays it back as a turn —
          // the agent should treat `form_response` as authoritative for the
          // params it asked about and skip re-asking.
          form_response: formResponse || null,
          // A message/selection the user is replying to → { text, role, messageId }.
          // Maps to the backend QuoteItem (message_id). null when not replying.
          quote: quote
            ? { text: quote.text, role: quote.role || null, message_id: quote.messageId || null }
            : null,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        onEvent('error', { detail: err?.message || 'network error' });
      }
      return;
    }

    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.text();
        if (body) detail = body;
      } catch {
        /* swallow */
      }
      onEvent('error', { detail, status: res.status });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    // SSE event separator is a blank line — `\n\n`, `\r\n\r\n`, or mixed.
    // sse-starlette emits `\r\n\r\n` so a literal `\n\n` match misses every event.
    const EVENT_SEP = /\r?\n\r?\n/;
    const LINE_SEP = /\r?\n/;
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let m;
        while ((m = EVENT_SEP.exec(buffer)) !== null) {
          const block = buffer.slice(0, m.index);
          buffer = buffer.slice(m.index + m[0].length);
          if (!block.trim()) continue;

          let event = 'message';
          let data = '';
          for (const line of block.split(LINE_SEP)) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { raw: data };
          }
          onEvent(event, parsed);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        onEvent('error', { detail: err?.message || 'stream interrupted' });
      }
    }
  })();

  return controller;
};

// -----------------------------------------------------------------------------
// Conversation list / history (drives the optional HistoryDrawer).
// -----------------------------------------------------------------------------
export const listConversations = async () => {
  const { data } = await axios.get(`${BASE_URL}/me/conversations`, {
    headers: headers(),
  });
  return data;
};

export const getHistory = async (sessionId) => {
  const { data } = await axios.get(
    `${BASE_URL}/me/conversations/${encodeURIComponent(sessionId)}/history`,
    { headers: headers() },
  );
  return data;
};

export const deleteConversation = async (sessionId) => {
  const { data } = await axios.delete(
    `${BASE_URL}/me/conversations/${encodeURIComponent(sessionId)}`,
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// File upload — multipart, JWT-auth'd. Returns { url, file_type, ... }.
// -----------------------------------------------------------------------------
export const uploadFile = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await axios.post(`${BASE_URL}/upload`, fd, {
    headers: { ...headers(), 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

// -----------------------------------------------------------------------------
// Feedback — thumbs up/down on a specific assistant message.
// Backend also logs the event to Agentic_userActivity automatically.
// -----------------------------------------------------------------------------
export const sendFeedback = async ({ messageId, rating, comment = '' }) => {
  const { data } = await axios.post(
    `${BASE_URL}/feedback`,
    { message_id: messageId, rating, comment },
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Video pipeline — per-scene regenerate and final merge (bypasses the LLM
// for snappy UI interactions). Long-running — pass a generous timeout.
// -----------------------------------------------------------------------------
const VIDEO_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export const generateVideoScene = async ({
  prompt,
  duration = 6,
  model = 'veo-3.1-fast',
  aspectRatio = '16:9',
  sceneId = '',
}) => {
  const { data } = await axios.post(
    `${BASE_URL}/me/video/scene`,
    {
      prompt,
      duration,
      model,
      aspect_ratio: aspectRatio,
      scene_id: sceneId,
    },
    { headers: headers(), timeout: VIDEO_TIMEOUT_MS },
  );
  return data;
};

export const mergeVideoClips = async ({ clipUrls, outputFilename = '' }) => {
  const { data } = await axios.post(
    `${BASE_URL}/me/video/merge`,
    { clip_urls: clipUrls, output_filename: outputFilename },
    { headers: headers(), timeout: VIDEO_TIMEOUT_MS },
  );
  return data;
};

// -----------------------------------------------------------------------------
// User activity — fire-and-forget event log (copy / read / share / etc).
// For like/dislike use sendFeedback instead — it logs activity AND updates
// the message's feedback field server-side in one call.
// -----------------------------------------------------------------------------
export const logActivity = async ({
  action,
  messageId = null,
  conversationId = null,
  value = null,
  comment = '',
  metadata = null,
}) => {
  const { data } = await axios.post(
    `${BASE_URL}/me/activity`,
    {
      action,
      message_id: messageId,
      conversation_id: conversationId,
      value,
      comment,
      metadata,
    },
    { headers: headers() },
  );
  return data;
};
