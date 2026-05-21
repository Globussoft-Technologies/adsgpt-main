/**
 * alertService — Phase 8 (multi-tenant, both channels per-user).
 *
 * Two channels, both fanned-out per opted-in user:
 *
 *   1. Slack: one post per user per cycle, to that user's
 *      `autopilotSettings.alerts.slackWebhookUrl`. Each post contains ONLY
 *      that user's accounts (privacy boundary). No env-level webhook
 *      fallback — if a user hasn't saved a webhook, they get no Slack post.
 *
 *   2. Email: one email per user per cycle, to that user's
 *      `autopilotSettings.alerts.emailTo`. Sent via SendGrid
 *      (`SENDGRID_API_KEY`); from-address is `AUTOPILOT_EMAIL_FROM` (must be
 *      a verified sender on SendGrid).
 *
 * Trigger gate (per-user)
 *   Whether a given user gets an alert this cycle is decided SOLELY by their
 *   `autopilotSettings.alerts.alertOn` chip selection from the Settings UI.
 *   We load the user's action-log rows for this run, filter to the rows
 *   matching their chips, and send only if ≥1 row matches. No dry-run gate,
 *   no severity floor — what the user picked in "Notify me about" is what
 *   they get notified about.
 *
 *   Chip → row match:
 *     low / medium / high   row.ruleSeverity
 *
 *   Empty/missing alertOn → schema default ['high'].
 *   Empty array (user unchecked everything) → no alert.
 *
 * Throttling
 *   Per-user, per-channel:
 *     - Slack: `autopilot:alert:user:<userId>:slack`
 *     - Email: `autopilot:alert:user:<userId>:email`
 *   Both use the same `AUTOPILOT_ALERT_THROTTLE_MINUTES` cooldown (default 60).
 *   Backed by Redis with matching TTL — fail-open if Redis is unavailable
 *   so alerts never take down the orchestrator.
 *
 * Deep links
 *   Each per-account row carries a Meta Ads Manager URL anchored at the ad
 *   account so the recipient can jump straight to the account in question.
 *
 * Config (env)
 *   AUTOPILOT_ALERT_THROTTLE_MINUTES     per-channel cooldown (default 60).
 *   SENDGRID_API_KEY                     SendGrid auth. Unset → email silent.
 *   AUTOPILOT_EMAIL_FROM                 from-address (must be a verified
 *                                        SendGrid sender). Default
 *                                        'autopilot@adsgpt.io'.
 */

let _axios;
function axios() {
  if (!_axios) _axios = require("axios");
  return _axios;
}

let _sgMail;
function sgMail() {
  // Lazy-load + lazy-init the SendGrid client. Returns null if the package
  // isn't installed OR the API key isn't set — caller treats null as
  // "email not configured" and short-circuits cleanly. We log the *reason*
  // the first time we fall back so deployment-side debugging doesn't have
  // to guess between "env not set" and "package missing".
  if (_sgMail !== undefined) return _sgMail;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) {
    getLogger().warn(
      "[autopilot] email disabled: SENDGRID_API_KEY env var is not set",
    );
    _sgMail = null;
    return null;
  }
  try {
    const sg = require("@sendgrid/mail");
    sg.setApiKey(key);
    _sgMail = sg;
  } catch (err) {
    getLogger().error(
      `[autopilot] email disabled: @sendgrid/mail load failed — ${err.message}. Run \`npm ci\` and redeploy.`,
    );
    _sgMail = null;
  }
  return _sgMail;
}

let _redisClient;
function redisClient() {
  if (_redisClient === undefined) {
    try {
      _redisClient = require("../../db/redis").redisClient;
    } catch {
      _redisClient = null;
    }
  }
  return _redisClient;
}

let _AutopilotSettings;
function AutopilotSettings() {
  if (_AutopilotSettings === undefined) {
    try {
      _AutopilotSettings = require("../../Module/autopilot/autopilotSettings");
    } catch {
      _AutopilotSettings = null;
    }
  }
  return _AutopilotSettings;
}

let _AutopilotActionLog;
function AutopilotActionLog() {
  if (_AutopilotActionLog === undefined) {
    try {
      _AutopilotActionLog = require("../../Module/autopilot/autopilotActionLog");
    } catch {
      _AutopilotActionLog = null;
    }
  }
  return _AutopilotActionLog;
}

/**
 * Load all autopilotActionLog rows for one (runId, userId) pair. Used by
 * the alert dispatcher to enrich per-user alerts with per-action detail
 * (entity name, rule, why, key metrics) — not just count rollups.
 *
 * Returns [] on any failure (logged) — alerts must never throw.
 */
async function loadActionRowsForUser(runId, userId) {
  const Log = AutopilotActionLog();
  if (!Log) return [];
  try {
    return await Log.find({
      runId,
      userId: { $in: [userId, "SYSTEM"] },
    })
      .sort({ runAt: 1 })
      .lean();
  } catch (err) {
    getLogger().warn(
      `[autopilot] alertService: action-log load failed for runId=${runId} userId=${userId}: ${err.message}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — group + format action-log rows for rendering
// ---------------------------------------------------------------------------

const ACTION_LABELS = {
  pause: "Paused",
  resume: "Resumed",
  scale_budget: "Scaled budget",
  rename: "Renamed",
  rotate_creative: "Rotated creative",
  alert_only: "Flagged",
};

const SEVERITY_COLOR = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
};

const SEVERITY_EMOJI = {
  high: "🔴",
  medium: "🟡",
  low: "🟢",
};

/**
 * Group rows: Map<adAccountId, Map<action, rows[]>>. Caller iterates this
 * to render per-account / per-action sections. Rows preserve their order
 * within each bucket (sorted by runAt at load time).
 */
function groupActionsByAccountAndType(rows) {
  const byAccount = new Map();
  for (const row of rows || []) {
    if (!row || !row.adAccountId || !row.action) continue;
    const accId = row.adAccountId;
    if (!byAccount.has(accId)) byAccount.set(accId, new Map());
    const byAction = byAccount.get(accId);
    if (!byAction.has(row.action)) byAction.set(row.action, []);
    byAction.get(row.action).push(row);
  }
  return byAccount;
}

/**
 * Pick a tight set of human-readable metrics from a row's metricsSnapshot.
 * Returns "spend ₹3,200 · cpi ₹62 · installs 6 · ctr 1.23%" — the fields
 * most likely to justify the action. Order is "rule-justifying first"
 * (spend → cpi → installs → cpa → purchases → roas → ctr → freq) so the
 * email reader sees the rule-relevant metric without scanning.
 *
 * Skips zero/null/undefined fields entirely — a non-app campaign
 * shouldn't render `cpi 0`, a no-purchase ad shouldn't render `cpa 0`.
 *
 * `currency` is read off the snapshot when present (the normalizer in
 * metaAuditService propagates the account currency onto every entity).
 */
const CURRENCY_SYMBOL = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
const fmtCurrency = (v, currency) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const sym = CURRENCY_SYMBOL[currency] || "";
  return `${sym}${n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 100 ? 0 : 2,
    maximumFractionDigits: n >= 100 ? 0 : 2,
  })}`;
};
const fmtCount = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString();
};
const fmtPercent = (v) => {
  // Meta returns CTR / engagement_rate already as a percentage value
  // (e.g. 1.234567 → 1.23%). Do NOT multiply by 100.
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(2)}%`;
};
const fmtRatio = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
};

