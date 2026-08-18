/**
 * telegramBotService — inbound side of the shared Autopilot Telegram bot.
 *
 * `alertService.postTelegram` covers the OUTBOUND path (cycle summaries
 * → user chats). This file handles the INBOUND path: when someone runs
 * `/start` in a group (or adds the bot to one), we reply with the chat
 * id so they can paste it into AdsGPT Settings without scraping JSON
 * from `/getUpdates` or relying on third-party utility bots.
 *
 * Transport: webhook. On boot we `setWebhook` so Telegram POSTs every
 * update to a single endpoint (`/telegram/webhook`, mounted at app root
 * in index.js). Any worker can serve it, so this scales horizontally
 * (pm2 cluster, multiple replicas) with no 409-conflict — unlike polling,
 * which Telegram only allows from one process per token. We talk to the
 * Bot API with plain axios (mirroring alertService.postTelegram), so the
 * inbound path no longer depends on `node-telegram-bot-api` at all.
 *
 * Config (all read from env; absence is a clean no-op, not a crash):
 *   AUTOPILOT_TELEGRAM_BOT_TOKEN      shared bot token (also used outbound)
 *   AUTOPILOT_TELEGRAM_WEBHOOK_URL    public https URL of the webhook route
 *   AUTOPILOT_TELEGRAM_WEBHOOK_SECRET secret echoed by Telegram in the
 *                                     X-Telegram-Bot-Api-Secret-Token
 *                                     header; we verify it to reject spoofed
 *                                     callers. Strongly recommended.
 *
 * Update shapes we care about:
 *
 *   message.text === "/start" (in a group or DM)
 *   message.text === "/start@adsgpt_autopilot_bot"
 *     User wants the chat id. Reply with it.
 *
 *   message.new_chat_members contains our bot
 *     Bot just joined a group. Reply with the chat id unprompted —
 *     saves the user from even needing to type /start.
 *
 * Everything else is ignored.
 *
 * `planReplyForUpdate` is the PURE core (no I/O, no globals) — same
 * function would work behind a webhook too, just wired differently.
 * Unit tests live in test/autopilot/telegramBot.test.js.
 */

let _logger;
function logger() {
  if (_logger) return _logger;
  _logger = require("../../utils/logger");
  return _logger;
}

// Bot username (without leading @) used to detect "/start@<bot>" form
// in group chats. Configurable for tests + in case we ever rename.
const DEFAULT_BOT_USERNAME = "adsgpt_autopilot_bot";

/**
 * Decide what (if anything) to reply to an incoming Telegram update.
 * Returns `{ chatId, text }` or `null`. Pure — caller does the send.
 */
function planReplyForUpdate(update, { botUsername = DEFAULT_BOT_USERNAME } = {}) {
  if (!update || typeof update !== "object") return null;
  const msg = update.message;
  if (!msg || !msg.chat || msg.chat.id == null) return null;

  const chatId = msg.chat.id;
  const chatType = msg.chat.type; // 'private' | 'group' | 'supergroup' | 'channel'
  const chatTitle = msg.chat.title || "";

  // Case 1: bot was just added to a group → greet unprompted.
  const added = Array.isArray(msg.new_chat_members)
    ? msg.new_chat_members.find(
        (m) => ((m && m.username) || "").toLowerCase() === botUsername.toLowerCase(),
      )
    : null;
  if (added) {
    return {
      chatId,
      text: greetingMessage({ chatId, chatTitle, chatType }),
    };
  }

  // Case 2: /start command (with or without bot-handle suffix).
  const text = typeof msg.text === "string" ? msg.text.trim() : "";
  if (!text) return null;
  const normalized = text.toLowerCase();
  const isStart =
    normalized === "/start" ||
    normalized === `/start@${botUsername.toLowerCase()}`;
  if (isStart) {
    return {
      chatId,
      text: greetingMessage({ chatId, chatTitle, chatType }),
    };
  }

  return null;
}

/**
 * The actual reply text. Split out so tests + future template tweaks
 * don't have to scrape it from `planReplyForUpdate`.
 */
function greetingMessage({ chatId, chatTitle, chatType }) {
  const where =
    chatType === "private"
      ? "this DM"
      : chatTitle
        ? `the group "${chatTitle}"`
        : "this chat";
  // HTML parse_mode — matches how the cycle summaries are formatted,
  // and `<code>` makes the chat id click-to-copy on most Telegram clients.
  return [
    `<b>Hi! I'm the AdsGPT Autopilot bot.</b>`,
    ``,
    `Chat id for ${escapeHtml(where)}:`,
    `<code>${chatId}</code>`,
    ``,
    `Paste that number into AdsGPT → Autopilot → Settings → Telegram, then hit Test. I'll deliver every cycle summary here.`,
  ].join("\n");
}

const escapeHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// ─── transport: webhook ─────────────────────────────────────────────────────

const API_BASE = "https://api.telegram.org";

// Path the webhook route is mounted at (see index.js). Exported so the
// route wiring and any future setWebhook tooling share one source of truth.
const DEFAULT_WEBHOOK_PATH = "/telegram/webhook";

let _axios;
function axios() {
  if (!_axios) _axios = require("axios");
  return _axios;
}

/**
 * Send a single inbound reply (the /start chat-id greeting) via the Bot
 * API. Plain axios POST, mirroring alertService.postTelegram — the inbound
 * path no longer needs node-telegram-bot-api. Best-effort: returns a
 * `{ sent }` result and never throws, so a failed greeting can't bubble
 * into the webhook's HTTP response (which would make Telegram retry).
 */
