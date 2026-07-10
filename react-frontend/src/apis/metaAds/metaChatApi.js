import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;
const CHAT_URL = `${BASE_URL}/adsgpt/meta-ads/chat`;

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// -----------------------------------------------------------------------------
// SSE streaming, same fetch + manual ReadableStream parsing as
// apis/aiAssistant/aiAssistantApi.js (EventSource can't send auth headers).
// Events: 'session' → { sessionId } | 'tool_call' → { name, args, auto } |
// 'tool_result' → { name } | 'tool_declined' → { name, args } |
// 'confirm_action' → { sessionId, toolName, args } | 'message' → { text } |
// 'done' → { sessionId } | 'error' → { detail }
// Returns the AbortController so the caller can cancel mid-stream.
// -----------------------------------------------------------------------------
const streamSse = (url, body, onEvent) => {
  const controller = new AbortController();

  (async () => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
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
        const text = await res.text();
        if (text) detail = text;
      } catch {
        /* swallow */
      }
      onEvent('error', { detail });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
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
    } finally {
      // Terminal signal for every close path (normal end, error, abort) so the
      // UI can always clear its streaming state even if 'done' never arrived.
      onEvent('end', {});
    }
  })();

  return controller;
};

export const streamChat = ({
  sessionId,
  adAccountId,
  currency,
  campaignId,
  adSetId,
  adId,
  message,
  onEvent,
}) =>
  streamSse(
    `${CHAT_URL}/stream`,
    {
      sessionId: sessionId || null,
      adAccountId,
      currency: currency || null,
      campaignId: campaignId || null,
      adSetId: adSetId || null,
      adId: adId || null,
      message,
    },
    onEvent,
  );

export const confirmAction = ({ sessionId, approve, onEvent }) =>
  streamSse(`${CHAT_URL}/confirm`, { sessionId, approve }, onEvent);

export const getChatHistory = async (sessionId) => {
  const { data } = await axios.get(`${CHAT_URL}/history/${encodeURIComponent(sessionId)}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const listChatSessions = async (adAccountId) => {
  const { data } = await axios.get(`${CHAT_URL}/sessions`, {
    headers: getAuthHeaders(),
    params: adAccountId ? { adAccountId } : undefined,
  });
  return data;
};
