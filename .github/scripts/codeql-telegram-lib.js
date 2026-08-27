// Shared helpers for the two CodeQL -> Telegram reporters:
//   codeql-telegram.js         per-scan, "what did this scan just raise"
//   codeql-telegram-digest.js  daily, "everything still open"
//
// Attribution is the subtle part and lives here so both agree. An alert's own
// commit_sha is just whichever mirror batch CodeQL happened to scan, so it
// names an unrelated PR most of the time. Instead we blame the flagged LINE to
// find the mirror commit that actually touched it, then read the "Upstream PR:"
// trailer the Jenkins mirror job writes into every mirror commit message.

const { execFileSync } = require("node:child_process");

const SEVERITY_ICON = {
  critical: "\u{1F7E5}", high: "\u{1F7E7}", medium: "\u{1F7E8}", low: "\u{2B1C}",
};
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();

const escape = (v) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const severityOf = (a) =>
  a.rule?.security_severity_level || a.rule?.severity || "unknown";

async function fetchOpenAlerts({ repo, token }) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/code-scanning/alerts?state=open&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
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
// sanitizer was removed elsewhere, which is why callers say "likely".
function introducingCommit(path, line, sha) {
  if (!path || !line) return null;
  try {
    return git("blame", "-L", `${line},${line}`, "--porcelain", sha || "HEAD", "--", path)
      .split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

// "Upstream PR:      #1301 (Jaydev Jana), #1306 (Chethan S)"
//   -> [{ num: "1301", name: "Jaydev Jana" }, ...]
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

// "PR #1386 — Chethan S", or a mirror SHA when the trailer predates the change.
function blameLine(alert, privateRepoUrl) {
  const inst = alert.most_recent_instance || {};
  const loc = inst.location || {};
  const mirrorSha = introducingCommit(loc.path, loc.start_line, inst.commit_sha);
  const prs = upstreamPrs(mirrorSha);
  if (!prs.length) {
    return { text: `mirror <code>${escape((mirrorSha || "unknown").slice(0, 8))}</code>`, who: [] };
  }
  const links = prs
    .map((p) => `<a href="${privateRepoUrl}/pull/${p.num}">#${p.num}</a>`)
    .join(", ");
  const who = [...new Set(prs.map((p) => p.name).filter(Boolean))];
  return {
    text: `PR ${links}` + (who.length ? ` — <b>${escape(who.join(", "))}</b>` : ""),
    who,
  };
}

async function send(text, { token, chatId }) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

module.exports = {
  SEVERITY_ICON, SEVERITY_ORDER,
  git, escape, severityOf,
  fetchOpenAlerts, introducingCommit, upstreamPrs, blameLine, send,
};
