const jwt = require("jsonwebtoken");
const { redisClient } = require("../../db/redis");
const {
  createAdsGptSessionForAmemberUserId,
} = require("./authController");
const {
  verifyAdsGptSession,
} = require("../../services/oauth/sessionCheck");

const ASSERTION_TTL_SECONDS = 60;
const REPLAY_TTL_SECONDS = 120;

function requiredConfig(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeReturnPath(value) {
  const path = typeof value === "string" ? value : "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "/";
  return path.slice(0, 2048);
}

function successRedirect(returnPath) {
  const configured = requiredConfig("AMEMBER_SSO_SUCCESS_URL");
  const base = new URL(configured);
  if (base.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("AMEMBER_SSO_SUCCESS_URL must use HTTPS in production");
  }
  return new URL(safeReturnPath(returnPath), base.origin).toString();
}

function serializeSessionCookie(token) {
  const expiryMinutes = Math.max(
    1,
    Number.parseInt(process.env.TOKEN_EXPIRY_TIME || "1440", 10) || 1440,
  );
  const parts = [
    `adsgpt-session=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${expiryMinutes * 60}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV !== "test") parts.push("Secure");

  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function serializeLegacyAccessTokenCookie(token) {
  const expiryMinutes = Math.max(
    1,
    Number.parseInt(process.env.TOKEN_EXPIRY_TIME || "1440", 10) || 1440,
  );
  const parts = [
    `access-token=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${expiryMinutes * 60}`,
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV !== "test") parts.push("Secure");

  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = [
    "adsgpt-session=",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV !== "test") parts.push("Secure");
  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function clearLegacyAccessTokenCookie() {
  const parts = [
    "access-token=",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV !== "test") parts.push("Secure");
  const domain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

async function consumeAssertion(assertion) {
  const secret = requiredConfig("AMEMBER_SSO_SECRET");
  if (secret.length < 32) {
    throw new Error("AMEMBER_SSO_SECRET must be at least 32 characters");
  }

  const payload = jwt.verify(assertion, secret, {
    algorithms: ["HS256"],
    issuer: process.env.AMEMBER_SSO_ISSUER || "amember",
    audience: process.env.AMEMBER_SSO_AUDIENCE || "adsgpt-node",
    maxAge: `${ASSERTION_TTL_SECONDS}s`,
    clockTolerance: 5,
  });

  if (!payload?.sub || !/^\d+$/.test(String(payload.sub))) {
    throw new Error("Assertion subject is invalid");
  }
  if (!payload?.jti || !/^[a-f0-9]{32,128}$/i.test(String(payload.jti))) {
    throw new Error("Assertion id is invalid");
  }

  // Fail closed: a login assertion is only safe when we can atomically mark
  // it as consumed. Redis returning null means the assertion was replayed.
  const replayKey = `auth:amember-sso:jti:${payload.jti}`;
  const stored = await redisClient.set(
    replayKey,
    String(payload.sub),
    "EX",
    REPLAY_TTL_SECONDS,
    "NX",
  );
  if (stored !== "OK") {
    const error = new Error("This login assertion has already been used");
    error.code = "ASSERTION_REPLAYED";
    throw error;
  }

  return payload;
}

async function callback(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");

  try {
    const assertion = String(req.query?.assertion || "");
    if (!assertion || assertion.length > 8192) {
      return res.status(400).send("Missing or invalid aMember login assertion.");
    }

    const payload = await consumeAssertion(assertion);
    const session = await createAdsGptSessionForAmemberUserId(payload.sub);

    res.setHeader("Set-Cookie", [
      serializeSessionCookie(session.token),
      serializeLegacyAccessTokenCookie(session.token),
    ]);
    return res.redirect(303, successRedirect(payload.return_path));
  } catch (error) {
    const status = Number(error.status) || 401;
    console.error("[amember-sso] login failed:", error.code || error.message);
    return res
      .status(status >= 400 && status < 600 ? status : 401)
      .send(
        error.code === "PLAN_EXPIRED"
          ? "Your AdsGPT plan has expired. Please renew it and try again."
          : "AdsGPT sign-in failed. Please return to the login page and try again.",
      );
  }
}

function session(req, res) {
  res.set("Cache-Control", "no-store");
  const user = verifyAdsGptSession(req);
  if (!user) return res.status(401).json({ authenticated: false });
  return res.json({
    authenticated: true,
    user: {
      user_id: user.user_id,
      login: user.login,
      user_name: user.user_name,
      user_email: user.user_email,
      userSubscriptionType: user.userSubscriptionType || {},
      created_from: user.created_from,
    },
  });
}

function logout(req, res) {
  res.set("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", [
    clearSessionCookie(),
    clearLegacyAccessTokenCookie(),
  ]);
  return res.status(204).end();
}

module.exports = {
  callback,
  session,
  logout,
  consumeAssertion,
  safeReturnPath,
  serializeSessionCookie,
  serializeLegacyAccessTokenCookie,
  clearSessionCookie,
  clearLegacyAccessTokenCookie,
};
