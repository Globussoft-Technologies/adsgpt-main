// Posts newly-raised CodeQL alerts to Telegram, naming the PR that introduced
// each one.
//
// Runs after a CodeQL scan completes (see codeql-telegram.yml). "New" means an
// alert whose created_at is at or after the moment that scan started - exactly
// the set of alerts the scan produced, including ones re-raised because an edit
// moved a flagged line and changed its fingerprint.
//
// Attribution is the whole point and the only subtle part. An alert's own
// commit_sha is just whichever mirror batch CodeQL happened to scan, so it names
// an unrelated PR most of the time. Instead we blame the flagged LINE to find
// the mirror commit that actually touched it, then read the "Upstream PR:"
// trailer the Jenkins mirror job writes into every mirror commit message.

const {
  SEVERITY_ICON, escape, severityOf, fetchOpenAlerts, blameLine, send,
} = require("./codeql-telegram-lib.js");

const {
  GH_TOKEN, REPO, SINCE, RUN_URL,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PRIVATE_REPO_URL,
} = process.env;

// Above this many new alerts, send one summary instead of flooding the group.
// A query-pack upgrade is the case this exists for.
const BATCH_THRESHOLD = 8;

function renderAlert(alert) {
  const inst = alert.most_recent_instance || {};
  const loc = inst.location || {};
  const severity = severityOf(alert);
  const attribution = blameLine(alert, PRIVATE_REPO_URL);

  const lines = [
    `${SEVERITY_ICON[severity] || SEVERITY_ICON.low} <b>New CodeQL alert</b> · ${escape(severity)}`,
    `<code>${escape(alert.rule?.id)}</code> — ${escape(alert.rule?.description)}`,
    "",
    `<code>${escape(loc.path)}:${loc.start_line}</code>`,
    "",
  ];

  lines.push(attribution.who.length
    ? `Likely introduced by ${attribution.text}`
    : `Could not resolve the PR — ${attribution.text}`);
  lines.push("", `<a href="${alert.html_url}">Open alert #${alert.number}</a>`);
  return lines.join("\n");
}

function renderSummary(alerts) {
  const bySeverity = {};
  for (const a of alerts) {
    const s = a.rule?.security_severity_level || "unknown";
    bySeverity[s] = (bySeverity[s] || 0) + 1;
  }
  const counts = Object.entries(bySeverity)
    .map(([s, n]) => `${SEVERITY_ICON[s] || ""} ${n} ${s}`).join(" · ");

  const byRule = {};
  for (const a of alerts) byRule[a.rule?.id] = (byRule[a.rule?.id] || 0) + 1;
  const top = Object.entries(byRule).sort((x, y) => y[1] - x[1]).slice(0, 8)
    .map(([r, n]) => `  ${n} × <code>${escape(r)}</code>`).join("\n");

  return [
    `⚠️ <b>${alerts.length} new CodeQL alerts</b> in one scan`,
    counts,
    "",
    "Too many to list individually — usually a query-pack change:",
    top,
    "",
    `<a href="https://github.com/${REPO}/security/code-scanning">Review in code scanning</a>`,
    RUN_URL ? `<a href="${RUN_URL}">Triggering scan</a>` : "",
  ].filter(Boolean).join("\n");
}

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set.");
    process.exit(1);
  }
  const cutoff = SINCE ? Date.parse(SINCE) : NaN;
  if (Number.isNaN(cutoff)) {
    console.error(`SINCE is not a parseable timestamp: ${SINCE}`);
    process.exit(1);
  }

  const all = await fetchOpenAlerts({ repo: REPO, token: GH_TOKEN });
  const fresh = all.filter((a) => Date.parse(a.created_at) >= cutoff);
  console.log(`${all.length} open alerts, ${fresh.length} created at or after ${SINCE}`);

  if (fresh.length === 0) return;                    // the quiet, common case
  if (fresh.length > BATCH_THRESHOLD) {
    await send(renderSummary(fresh), { token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
    return;
  }
  for (const alert of fresh) {
    const text = renderAlert(alert);
    console.log(text);
    await send(text, { token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
