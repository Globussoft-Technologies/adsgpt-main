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

async function sendInvitation({ to, token, workspaceName }) {
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
  return send({
    to,
    subject: `Join ${workspaceName} on AdsGPT`,
    text: `You have been invited to ${workspaceName}. Accept your invitation: ${link}\n\nWorkspace access is passwordless. For future visits, request a secure one-time sign-in link at ${loginUrl}`,
    html: `<p>You have been invited to <strong>${safeWorkspaceName}</strong>.</p><p><a href="${safeLink}">Accept invitation</a></p><p>Workspace access is passwordless. For future visits, request a secure one-time sign-in link at <a href="${safeLoginUrl}">${safeLoginUrl}</a>.</p>`,
  });
}

async function sendLoginLink({ to, token }) {
  const baseUrl =
    process.env.WORKSPACE_MEMBER_LOGIN_URL_BASE ||
    `${String(process.env.FRONTEND_URL || "").replace(/\/$/, "")}/workspace-login`;
  const link = `${baseUrl}?token=${encodeURIComponent(token)}`;
  const safeLink = escapeHtml(link);
  return send({
    to,
    subject: "Sign in to your AdsGPT workspaces",
    text: `Use this one-time link to sign in: ${link}`,
    html: `<p><a href="${safeLink}">Sign in to your AdsGPT workspaces</a></p><p>This link expires shortly and can be used once.</p>`,
  });
}

module.exports = { sendInvitation, sendLoginLink };