async function sendTelegramMessage({
  chatId,
  text,
  token = process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN,
  timeoutMs = 10000,
} = {}) {
  if (!token) return { sent: false, reason: "no-token" };
  if (chatId == null) return { sent: false, reason: "no-chat-id" };
  try {
    const url = `${API_BASE}/bot${token}/sendMessage`;
    const r = await axios().post(
      url,
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      },
      { timeout: timeoutMs, validateStatus: () => true },
    );
    const body = r && r.data;
    if (r && r.status >= 200 && r.status < 300 && body && body.ok) {
      return { sent: true };
    }
    return {
      sent: false,
      reason: "api-error",
      error:
        (body && (body.description || body.error_code)) ||
        `HTTP ${r ? r.status : "?"}`,
    };
  } catch (err) {
    return {
      sent: false,
      reason: "post-failed",
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Process one inbound update: run the pure planReplyForUpdate core and
 * send the reply if there is one. Never throws — the webhook controller
 * relies on this so it can always 200 OK. Returns a small result object
 * for logging/tests.
 */
async function handleWebhookUpdate(update) {
  let reply;
  try {
    reply = planReplyForUpdate(update);
  } catch (err) {
    logger().error(
      `[autopilot telegram] planReplyForUpdate threw: ${err.message}`,
    );
    return { handled: false };
  }
  if (!reply) return { handled: false };

  const r = await sendTelegramMessage({ chatId: reply.chatId, text: reply.text });
  if (r.sent) {
    logger().info(
      `[autopilot telegram] /start handled for chat=${reply.chatId}`,
    );
  } else {
    logger().error(
      `[autopilot telegram] reply send failed for chat=${reply.chatId}: ${r.reason}${r.error ? " — " + r.error : ""}`,
    );
  }
  return { handled: true, ...r };
}

/**
 * Build the Express handler for the Telegram webhook. Mounted at app root
 * (see index.js). Unauthenticated except for Telegram's secret-token
 * header, which we verify against AUTOPILOT_TELEGRAM_WEBHOOK_SECRET.
 *
 * Acks with 200 immediately and processes the update out-of-band, so a
 * slow Bot API call can't make Telegram time out and redeliver.
 */
function createWebhookHandler({
  secret = process.env.AUTOPILOT_TELEGRAM_WEBHOOK_SECRET,
} = {}) {
  return function telegramWebhook(req, res) {
    // Telegram echoes the secret we registered via setWebhook in this
    // header. If we configured one, reject anything that doesn't match —
    // the endpoint is otherwise unauthenticated and publicly reachable.
    if (secret) {
      const got = req.get("X-Telegram-Bot-Api-Secret-Token");
      if (got !== secret) {
        logger().warn(
          "[autopilot telegram] webhook called with bad/missing secret token — rejected",
        );
        return res.sendStatus(401);
      }
    }
    // Ack first, work after. Failures are logged inside handleWebhookUpdate.
    res.sendStatus(200);
    Promise.resolve()
      .then(() => handleWebhookUpdate(req.body))
      .catch((err) =>
        logger().error(
          `[autopilot telegram] webhook processing error: ${err.message}`,
        ),
      );
  };
}

/**
 * Register the webhook with Telegram on boot. Idempotent — setWebhook with
 * an unchanged URL is a no-op on Telegram's side, so calling it every boot
 * is safe. No-op (logs and returns null) when the token or public URL is
 * absent, so the app keeps booting in environments where Telegram isn't
 * wired up. Outbound alert delivery is unaffected either way.
 */
async function registerWebhook({
  token = process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN,
  webhookUrl = process.env.AUTOPILOT_TELEGRAM_WEBHOOK_URL,
  secret = process.env.AUTOPILOT_TELEGRAM_WEBHOOK_SECRET,
} = {}) {
  if (!token) {
    logger().info(
      "[autopilot telegram] AUTOPILOT_TELEGRAM_BOT_TOKEN not set — skipping webhook registration (outbound alerts unaffected)",
    );
    return null;
  }
  if (!webhookUrl) {
    logger().info(
      "[autopilot telegram] AUTOPILOT_TELEGRAM_WEBHOOK_URL not set — skipping webhook registration (inbound /start auto-reply disabled; outbound alerts unaffected)",
    );
    return null;
  }
  try {
    const url = `${API_BASE}/bot${token}/setWebhook`;
    const payload = {
      url: webhookUrl,
      // We only act on plain messages (/start, group-join). Narrowing the
      // subscription keeps Telegram from POSTing edits, channel posts,
      // callback queries, etc. that planReplyForUpdate would just drop.
      allowed_updates: ["message"],
    };
    if (secret) payload.secret_token = secret;
    const r = await axios().post(url, payload, {
      timeout: 10000,
      validateStatus: () => true,
    });
    const body = r && r.data;
    if (r && r.status >= 200 && r.status < 300 && body && body.ok) {
      logger().info(
        `[autopilot telegram] webhook registered → ${webhookUrl}${
          secret
            ? " (secret-protected)"
            : " (no secret set — recommend AUTOPILOT_TELEGRAM_WEBHOOK_SECRET)"
        }`,
      );
      return { ok: true };
    }
    logger().error(
      `[autopilot telegram] setWebhook failed: ${
        (body && body.description) || `HTTP ${r ? r.status : "?"}`
      }`,
    );
    return { ok: false };
  } catch (err) {
    logger().error(`[autopilot telegram] setWebhook error: ${err.message}`);
    return { ok: false };
  }
}

module.exports = {
  planReplyForUpdate,
  sendTelegramMessage,
  handleWebhookUpdate,
  createWebhookHandler,
  registerWebhook,
  DEFAULT_WEBHOOK_PATH,
  // exported for tests
  _internals: { greetingMessage, escapeHtml, DEFAULT_BOT_USERNAME },
};
