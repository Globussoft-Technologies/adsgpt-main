// Posts one Telegram message per new CodeQL alert, naming the PR that
// introduced it.
//
// Attribution is the whole point and the only tricky part. An alert's own
// `commit_sha` is just whichever mirror batch CodeQL happened to scan — it
// names an unrelated PR most of the time. So we blame the flagged LINE to find
// the mirror commit that actually touched it, then read the "Upstream PR:"
// trailer the Jenkins mirror job writes into every mirror commit message.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const alert = event.alert;
const instance = alert.most_recent_instance || {};
const location = instance.location || {};
const scannedSha = event.commit_oid || instance.commit_sha;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();

// The mirror commit that last touched the flagged line. Almost always the one
// that introduced the alert — the exception is an alert that appears because a
// sanitizer was removed somewhere else, which is why the message below says
// "likely" rather than asserting it.
function introducingCommit() {
  if (!location.path || !location.start_line) return null;
  try {
    const out = git(
      "blame",
      "-L", `${location.start_line},${location.start_line}`,
      "--porcelain",
      scannedSha,
      "--", location.path,
    );
    return out.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

// "Upstream PR:      #1301, #1306" -> ["1301", "1306"]
function upstreamPrs(sha) {
  if (!sha) return [];
  let body;
  try {
    body = git("log", "-1", "--format=%B", sha);
  } catch {
    return [];
  }
  const line = body.match(/^Upstream PR:\s*(.+)$/m);
  if (!line) return [];
  return [...line[1].matchAll(/#(\d+)/g)].map((m) => m[1]);
}

const escape = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const SEVERITY_ICON = {
  critical: "\u{1F7E5}",
  high: "\u{1F7E7}",
  medium: "\u{1F7E8}",
  low: "\u{2B1C}",
};

function buildMessage() {
  const severity =
    alert.rule.security_severity_level || alert.rule.severity || "unknown";
  const verb = event.action === "reopened" ? "Reopened" : "New";
  const mirrorSha = introducingCommit();
  const prs = upstreamPrs(mirrorSha);

  const lines = [
    `${SEVERITY_ICON[severity] || SEVERITY_ICON.low} <b>${verb} CodeQL alert</b> \u00b7 ${escape(severity)}`,
    `<code>${escape(alert.rule.id)}</code> \u2014 ${escape(alert.rule.description)}`,
    "",
    `<code>${escape(location.path)}:${location.start_line}</code>`,
    "",
  ];

  if (prs.length) {
    const links = prs
      .map((n) => `<a href="${process.env.PRIVATE_REPO_URL}/pull/${n}">#${n}</a>`)
      .join(", ");
    lines.push(`Likely introduced by PR ${links}`);
  } else {
    // No trailer means either a pre-Jenkins-change commit or a mirror batch
    // with no detectable PR. The SHA still gives someone a thread to pull.
    lines.push(
      `Could not resolve the PR \u2014 mirror commit <code>${escape((mirrorSha || "unknown").slice(0, 8))}</code>`,
    );
  }

  lines.push("", `<a href="${alert.html_url}">Open alert #${alert.number}</a>`);
  return lines.join("\n");
}

async function main() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set.");
    process.exit(1);
  }

  const text = buildMessage();
  console.log(text);

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!res.ok) {
    console.error(`Telegram rejected the message (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
}

main();
