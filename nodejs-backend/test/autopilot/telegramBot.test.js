#!/usr/bin/env node
/**
 * Tests for telegramBotService.planReplyForUpdate — the pure-logic core
 * of the inbound /start handler. Network calls (setWebhook,
 * getWebhookInfo) aren't covered here; the controller test would need
 * a mocked axios and is out of scope for this unit suite.
 */

const assert = require("node:assert/strict");
const {
  planReplyForUpdate,
  _internals,
} = require("../../services/autopilot/telegramBotService");

const { DEFAULT_BOT_USERNAME } = _internals;

let pass = 0;
let fail = 0;
const FAILURES = [];

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    FAILURES.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}
function group(label, fn) {
  console.log(`\n${label}`);
  return fn();
}

// ─── fixtures ───────────────────────────────────────────────────────────────

const startInGroup = {
  update_id: 1,
  message: {
    message_id: 10,
    chat: { id: -1001234567890, title: "test alert", type: "supergroup" },
    text: "/start",
  },
};

const startInGroupWithHandle = {
  update_id: 2,
  message: {
    message_id: 11,
    chat: { id: -1001234567890, title: "test alert", type: "supergroup" },
    text: `/start@${DEFAULT_BOT_USERNAME}`,
  },
};

const startInDm = {
  update_id: 3,
  message: {
    message_id: 12,
    chat: { id: 987654321, type: "private" },
    text: "/start",
  },
};

const randomMessage = {
  update_id: 4,
  message: {
    message_id: 13,
    chat: { id: -1001234567890, title: "test alert", type: "supergroup" },
    text: "hello team, how's everyone doing today?",
  },
};

const botAddedToGroup = {
  update_id: 5,
  message: {
    message_id: 14,
    chat: { id: -1001234567890, title: "test alert", type: "supergroup" },
    new_chat_members: [
      { id: 1234, username: DEFAULT_BOT_USERNAME, is_bot: true },
    ],
  },
};

// ─── tests ──────────────────────────────────────────────────────────────────

group("planReplyForUpdate", () => {
  test("/start in a group → reply with the group's negative chat id", () => {
    const r = planReplyForUpdate(startInGroup);
    assert.ok(r, "expected a reply, got null");
    assert.equal(r.chatId, -1001234567890);
    assert.match(r.text, /-1001234567890/);
    assert.match(r.text, /test alert/);
  });

  test("/start@<botname> in a group is treated identically", () => {
    // Privacy-mode bots only see commands addressed to them. We accept
    // the bare /start too because our bot has privacy mode off, but if
    // someone toggles it back on in BotFather we still want the
    // explicit form to keep working.
    const r = planReplyForUpdate(startInGroupWithHandle);
    assert.ok(r);
    assert.equal(r.chatId, -1001234567890);
    assert.match(r.text, /-1001234567890/);
  });

  test("/start in a DM → reply with the user's positive chat id", () => {
    const r = planReplyForUpdate(startInDm);
    assert.ok(r);
    assert.equal(r.chatId, 987654321);
    assert.match(r.text, /987654321/);
    // No group title in a DM — fall back to "this DM" phrasing.
    assert.match(r.text, /this DM/);
  });

  test("random non-/start text → no reply (silent ack)", () => {
    // We don't want the bot replying to every message in groups it's
    // in — only to the explicit onboarding command.
    assert.equal(planReplyForUpdate(randomMessage), null);
  });

  test("bot added to group → unprompted greeting with chat id", () => {
    // The polished UX: user doesn't even have to type /start. The
    // moment they add the bot, it announces the chat id. Saves a step.
    const r = planReplyForUpdate(botAddedToGroup);
    assert.ok(r);
    assert.equal(r.chatId, -1001234567890);
    assert.match(r.text, /-1001234567890/);
  });

  test("new_chat_members WITHOUT our bot → no reply", () => {
    // Someone else added a different bot or a person. We're not the
    // event's target; staying silent keeps group chatter to a minimum.
    const r = planReplyForUpdate({
      update_id: 6,
      message: {
        chat: { id: -1, title: "x", type: "group" },
        new_chat_members: [
          { id: 9999, username: "some_other_bot", is_bot: true },
        ],
      },
    });
    assert.equal(r, null);
  });

  test("case-insensitive /start matching", () => {
    // Telegram clients can autocapitalize. "/Start" should still
    // trigger the handler — the worst UX is failing silently on a typo
    // we could have accepted.
    const r = planReplyForUpdate({
      update_id: 7,
      message: {
        chat: { id: -1, title: "x", type: "group" },
        text: "/Start",
      },
    });
    assert.ok(r);
  });

  test("custom botUsername respected (rename-safe)", () => {
    // If we ever rename the bot in BotFather, the existing
    // /start@<old> won't match — but the test pins the parameter so
    // the rename path is just "update DEFAULT_BOT_USERNAME and ship."
    const r = planReplyForUpdate(
      {
        update_id: 8,
        message: {
          chat: { id: -1, title: "x", type: "supergroup" },
          text: "/start@new_bot_name",
        },
      },
      { botUsername: "new_bot_name" },
    );
    assert.ok(r);
  });

  test("malformed updates → null (no throws)", () => {
    // Telegram has thrown surprising payloads at us before (edit
    // events, channel_post, callback queries). The handler returns
    // null for anything it doesn't understand instead of crashing —
    // the webhook controller relies on this to 200 OK consistently.
    assert.equal(planReplyForUpdate(null), null);
    assert.equal(planReplyForUpdate(undefined), null);
    assert.equal(planReplyForUpdate({}), null);
    assert.equal(planReplyForUpdate({ message: null }), null);
    assert.equal(planReplyForUpdate({ message: {} }), null);
    assert.equal(
      planReplyForUpdate({ message: { chat: null } }),
      null,
    );
    assert.equal(
      planReplyForUpdate({ message: { chat: { id: -1 } } }),
      null,
    );
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFailures:");
  for (const f of FAILURES) {
    console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
  }
  process.exit(1);
}
