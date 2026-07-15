/**
 * adsFactoryAlertService — cycle-complete alert emails for Ads Factory Autopilot.
 *
 * After every run cycle finishes (success / partial / failed), the orchestrator
 * calls notifyAdsFactoryRun() with the job, its campaign, and the run-history
 * entry just recorded. This module resolves the job's alert recipients and
 * emails them a summary of that cycle (status, platforms posted to, ad IDs,
 * creatives generated, generation health, error).
 *
 * Reuses the shared SendGrid sender from ../autopilot/alertService — we do NOT
 * duplicate the SendGrid client. From-address + API key come from the same env
 * vars documented there (SENDGRID_API_KEY, AUTOPILOT_EMAIL_FROM).
 *
 * Recipients
 *   job.alerts.emailTo — a comma-separated list (up to 5), validated at
 *   save-time by the createJob/updateJob Joi schema. Empty/unset → no email is
 *   sent (the cycle is unaffected). A caller may pass `toOverride` to force a
 *   recipient list (used by the /test-email endpoint).
 *
 * Never throws — every failure is logged and swallowed. Emailing must never be
 * able to break a run cycle. Same fire-and-forget contract as the Meta
 * Autopilot's notifyAutopilotCycle.
 */

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

// Reuse the shared SendGrid sender — same one the Meta Autopilot + newsletter
// use. Lazy-required to avoid any load-order surprises.
let _sendEmail;
function sendEmailFn() {
  if (_sendEmail === undefined) {
    try {
      _sendEmail = require("../autopilot/alertService").sendEmail;
    } catch (err) {
      getLogger().error(`[adsFactoryAuto:alert] could not load shared sendEmail: ${err.message}`);
      _sendEmail = null;
    }
  }
  return _sendEmail;
}

