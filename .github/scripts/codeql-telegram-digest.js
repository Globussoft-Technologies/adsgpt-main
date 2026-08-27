// Daily digest of every open CodeQL alert, posted to Telegram.
//
// Runs on a schedule (see codeql-telegram-digest.yml). Unlike the per-scan
// reporter this always sends, including when the board is clean - a silent
// channel is indistinguishable from a broken one, and the "0 open" message is
// the only thing that proves the pipeline still works.

const {
  SEVERITY_ICON, SEVERITY_ORDER,
  escape, severityOf, fetchOpenAlerts, blameLine, send,
} = require("./codeql-telegram-lib.js");

const {
  GH_TOKEN, REPO, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PRIVATE_REPO_URL,
} = process.env;

// Above this many, list per-rule counts instead of every alert. Blaming each
// alert costs a git call, so this also bounds the job's runtime.
const DETAIL_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const ageDays = (iso) => Math.floor((Date.now() - Date.parse(iso)) / DAY_MS);

function header(alerts) {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
  if (!alerts.length) {
    return [`✅ <b>CodeQL clean</b> · ${today}`, "No open alerts."].join("\n");
  }
  const counts = {};
  for (const a of alerts) counts[severityOf(a)] = (counts[severityOf(a)] || 0) + 1;
  const bits = Object.entries(counts)
    .sort((x, y) => (SEVERITY_ORDER[x[0]] ?? 9) - (SEVERITY_ORDER[y[0]] ?? 9))
    .map(([s, n]) => `${SEVERITY_ICON[s] || ""} ${n} ${s}`)
    .join(" · ");
  const fresh = alerts.filter((a) => Date.parse(a.created_at) >= Date.now() - DAY_MS).length;

  return [
    `\u{1F4CB} <b>CodeQL open alerts</b> · ${today}`,
    `${alerts.length} open — ${bits}`,
    fresh ? `${fresh} raised in the last 24h` : "",
  ].filter(Boolean).join("\n");
}

function detailed(alerts) {
  const sorted = [...alerts].sort((a, b) => {
    const s = (SEVERITY_ORDER[severityOf(a)] ?? 9) - (SEVERITY_ORDER[severityOf(b)] ?? 9);
    return s !== 0 ? s : Date.parse(a.created_at) - Date.parse(b.created_at);
  });
  return sorted.map((a) => {
    const loc = a.most_recent_instance?.location || {};
    const sev = severityOf(a);
    const { text } = blameLine(a, PRIVATE_REPO_URL);
    const age = ageDays(a.created_at);
    return [
      `${SEVERITY_ICON[sev] || ""} <code>${escape(a.rule?.id)}</code>`,
      `   <code>${escape(loc.path)}:${loc.start_line}</code>`,
      `   <a href="${a.html_url}">#${a.number}</a> · ${age}d old · ${text}`,
    ].join("\n");
  }).join("\n\n");
}

function grouped(alerts) {
  const byRule = {};
  for (const a of alerts) {
    const k = a.rule?.id;
    byRule[k] = byRule[k] || { n: 0, sev: severityOf(a) };
    byRule[k].n += 1;
  }
  return Object.entries(byRule)
    .sort((x, y) => (SEVERITY_ORDER[x[1].sev] ?? 9) - (SEVERITY_ORDER[y[1].sev] ?? 9) || y[1].n - x[1].n)
    .map(([rule, { n, sev }]) => `${SEVERITY_ICON[sev] || ""} ${n} × <code>${escape(rule)}</code>`)
    .join("\n");
}

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set.");
    process.exit(1);
  }
  const alerts = await fetchOpenAlerts({ repo: REPO, token: GH_TOKEN });
  console.log(`${alerts.length} open alerts`);

  const parts = [header(alerts)];
  if (alerts.length) {
    parts.push("");
    parts.push(alerts.length <= DETAIL_LIMIT ? detailed(alerts) : grouped(alerts));
    parts.push("");
    parts.push(`<a href="https://github.com/${REPO}/security/code-scanning">Review in code scanning</a>`);
  }

  const text = parts.join("\n");
  console.log(text);
  await send(text, { token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
