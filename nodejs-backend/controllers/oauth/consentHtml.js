/**
 * consentHtml — renders the OAuth consent page directly from the backend.
 *
 * Design mirrors the Figma-sourced template the user provided: dark canvas
 * with two blue gradient glows, a semi-transparent card with backdrop blur,
 * pill-shaped buttons (white "Allow", grey "Deny"), a signed-in chip,
 * and the AdsGPT lightning-bolt logo top-left.
 *
 * Self-contained: no external assets required for the layout to render.
 * Fonts come from Google Fonts (Public Sans) — CSP is opened just enough to
 * fetch the stylesheet + woff2 files. If Google Fonts is blocked or slow,
 * the system-font fallback in the font-family stack keeps the page usable.
 *
 * CSP shape (set at the response layer in authorizeController):
 *   default-src 'none'
 *   style-src 'unsafe-inline' https://fonts.googleapis.com
 *   font-src https://fonts.gstatic.com
 *   img-src <logo host>          (or 'none' if the client has no logo)
 *   form-action 'self' <client redirect origin>
 *   frame-ancestors 'none'
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SCOPE_COPY = {
  openid: {
    title: "Sign in as you",
    detail: "Identify you by your unique AdsGPT ID.",
  },
  profile: {
    title: "Basic profile",
    detail: "See your name and account details.",
  },
  email: {
    title: "Email address",
    detail: "See the email address you use to sign in to AdsGPT.",
  },
  offline_access: {
    title: "Stay signed in",
    detail: "Refresh access without asking you to sign in again.",
  },
  plan: {
    title: "Subscription plan",
    detail: "See which AdsGPT plan you are on.",
  },
  "mcp:meta-2": {
    title: "Meta ads via AdsGPT",
    detail: "Read your connected Meta ad accounts through AdsGPT.",
  },
};

function renderConsentPage(ctx) {
  const {
    ticket,
    clientName,
    logoUri,
    scopes,
    userEmail,
    userName,
    userId,
  } = ctx;

  const displayClient = clientName || "An application";
  const signedInAs = (userEmail && userEmail.trim()) ||
    (userName && userName.trim()) ||
    userId ||
    "";

  const scopeRows = scopes
    .map((s) => {
      const copy = SCOPE_COPY[s] || { title: s, detail: "" };
      return `<div class="scope-row">
        <div class="scope-title">${escapeHtml(copy.title)}</div>
        ${copy.detail ? `<div class="scope-detail">${escapeHtml(copy.detail)}</div>` : ""}
      </div>`;
    })
    .join("");

  const logoBlock = logoUri
    ? `<img class="client-logo" src="${escapeHtml(logoUri)}" alt="">`
    : `<div class="client-logo client-logo-fallback" aria-hidden="true">
         <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
           <path d="M12 2L4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z"
                 stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
         </svg>
       </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize — AdsGPT</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: #0F0F0F;
    color: #FFFFFF;
    font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    position: relative;
    overflow-x: hidden;
  }

  /* Bottom-left large blue glow (Polygon 2) */
  .glow-bottom {
    position: fixed;
    left: -18%;
    bottom: -15%;
    width: 130%;
    height: 55%;
    background: linear-gradient(263.15deg,
      #0975F0 2.44%, #28BCFC 34.24%, #8FC8FB 50.61%,
      #28BCFC 66.04%, #0975F0 80.15%);
    opacity: 0.35;
    filter: blur(160px);
    z-index: 0;
    pointer-events: none;
  }
  /* Top-right circular glow (Ellipse 2505) */
  .glow-topright {
    position: fixed;
    top: -180px;
    right: 60px;
    width: 400px;
    height: 400px;
    border-radius: 50%;
    background: linear-gradient(234.24deg,
      #0975F0 17.78%, #28BCFC 29.75%, #8FC8FB 47.29%,
      #28BCFC 67.34%, #0975F0 82.61%);
    opacity: 0.35;
    filter: blur(140px);
    z-index: 0;
    pointer-events: none;
  }

  /* AdsGPT logo top-left */
  .brand {
    position: fixed;
    top: 22px;
    left: 24px;
    width: 44px;
    height: 44px;
    z-index: 5;
    color: #F5C518;
  }

  /* Consent card — the star of the page */
  .card {
    position: relative;
    z-index: 3;
    width: 100%;
    max-width: 494px;
    background: rgba(13, 13, 13, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.06);
    backdrop-filter: blur(50px);
    -webkit-backdrop-filter: blur(50px);
    border-radius: 30px;
    padding: 32px 34px 30px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }

  .header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;
  }
  .header-text { flex: 1; min-width: 0; }
  .client-logo {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
  }
  .client-logo-fallback {
    background: rgba(37, 99, 235, 0.15);
    color: #6CB4EE;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h1 {
    font-size: 22px;
    line-height: 1.2;
    font-weight: 600;
    color: #FFFFFF;
    margin-bottom: 4px;
  }
  .subtitle {
    font-size: 15px;
    color: #FFFFFF;
    font-weight: 400;
  }

  /* Signed-in pill */
  .signed-in {
    display: inline-flex;
    align-items: center;
    padding: 10px 18px;
    border-radius: 30px;
    background: rgba(144, 146, 148, 0.1);
    font-size: 12px;
    font-weight: 300;
    color: #AFAFAF;
    margin-bottom: 26px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scopes-label {
    font-size: 15px;
    color: #FFFFFF;
    margin-bottom: 12px;
  }
  .client-name-emphasis {
    color: #FFFFFF;
    font-weight: 600;
  }

  .scopes-box {
    background: rgba(144, 146, 148, 0.1);
    border-radius: 20px;
    padding: 14px 20px;
    margin-bottom: 28px;
  }
  .scope-row {
    padding: 8px 0;
  }
  .scope-row + .scope-row {
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    margin-top: 4px;
    padding-top: 12px;
  }
  .scope-title {
    font-size: 15px;
    font-weight: 600;
    color: #FFFFFF;
  }
  .scope-detail {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.72);
    margin-top: 4px;
    line-height: 1.4;
  }

  /* Buttons */
  .actions {
    display: flex;
    justify-content: center;
    gap: 10px;
    margin-bottom: 22px;
  }
  .btn {
    min-width: 120px;
    height: 42px;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-family: inherit;
    padding: 0 20px;
    transition: transform 0.05s ease, filter 0.15s ease;
  }
  .btn:active { transform: translateY(1px); }
  .btn:focus-visible { outline: 2px solid #6CB4EE; outline-offset: 3px; }
  .btn-deny {
    background: #3B3C3D;
    color: #FFFFFF;
    font-weight: 400;
    font-size: 14px;
  }
  .btn-deny:hover { filter: brightness(1.15); }
  .btn-allow {
    background: #FFFFFF;
    color: #000000;
    font-weight: 500;
    font-size: 15px;
  }
  .btn-allow:hover { filter: brightness(0.95); }

  .footer {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
    font-weight: 400;
  }

  /* Tighter layout on narrow screens */
  @media (max-width: 480px) {
    .card { padding: 24px 22px 22px; border-radius: 22px; }
    h1 { font-size: 19px; }
    .subtitle { font-size: 14px; }
    .btn { min-width: 0; flex: 1; }
    .actions { gap: 10px; }
    .glow-topright { width: 260px; height: 260px; }
  }
</style>
</head>
<body>
  <div class="glow-bottom" aria-hidden="true"></div>
  <div class="glow-topright" aria-hidden="true"></div>

  <!-- AdsGPT brand mark -->
  <div class="brand" aria-hidden="true">
    <svg width="44" height="44" viewBox="0 0 52 52" fill="none">
      <circle cx="23" cy="23" r="18" stroke="#F5C518" stroke-width="3" stroke-dasharray="2 3"/>
      <path d="M25 12 L18 25 L24 25 L21 34 L32 21 L26 21 Z" fill="#F5C518"/>
      <rect x="35" y="35" width="14" height="4.5" rx="2.25"
            transform="rotate(45 35 35)" fill="#F5C518"/>
    </svg>
  </div>

  <main class="card" role="dialog" aria-labelledby="consent-title">
    <div class="header">
      ${logoBlock}
      <div class="header-text">
        <h1 id="consent-title">${escapeHtml(displayClient)} wants to access AdsGPT</h1>
        <div class="subtitle">Review and Approve below</div>
      </div>
    </div>

    ${signedInAs ? `<div class="signed-in">Signed in as ${escapeHtml(signedInAs)}</div>` : ""}

    <div class="scopes-label">
      This will let <span class="client-name-emphasis">${escapeHtml(displayClient)}</span>:
    </div>

    <div class="scopes-box">${scopeRows}</div>

    <form method="POST" action="/oauth/consent" class="actions">
      <input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
      <button type="submit" name="decision" value="deny" class="btn btn-deny">Deny</button>
      <button type="submit" name="decision" value="approve" class="btn btn-allow">Allow</button>
    </form>

    <div class="footer">You can revoke this anytime from your AdsGPT account</div>
  </main>
</body>
</html>`;
}

module.exports = { renderConsentPage };