let _UserProfile;
function UserProfile() {
  if (_UserProfile === undefined) {
    try {
      _UserProfile = require("../../Module/user/userProfileModel");
    } catch {
      _UserProfile = null;
    }
  }
  return _UserProfile;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const MAX_EMAIL_RECIPIENTS = 5;

/**
 * Parse the job's comma-separated `alerts.emailTo` string into a deduped list
 * of recipient addresses. Mirrors alertService.parseEmailRecipients exactly:
 * trims, drops empties, lowercases for dedup, preserves first-seen order,
 * clamps at MAX_EMAIL_RECIPIENTS.
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

// `color`  — the status accent (headline, band border, tile values)
// `soft`   — a tinted background for the top status band
// `dot`    — the status indicator dot color (same family as `color`)
const STATUS_META = {
  success: { emoji: "🟢", label: "Your ads were posted",         color: "#0f9d63", soft: "#eaf7f0", dot: "#0f9d63" },
  partial: { emoji: "🟡", label: "Some ads didn't post",         color: "#c8851a", soft: "#fbf3e4", dot: "#e0a428" },
  failed:  { emoji: "🔴", label: "This run failed",               color: "#d64545", soft: "#fdecec", dot: "#d64545" },
  skipped: { emoji: "⏭",  label: "This run was skipped",          color: "#5b6b7b", soft: "#eef2f6", dot: "#8b98a5" },
};

/**
 * Translate a raw platform API error into plain language a non-technical
 * user can act on. Matches on distinctive substrings from Meta/Google's own
 * error text — order matters, first match wins. Falls back to the raw
 * message (still shown, just not friendly) for anything unrecognized, so
 * an unmapped error is never silently hidden.
 */
const FRIENDLY_ERROR_PATTERNS = [
  {
    test: /doesn.?t have permission to access customer|login-customer-id|USER_PERMISSION_DENIED/i,
    friendly: (platform) =>
      `${platform} couldn't post this ad because this ${platform} account isn't connected properly. ` +
      `Please reconnect it or choose a different ${platform} account in this automation's settings.`,
  },
  {
    test: /access token.*(expired|invalid)|OAuthException/i,
    friendly: (platform) =>
      `${platform} couldn't post this ad because the connection to your ${platform} account has expired. ` +
      `Please reconnect your ${platform} account and try again.`,
  },
  {
    test: /No Facebook account linked|No Google account linked/i,
    friendly: (platform) =>
      `${platform} couldn't post this ad because no ${platform} account is linked yet. ` +
      `Please connect a ${platform} account in this automation's settings.`,
  },
  {
    test: /billing|payment method/i,
    friendly: (platform) =>
      `${platform} couldn't post this ad because of a billing issue on the ${platform} account. ` +
      `Please check the account's billing/payment settings.`,
  },
];

function friendlyPlatformError(platform, rawMessage) {
  if (!rawMessage) return rawMessage;
  const pretty = platform.charAt(0).toUpperCase() + platform.slice(1);
  for (const { test, friendly } of FRIENDLY_ERROR_PATTERNS) {
    if (test.test(rawMessage)) return friendly(pretty);
  }
  return rawMessage;
}

// Whole-run errors that aren't tied to a single platform (generation failures,
// server interruptions, credits, name collisions). These reach the email as a
// bare run.error string with no "platform: " prefix, so they'd otherwise show
// raw developer text. Translate them into plain language a marketer can act on.
const FRIENDLY_GENERAL_PATTERNS = [
  {
    test: /campaign generation failed|generation failed|status updated to error/i,
    friendly: () =>
      "We couldn't finish creating the ad creatives for this run. No credits were charged for the ads that didn't post. The automation will try again on its next scheduled run.",
  },
  {
    test: /interrupted mid-run|server restart|stuck in-progress/i,
    friendly: () =>
      "This run was interrupted before it could finish. The automation will try again on its next scheduled run.",
  },
  {
    test: /insufficient credits|not enough credits/i,
    friendly: () =>
      "This run was paused because your account is out of credits. Add more credits, then resume the automation from its settings.",
  },
  {
    test: /campaign with this name already exists|duplicate campaign name/i,
    friendly: () =>
      "A campaign with this name already exists on your ad account, so we paused the automation. Open its settings, choose a different campaign name, and resume it.",
  },
  {
    test: /account not connected|reconnect it or remove/i,
    friendly: () =>
      "One of your connected ad accounts is no longer linked, so we paused the automation. Reconnect the account (or remove that platform) in the automation's settings, then resume it.",
  },
];

// Turn any run-level error into user-friendly copy. Platform-prefixed segments
// ("meta: ...") go through friendlyPlatformError; otherwise we try the general
// patterns; and as a last resort we hide the raw text behind a generic line so
// a marketer never sees internal error strings.
function friendlyRunError(rawMessage) {
  if (!rawMessage) return rawMessage;
  for (const { test, friendly } of FRIENDLY_GENERAL_PATTERNS) {
    if (test.test(rawMessage)) return friendly();
  }
  // Unmapped — don't leak developer text; give a safe, generic explanation.
  return "Something went wrong on this run. The automation will try again on its next scheduled run — no action is needed unless this keeps happening.";
}

const escapeHtml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Normalize the platformAdIds field (stored as a Mongoose Map or a plain
 * object depending on code path) into a plain { platform: adId } object.
 */
function normalizePlatformAdIds(run) {
  const ids = run && run.platformAdIds;
  if (!ids) return {};
  if (ids instanceof Map) return Object.fromEntries(ids);
  return ids;
}

/**
 * Resolve a platform's ad account id from the job's saved template so we can
 * build a deep link to the live ad. Meta stores it as `adAccountId`; Google
 * uses `adAccountId` or `customerId` (or the top-level template.customerId).
 * Returns null when unresolvable — the caller then renders the ad id as plain
 * text instead of a link.
 */
function resolveAdAccountId(job, platform) {
  const tpl = job && job.targets && job.targets[platform] && job.targets[platform].template;
  if (!tpl) return null;
  const payload = tpl.payload || {};
  if (platform === "meta") {
    return payload.adAccountId || null;
  }
  if (platform === "google") {
    return payload.adAccountId || payload.customerId || tpl.customerId || null;
  }
  return null;
}

/**
 * Deep link to the created ad(s) on the platform's own manager UI.
 *   - meta   → Meta Ads Manager, ads view, pre-selected ad id(s). `adId` may be
 *              a comma-joined list (the orchestrator joins multiple ads per
 *              cycle with ","), which `selected_ad_ids` accepts directly.
 *   - google → Google Ads, scoped to the customer account. Google Ads has no
 *              stable public deep-link to an individual ad id, so we link to
 *              the account's Ads overview (the closest reliable target).
 * Returns null when we can't build a usable URL (missing account id).
 */
function platformAdUrl(platform, adAccountId, adId, context) {
  if (!adAccountId) return null;
  const rawAcct = String(adAccountId);
  if (platform === "meta") {
    const acct = rawAcct.startsWith("act_") ? rawAcct.slice(4) : rawAcct;
    const base = "https://business.facebook.com/adsmanager/manage/ads";
    return adId
      ? `${base}?act=${acct}&selected_ad_ids=${encodeURIComponent(adId)}`
      : `${base}?act=${acct}`;
  }
  if (platform === "google") {
    // Google customer ids are often shown as 123-456-7890 but the URL wants
    // the digits only.
    const acct = rawAcct.replace(/[^0-9]/g, "");
    if (!acct) return null;
    // Scope the deep link to the campaign/ad group this run created —
    // Google Ads has no stable per-ad deep link, but campaignId+adGroupId
    // gets the user to the exact ad group the ad lives in.
    const params = [`__c=${acct}`];
    if (context && context.campaignId) params.push(`campaignId=${encodeURIComponent(context.campaignId)}`);
    if (context && context.adGroupId) params.push(`adGroupId=${encodeURIComponent(context.adGroupId)}`);
    return `https://ads.google.com/aw/ads?${params.join("&")}`;
  }
  return null;
}

// Friendly label for the "view ad" link, per platform.
const PLATFORM_LINK_LABEL = {
  meta: "View ad in Meta Ads Manager →",
  google: "View in Google Ads →",
};

/**
 * Count how many images / texts a run actually generated (status 200) vs how
 * many were requested (pairsPerCycle). Reads the same rawImages/rawTexts the
 * orchestrator persisted on the run entry, so the numbers match getJobStats.
 */
function generationHealth(job, run) {
  const requested = job && job.pairsPerCycle ? job.pairsPerCycle : 1;
  const imagesGenerated = (run.rawImages || []).filter((i) => i && i.status === 200).length;
  const textsGenerated  = (run.rawTexts  || []).filter((t) => t && t.status === 200).length;
  return {
    imagesRequested: requested,
    imagesGenerated,
    textsRequested:  requested,
    textsGenerated,
    creativesAssembled: (run.automationCreatives || []).length,
  };
}

// ─── HTML + plain-text builders ─────────────────────────────────────────────
// Inline styles only (no <style> blocks) for max email-client compatibility —
// same approach + branding as the Meta Autopilot's buildEmailHtml.

function buildRunEmailHtml(job, campaign, run) {
  const meta = STATUS_META[run.status] || STATUS_META.failed;
  const campaignName = (campaign && campaign.metadata && campaign.metadata.campaignName) || "Campaign";
  const adIds = normalizePlatformAdIds(run);
  const health = generationHealth(job, run);
  const durationMs =
    run.startedAt && run.completedAt
      ? new Date(run.completedAt) - new Date(run.startedAt)
      : null;

  // ── Design tokens ─────────────────────────────────────────────────────────
  // Email-safe only: system font stack, table layout, all-inline styles, web
  // colors. Neutrals are biased slightly cool toward the brand teal so the
  // palette reads as chosen, not defaulted.
  const INK    = "#0b1f33";  // near-black brand navy — headings
  const BODY   = "#3d4b5a";  // primary body text
  const MUTE    = "#7c8a99"; // secondary / meta text
  const HAIR    = "#e6ebf0"; // hairline dividers + borders
  const CARD    = "#f6f8fb"; // tinted card ground
  const TEAL    = "#0e9db8"; // AdsGPT accent (links, buttons)
  const PAGE_BG = "#eef2f6"; // outer page ground (frames the card)

  const font    = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  const label    = `font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};`;

  const nextRunLabel  = job.schedule && job.schedule.nextRunAt
    ? new Date(job.schedule.nextRunAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const endDateLabel  = job.schedule && job.schedule.endDate
    ? new Date(job.schedule.endDate).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  // A single section wrapper: uppercase eyebrow label + inner content, divided
  // from the previous block by a hairline. Keeps vertical rhythm consistent.
  const section = (title, inner) =>
    `<tr><td style="padding:26px 32px 4px 32px;border-top:1px solid ${HAIR};">` +
    `<div style="${label}margin:0 0 14px 0;">${escapeHtml(title)}</div>${inner}</td></tr>`;

  let html = "";
  html += `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`;
  html += `<body style="margin:0;padding:0;background:${PAGE_BG};${font}">`;

  // Preheader — hidden inline preview text shown by inboxes next to the subject.
  const preheader = `${meta.label} · ${campaignName} · ${health.imagesGenerated}/${health.imagesRequested} images`;
  html += `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE_BG};font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>`;

  // Outer table — centers the 600px card on the page ground.
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:28px 12px;"><tr><td align="center">`;
  html += `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${HAIR};border-radius:14px;overflow:hidden;">`;

  // ── Masthead — logo + product name, on a clean white bar ────────────────────
  html += `<tr><td style="padding:26px 32px 20px 32px;">`;
  html += `<img src="https://adsgpt.io/wp-content/uploads/2024/10/Adsgpt-Header-colored-logo.webp" alt="AdsGPT" width="132" style="display:block;width:132px;max-width:132px;height:auto;border:0;font-size:16px;font-weight:700;color:${INK};${font}">`;
  html += `</td></tr>`;

  // ── Status band — the outcome, legible at a glance via a tinted band + dot ──
  html += `<tr><td style="padding:0 32px;">`;
  html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${meta.soft};border-radius:10px;">`;
  html += `<tr><td style="padding:16px 18px;">`;
  html += `<table role="presentation" cellpadding="0" cellspacing="0"><tr>`;
  html += `<td valign="middle" style="padding-right:10px;"><span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${meta.dot};"></span></td>`;
  html += `<td valign="middle">`;
  html += `<div style="font-size:18px;font-weight:700;color:${meta.color};line-height:1.2;">${escapeHtml(meta.label)}</div>`;
  html += `<div style="font-size:14px;color:${INK};margin-top:2px;">Ads Factory · <strong>${escapeHtml(campaignName)}</strong></div>`;
  html += `</td></tr></table>`;
  html += `</td></tr></table>`;
  html += `</td></tr>`;

  // Parses run.error's "platform: message" segments (joined with " | " by
  // the orchestrator) back into a per-platform list. Used both by the
  // top-level error banner and the "Posted ads" failed-platform cards below,
  // each translated into plain language via friendlyPlatformError.
  const failedPlatformEntries = (run.error || "")
    .split(" | ")
    .map((seg) => {
      const idx2 = seg.indexOf(": ");
      if (idx2 === -1) return null;
      return { platform: seg.slice(0, idx2).trim(), message: seg.slice(idx2 + 2).trim() };
    })
    .filter(Boolean);

  // ── Error (only when the cycle failed) ─────────────────────────────────────
  if (run.error) {
    const friendlyLines = failedPlatformEntries.length
      ? failedPlatformEntries.map((f) => friendlyPlatformError(f.platform, f.message))
      : [friendlyRunError(run.error)];
    html += `<tr><td style="padding:0 32px 4px 32px;">`;
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdecec;border:1px solid #f6cccc;border-radius:10px;"><tr>`;
    html += `<td style="width:4px;background:#d64545;"></td>`;
    html += `<td style="padding:12px 16px;">`;
    html += `<div style="${label}color:#b23636;margin-bottom:4px;">What went wrong</div>`;
    friendlyLines.forEach((line, i) => {
      html += `<div style="font-size:13px;color:#7f2a2a;line-height:1.5;${i > 0 ? "margin-top:6px;" : ""}">${escapeHtml(line)}</div>`;
    });
    html += `</td></tr></table></td></tr>`;
  }

  const formatTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "—";
  const startDateStr = run.startedAt ? formatTime(run.startedAt) : "—";
  const durationDisplay = durationMs != null
    ? (durationMs < 1000 ? "less than a second" : `${(durationMs / 1000).toFixed(1)}s`)
    : "—";
  const postedCount = Object.keys(adIds).reduce((acc, p) => acc + (adIds[p] ? adIds[p].split(",").length : 0), 0);
  // Platforms that actually got at least one ad this run — one creative posted
  // to both Meta + Google is 2 ads, so show the total plus which platforms
  // rather than the misleading "N of <creatives>" (ads and creatives are
  // different units).
  const postedPlatforms = Object.keys(adIds)
    .filter((p) => adIds[p])
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  const postedValue = postedPlatforms.length
    ? `${postedCount} (${postedPlatforms.join(" + ")})`
    : String(postedCount);

  const RESULT_LABEL = { success: "Success", partial: "Partially completed", failed: "Failed", skipped: "Skipped" };
  const resultLabel = RESULT_LABEL[run.status] || run.status;

  const detailGrid =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${HAIR};border-radius:10px;margin:-4px 0 8px 0;">` +
    `<tr>` +
      `<td style="padding:14px 16px;border-bottom:1px solid ${HAIR};"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">Result</div><div style="font-size:15px;font-weight:700;color:${run.status === "success" ? TEAL : '#d93025'};margin-top:4px;">${escapeHtml(resultLabel)}</div></td>` +
      `<td style="padding:14px 16px;border-bottom:1px solid ${HAIR};border-left:1px solid ${HAIR};"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">Ads posted</div><div style="font-size:15px;font-weight:700;color:${INK};margin-top:4px;">${escapeHtml(postedValue)}</div></td>` +
    `</tr>` +
    `<tr>` +
      `<td style="padding:14px 16px;border-bottom:1px solid ${HAIR};"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">Started</div><div style="font-size:14px;font-weight:600;color:${INK};margin-top:4px;">${startDateStr}</div></td>` +
      `<td style="padding:14px 16px;border-bottom:1px solid ${HAIR};border-left:1px solid ${HAIR};"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">Duration</div><div style="font-size:14px;font-weight:600;color:${INK};margin-top:4px;">${escapeHtml(durationDisplay)}</div></td>` +
    `</tr>` +
    `<tr>` +
      `<td style="padding:14px 16px;"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">Next run</div><div style="font-size:14px;font-weight:600;color:${INK};margin-top:4px;">${nextRunLabel ? escapeHtml(nextRunLabel) : "—"}</div></td>` +
      `<td style="padding:14px 16px;border-left:1px solid ${HAIR};"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTE};">End date</div><div style="font-size:14px;font-weight:600;color:${INK};margin-top:4px;">${endDateLabel ? escapeHtml(endDateLabel) : "—"}</div></td>` +
    `</tr>` +
    `</table>`;

  html += section("Summary", detailGrid);

  // Posted-platform confirmation is already visible per-creative below (the
  // "Google ad →" / "Meta ad →" links), and failures already surface once in
  // the "What went wrong" banner above — a separate "Posted ads" section here
  // just repeated the same information a third time.

  // ── Creatives — bordered, zebra-striped table of this cycle's output ───────
  // One row PER PLATFORM AD, not per creative — a single creative posts a
  // separate Meta ad and Google ad, each with its own generated headline/body,
  // so each gets its own row/status/link instead of being collapsed together.
  const creatives = run.automationCreatives || [];
  const platformRows = [];
  creatives.forEach((c) => {
    const creativePostedIds = c.postedAdIds instanceof Map
      ? Object.fromEntries(c.postedAdIds)
      : (c.postedAdIds || {});

    [
      { key: "meta",   label: "Meta",   text: c.platformText?.meta },
      { key: "google", label: "Google", text: c.platformText?.google },
    ].forEach(({ key, label: platformLabel, text }) => {
      if (!text?.headline && !text?.message) return; // this platform had no copy for this creative

      const adId = creativePostedIds[key] || null;
      const posted = !!adId;
      platformRows.push({ platformLabel, key, text, adId, posted });
    });
  });

  if (platformRows.length) {
    // Long message bodies collapse behind a native <details> toggle so the
    // table stays scannable — clients that support <details> (Gmail app/web,
    // Apple Mail) get a real "View more"/"View less"; clients that don't
    // (Outlook) just render it permanently expanded, which is a safe
    // degrade since the full text is never actually hidden from those users.
    // Slice the RAW text first, then escape each piece separately — slicing
    // after escapeHtml() could cut an entity in half (e.g. "ROG&#39;s" →
    // "ROG&#3…") whenever the 140-char boundary lands inside one.
    const buildMessageBlock = (rawMsg) => {
      const rawPreview = rawMsg.length > 140 ? rawMsg.slice(0, 140).replace(/\s+\S*$/, "") : rawMsg;
      const msgText = escapeHtml(rawMsg);
      const previewCut = escapeHtml(rawPreview);
      return rawMsg.length > 140
        ? `<details style="margin-top:3px;">` +
            `<summary style="font-size:12px;color:${BODY};line-height:1.45;list-style:none;cursor:pointer;">` +
              `${previewCut}&hellip; <span style="color:${TEAL};font-weight:600;">View more</span>` +
            `</summary>` +
            `<div style="font-size:12px;color:${BODY};line-height:1.45;margin-top:4px;">${msgText}</div>` +
          `</details>`
        : `<div style="font-size:12px;color:${BODY};line-height:1.45;margin-top:3px;">${msgText}</div>`;
    };

    let rows = "";
    platformRows.forEach((r, idx) => {
      const zebra = idx % 2 ? `background:${CARD};` : "background:#ffffff;";

      const statusChip = r.posted
        ? `<span style="display:inline-block;background:#eaf7f0;color:#0f9d63;font-size:10.5px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:20px;">Posted</span>`
        : `<span style="display:inline-block;background:#fdecec;color:#b23636;font-size:10.5px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:20px;">Failed</span>`;

      let adLink = "";
      if (r.adId) {
        const url = platformAdUrl(r.key, resolveAdAccountId(job, r.key), r.adId, (run.platformContext && run.platformContext[r.key]) || null);
        if (url) adLink = `<div style="margin-top:6px;font-size:11px;"><a href="${escapeHtml(url)}" style="color:${TEAL};text-decoration:none;font-weight:600;">${r.platformLabel} ad &rarr;</a></div>`;
      }

      rows +=
        `<tr style="${zebra}">` +
        `<td style="padding:12px;border-top:1px solid ${HAIR};vertical-align:middle;">` +
          `<div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTE};">${r.platformLabel}</div>` +
          `<div style="font-size:13px;font-weight:600;color:${INK};line-height:1.35;margin-top:2px;">${escapeHtml(r.text.headline || "—")}</div>` +
          buildMessageBlock(r.text.message || "") +
          adLink +
        `</td>` +
        `<td width="90" style="padding:12px;border-top:1px solid ${HAIR};vertical-align:middle;text-align:right;white-space:nowrap;">${statusChip}</td>` +
        `</tr>`;
    });
    const crInner =
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${HAIR};border-radius:10px;overflow:hidden;border-collapse:separate;">` +
      `<tr style="background:${CARD};">` +
      `<td style="${label}padding:10px 12px;">Headline &amp; text</td>` +
      `<td width="90" style="${label}padding:10px 12px;text-align:right;">Status</td>` +
      `</tr>${rows}</table>`;
    html += section(`Ads created this run (${platformRows.length})`, crInner);
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  html += `<tr><td style="padding:24px 32px 28px 32px;border-top:1px solid ${HAIR};">`;
  html += `<div style="font-size:11.5px;color:${MUTE};line-height:1.6;">You're receiving this because an alert email is configured on this Ads Factory automation. Manage recipients in the automation's settings.</div>`;
  html += `<div style="font-size:11.5px;color:${MUTE};margin-top:8px;">AdsGPT · Ads Factory Autopilot</div>`;
  html += `<div style="font-size:10.5px;color:${MUTE};margin-top:8px;">Reference: ${escapeHtml(run.runId)}</div>`;
  html += `</td></tr>`;

  html += `</table></td></tr></table></body></html>`;

  return html;
}

function buildRunEmailText(job, campaign, run) {
  const meta = STATUS_META[run.status] || STATUS_META.failed;
  const campaignName = (campaign && campaign.metadata && campaign.metadata.campaignName) || "Campaign";
  const adIds = normalizePlatformAdIds(run);
  const health = generationHealth(job, run);
  const durationMs =
    run.startedAt && run.completedAt
      ? new Date(run.completedAt) - new Date(run.startedAt)
      : null;

  const lines = [
    `AdsGPT Ads Factory — ${meta.label} (${run.status})`,
    `Campaign: ${campaignName}`,
    `runId: ${run.runId}${durationMs != null ? `  duration: ${durationMs}ms` : ""}`,
  ];
  if (job.schedule && job.schedule.nextRunAt) {
    lines.push(`next run: ${new Date(job.schedule.nextRunAt).toISOString()}`);
  }
  lines.push("");

  if (run.error) {
    // Same friendly translation as the HTML "What went wrong" banner.
    const entries = String(run.error).split(" | ").map((seg) => {
      const idx = seg.indexOf(": ");
      return idx === -1 ? null : { platform: seg.slice(0, idx).trim(), message: seg.slice(idx + 2).trim() };
    }).filter(Boolean);
    const friendly = entries.length
      ? entries.map((e) => friendlyPlatformError(e.platform, e.message)).join(" ")
      : friendlyRunError(run.error);
    lines.push(`What went wrong: ${friendly}`);
    lines.push("");
  }

  lines.push("Generation:");
  lines.push(`  images ${health.imagesGenerated}/${health.imagesRequested}`);
  lines.push(`  text   ${health.textsGenerated}/${health.textsRequested}`);
  lines.push(`  creatives assembled ${health.creativesAssembled}`);
  lines.push("");

  const postedPlatforms = Object.keys(adIds).filter((p) => adIds[p]);
  lines.push("Posting:");
  if (postedPlatforms.length === 0) {
    lines.push("  No ads were posted this cycle.");
  } else {
    for (const platform of postedPlatforms) {
      lines.push(`  ${platform}: ${adIds[platform]}`);
      const url = platformAdUrl(platform, resolveAdAccountId(job, platform), adIds[platform]);
      if (url) lines.push(`    ${url}`);
    }
  }

  const creatives = run.automationCreatives || [];
  if (creatives.length) {
    const textLines = [];
    for (const c of creatives) {
      const postedIds = c.postedAdIds instanceof Map ? Object.fromEntries(c.postedAdIds) : (c.postedAdIds || {});
      for (const [key, platformLabel] of [["meta", "Meta"], ["google", "Google"]]) {
        const text = c.platformText?.[key];
        if (!text?.headline && !text?.message) continue;
        const posted = !!postedIds[key];
        textLines.push(`  - [${platformLabel}] ${text.headline || "(no headline)"} [${c.callToAction || "no CTA"}]${posted ? " — posted" : " — failed"}`);
      }
    }
    if (textLines.length) {
      lines.push("");
      lines.push(`Ads this cycle (${textLines.length}):`);
      lines.push(...textLines);
    }
  }

  return lines.join("\n");
}

// ─── Recipient resolution ────────────────────────────────────────────────────

/**
 * Resolve the recipient list for a job's cycle alert.
 *   1. Explicit toOverride (used by the test-email endpoint) wins.
 *   2. Otherwise the job's own alerts.emailTo list.
 * Returns [] when nothing is configured — caller skips silently.
 */
function resolveRecipients(job, toOverride) {
  if (toOverride) return parseEmailRecipients(toOverride);
  return parseEmailRecipients(job && job.alerts && job.alerts.emailTo);
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Email a cycle summary for one Ads Factory run. Fire-and-forget: never throws.
 *
 * @param {Object}  opts
 * @param {Object}  opts.job         the AdsFactoryJob doc (for alerts + schedule)
 * @param {Object}  opts.campaign    the Campaign doc (for the display name)
 * @param {Object}  opts.run         the runHistory entry just recorded this cycle
 * @param {string} [opts.toOverride] force a recipient list (test-email endpoint)
 *
 * Returns { sent, reason?, recipients?, error? } — same shape as sendEmail,
 * plus `reason: "no-recipient"` when the job has no alert email configured.
 */
async function notifyAdsFactoryRun({ job, campaign, run, toOverride } = {}) {
  const logger = getLogger();
  try {
    if (!run) return { sent: false, reason: "no-run" };

    const recipients = resolveRecipients(job, toOverride);
    if (!recipients.length) {
      return { sent: false, reason: "no-recipient" };
    }

    const send = sendEmailFn();
    if (!send) return { sent: false, reason: "email-not-configured" };

    const meta = STATUS_META[run.status] || STATUS_META.failed;
    const campaignName = (campaign && campaign.metadata && campaign.metadata.campaignName) || "Campaign";

    const result = await send({
      to: recipients,
      subject: `AdsGPT Ads Factory — ${campaignName}: ${meta.label}`,
      text: buildRunEmailText(job, campaign, run),
      html: buildRunEmailHtml(job, campaign, run),
    });

    if (!result.sent) {
      logger.warn(
        `[adsFactoryAuto:alert] email not sent (recipients=${recipients.length}): ${result.reason}${result.error ? " — " + result.error : ""}`,
      );
    } else {
      logger.info(`[adsFactoryAuto:alert] cycle email sent to ${recipients.length} recipient(s)  runId=${run.runId}`);
    }
    return { ...result, recipients };
  } catch (err) {
    logger.error(`[adsFactoryAuto:alert] notifyAdsFactoryRun failed (non-fatal): ${err.message}`);
    return { sent: false, reason: "exception", error: err.message };
  }
}

/**
 * Resolve the job owner's registered email from their UserProfile. Used by the
 * test-email endpoint to pre-fill a recipient when the user hasn't saved an
 * alerts.emailTo yet. userId is stored like "GPT-438" — the profile is keyed
 * by the raw numeric part, so we split off the created_from prefix (same split
 * the orchestrator uses for credits).
 *
 * Returns the email string or null.
 */
async function resolveOwnerEmail(userId) {
  const Profile = UserProfile();
  if (!Profile || !userId) return null;
  try {
    const parts = String(userId).split("-");
    const rawUserId = parts.length > 1 ? parts.slice(1).join("-") : userId;
    const doc = await Profile.findOne({ user_id: rawUserId }).select("email").lean();
    return (doc && doc.email) || null;
  } catch (err) {
    getLogger().warn(`[adsFactoryAuto:alert] owner-email lookup failed for ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * A fabricated run entry + campaign for the /test-email endpoint, so users can
 * verify delivery + rendering before the first real cycle. Mirrors the shape
 * the orchestrator pushes into runHistory.
 */
function buildSampleRun() {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 4200);
  return {
    job: {
      pairsPerCycle: 2,
      schedule: { nextRunAt: new Date(now.getTime() + 86400000) },
      // Placeholder ad-account ids so the sample email renders the "View ad"
      // deep links. The controller overlays the real job's targets when
      // available, so a saved job's true account ids are used instead.
      targets: {
        meta:   { template: { payload: { adAccountId: "1234567890" } } },
        google: { template: { payload: { adAccountId: "123-456-7890" } } },
      },
    },
    campaign: { metadata: { campaignName: "Sample Campaign (test)" } },
    run: {
      runId: "test-" + now.getTime(),
      status: "success",
      startedAt,
      completedAt: now,
      error: null,
      platformAdIds: { meta: "120200000000000000", google: "9876543210" },
      // Mirrors the real orchestrator: campaign/ad-group ids used to build
      // the Google deep link, keyed per platform.
      platformContext: {
        meta:   { campaignId: "sample-meta-campaign", adSetId: "sample-meta-adset" },
        google: { campaignId: "1111111111", adGroupId: "2222222222" },
      },
      automationCreatives: [
        {
          creativeId: "sample-1",
          headline: "Summer Sale — Up to 50% Off",
          message: "Shop the collection everyone's talking about. Limited time only.",
          callToAction: "SHOP_NOW",
          imageUrl: "https://adsgpt.io/wp-content/uploads/2024/10/Adsgpt-Header-colored-logo.webp",
          // Posted to both platforms — sample shows both link chips.
          postedAdIds: { meta: "120200000000000000", google: "9876543210" },
        },
        {
          creativeId: "sample-2",
          headline: "New Arrivals Just Dropped",
          message: "Be the first to grab this season's must-haves.",
          callToAction: "LEARN_MORE",
          imageUrl: "https://adsgpt.io/wp-content/uploads/2024/10/Adsgpt-Header-colored-logo.webp",
          // Posted to Google only — sample shows only the Google link chip,
          // demonstrating that each creative links only to where it actually went.
          postedAdIds: { google: "9876543211" },
        },
      ],
      rawImages: [{ status: 200 }, { status: 200 }],
      rawTexts:  [{ status: 200 }, { status: 200 }],
    },
  };
}

module.exports = {
  notifyAdsFactoryRun,
  resolveOwnerEmail,
  buildSampleRun,
  sendEmail: sendEmailFn(),
  // exported for tests / reuse
  parseEmailRecipients,
  resolveRecipients,
  buildRunEmailHtml,
  buildRunEmailText,
  normalizePlatformAdIds,
  generationHealth,
  resolveAdAccountId,
  platformAdUrl,
  MAX_EMAIL_RECIPIENTS,
};