const KEY_METRICS = [
  { key: "spend", label: "spend", kind: "currency" },
  { key: "cpi", label: "cpi", kind: "currency" },
  { key: "installs", label: "installs", kind: "count" },
  { key: "cpa", label: "cpa", kind: "currency" },
  { key: "purchases", label: "purchases", kind: "count" },
  { key: "roas", label: "roas", kind: "ratio" },
  { key: "ctr", label: "ctr", kind: "percent" },
  { key: "cpc", label: "cpc", kind: "currency" },
  { key: "cpm", label: "cpm", kind: "currency" },
  { key: "frequency", label: "freq", kind: "ratio" },
  { key: "clicks", label: "clicks", kind: "count" },
  { key: "impressions", label: "impr", kind: "count" },
];

/**
 * Build a "Campaign · Adset" breadcrumb for an action-log row, so the
 * entity table can show where a flagged ad lives without forcing the
 * reader to click through to Ads Manager. Returns "" when the row has
 * no parent context (campaign-level rows, or pre-schema-update rows
 * that were written before campaignName/adsetName columns existed).
 */
function buildParentCrumb(row) {
  if (!row || row.level === "campaign") return "";
  const parts = [];
  if (row.campaignName) parts.push(row.campaignName);
  if (row.level === "ad" && row.adsetName) parts.push(row.adsetName);
  return parts.join(" · ");
}

function formatKeyMetrics(metricsSnapshot) {
  if (!metricsSnapshot) return "";
  const currency = metricsSnapshot.currency;
  const parts = [];
  for (const m of KEY_METRICS) {
    const val = metricsSnapshot[m.key];
    if (val === null || val === undefined) continue;
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) continue;
    let formatted = null;
    if (m.kind === "currency") formatted = fmtCurrency(val, currency);
    else if (m.kind === "count") formatted = fmtCount(val);
    else if (m.kind === "percent") formatted = fmtPercent(val);
    else if (m.kind === "ratio") formatted = fmtRatio(val);
    if (formatted == null) continue;
    parts.push(`${m.label} ${formatted}`);
  }
  return parts.join(" · ");
}

/**
 * Top firing rules across the cycle, sorted desc by count. Used as the
 * lead-in summary at the top of every alert. Returns
 * `[{ ruleId, ruleMessage, count, severity }, ...]`.
 */
