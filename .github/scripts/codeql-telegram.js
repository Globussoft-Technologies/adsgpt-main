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

const { execFileSync } = require("node:child_process");

const {
  GH_TOKEN, REPO, SINCE, RUN_URL,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PRIVATE_REPO_URL,
} = process.env;

// Above this many new alerts, send one summary instead of flooding the group.
// A query-pack upgrade is the case this exists for.
const BATCH_THRESHOLD = 8;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();

const escape = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SEVERITY_ICON = {
  critical: "\u{1F7E5}", high: "\u{1F7E7}", medium: "\u{1F7E8}", low: "\u{2B1C}",
};

async function fetchOpenAlerts() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/code-scanning/alerts?state=open&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error(`alerts API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// The mirror commit that last touched the flagged line. Almost always the one
// that introduced the alert; the exception is an alert that appears because a
// sanitizer was removed elsewhere, which is why the wording says "likely".
function introducingCommit(path, line, sha) {
  if (!path || !line) return null;
  try {
    const out = git("blame", "-L", `${line},${line}`, "--porcelain", sha, "--", path);
    return out.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

// "Upstream PR:      #1301 (Jaydev Jana), #1306 (Chethan S)"
//   -> [{ num: "1301", name: "Jaydev Jana" }, { num: "1306", name: "Chethan S" }]
//
// The name is optional: trailers written before Jenkins started recording the
// author carry the number alone, so fall back to numbers-only parsing.
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
  const named = [...line[1].matchAll(/#(\d+)\s*\(([^)]*)\)/g)]
    .map((m) => ({ num: m[1], name: m[2].trim() || null }));
  if (named.length) return named;
  return [...line[1].matchAll(/#(\d+)/g)].map((m) => ({ num: m[1], name: null }));
}

function renderAlert(alert) {
  const inst = alert.most_recent_instance || {};
  const loc = inst.location || {};
  const severity = alert.rule?.security_severity_level || alert.rule?.severity || "unknown";
  const mirrorSha = introducingCommit(loc.path, loc.start_line, inst.commit_sha || "HEAD");
  const prs = upstreamPrs(mirrorSha);

  const lines = [
    `${SEVERITY_ICON[severity] || SEVERITY_ICON.low} <b>New CodeQL alert</b> · ${escape(severity)}`,
    `<code>${escape(alert.rule?.id)}</code> — ${escape(alert.rule?.description)}`,
    "",
    `<code>${escape(loc.path)}:${loc.start_line}</code>`,
    "",
  ];

  if (prs.length) {
    const links = prs
      .map((p) => `<a href="${PRIVATE_REPO_URL}/pull/${p.num}">#${p.num}</a>`)
      .join(", ");
    // Distinct authors, in order. A batch can carry several PRs from one person.
    const who = [...new Set(prs.map((p) => p.name).filter(Boolean))];
    lines.push(
      `Likely introduced by PR ${links}` +
      (who.length ? ` — <b>${escape(who.join(", "))}</b>` : ""),
    );
  } else {
    // No trailer means the line predates the Jenkinsfile change, or the mirror
    // batch carried no detectable PR. The SHA still gives a thread to pull.
    lines.push(`Could not resolve the PR — mirror commit <code>${escape((mirrorSha || "unknown").slice(0, 8))}</code>`);
  }
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

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
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

  const all = await fetchOpenAlerts();
  const fresh = all.filter((a) => Date.parse(a.created_at) >= cutoff);
  console.log(`${all.length} open alerts, ${fresh.length} created at or after ${SINCE}`);

  if (fresh.length === 0) return;                    // the quiet, common case
  if (fresh.length > BATCH_THRESHOLD) {
    await send(renderSummary(fresh));
    return;
  }
  for (const alert of fresh) {
    const text = renderAlert(alert);
    console.log(text);
    await send(text);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
