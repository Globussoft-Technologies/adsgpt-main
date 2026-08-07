const { WORKSPACE_FEATURE_LABELS } = require("./workspaceConfig");

let sendgrid;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function client() {
  if (sendgrid !== undefined) return sendgrid;
  if (!process.env.SENDGRID_API_KEY) {
    sendgrid = null;
    return sendgrid;
  }
  sendgrid = require("@sendgrid/mail");
  sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
  return sendgrid;
}

async function send({ to, subject, text, html }) {
  const mail = client();
  if (!mail) return { sent: false, reason: "not_configured" };
  await mail.send({
    to,
    from: process.env.WORKSPACE_EMAIL_FROM || "support@adsgpt.io",
    subject,
    text,
    html,
  });
  return { sent: true };
}

// Same visual language as the newsletter drip templates in
// controllers/newsletter.controller.js (brand gradient, table-based layout
// for email-client compatibility) — kept as a standalone template here since
// this is the only transactional workspace email; extract a shared shell if
// a second one shows up.
function emailShell({ badge, title, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .logo-text { font-family: 'Inter', -apple-system, sans-serif; font-size: 20px; font-weight: 800; letter-spacing: -0.6px; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .body-section { padding: 40px 40px 0; }
    .title { font-size: 24px; font-weight: 800; letter-spacing: -0.6px; color: #0f172a; margin-bottom: 14px; }
    .body-para { font-size: 15px; color: #334155; line-height: 1.7; margin-bottom: 16px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .feature-card { margin: 24px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 20px 24px; }
    .feature-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; margin-bottom: 12px; }
    .feature-row td { font-size: 14px; color: #334155; padding: 5px 0; }
    .feature-check { color: #BB48B9; font-weight: 700; padding-right: 10px; }
    .cta-wrap { text-align: center; padding: 8px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 700; padding: 15px 36px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .cta-note { display: block; margin-top: 14px; font-size: 12px; color: #94a3b8; }
    .rule { height: 1px; background: #f1f1f4; margin: 36px 40px 0; }
    .outro { padding: 28px 40px 0; }
    .outro p { font-size: 13.5px; color: #64748b; line-height: 1.7; }
    .footer { padding: 30px 40px 34px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 36px; background: #fafafb; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .header-cell { padding: 18px 22px; }
      .body-section { padding: 32px 22px 0; }
      .title { font-size: 21px; }
      .feature-card { padding: 16px 18px; }
      .cta-wrap { padding: 8px 22px 0; }
      .cta-btn { width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 28px 22px 0; }
      .outro { padding: 24px 22px 0; }
      .footer { padding: 26px 22px 30px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span class="logo-text">AdsGPT</span></td>
        <td align="right"><span class="header-tag">${escapeHtml(badge)}</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="body-section">
    <div class="title">${escapeHtml(title)}</div>
    ${bodyHtml}
  </div>
  <div class="cta-wrap">
    <a href="${ctaUrl}" class="cta-btn">${escapeHtml(ctaLabel)}</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p>${footerNote}</p>
  </div>
  <div class="footer">
    <div class="footer-note">
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
}

async function sendInvitation({ to, token, workspaceName, features = [], ownerName = "" }) {
  const baseUrl =
    process.env.WORKSPACE_INVITATION_URL_BASE ||
    `${String(process.env.FRONTEND_URL || "").replace(/\/$/, "")}/workspace-invite`;
  const loginUrl =
    process.env.WORKSPACE_MEMBER_LOGIN_URL_BASE ||
    `${String(process.env.FRONTEND_URL || "").replace(/\/$/, "")}/workspace-login`;
  const link = `${baseUrl}/${encodeURIComponent(token)}`;
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeLink = escapeHtml(link);
  const safeLoginUrl = escapeHtml(loginUrl);
  const invitedBy = ownerName ? ` by <strong>${escapeHtml(ownerName)}</strong>` : "";

  const featureLabels = features.map(
    (id) => WORKSPACE_FEATURE_LABELS[id] || id,
  );
  const featureListHtml = featureLabels.length
    ? `<div class="feature-card">
         <div class="feature-card-label">What you'll get access to</div>
         <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
           ${featureLabels
             .map(
               (label) =>
                 `<tr class="feature-row"><td width="18" valign="top">&#10003;</td><td valign="top">${escapeHtml(label)}</td></tr>`,
             )
             .join("")}
         </table>
       </div>`
    : "";

  const html = emailShell({
    badge: "Workspace invite",
    title: `Join ${workspaceName} on AdsGPT`,
    bodyHtml: `
      <p class="body-para">You've been invited${invitedBy} to join <strong>${safeWorkspaceName}</strong> on AdsGPT — a shared workspace with its own set of features picked out for you.</p>
      ${featureListHtml}
      <p class="body-para">Accepting takes a minute: confirm your details, set a password, and you're in.</p>
    `,
    ctaLabel: "Accept invitation",
    ctaUrl: safeLink,
    footerNote: `You'll sign in with this email address and your password afterward at <a href="${safeLoginUrl}" style="color:#64748b;">${safeLoginUrl}</a>.`,
  });

  const featureListText = featureLabels.length
    ? `\n\nWhat you'll get access to:\n${featureLabels.map((label) => `- ${label}`).join("\n")}`
    : "";
  const text = `You've been invited${ownerName ? ` by ${ownerName}` : ""} to join ${workspaceName} on AdsGPT.${featureListText}\n\nAccept your invitation: ${link}\n\nYou'll set a password when you accept, and can sign in with your email and password afterward at ${loginUrl}`;

  return send({
    to,
    subject: `You're invited to join ${workspaceName} on AdsGPT`,
    text,
    html,
  });
}

module.exports = { sendInvitation };