function topFiringRules(rows, limit = 5) {
  const counts = new Map();
  for (const row of rows || []) {
    const key = row.ruleId;
    if (!key) continue;
    if (!counts.has(key)) {
      counts.set(key, {
        ruleId: row.ruleId,
        ruleMessage: row.ruleMessage || "",
        severity: row.ruleSeverity || "low",
        count: 0,
      });
    }
    counts.get(key).count += 1;
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const escapeHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

let _logger;
function getLogger() {
  if (_logger) return _logger;
  try {
    _logger = require("../../utils/logger");
  } catch {
    _logger = console;
  }
  return _logger;
}

// ---------------------------------------------------------------------------
// Pure helpers — Meta Ads Manager URL builder
// ---------------------------------------------------------------------------

function metaAdsManagerUrl({ adAccountId, level, entityId } = {}) {
  if (!adAccountId) return null;
  const id = String(adAccountId).startsWith("act_")
    ? String(adAccountId).slice(4)
    : String(adAccountId);
  const base = "https://business.facebook.com/adsmanager/manage";
  if (!entityId) {
    return `${base}/accounts?act=${id}`;
  }
  if (level === "campaign") {
    return `${base}/campaigns?act=${id}&selected_campaign_ids=${entityId}`;
  }
  if (level === "adset") {
    return `${base}/adsets?act=${id}&selected_adset_ids=${entityId}`;
  }
  if (level === "ad") {
    return `${base}/ads?act=${id}&selected_ad_ids=${entityId}`;
  }
  return `${base}/accounts?act=${id}`;
}

// ---------------------------------------------------------------------------
// Pure helpers — slice a multi-tenant summary down to a single user's slice
// ---------------------------------------------------------------------------

/**
 * Filter a cycle summary down to only the accounts belonging to one user.
 * The returned object keeps the original shape (runId, dryRun, durationMs,
 * accounts[]) so the existing `buildSlackPayload` / `buildPlainTextSummary`
 * formatters work unchanged.
 *
 * Pure — no side effects.
 */
function sliceSummaryByUser(summary, userId) {
  const accounts = (summary.accounts || []).filter(
    (a) => a && a.ownerUserId === userId,
  );
  return { ...summary, accounts };
}

/**
 * Group cycle accounts by ownerUserId. Returns a Map of userId → accounts[].
 * Accounts with no ownerUserId (shouldn't happen in v3, but defensive) are
 * dropped — they have no recipient candidate.
 */
function groupAccountsByUser(summary) {
  const out = new Map();
  for (const acc of summary.accounts || []) {
    if (!acc || !acc.ownerUserId) continue;
    const list = out.get(acc.ownerUserId) || [];
    list.push(acc);
    out.set(acc.ownerUserId, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTML email formatter — per-account / per-action / per-entity tables.
// Inline styles only (no <style> blocks) for max email-client compatibility.
// ---------------------------------------------------------------------------

function buildEmailHtml(summary, rows) {
  const dryLabel = summary.dryRun ? " (dry-run)" : "";
  const banner = summary.dryRun
    ? "🟡 AdsGPT Autopilot — dry-run complete"
    : "🟢 AdsGPT Autopilot — cycle complete";
  const grouped = groupActionsByAccountAndType(rows);
  const topRules = topFiringRules(rows);

  // Build a quick adAccountId → name lookup from the summary's per-account
  // rollup (the action-log row also has it, but we prefer the friendlier
  // name from the cycle summary if available).
  const nameByAccount = new Map();
  for (const acc of summary.accounts || []) {
    if (acc && acc.adAccountId) {
      nameByAccount.set(acc.adAccountId, acc.name || acc.adAccountId);
    }
  }

  const baseFont = "font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;";
  const muted = "color: #6b7280; font-size: 12px;";
  const code = "background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px;";

  let html = `<!DOCTYPE html><html><body style="${baseFont} background: #ffffff; color: #111827; padding: 20px; max-width: 720px; margin: 0 auto;">`;

  // Brand mark — anchored on WIDTH (Thunderbird and a few Outlook builds
  // ignore inline `height` on <img> and render at natural size, while
  // width-anchoring is universally respected). 160px reads as a logo
  // wordmark, not a banner. Centered via `margin: 0 auto` rather than
  // `text-align: center` because some clients strip the parent's text
  // alignment when the child is `display: block`.
  html += `<img src="https://adsgpt.io/wp-content/uploads/2024/10/Adsgpt-Header-colored-logo.webp" alt="AdsGPT" width="140" style="width: 140px; max-width: 140px; height: auto; display: block; margin: 0 auto 20px auto;">`;

  // Header
  html += `<h1 style="font-size: 18px; margin: 0 0 4px 0; color: #111827;">${escapeHtml(banner)}${escapeHtml(dryLabel)}</h1>`;
  html += `<p style="${muted} margin: 0 0 16px 0;">runId: <span style="${code}">${escapeHtml(summary.runId)}</span> · duration: ${summary.durationMs}ms</p>`;

  // Top firing rules (lead with the gist)
  if (topRules.length) {
    html += `<h2 style="font-size: 14px; margin: 20px 0 8px 0; color: #111827;">Top firing rules</h2><ul style="margin: 0 0 16px 0; padding-left: 18px;">`;
    for (const r of topRules) {
      const emoji = SEVERITY_EMOJI[r.severity] || "•";
      html += `<li style="margin-bottom: 4px; font-size: 13px;">${emoji} <strong>${r.count}</strong> ${escapeHtml(r.ruleMessage || r.ruleId)} <span style="${muted}">(${escapeHtml(r.ruleId)})</span></li>`;
    }
    html += `</ul>`;
  }

  // Per-account / per-action breakdown
  if (grouped.size === 0) {
    html += `<p style="${muted}">No actions taken or proposed in this cycle.</p>`;
  } else {
    for (const [adAccountId, byAction] of grouped.entries()) {
      const acctName = nameByAccount.get(adAccountId) || adAccountId;
      const acctLink = metaAdsManagerUrl({ adAccountId });
      html += `<h2 style="font-size: 14px; margin: 24px 0 8px 0; color: #111827; border-top: 1px solid #e5e7eb; padding-top: 16px;">Account: <a href="${escapeHtml(acctLink)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(acctName)}</a></h2>`;

      for (const [action, list] of byAction.entries()) {
        const label = ACTION_LABELS[action] || action;
        html += `<h3 style="font-size: 13px; margin: 12px 0 6px 0; color: #374151;">${escapeHtml(label)} (${list.length})</h3>`;
        html += `<table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px;"><thead><tr style="background: #f9fafb;"><th style="text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">Entity</th><th style="text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">Rule</th><th style="text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">Why</th><th style="text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">Key metrics</th><th style="text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;">Outcome</th></tr></thead><tbody>`;

        for (const row of list) {
          const entityLink = metaAdsManagerUrl({
            adAccountId: row.adAccountId,
            level: row.level,
            entityId: row.entityId,
          });
          const sevColor = SEVERITY_COLOR[row.ruleSeverity] || "#6b7280";
          const outcomeColor =
            row.outcome === "failed"
              ? "#ef4444"
              : row.outcome === "skipped"
                ? "#6b7280"
                : "#10b981";
          const dryTag = row.dryRun
            ? ' <span style="background: #fef3c7; color: #92400e; padding: 1px 4px; border-radius: 3px; font-size: 10px;">dry-run</span>'
            : "";
          html += `<tr style="border-bottom: 1px solid #f3f4f6;">`;
          // Entity column: leaf entity name (linked) + parent-chain crumb
          // ("Campaign · Adset") so the reader sees where the ad lives
          // without having to click through. Falls back to the bare ID
          // when the row predates the parent-name columns.
          const parentCrumb = buildParentCrumb(row);
          html += `<td style="padding: 6px 8px; vertical-align: top;"><a href="${escapeHtml(entityLink)}" style="color: #2563eb; text-decoration: none; font-weight: 500;">${escapeHtml(row.entityName || row.entityId)}</a>`;
          if (parentCrumb) {
            html += `<div style="font-size: 11px; color: #4b5563; margin-top: 2px;">${escapeHtml(parentCrumb)}</div>`;
          }
          html += `<div style="${muted}">${escapeHtml(row.level)}: <span style="font-family: ui-monospace, SFMono-Regular, monospace;">${escapeHtml(row.entityId)}</span></div></td>`;
          html += `<td style="padding: 6px 8px; vertical-align: top;"><div style="${code}">${escapeHtml(row.ruleId)}</div><div style="color: ${sevColor}; font-size: 10px; text-transform: uppercase; margin-top: 2px;">${escapeHtml(row.ruleSeverity || "")}</div></td>`;
          html += `<td style="padding: 6px 8px; vertical-align: top; color: #374151;">${escapeHtml(row.ruleMessage || "—")}${row.skipReason ? `<div style="${muted}">skip: ${escapeHtml(row.skipReason)}</div>` : ""}</td>`;
          html += `<td style="padding: 6px 8px; vertical-align: top; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: #374151;">${escapeHtml(formatKeyMetrics(row.metricsSnapshot) || "—")}</td>`;
          html += `<td style="padding: 6px 8px; vertical-align: top;"><span style="color: ${outcomeColor}; text-transform: uppercase; font-size: 10px; font-weight: 600;">${escapeHtml(row.outcome || "")}</span>${dryTag}${row.error ? `<div style="color: #ef4444; ${muted}">${escapeHtml(row.error)}</div>` : ""}</td>`;
          html += `</tr>`;
        }
        html += `</tbody></table>`;
      }
    }
  }

  html += `<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">`;
  // html += `<p style="${muted} margin: 0;">You're receiving this because you saved an alert email in your AdsGPT Autopilot settings. Manage alerts → <a href="https://adsgpt.io/autopilot/meta?tab=settings" style="color: #2563eb;">Autopilot Settings</a>.</p>`;
  html += `</body></html>`;

  return html;
}

// ---------------------------------------------------------------------------
// Pure helpers — Slack + plain-text payload builders
// ---------------------------------------------------------------------------

function buildSlackPayload(summary, rows = []) {
  const dryLabel = summary.dryRun ? " (dry-run)" : "";
  const banner = summary.dryRun
    ? `🟡 *AdsGPT Autopilot — dry-run complete*`
    : `🟢 *AdsGPT Autopilot — cycle complete*`;

  const header = `${banner}${dryLabel}\nrunId: \`${summary.runId}\` · duration: ${summary.durationMs}ms`;

  // Slack mirrors the email layout (header → top rules → per-account detail
  // → errors). The earlier version also included a per-account rollup line
  // ("findings 2 · would-pause 2 · would-resume 0") + a totals line, but
  // those numbers were already visible in the per-account detail section
  // below, so the message was reading the same information twice. The
  // detail section IS the rollup.

  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: header } },
  ];

  // Top firing rules — short list at the top so readers see the gist before
  // scrolling through tables.
  const topRules = topFiringRules(rows, 5);
  if (topRules.length) {
    blocks.push({ type: "divider" });
    const top = topRules
      .map(
        (r) =>
          `${SEVERITY_EMOJI[r.severity] || "•"} *${r.count}* ${r.ruleMessage || r.ruleId} \`${r.ruleId}\``,
      )
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Top firing rules*\n${top}`,
      },
    });
  }

  // Per-account / per-action detail.
  const grouped = groupActionsByAccountAndType(rows);

  // Empty cycle — no rows to render. Mirror the email's "nothing happened"
  // copy so a cycle that fired the alert (because rows matched the user's
  // chips) but is now displayed without per-account detail (shouldn't
  // happen, but defensive) still reads sensibly.
  if (grouped.size === 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No actions taken or proposed in this cycle._",
      },
    });
  }

  for (const [adAccountId, byAction] of grouped.entries()) {
    const acc = (summary.accounts || []).find(
      (a) => a.adAccountId === adAccountId,
    );
    const acctLink = metaAdsManagerUrl({ adAccountId });
    const acctName = acc?.name || adAccountId;
    const acctHeader = acctLink
      ? `<${acctLink}|*${acctName}*>`
      : `*${acctName}*`;
    blocks.push({ type: "divider" });

    const sections = [`${acctHeader}  \`${adAccountId}\``];
    for (const [action, list] of byAction.entries()) {
      const label = ACTION_LABELS[action] || action;
      sections.push(`\n*${label}* (${list.length})`);
      for (const row of list) {
        const entityLink = metaAdsManagerUrl({
          adAccountId: row.adAccountId,
          level: row.level,
          entityId: row.entityId,
        });
        const entityName = row.entityName || row.entityId;
        const linked = entityLink
          ? `<${entityLink}|${entityName}>`
          : entityName;
        const sevEmoji = SEVERITY_EMOJI[row.ruleSeverity] || "•";
        const dryTag = row.dryRun ? " _(dry-run)_" : "";
        const outcomeTag =
          row.outcome === "failed" ? " ❌" : row.outcome === "skipped" ? " ⏭" : "";
        const metricsLine = formatKeyMetrics(row.metricsSnapshot);
        const parentCrumb = buildParentCrumb(row);
        sections.push(
          `${sevEmoji} ${linked}${outcomeTag}${dryTag}\n` +
            (parentCrumb ? `   _${parentCrumb}_\n` : "") +
            `   \`${row.ruleId}\` — ${row.ruleMessage || ""}` +
            (metricsLine ? `\n   _${metricsLine}_` : "") +
            (row.error ? `\n   :warning: ${row.error}` : ""),
        );
      }
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: sections.join("\n") },
    });
  }

  // Account-level errors (e.g. /me/adaccounts failed, token expired) —
  // these don't appear in the per-action detail because no rows were
  // written for them, so surface them as their own footer section.
  const errored = (summary.accounts || []).filter((a) => a && !a.ok);
  if (errored.length) {
    blocks.push({ type: "divider" });
    const lines = errored.map((acc) => {
      const acctLink = metaAdsManagerUrl({ adAccountId: acc.adAccountId });
      const nameLink = acctLink
        ? `<${acctLink}|*${acc.name}*>`
        : `*${acc.name}*`;
      return `❌ ${nameLink} \`${acc.adAccountId}\` — ${acc.error || "unknown error"}`;
    });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Errors*\n${lines.join("\n")}`,
      },
    });
  }

  return {
    text: header,
    blocks,
  };
}

/**
 * Plain-text body. Used as the SendGrid multipart `text` fallback (when the
 * recipient's mail client can't render HTML) and as the Slack `text` field
 * for clients that don't render block-kit. When `rows` is supplied, the
 * body includes per-entity detail; without it, falls back to count rollups.
 */
function buildPlainTextSummary(summary, rows = []) {
  const dryLabel = summary.dryRun ? " (DRY RUN)" : "";
  const lines = [
    `AdsGPT Autopilot cycle complete${dryLabel}`,
    `runId: ${summary.runId}  duration: ${summary.durationMs}ms`,
    "",
  ];

  // Top firing rules
  const topRules = topFiringRules(rows, 5);
  if (topRules.length) {
    lines.push("Top firing rules:");
    for (const r of topRules) {
      lines.push(
        `  - ${r.count} × ${r.ruleMessage || r.ruleId} (${r.ruleId}, ${r.severity})`,
      );
    }
    lines.push("");
  }

  for (const acc of summary.accounts || []) {
    if (!acc.ok) {
      lines.push(`  [ERROR] ${acc.name} (${acc.adAccountId}): ${acc.error}`);
      continue;
    }
    const p = acc.pause || {};
    const r = acc.resume || {};
    const s = acc.scale || {};
    const rot = acc.rotate || {};
    const bits = [
      // Show post-severity-floor count, not raw audit count — see comment
      // in buildSlackPayload for the rationale.
      `findings=${p.actionable_count ?? p.findings_count ?? 0}`,
      summary.dryRun
        ? `would-pause=${p.would_pause ?? 0}`
        : `paused=${p.paused ?? 0}`,
      summary.dryRun
        ? `would-resume=${r.would_resume ?? 0}`
        : `resumed=${r.resumed ?? 0}`,
    ];
    if (acc.scale)
      bits.push(
        summary.dryRun
          ? `would-scale=${s.would_scale ?? 0}`
          : `scaled=${s.scaled ?? 0}`,
      );
    if (acc.rotate)
      bits.push(
        summary.dryRun
          ? `would-rotate=${rot.would_rotate ?? 0}`
          : `rotated=${rot.rotated ?? 0}`,
      );
    lines.push(
      `  ${acc.name} (${acc.adAccountId}): ${bits.join(", ")}  ${metaAdsManagerUrl({ adAccountId: acc.adAccountId })}`,
    );
  }

  // Per-entity detail block, grouped by account → action.
  const grouped = groupActionsByAccountAndType(rows);
  if (grouped.size > 0) {
    lines.push("");
    lines.push("Action detail:");
    for (const [adAccountId, byAction] of grouped.entries()) {
      const acc = (summary.accounts || []).find(
        (a) => a.adAccountId === adAccountId,
      );
      const acctName = acc?.name || adAccountId;
      lines.push("");
      lines.push(`  Account: ${acctName} (${adAccountId})`);
      for (const [action, list] of byAction.entries()) {
        const label = ACTION_LABELS[action] || action;
        lines.push(`    ${label} (${list.length}):`);
        for (const row of list) {
          const dryTag = row.dryRun ? " [dry-run]" : "";
          const outTag =
            row.outcome === "failed"
              ? " [FAILED]"
              : row.outcome === "skipped"
                ? " [skipped]"
                : "";
          lines.push(
            `      • ${row.entityName || row.entityId} (${row.level}: ${row.entityId})${outTag}${dryTag}`,
          );
          const parentCrumb = buildParentCrumb(row);
          if (parentCrumb) lines.push(`        in: ${parentCrumb}`);
          lines.push(
            `        ${row.ruleId} [${row.ruleSeverity || ""}] — ${row.ruleMessage || ""}`,
          );
          const metricsLine = formatKeyMetrics(row.metricsSnapshot);
          if (metricsLine) lines.push(`        metrics: ${metricsLine}`);
          if (row.skipReason)
            lines.push(`        skip: ${row.skipReason}`);
          if (row.error) lines.push(`        error: ${row.error}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Throttling — Redis SET NX EX cooldown
// ---------------------------------------------------------------------------

/**
 * `key` is the throttle-namespace key (caller composes whatever uniqueness
 * matters: cycle-level for slack, per-user for email). Returns true if the
 * alert SHOULD be sent (no cooldown active), and atomically sets the
 * cooldown for `minutes`. Fails open if Redis is unavailable — alert
 * delivery is more important than rate-limiting.
 */
async function reserveAlertSlot({ key, minutes }) {
  const r = redisClient();
  if (!r) return true;
  try {
    const set = await r.set(key, "1", "EX", minutes * 60, "NX");
    return set === "OK";
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Slack dispatch
// ---------------------------------------------------------------------------

async function postSlack(payload, { webhookUrl, timeoutMs = 10000 } = {}) {
  if (!webhookUrl) return { sent: false, reason: "no-webhook" };
  try {
    await axios().post(webhookUrl, payload, { timeout: timeoutMs });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: "post-failed",
      error: err && err.message ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Email dispatch — SendGrid
// ---------------------------------------------------------------------------

// Cap on multi-email fan-out. The validator enforces this at save-time;
// `parseEmailRecipients` enforces it again at send-time as defense in
// depth (catches docs that predate the validator's cap).
const MAX_EMAIL_RECIPIENTS = 5;

/**
 * Parse the user-configured `alerts.emailTo` string into a deduped list
 * of recipient addresses. The setting is stored as comma-separated text
 * (validated at save-time) so a team can type
 * "alice@x.com, bob@x.com, charlie@x.com" into a single field; downstream
 * code wants an array.
 *
 * Trims whitespace, drops empties, lowercases for dedup (so "A@X.com"
 * and "a@x.com" don't both get a copy), preserves first-seen order for
 * stable logs, and clamps at MAX_EMAIL_RECIPIENTS.
 */
function parseEmailRecipients(emailTo) {
  if (!emailTo) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(emailTo).split(",")) {
    const addr = raw.trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
    if (out.length >= MAX_EMAIL_RECIPIENTS) break;
  }
  return out;
}

async function sendEmail({ to, subject, text, html }) {
  const sg = sgMail();
  if (!sg) return { sent: false, reason: "email-not-configured" };
  if (!to) return { sent: false, reason: "no-recipient" };
  const from = process.env.AUTOPILOT_EMAIL_FROM || "autopilot@adsgpt.io";

  // Normalize `to` into the explicit personalizations form. Passing
  // `to: ["a@x.com", "b@x.com"]` to `sg.send` SHOULD send one email with
  // both addresses in the To: header, but the SDK's implicit handling
  // is brittle — depending on `@sendgrid/mail` version it sometimes
  // drops everything after the first address, especially when the
  // surrounding object has no `personalizations`. Building the
  // personalization ourselves makes the contract unambiguous: one
  // email, every address visible in the To: header, every recipient
  // delivered to.
  const recipients = Array.isArray(to) ? to : [to];
  const cleanRecipients = recipients
    .map((r) => String(r || "").trim())
    .filter(Boolean);
  if (!cleanRecipients.length) return { sent: false, reason: "no-recipient" };

  try {
    // tracking_settings disables every form of SendGrid URL rewriting +
    // tracking pixel. By default the account-level settings rewrite
    // every <a> in the HTML body as `https://url####.sendgrid.net/...`
    // so users see the tracking domain instead of `business.facebook.com`
    // / `adsgpt.io`. We explicitly opt OUT per-message so even if someone
    // re-enables click tracking at the account level later, our alerts
    // stay clean.
    const msg = {
      from,
      subject,
      text,
      personalizations: [
        {
          to: cleanRecipients.map((email) => ({ email })),
        },
      ],
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
        ganalytics: { enable: false },
      },
    };
    if (html) msg.html = html;
    await sg.send(msg);
    return { sent: true, recipients: cleanRecipients };
  } catch (err) {
    // SendGrid wraps the API response in `err.response.body.errors[]`.
    const sgErrors =
      err?.response?.body?.errors || err?.response?.body?.error || null;
    const detail = sgErrors
      ? Array.isArray(sgErrors)
        ? sgErrors.map((e) => e.message).join("; ")
        : String(sgErrors)
      : err && err.message
        ? err.message
        : String(err);
    return { sent: false, reason: "send-failed", error: detail };
  }
}

// ---------------------------------------------------------------------------
// Telegram dispatch
// ---------------------------------------------------------------------------

/**
 * Compact HTML body for a Telegram message. Mirrors `buildEmailHtml`'s
 * structure (header → top rules → per-account / per-action / per-entity
 * → errors footer) but trimmed for Telegram's HTML tag set (<b>, <i>,
 * <u>, <a>, <code>, <pre>) and 4096-char message cap.
 *
 * Only accounts that actually had actions in this cycle are rendered —
 * the old version listed every audited account with `findings=0 ·
 * paused=0 · resumed=0` rollups, which was just noise for read-mostly
 * accounts. Account-level errors (token expired, API limit reached) are
 * surfaced as a separate footer so they don't get lost.
 *
 * Truncates at the cap with an ellipsis so a very chatty cycle never
 * throws "MESSAGE_TOO_LONG".
 */
function buildTelegramHtml(summary, rows = []) {
  const escape = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const dryLabel = summary.dryRun ? " (DRY RUN)" : "";
  const lines = [
    `<b>AdsGPT Autopilot${escape(dryLabel)}</b>`,
    `run <code>${escape(summary.runId || "—")}</code> · ${summary.durationMs || 0}ms`,
  ];

  // Top firing rules
  const topRules = topFiringRules(rows, 5);
  if (topRules.length) {
    lines.push("");
    lines.push("<b>Top firing rules</b>");
    for (const r of topRules) {
      const emoji = SEVERITY_EMOJI[r.severity] || "•";
      lines.push(
        `${emoji} <b>${r.count}×</b> ${escape(r.ruleMessage || r.ruleId)}`,
      );
    }
  }

  // Per-account / per-action — only accounts that had rows this cycle.
  const grouped = groupActionsByAccountAndType(rows);
  const nameByAccount = new Map();
  for (const acc of summary.accounts || []) {
    if (acc && acc.adAccountId) {
      nameByAccount.set(acc.adAccountId, acc.name || acc.adAccountId);
    }
  }

  if (grouped.size === 0) {
    lines.push("");
    lines.push("<i>No actions taken or proposed in this cycle.</i>");
  } else {
    for (const [adAccountId, byAction] of grouped.entries()) {
      const acctName = nameByAccount.get(adAccountId) || adAccountId;
      const acctLink = metaAdsManagerUrl({ adAccountId });
      lines.push("");
      lines.push(
        `<b><a href="${escape(acctLink)}">${escape(acctName)}</a></b>`,
      );

      for (const [action, list] of byAction.entries()) {
        const label = ACTION_LABELS[action] || action;
        lines.push(`<b>${escape(label)}</b> (${list.length})`);
        for (const row of list) {
          const entityLink = metaAdsManagerUrl({
            adAccountId: row.adAccountId,
            level: row.level,
            entityId: row.entityId,
          });
          const entityName = row.entityName || row.entityId;
          const linked = entityLink
            ? `<a href="${escape(entityLink)}">${escape(entityName)}</a>`
            : `<b>${escape(entityName)}</b>`;
          const sevEmoji = SEVERITY_EMOJI[row.ruleSeverity] || "•";
          const dryTag = row.dryRun ? " <i>(dry-run)</i>" : "";
          const outTag =
            row.outcome === "failed"
              ? " ❌"
              : row.outcome === "skipped"
                ? " ⏭"
                : "";
          lines.push(`${sevEmoji} ${linked}${outTag}${dryTag}`);
          const parentCrumb = buildParentCrumb(row);
          if (parentCrumb) {
            lines.push(`  <i>${escape(parentCrumb)}</i>`);
          }
          if (row.ruleMessage) {
            lines.push(`  ${escape(row.ruleMessage)}`);
          }
          const metricsLine = formatKeyMetrics(row.metricsSnapshot);
          if (metricsLine) {
            lines.push(`  <i>${escape(metricsLine)}</i>`);
          }
          if (row.error) {
            lines.push(`  ⚠ ${escape(row.error)}`);
          }
        }
      }
    }
  }

  // Account-level errors (e.g. token expired, API request limit reached) —
  // these don't appear in the per-action detail because no rows were
  // written for them, so surface them as their own footer section. Mirrors
  // the email + Slack "Errors" block.
  const errored = (summary.accounts || []).filter((a) => a && !a.ok);
  if (errored.length) {
    lines.push("");
    lines.push("<b>Errors</b>");
    for (const acc of errored) {
      lines.push(
        `❌ <b>${escape(acc.name || acc.adAccountId)}</b> — ${escape(acc.error || "unknown error")}`,
      );
    }
  }

  let body = lines.join("\n");
  if (body.length > 4000) {
    body = body.slice(0, 3990) + "\n…(truncated)";
  }
  return body;
}

/**
 * POST a sendMessage call to Telegram's Bot API.
 *
 * Returns `{ sent: true }` on HTTP 200 + `{ ok: true }` body.
 * Returns `{ sent: false, reason, error }` for every failure mode:
 *   - `no-token` / `no-chat-id` if the user's settings are incomplete
 *   - `post-failed` for network errors
 *   - `api-error` when Telegram says `ok: false` (bad token, blocked bot,
 *     wrong chat id, bot not added to group/channel) — `error` carries
 *     Telegram's `description` so the UI test panel can surface the cause.
 */
async function postTelegram(
  { text, botToken, chatId, parseMode = "HTML", timeoutMs = 10000 } = {},
) {
  if (!botToken) return { sent: false, reason: "no-token" };
  if (!chatId) return { sent: false, reason: "no-chat-id" };
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const r = await axios().post(
      url,
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
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

// ---------------------------------------------------------------------------
// alertOn chip → action-log row matcher
// ---------------------------------------------------------------------------

/**
 * Does this action-log row match the user's "Notify me about" chip
 * selection? Pure function — no side effects. v4 chips are user-defined
 * severities (low/medium/high) and match `row.ruleSeverity` directly.
 */
function rowMatchesAlertOn(row, alertOn) {
  if (!row || !Array.isArray(alertOn) || alertOn.length === 0) return false;
  const set = new Set(alertOn);
  if (row.ruleSeverity && set.has(row.ruleSeverity)) return true;
  return false;
}

// v3→v4 severity remap. Existing autopilotSettings docs from before the
// v4 cutover have alertOn arrays full of legacy bucket names; we upgrade
// them on read so the user keeps getting alerts without needing to revisit
// Settings. The PATCH validator only accepts v4 values, so anything saved
// after the cutover is already clean.
const LEGACY_SEVERITY_MAP = {
  critical: "high",
  warning: "medium",
  opportunity: "low",
};

function remapLegacyAlertOn(values) {
  const out = new Set();
  for (const v of values) {
    if (LEGACY_SEVERITY_MAP[v]) out.add(LEGACY_SEVERITY_MAP[v]);
    else if (v === "low" || v === "medium" || v === "high") out.add(v);
    // Legacy synthetic chips (budget_anomaly / scale_action / flap) drop —
    // their underlying triggers no longer exist in v4.
  }
  return Array.from(out);
}

/**
 * Resolve the user's effective alertOn list. Missing/null falls back to the
 * schema default (`['high']`) so users who never visited Settings still get
 * the safe default. An explicit empty array is a deliberate opt-out — we
 * honor it by returning [] (caller will skip the alert). Legacy v3 chip
 * values are remapped to v4 severities so existing users keep their alert
 * preferences across the cutover.
 */
function resolveAlertOn(settingsDoc) {
  const raw = settingsDoc && settingsDoc.alerts && settingsDoc.alerts.alertOn;
  if (raw == null) return ["high"];
  if (!Array.isArray(raw)) return ["high"];
  // Empty array is a deliberate opt-out — respect it exactly.
  if (raw.length === 0) return [];
  return remapLegacyAlertOn(raw);
}

// ---------------------------------------------------------------------------
// Main entry — multi-tenant aware
// ---------------------------------------------------------------------------

/**
 * Dispatch alerts for an orchestrator cycle. Both channels fan-out per
 * opted-in user — each tenant gets a slack post + email containing only
 * their own accounts (privacy boundary).
 *
 * @param {Object} summary   the cycle result from `runAutopilotCycle`.
 *
 * Returns
 *   {
 *     slacks: [{ userId, sent, reason?, error?, throttled? }, ...],
 *     emails: [{ userId, sent, reason?, error?, throttled? }, ...]
 *   }
 *
 * Never throws. Per-user failures (in either channel) don't block other
 * users or the other channel for that user.
 */
async function notifyAutopilotCycle(summary) {
  const logger = getLogger();

  const throttleMin = Math.max(
    1,
    parseInt(process.env.AUTOPILOT_ALERT_THROTTLE_MINUTES || "60", 10) || 60,
  );

  const slacks = [];
  const emails = [];
  const telegrams = [];
  const groups = groupAccountsByUser(summary);

  if (groups.size === 0) {
    slacks.push({ sent: false, reason: "no-accounts" });
    emails.push({ sent: false, reason: "no-accounts" });
    telegrams.push({ sent: false, reason: "no-accounts" });
    return { slacks, emails, telegrams };
  }

  // Shared bot token — one bot owned by AdsGPT, configured at deploy
  // time. Read once per cycle (not per user) so a missing env var is
  // visible in logs without spamming.
  const sharedTelegramToken =
    process.env.AUTOPILOT_TELEGRAM_BOT_TOKEN || null;

  const Settings = AutopilotSettings();
  for (const [userId] of groups.entries()) {
    // Single Mongo round-trip per user pulling channel addresses + chip
    // selection at once.
    let slackUrl = null;
    let emailTo = null;
    let telegramChatId = null;
    let alertOn = ["high"];
    try {
      if (Settings) {
        const doc = await Settings.findOne(
          { userId },
          {
            "alerts.slackWebhookUrl": 1,
            "alerts.emailTo": 1,
            "alerts.telegramChatId": 1,
            "alerts.alertOn": 1,
          },
        ).lean();
        slackUrl = (doc && doc.alerts && doc.alerts.slackWebhookUrl) || null;
        emailTo = (doc && doc.alerts && doc.alerts.emailTo) || null;
        telegramChatId =
          (doc && doc.alerts && doc.alerts.telegramChatId) || null;
        alertOn = resolveAlertOn(doc);
      }
    } catch (err) {
      logger.warn(
        `[autopilot] alertService: settings lookup failed for userId=${userId}: ${err.message}`,
      );
    }

    const userSlice = sliceSummaryByUser(summary, userId);

    // Load this user's action-log rows for THIS run, once. Used by both
    // Slack and email formatters to render per-entity detail (entity name,
    // rule, why, key metrics) instead of just count rollups.
    const userRows = await loadActionRowsForUser(summary.runId, userId);

    // The "Notify me about" chip selection is the sole trigger. Filter the
    // user's rows down to ones matching any selected chip; if the result is
    // empty (either because they unchecked everything, or because nothing
    // they care about happened this cycle), skip both channels.
    const matchingRows = userRows.filter((row) =>
      rowMatchesAlertOn(row, alertOn),
    );

    if (matchingRows.length === 0) {
      slacks.push({ userId, sent: false, reason: "no-matching-activity" });
      emails.push({ userId, sent: false, reason: "no-matching-activity" });
      telegrams.push({ userId, sent: false, reason: "no-matching-activity" });
      continue;
    }

    // ─── Slack (per-user) ─────────────────────────────────────────────────
    if (!slackUrl) {
      slacks.push({ userId, sent: false, reason: "no-webhook" });
    } else {
      const allowed = await reserveAlertSlot({
        key: `autopilot:alert:user:${userId}:slack`,
        minutes: throttleMin,
      });
      if (!allowed) {
        slacks.push({
          userId,
          sent: false,
          reason: "throttled",
          throttled: true,
          cooldownMinutes: throttleMin,
        });
      } else {
        const r = await postSlack(buildSlackPayload(userSlice, matchingRows), {
          webhookUrl: slackUrl,
        });
        slacks.push({ userId, ...r });
        if (!r.sent) {
          logger.warn(
            `[autopilot] Slack alert not sent (userId=${userId}): ${r.reason}${r.error ? " — " + r.error : ""}`,
          );
        }
      }
    }

    // ─── Telegram (per-user) ──────────────────────────────────────────────
    // Placed BEFORE email so the email block's `continue` short-circuit
    // (used for no-recipient + throttled) doesn't accidentally skip
    // Telegram dispatch for a user who has Telegram set but not email.
    //
    // The bot is shared across all users (env-supplied token), so the
    // per-user gate is just "did they paste a chat id?". A missing env
    // token is a deploy/config issue and gets reported as `no-token`
    // exactly once per user (helpful for ops triage) without making the
    // user feel they did something wrong.
    if (!sharedTelegramToken) {
      telegrams.push({ userId, sent: false, reason: "no-token" });
    } else if (!telegramChatId) {
      telegrams.push({ userId, sent: false, reason: "no-chat-id" });
    } else {
      const tgAllowed = await reserveAlertSlot({
        key: `autopilot:alert:user:${userId}:telegram`,
        minutes: throttleMin,
      });
      if (!tgAllowed) {
        telegrams.push({
          userId,
          sent: false,
          reason: "throttled",
          throttled: true,
          cooldownMinutes: throttleMin,
        });
      } else {
        const r = await postTelegram({
          text: buildTelegramHtml(userSlice, matchingRows),
          botToken: sharedTelegramToken,
          chatId: telegramChatId,
        });
        telegrams.push({ userId, ...r });
        if (!r.sent) {
          logger.warn(
            `[autopilot] Telegram alert not sent (userId=${userId}): ${r.reason}${r.error ? " — " + r.error : ""}`,
          );
        }
      }
    }

    // ─── Email (per-user) ─────────────────────────────────────────────────
    // emailTo is a comma-separated list (validated at save-time, max 5).
    // Parse into a deduped array so SendGrid delivers one copy of the
    // cycle summary to each recipient in a single send call.
    const recipients = parseEmailRecipients(emailTo);
    if (!recipients.length) {
      emails.push({ userId, sent: false, reason: "no-recipient" });
      continue;
    }
    const emailAllowed = await reserveAlertSlot({
      key: `autopilot:alert:user:${userId}:email`,
      minutes: throttleMin,
    });
    if (!emailAllowed) {
      emails.push({
        userId,
        sent: false,
        reason: "throttled",
        throttled: true,
        cooldownMinutes: throttleMin,
      });
      continue;
    }
    const r = await sendEmail({
      to: recipients,
      subject: `AdsGPT Autopilot cycle ${summary.dryRun ? "(dry-run) " : ""}— ${summary.runId}`,
      text: buildPlainTextSummary(userSlice, matchingRows),
      html: buildEmailHtml(userSlice, matchingRows),
    });
    emails.push({ userId, recipients, ...r });
    if (!r.sent) {
      logger.warn(
        `[autopilot] Email alert not sent (userId=${userId}, recipients=${recipients.length}): ${r.reason}${r.error ? " — " + r.error : ""}`,
      );
    }
  }

  return { slacks, emails, telegrams };
}

module.exports = {
  notifyAutopilotCycle,
  // exported for tests
  buildSlackPayload,
  buildPlainTextSummary,
  buildEmailHtml,
  buildTelegramHtml,
  metaAdsManagerUrl,
  postSlack,
  postTelegram,
  sendEmail,
  parseEmailRecipients,
  MAX_EMAIL_RECIPIENTS,
  reserveAlertSlot,
  sliceSummaryByUser,
  groupAccountsByUser,
  groupActionsByAccountAndType,
  topFiringRules,
  formatKeyMetrics,
  loadActionRowsForUser,
  rowMatchesAlertOn,
  resolveAlertOn,
};
