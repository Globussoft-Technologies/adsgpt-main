/**
 * telegramBotService — inbound side of the shared Autopilot Telegram bot.
 *
 * `alertService.postTelegram` covers the OUTBOUND path (cycle summaries
 * → user chats). This file handles the INBOUND path: when someone runs
 * `/start` in a group (or adds the bot to one), we reply with the chat
 * id so they can paste it into AdsGPT Settings without scraping JSON
 * from `/getUpdates` or relying on third-party utility bots.
 *
 * Transport: long-polling via `node-telegram-bot-api`. Polling is the
 * right call for our single-process `node index.js` deployment — no
 * public URL or setWebhook dance needed. If we ever scale horizontally
 * (pm2 cluster mode, multiple replicas, etc.) ONE thing changes:
 * Telegram only allows a single active poller per bot token, so the
 * other workers would 409-conflict forever. At that point switch to
 * webhook mode (Telegram POSTs to a single endpoint, any worker can
 * handle it) — the `planReplyForUpdate` core stays unchanged.
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
  try {
    _logger = require("../../utils/logger");
  } catch {
    _logger = console;
  }
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

// ─── transport: polling ────────────────────────────────────────────────────

// One bot per Node process. Re-initializing would double-poll the same
// token and Telegram would 409-conflict the second connection.
let _bot = null;

/**
 * Boot the polling bot. Idempotent — calling twice is a no-op.
 * Reads `AUTOPILOT_TELEGRAM_BOT_TOKEN` from env. If unset, logs and
 * returns null without throwing — the rest of the app must keep
 * booting even if Telegram is misconfigured.
 *
 * Returns the live `TelegramBot` instance (or the existing one on
 * subsequent calls), `null` if env wasn't set.
 */
function startTelegramBot() {
  if (_bot) return _bot;

  const token = process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger().info(
      "[autopilot telegram] AUTOPILOT_TELEGRAM_BOT_TOKEN not set — skipping bot startup (alerts still work for setups that don't need /start auto-reply)",
    );
    return null;
  }

  // Lazy require so test runs and codepaths that don't touch Telegram
  // don't have to load the SDK.
  let TelegramBot;
  try {
    TelegramBot = require("node-telegram-bot-api");
  } catch (err) {
    logger().error(
      `[autopilot telegram] node-telegram-bot-api not installed — run 'npm install node-telegram-bot-api' in nodejs-backend: ${err.message}`,
    );
    return null;
  }

  try {
    _bot = new TelegramBot(token, { polling: true });
  } catch (err) {
    logger().error(
      `[autopilot telegram] bot init failed: ${err.message}`,
    );
    return null;
  }

  // Unified handler — we ignore the SDK's regex helpers (`onText`) and
  // route everything through `planReplyForUpdate` so the logic stays
  // testable as a pure function.
  _bot.on("message", async (msg) => {
    try {
      const reply = planReplyForUpdate({ message: msg });
      if (!reply) return;
      await _bot.sendMessage(reply.chatId, reply.text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      logger().info(
        `[autopilot telegram] /start handled for chat=${reply.chatId}`,
      );
    } catch (err) {
      // Never let a handler exception kill the polling loop.
      logger().error(
        `[autopilot telegram] message handler error: ${err.message}`,
      );
    }
  });

  // Polling errors (network blip, Telegram 5xx, the dreaded 409 conflict
  // when two pollers fight for the same token). Logged loudly because
  // a 409 specifically means another instance is also polling — that's
  // the signal to either kill the duplicate or switch to webhook mode.
  _bot.on("polling_error", (err) => {
    const msg = (err && err.message) || String(err);
    if (msg.includes("409")) {
      logger().error(
        `[autopilot telegram] 409 Conflict — another process is polling this bot token. Polling only works for a single process; stop the duplicate or migrate to webhook mode.`,
      );
    } else {
      logger().warn(`[autopilot telegram] polling error: ${msg}`);
    }
  });

  logger().info(
    "[autopilot telegram] polling started — /start in any group/DM will reply with the chat id",
  );
  return _bot;
}

/**
 * Stop polling. Mostly useful for tests + graceful shutdown.
 */
async function stopTelegramBot() {
  if (!_bot) return;
  try {
    await _bot.stopPolling();
  } catch {
    // best-effort
  }
  _bot = null;
}

module.exports = {
  planReplyForUpdate,
  startTelegramBot,
  stopTelegramBot,
  // exported for tests
  _internals: { greetingMessage, escapeHtml, DEFAULT_BOT_USERNAME },
};
