const jwt = require("jsonwebtoken");
const axios = require("axios");
const GoogleUsers = require("../../Module/adPosting/googleUsers");
const { encrypt, decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const { invalidateAllUserGoogleCache } = require("./googleAdController");
const { trackBackendGA4Event } = require("../../utils/ga4");

const ALLOWED_REDIRECT_ORIGIN = process.env.FRONTEND_URL;

function isSafeRedirectUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.trim();
  if (/^(javascript|data|vbscript):/i.test(clean)) return false;
  if (clean.startsWith('/') && !clean.startsWith('//') && !clean.startsWith('/\\')) return true;
  try {
    const parsed = new URL(clean);
    const allowed = [
      ALLOWED_REDIRECT_ORIGIN,
      process.env.FRONTEND_URL,
      "http://localhost:3000",
      "http://localhost:5173",
    ].filter(Boolean);
    return allowed.some((a) => {
      try { return new URL(a).origin === parsed.origin; } catch { return false; }
    });
  } catch {
    return false;
  }
}

class GoogleAuthController {
  constructor() {
    this.initiateAuth = this.initiateAuth.bind(this);
    this.handleCallback = this.handleCallback.bind(this);
    this.getCurrentUser = this.getCurrentUser.bind(this);
    this.disconnectUser = this.disconnectUser.bind(this);
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────────

  initiateAuth(req, res) {
    let userId = null;
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;

    // 1. Check Authorization Header OR Query Parameter for JWT
    const token = (authHeader && authHeader.startsWith("Bearer ")) 
      ? authHeader.split(" ")[1] 
      : queryToken;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY, { algorithms: ["HS512"] });
        if (decoded.user_id) {
          // Robustly normalize: Strip anything that isn't a digit to get the raw numeric ID
          const rawId = String(decoded.user_id).replace(/\D/g, "");
          userId = (decoded.created_from === "PAS" ? "PAS-" : "GPT-") + rawId;
        }
      } catch (e) {
        logger.error(`Google initiateAuth token decode failed: ${e.message}`);
      }
    }

    // 2. Fallback to userId query param (less secure, for dev/legacy)
    if (!userId && req.query.userId) {
      userId = req.query.userId;
    }

    if (!userId) {
      return res.status(401).json({ error: "Valid JWT token (Header or ?token=) required" });
    }

    const { feUrl } = req.query;
    const state = JSON.stringify({
      userId,
      feUrl: feUrl || ALLOWED_REDIRECT_ORIGIN,
    });

    const scope = [
      "https://www.googleapis.com/auth/adwords",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ].join(" ");

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${process.env.GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  }

  async handleCallback(req, res) {
    const { code, state } = req.query;
    const fallback = `${ALLOWED_REDIRECT_ORIGIN}?error=google_auth_failed`;

    if (!code) return res.redirect(fallback);

    let userId = null;
    let feUrl = ALLOWED_REDIRECT_ORIGIN;
    try {
      if (state) {
        const decodedState = JSON.parse(state);
        userId = decodedState.userId;
        feUrl = isSafeRedirectUrl(decodedState.feUrl) ? decodedState.feUrl : feUrl;
      }
    } catch (e) {
      logger.error(`Failed to parse Google auth state: ${e.message}`);
    }

    try {
      const appId = process.env.GOOGLE_CLIENT_ID;
      const appSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
        code,
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      const userResponse = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const { id, name, email } = userResponse.data;

      const encryptedAccessToken = encrypt(access_token);
      const encryptedRefreshToken = encrypt(refresh_token || ""); // refresh_token might be null if already granted
      const tokenExpiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

      let user = await GoogleUsers.findOne({ $or: [{ googleId: id }, { userId }] });
      if (user) {
        user.googleId = id;
        user.accessToken = encryptedAccessToken;
        if (refresh_token) user.refreshToken = encryptedRefreshToken;
        user.name = name;
        user.email = email;
        user.tokenExpiresAt = tokenExpiresAt;
        user.userId = userId;
        await user.save();
      } else {
        user = await GoogleUsers.create({
          googleId: id,
          name,
          email,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt,
          userId,
        });
      }

      // Try to fetch and store accessible customer IDs at login time so
      // getAdAccountsList can use them with login-customer-id (needed for Basic access).
      try {
        const customerResp = await axios.get("https://googleads.googleapis.com/v23/customers:listAccessibleCustomers", {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "developer-token": process.env.GOOGLE_DEVELOPER_TOKEN,
          },
        });
        const resourceNames = customerResp.data?.resourceNames || [];
        const ids = resourceNames.map((rn) => rn.replace("customers/", "").replace(/-/g, ""));
        if (ids.length) {
          user.customerIds = ids;
          await user.save();
        }
      } catch (_) {
        // Non-fatal — customerIds will remain empty and getAdAccountsList handles it
      }

      // Bust per-user Google caches so the next read hits Google fresh
      await invalidateAllUserGoogleCache(userId).catch(() => {});

      trackBackendGA4Event('account_connected', {
        user_id: userId,
        platform: 'google',
        success: true,
      });

      logger.info(`Google auth success for userId: ${userId}`);

      // Redirect back to the frontend — exactly like Meta's flow.
      // The user's original JWT is unchanged; the Google OAuth token is
      // stored in MongoDB and looked up automatically on every API call.
      const redirectUrl = new URL(feUrl);
      redirectUrl.searchParams.set("google_auth", "success");
      redirectUrl.searchParams.set("name", encodeURIComponent(name));
      redirectUrl.searchParams.set("email", encodeURIComponent(email));
      res.redirect(redirectUrl.toString());
    } catch (error) {
      logger.error(`Google auth callback error: ${error.response?.data?.error || error.message}`);
      trackBackendGA4Event('account_connection_failed', {
        platform: 'google',
        success: false,
        error_code: 'OAUTH_FAILED',
      });
      res.redirect(`${feUrl}?error=google_token_exchange_failed`);
    }
  }

  
  // ─── User ─────────────────────────────────────────────────────────────────────

  async getCurrentUser(req, res) {
    try {
      const user = await GoogleUsers.findOne({
        userId: req.params.id,
      }).select("-accessToken -refreshToken");

      if (!user) {
        return res.status(404).json({
          error: "User not found. Please connect your Google account.",
        });
      }

      // Warn if token is expiring within 24 hours (but still return the user)
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tokenExpiringSoon = !user.tokenExpiresAt || user.tokenExpiresAt < oneDayFromNow;

      return res.status(200).json({
        message: "Google account fetched successfully",
        data: user,
        tokenExpiringSoon,
        ...(tokenExpiringSoon && {
          warning: "Google token is expiring soon. Please reconnect to avoid disruption.",
        }),
      });
    } catch (error) {
      console.error("Get Google user error:", error);
      return res.status(500).json({ error: "Failed to fetch user" });
    }
  }
  
  /**
   * Disconnect Google account by removing the user record.
   */
  async disconnectUser(req, res) {
    try {
      const userId = req.params.id;
      const user = await GoogleUsers.findOneAndDelete({ userId });

      if (!user) {
        return res.status(404).json({
          error: "User not found or already disconnected.",
        });
      }

      // Best-effort cache wipe — never fail the disconnect on a Redis hiccup.
      try {
        await invalidateAllUserGoogleCache(userId);
      } catch (cacheErr) {
        console.error("Disconnect Google cache invalidation failed:", cacheErr);
      }

      return res.status(200).json({
        message: "Google account disconnected successfully",
      });
    } catch (error) {
      console.error("Disconnect Google user error:", error);
      return res.status(500).json({ error: "Failed to disconnect user" });
    }
  }
}

module.exports = new GoogleAuthController();
