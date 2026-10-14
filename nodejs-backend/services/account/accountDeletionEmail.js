// Reminder sent a few days before a pending account is permanently purged.
let sendgrid;
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

const escapeHtml = (value) =>
  String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const buildHtml = ({ subject, firstName, dayText, loginUrl }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 16px; }
    .step-card { margin: 32px 0; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px 24px; text-align: center; }
    .step-card-label { font-size: 11px; font-weight: 700; color: #BB48B9; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px; display: inline-block; background: #faf2fb; padding: 4px 10px; border-radius: 100px; }
    .step-card-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 10px; }
    .step-card-body { font-size: 14.5px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 8px; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; }
    .footer { padding: 36px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span class="grad" style="font-size:20px;font-weight:800;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Action Required</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Account Update</div>
    <div class="hero-title">Your account will be<br><span class="grad">deleted in ${dayText}.</span></div>
    <p class="hero-subtitle">We received a request to permanently delete your AdsGPT account and all associated data.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${escapeHtml(firstName) || "there"},</div>
    <p class="body-para">Your account is in its deletion cooling period. It will be permanently removed from all our systems in <strong>${dayText}</strong>.</p>
    <p class="body-para">If you meant to delete your account, you don't need to do anything. We're sorry to see you go!</p>
    <div class="step-card">
      <div class="step-card-label">Changed your mind?</div>
      <div class="step-card-title">You can still keep your account</div>
      <div class="step-card-body">If you didn't make this request, or you changed your mind, log in and choose Restore Account.</div>
      <a href="${escapeHtml(loginUrl)}" class="cta-btn">Log In to Keep Account</a>
    </div>
  </div>
  <div class="outro"><p><strong>The AdsGPT Team</strong></p></div>
  <div class="footer">
    <div class="footer-note">This is an automated system notification.<br>&copy; ${new Date().getFullYear()} AdsGPT. All Rights Reserved.</div>
  </div>
</div>
</body>
</html>`;

const sendDeletionReminderEmail = async (email, firstName = "", daysLeft = 3) => {
  const mail = client();
  if (!mail) return { sent: false, reason: "not_configured" };

  const dayText = `${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  const subject = `Your AdsGPT account will be deleted in ${dayText}`;
  const loginUrl = process.env.ACCOUNT_RESTORE_LOGIN_URL || "https://adsgpt.io/login";

  await mail.send({
    to: email,
    from: process.env.WORKSPACE_EMAIL_FROM || "support@adsgpt.io",
    subject,
    text: `Hi ${firstName || "there"}, your AdsGPT account will be permanently deleted in ${dayText}. To keep it, log in at ${loginUrl} and choose Restore Account.`,
    html: buildHtml({ subject, firstName, dayText, loginUrl }),
  });
  return { sent: true };
};

module.exports = { sendDeletionReminderEmail };
