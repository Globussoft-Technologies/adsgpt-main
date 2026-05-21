const UserProfile = require("../Module/user/userProfileModel");
const { sendEmail } = require("../services/autopilot/alertService");

const FREE_PLAN_ID = process.env.FREE_PLAN_ID;

const DRIP_DAYS = [1, 2, 3, 4, 5, 6, 7];

// ---------------------------------------------------------------------------
// Email builders
// ---------------------------------------------------------------------------

function buildDay1Email(firstName) {
  const subject = "Welcome to AdsGPT, your first ad is 60 seconds away";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 14px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-card-body strong { color: #0f172a; font-weight: 700; }
    .step-row { }
    .step-num { background: linear-gradient(90deg, #F47043, #BB48B9); color: #fff; border-radius: 50%; width: 24px; height: 24px; min-width: 24px; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; display: inline-block; vertical-align: middle; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .cta-note { display: block; margin-top: 14px; font-size: 12px; color: #94a3b8; }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Welcome aboard</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Welcome to AdsGPT</div>
    <div class="hero-title">Your first ad is<br><span class="grad">60 seconds away.</span></div>
    <p class="hero-subtitle">You just joined 10,000+ marketers who stopped writing ads from scratch.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">Welcome aboard. You just joined 10,000+ marketers who stopped writing ads from scratch.</p>
    <p class="body-para">You've got <strong>35 free creatives</strong> waiting in your account — no credit card, no expiry pressure. Here's the fastest path to your first one:</p>
    <div class="step-card">
      <div class="step-card-label">Get started in 60 seconds</div>
      <div class="step-card-title">Your first ad, step by step</div>
      <div class="step-card-body">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">1</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Open your dashboard</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">2</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Type what you're selling (one sentence is enough)</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">3</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Pick an aspect ratio — Meta 1:1, Story 9:16, whatever you need</td></tr>
          <tr class="step-row"><td width="24" valign="middle"><span class="step-num">4</span></td><td valign="middle" style="padding-left:12px;">Hit Generate. AdsGPT returns 4 styles, batch up to 5 at once.</td></tr>
        </table>
      </div>
    </div>
    <p class="body-para">Sixty seconds, scroll-stopping image ad, sized for the platform. No Canva. No designer. No blank page.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://app.adsgpt.io/amember/login" class="cta-btn">Generate your first ad &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p>If anything's confusing or breaks, just reply. A real human reads every email that comes to this inbox.</p>
    <p>Talk soon,<br><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay2Email(firstName) {
  const subject = "The format that converts 4× better than static ads";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 14px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-row { }
    .step-num { background: linear-gradient(90deg, #F47043, #BB48B9); color: #fff; border-radius: 50%; width: 24px; height: 24px; min-width: 24px; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; display: inline-block; vertical-align: middle; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 2 &middot; UGC Video</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Video that converts</div>
    <div class="hero-title">4&times; better than<br><span class="grad">static ads.</span></div>
    <p class="hero-subtitle">UGC video ads outperform polished brand content — and AdsGPT generates them from a single prompt.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">Quick one: UGC video ads convert up to <strong>4&times; better</strong> than polished brand content. Doesn't matter what you sell — people trust people more than they trust a logo.</p>
    <p class="body-para">The catch? Filming UGC is expensive. Casting creators, briefing them, paying per video, waiting a week for delivery. Most brands skip it entirely.</p>
    <p class="body-para">AdsGPT generates UGC videos from a single prompt:</p>
    <div class="step-card">
      <div class="step-card-label">How it works</div>
      <div class="step-card-title">UGC Video Ads in 4 steps</div>
      <div class="step-card-body">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">1</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Upload your product image</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">2</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Describe the scene or the hook</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">3</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Pick a 9:16 ratio for Reels, TikTok, or Shorts</td></tr>
          <tr class="step-row"><td width="24" valign="middle"><span class="step-num">4</span></td><td valign="middle" style="padding-left:12px;">Get a talking-head UGC video back in minutes</td></tr>
        </table>
      </div>
    </div>
    <p class="body-para">No casting. No filming. No creators to manage.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://app.adsgpt.io/amember/login" class="cta-btn">Try UGC Video Ads &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p>The same workflow gives you AI Avatar Ads (pick a face from the library, write a script, get lip-synced video with burned-in captions) and Product B-roll (cinematic 4K clips from a text prompt). Worth poking around.</p>
    <p>Reply if you want a hand picking which format fits your product.</p>
    <p><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay3Email(firstName) {
  const subject = "Peek inside your competitor's ad playbook";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 14px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-row { }
    .step-num { background: linear-gradient(90deg, #F47043, #BB48B9); color: #fff; border-radius: 50%; width: 24px; height: 24px; min-width: 24px; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; display: inline-block; vertical-align: middle; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 3 &middot; Competitor Intel</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Competitor Intel</div>
    <div class="hero-title">Your competitor's<br><span class="grad">ad playbook.</span></div>
    <p class="hero-subtitle">Search any brand and instantly see every ad they're running across Meta, Google, LinkedIn, TikTok, Pinterest, and more.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">Here's the feature most users find by accident — and then can't stop using.</p>
    <p class="body-para">Competitor Intel lets you search any brand and instantly see every ad they're running across Meta, Google, LinkedIn, TikTok, Pinterest, and more. Our database tracks <strong>500M+ active creatives</strong>.</p>
    <div class="step-card">
      <div class="step-card-label">Try it tonight</div>
      <div class="step-card-title">Competitor Intel — 5 steps</div>
      <div class="step-card-body">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">1</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Open Competitor Intel in the dashboard</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">2</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Type a competitor's name (or any brand you admire)</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">3</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Browse their top-performing ads, sorted by popularity</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">4</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Find one that works — click Generate Similar</td></tr>
          <tr class="step-row"><td width="24" valign="middle"><span class="step-num">5</span></td><td valign="middle" style="padding-left:12px;">AdsGPT reverse-engineers the strategy into a brand-new version, built for you</td></tr>
        </table>
      </div>
    </div>
    <p class="body-para">It's the fastest way to short-circuit the "what should we test next?" question. A SaaS startup in our case studies used this to take LinkedIn ROAS from 2.1&times; to 4.8&times; in six weeks.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://app.adsgpt.io/amember/login" class="cta-btn">Search your first competitor &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay4Email(firstName) {
  const subject = "Stop re-typing your brand details. Train AdsGPT once.";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 6px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-card-body strong { color: #0f172a; font-weight: 700; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 4 &middot; BrandIQ</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Brand memory</div>
    <div class="hero-title">Train AdsGPT once.<br><span class="grad">Use it forever.</span></div>
    <p class="hero-subtitle">Three minutes of setup, hours saved every week. No more pasting hex codes. No more off-brand outputs.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">A small habit that pays off forever: set up BrandIQ before your next campaign.</p>
    <p class="body-para">BrandIQ is the brand memory layer inside AdsGPT. Load your logo, brand colors, tone of voice, and tagline once — and every creative, every video, every line of copy AdsGPT generates after that automatically reflects your brand.</p>
    <div class="step-card">
      <div class="step-card-label">What you get</div>
      <div class="step-card-title">BrandIQ eliminates the friction</div>
      <div class="step-card-body">No more pasting hex codes into prompts. No more "make it more premium" follow-ups. No more off-brand outputs.<br><br>For agencies and multi-brand operators: BrandIQ supports <strong>unlimited brand profiles</strong>. Switch context with one click.</div>
    </div>
    <p class="body-para"><strong>Tip:</strong> combine BrandIQ with Competitor Intel from yesterday's email. Find what's working in your niche, click Generate Similar, and the output already matches your brand. That's the workflow our top users live in.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://app.adsgpt.io/amember/login" class="cta-btn">Set up BrandIQ &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay5Email(firstName) {
  const subject = "Generate 200 ads. Launch them to Meta. Without leaving AdsGPT.";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 14px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-row { }
    .step-num { background: linear-gradient(90deg, #F47043, #BB48B9); color: #fff; border-radius: 50%; width: 24px; height: 24px; min-width: 24px; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; display: inline-block; vertical-align: middle; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 5 &middot; Ad Factory</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Scale mode</div>
    <div class="hero-title">Generate 200 ads.<br><span class="grad">Launch to Meta.</span></div>
    <p class="hero-subtitle">Upload your brand kit once, give it a brief, and ship hundreds of on-brand variants in a single run.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">You've made a few ads one at a time. Now let's show you how power users scale.</p>
    <p class="body-para">Ad Factory is bulk mode. Upload your brand kit once, give it a brief, and it churns out hundreds of on-brand variations — different hooks, different angles, different formats, every platform ratio — in a single run.</p>
    <p class="body-para">A DTC fashion brand shipped 340 variants across Meta and TikTok in 45 days using this. Cost-per-acquisition dropped <strong>62%</strong>.</p>
    <div class="step-card">
      <div class="step-card-label">Then there's the part most ad tools skip</div>
      <div class="step-card-title">Meta Ads Manager — built in</div>
      <div class="step-card-body">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">1</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Connect your Meta account with one-click OAuth</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">2</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Pick your winning creative, add a CTA</td></tr>
          <tr class="step-row"><td width="24" valign="middle" style="padding-bottom:10px;"><span class="step-num">3</span></td><td valign="middle" style="padding-bottom:10px;padding-left:12px;">Hit Launch — AdsGPT publishes live to your campaign</td></tr>
          <tr class="step-row"><td width="24" valign="middle"><span class="step-num">4</span></td><td valign="middle" style="padding-left:12px;">View live analytics, audit 37 rules, drill from campaigns down to individual ads</td></tr>
        </table>
      </div>
    </div>
    <p class="body-para">Generate &rarr; Launch &rarr; Optimize, without switching tabs.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://app.adsgpt.io/amember/login" class="cta-btn">Try Ad Factory &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay6Email(firstName) {
  const subject = "What if your ads optimized themselves while you slept?";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 6px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 6 &middot; Autopilot</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">Set it and forget it</div>
    <div class="hero-title">Ads that optimize<br><span class="grad">while you sleep.</span></div>
    <p class="hero-subtitle">Autopilot runs hourly audits on your Meta campaigns, evaluates your rules, and acts — so you don't have to.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">Three weeks in. You've seen the generation side. Here's the part that compounds.</p>
    <p class="body-para">Autopilot is an automation layer on top of your Meta Ads. Once your campaigns are live, it runs hourly audits using AI, evaluates every active ad against 37 rules, and recommends or executes optimizations — pausing losers, reallocating budget to winners, and surfacing creative fatigue before it tanks your ROAS.</p>
    <div class="step-card">
      <div class="step-card-label">Built-in safety controls</div>
      <div class="step-card-title">You're always in control</div>
      <div class="step-card-body">Every action is gated by safety controls. Everything is logged. Anything can be undone. Run it in dry-run mode first if you want to watch it work before letting it act.</div>
    </div>
    <p class="body-para">The teams using Autopilot ship <strong>2.8&times; more creative</strong> and report <strong>4.8&times; higher ROAS</strong> within six weeks — not because the AI is magic, but because they stop wasting cycles on manual ad ops and spend the time on strategy.</p>
    <p class="body-para">How are things going on your end, ${firstName}? If you've shipped a campaign, reply and tell me what's working (or what isn't). I'll point you to the exact feature that closes the gap.</p>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

function buildDay7Email(firstName) {
  const subject = "Your 35 free creatives won't last forever!";
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${subject}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: #f4f4f6; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased; margin: 0; padding: 24px 0; }
    .email-wrapper { max-width: 620px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ececf0; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.05); }
    .topbar { background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); height: 4px; width: 100%; }
    .header-cell { padding: 22px 40px; border-bottom: 1px solid #f1f1f4; }
    .header-tag { font-size: 10.5px; font-weight: 600; color: #BB48B9; letter-spacing: 1.6px; text-transform: uppercase; background: #faf2fb; border: 1px solid #f0dcf2; padding: 5px 12px; border-radius: 100px; white-space: nowrap; }
    .hero { padding: 56px 40px 0; text-align: center; }
    .announce-badge { display: inline-flex; align-items: center; gap: 8px; background: #fff5f0; border: 1px solid #fbe0d1; border-radius: 100px; padding: 7px 16px 7px 12px; margin-bottom: 28px; }
    .badge-dot { width: 8px; height: 8px; background: #F47043; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 3px rgba(244,112,67,0.18); }
    .badge-text { font-size: 12px; font-weight: 600; color: #c14d22; letter-spacing: 0.4px; }
    .hero-kicker { font-size: 12px; font-weight: 600; color: #94a3b8; letter-spacing: 2.4px; text-transform: uppercase; margin-bottom: 18px; }
    .hero-title { font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -1.8px; color: #0f172a; margin-bottom: 4px; }
    .hero-title .grad { background: linear-gradient(90deg, #F47043 0%, #DA5775 50%, #BB48B9 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    .hero-subtitle { font-size: 16.5px; font-weight: 400; color: #475569; line-height: 1.6; max-width: 480px; margin: 22px auto 0; }
    .body-section { padding: 44px 48px 0; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 18px; }
    .body-para { font-size: 15.5px; color: #334155; line-height: 1.75; margin-bottom: 18px; }
    .body-para strong { color: #0f172a; font-weight: 700; }
    .step-card { margin: 28px 0; background: linear-gradient(135deg, #fff5f0 0%, #ffffff 50%, #faf2fb 100%); border: 1px solid #f5d4dc; border-radius: 14px; padding: 22px 24px; }
    .step-card-label { font-size: 10.5px; font-weight: 700; color: #BB48B9; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
    .step-card-title { font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.2px; margin-bottom: 10px; }
    .step-card-body { font-size: 14px; color: #475569; line-height: 1.65; }
    .step-card-body strong { color: #0f172a; font-weight: 700; }
    .feature-row { }
    .feature-icon { background: linear-gradient(90deg, #F47043, #BB48B9); color: #fff; border-radius: 8px; width: 32px; height: 32px; min-width: 32px; text-align: center; line-height: 32px; font-size: 15px; font-weight: 700; display: inline-block; vertical-align: middle; }
    .cta-wrap { text-align: center; padding: 24px 40px 0; }
    .cta-btn { display: inline-block; background: linear-gradient(90deg, #F47043, #DA5775, #BB48B9); color: #ffffff !important; text-decoration: none; font-size: 15.5px; font-weight: 700; letter-spacing: 0.1px; padding: 16px 38px; border-radius: 10px; box-shadow: 0 10px 24px -8px rgba(218,87,117,0.55); }
    .cta-note { display: block; margin-top: 14px; font-size: 12px; color: #94a3b8; }
    .rule { height: 1px; background: #f1f1f4; margin: 44px 48px 0; }
    .outro { padding: 32px 48px 0; }
    .outro p { font-size: 14.5px; color: #475569; line-height: 1.7; margin-bottom: 16px; }
    .outro p:last-of-type { margin-bottom: 0; }
    .outro .signoff-name { font-weight: 700; color: #0f172a; }
    .footer { padding: 36px 40px 40px; text-align: center; border-top: 1px solid #f1f1f4; margin-top: 48px; background: #fafafb; }
    .footer-logo-text { font-size: 13px; font-weight: 700; color: #94a3b8; margin-bottom: 14px; }
    .footer-links { margin-bottom: 18px; }
    .footer-links a { font-size: 12px; color: #64748b; text-decoration: none; margin: 0 10px; font-weight: 500; }
    .footer-note { font-size: 11px; color: #94a3b8; line-height: 1.7; }
    .footer-note a { color: #64748b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body, .email-wrapper, .footer { background-color: #ffffff !important; }
      body, .hero-title, .greeting, .step-card-title, .body-para strong { color: #0f172a !important; }
      .body-para, .hero-subtitle, .step-card-body { color: #334155 !important; }
      .step-card { background: #fff5f0 !important; }
    }
    [data-ogsc] body, [data-ogsc] .email-wrapper, [data-ogsc] .footer { background-color: #ffffff !important; }
    [data-ogsc] body, [data-ogsc] .hero-title, [data-ogsc] .greeting, [data-ogsc] .step-card-title { color: #0f172a !important; }
    [data-ogsc] .body-para, [data-ogsc] .hero-subtitle, [data-ogsc] .step-card-body { color: #334155 !important; }
    @media screen and (max-width: 480px) {
      body { padding: 0; }
      .email-wrapper { border-radius: 0; border-left: none; border-right: none; }
      .hero { padding: 40px 22px 0; }
      .hero-title { font-size: 30px; letter-spacing: -1.1px; }
      .hero-subtitle { font-size: 15px; }
      .body-section { padding: 32px 24px 0; }
      .step-card { padding: 18px 20px; }
      .cta-wrap { padding: 8px 24px 0; }
      .cta-btn { padding: 14px 28px; font-size: 14.5px; width: 100%; max-width: 320px; box-sizing: border-box; }
      .rule { margin: 32px 24px 0; }
      .outro { padding: 28px 24px 0; }
      .footer { padding: 28px 22px 32px; }
      .header-cell { padding: 18px 22px; }
    }
  </style>
</head>
<body>
<div class="email-wrapper">
  <div class="topbar"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
    <td class="header-cell">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td><span style="font-family:'Inter',-apple-system,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.6px;background:linear-gradient(90deg,#F47043,#DA5775,#BB48B9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">AdsGPT</span></td>
        <td align="right"><span class="header-tag">Day 7 &middot; Upgrade</span></td>
      </tr></tbody></table>
    </td>
  </tr></tbody></table>
  <div class="hero">
    <div class="hero-kicker">One week in</div>
    <div class="hero-title">35 free creatives<br><span class="grad">won't last forever.</span></div>
    <p class="hero-subtitle">Here's everything that unlocks when you go Pro.</p>
  </div>
  <div class="body-section">
    <div class="greeting">Hi ${firstName},</div>
    <p class="body-para">Two weeks in. By now, you've either burnt through your 35 free creatives or you're close.</p>
    <p class="body-para">Here's what unlocks when you switch to Pro:</p>
    <div class="step-card">
      <div class="step-card-label">Pro plan features</div>
      <div class="step-card-title">Everything, unlocked</div>
      <div class="step-card-body">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr class="feature-row"><td width="32" valign="middle" style="padding-bottom:14px;"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-bottom:14px;padding-left:12px;"><strong>Unlimited generation</strong> across image ads, UGC video, AI avatars, B-roll, and Product Shot Studio</td></tr>
          <tr class="feature-row"><td width="32" valign="middle" style="padding-bottom:14px;"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-bottom:14px;padding-left:12px;"><strong>Full Ad Factory access</strong> — bulk-generate hundreds of variants at machine speed</td></tr>
          <tr class="feature-row"><td width="32" valign="middle" style="padding-bottom:14px;"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-bottom:14px;padding-left:12px;"><strong>Competitor Intel</strong> with unlimited searches across 500M+ ads</td></tr>
          <tr class="feature-row"><td width="32" valign="middle" style="padding-bottom:14px;"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-bottom:14px;padding-left:12px;"><strong>BrandIQ</strong> with multi-brand profiles (agencies and consultants — this is for you)</td></tr>
          <tr class="feature-row"><td width="32" valign="middle" style="padding-bottom:14px;"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-bottom:14px;padding-left:12px;"><strong>Meta Ads Manager + Autopilot</strong> — launch and optimize without leaving AdsGPT</td></tr>
          <tr class="feature-row"><td width="32" valign="middle"><span class="feature-icon">✦</span></td><td valign="middle" style="padding-left:12px;"><strong>Priority support</strong> and early access to new features</td></tr>
        </table>
      </div>
    </div>
    <p class="body-para">The numbers from accounts that upgrade in the first 30 days: <strong>2.8&times; more creative shipped</strong>, <strong>4.8&times; higher ROAS</strong> on winners within six weeks, <strong>80% lower production cost</strong> versus agency workflows.</p>
  </div>
  <div class="cta-wrap">
    <a href="https://adsgpt.io/pricing/" class="cta-btn">Upgrade to Pro &rarr;</a>
  </div>
  <div class="rule"></div>
  <div class="outro">
    <p>Not ready yet? No pressure — reply and tell me what's holding you back. If it's a feature gap, I want to know.</p>
    <p>Here's to your next winning campaign,<br><span class="signoff-name">The AdsGPT Team</span></p>
  </div>
  <div class="footer">
    <div class="footer-logo-text">AdsGPT</div>
    <div class="footer-links">
      <a href="https://adsgpt.io">Home</a>
      <a href="https://adsgpt.io/blog">Blog</a>
      <a href="https://adsgpt.io/faq">FAQ</a>
      <a href="https://adsgpt.io/contact-us/">Contact us</a>
    </div>
    <div class="footer-note">
      You're receiving this because you created an account at <a href="https://adsgpt.io">adsgpt.io</a>.<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a> &nbsp;&middot;&nbsp;
      <a href="{{preferences_url}}">Email preferences</a> &nbsp;&middot;&nbsp;
      <a href="{{privacy_url}}">Privacy policy</a><br><br>
      &copy; 2026 AdsGPT. All Rights Reserved.
    </div>
  </div>
</div>
</body>
</html>`;
  return { subject, html };
}

// ---------------------------------------------------------------------------
// Map drip day → builder
// ---------------------------------------------------------------------------

const DRIP_TEMPLATES = {
  1: buildDay1Email,
  2: buildDay2Email,
  3: buildDay3Email,
  4: buildDay4Email,
  5: buildDay5Email,
  6: buildDay6Email,
  7: buildDay7Email,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(startDate) {
  const ms = Date.now() - new Date(startDate).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}


// ---------------------------------------------------------------------------
// scheduleFreePlanDrip — call once at new-user creation (sends Day 1 immediately)
// ---------------------------------------------------------------------------

async function scheduleFreePlanDrip(userProfile) {
  if (String(userProfile.subscription_plan_id) !== FREE_PLAN_ID) return;

  const email = userProfile.email;
  const firstName = userProfile.name_f || userProfile.name || "there";

  if (!email) {
    console.warn(`[newsletter] no email for user ${userProfile.user_id}, skipping Day 1`);
    return;
  }

  const { subject, html } = buildDay1Email(firstName);
  const result = await sendEmail({ to: email, subject, html });

  if (result.sent) {
    console.log(`[newsletter] Day 1 sent to ${email} (${userProfile.user_id})`);
  } else {
    console.warn(`[newsletter] Day 1 send failed for ${email}: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// dispatchDripEmails — called daily by cron
// ---------------------------------------------------------------------------

async function dispatchDripEmails() {
  const freePlanUsers = await UserProfile.find({
    subscription_plan_id: FREE_PLAN_ID,
    email: { $nin: [null, ""] },
  }).lean();

  let sent = 0;
  let skipped = 0;

  for (const user of freePlanUsers) {
    const cycleStart = user.billing_cycle_start || user.createdAt;
    if (!cycleStart) { skipped++; continue; }

    const elapsed = daysSince(cycleStart);
    const firstName = user.name_f || user.name || "there";

    for (const day of DRIP_DAYS) {
      // Send day N only when elapsed falls exactly in the [N-1, N) window.
      // Cron runs daily, so each drip fires exactly once without any stored state.
      if (Math.floor(elapsed) !== day - 1) continue;

      const buildTemplate = DRIP_TEMPLATES[day];
      if (!buildTemplate) continue;

      const { subject, html } = buildTemplate(firstName);
      const result = await sendEmail({ to: user.email, subject, html });

      if (result.sent) {
        console.log(`[newsletter] Day ${day} sent to ${user.email} (${user.user_id})`);
        sent++;
      } else {
        console.warn(`[newsletter] Day ${day} failed for ${user.email}: ${result.reason}`);
      }
    }
  }

  console.log(`[newsletter] drip run complete — sent: ${sent}, skipped: ${skipped}`);
  return { sent, skipped };
}

module.exports = {
  scheduleFreePlanDrip,
  dispatchDripEmails,
  buildDay1Email,
  buildDay2Email,
  buildDay3Email,
  buildDay4Email,
  buildDay5Email,
  buildDay6Email,
  buildDay7Email,
};
