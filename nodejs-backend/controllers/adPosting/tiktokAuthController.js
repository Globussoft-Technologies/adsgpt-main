const axios = require("axios");
const jwt = require("jsonwebtoken");
const TiktokUsers = require("../../Module/adPosting/tiktokUsers");
const { encrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");
const { invalidateAllUserTiktokCache, TIKTOK_API_BASE } = require("../../utils/tiktokHelpers");

const ALLOWED_REDIRECT_ORIGIN = process.env.FRONTEND_URL;

class TiktokAuthController {
  constructor() {
    this.initiateAuth = this.initiateAuth.bind(this);
    this.handleCallback = this.handleCallback.bind(this);
    this.getCurrentUser = this.getCurrentUser.bind(this);
    this.disconnectUser = this.disconnectUser.bind(this);
  }

  /**
   * Initiate TikTok OAuth flow.
   *
   * Supports userId from either:
   *  - query param `userId` (legacy / picker flow)
   *  - JWT token in Authorization header (preferred)
   *
   * Mirrors Meta/Google initiateAuth patterns.
   */
  initiateAuth(req, res) {
    let userId = null;
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;

    const token = authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : queryToken;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY, { algorithms: ["HS512"] });
        if (decoded.user_id) {
          const rawId = String(decoded.user_id).replace(/\D/g, "");
          userId = (decoded.created_from === "PAS" ? "PAS-" : "GPT-") + rawId;
        }
      } catch (e) {
        logger.error(`TikTok initiateAuth token decode failed: ${e.message}`);
      }
    }

    if (!userId && req.query.userId) {
      userId = req.query.userId;
    }

    if (!userId) {
      return res.status(401).json({ error: "Valid JWT token or userId required" });
    }

    const { feUrl } = req.query;
    const state = JSON.stringify({
      userId,
      feUrl: feUrl || ALLOWED_REDIRECT_ORIGIN,
    });

    const appId = process.env.TIKTOK_APP_ID;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;

    if (!appId || !redirectUri) {
      return res.status(500).json({ error: "TikTok OAuth not configured" });
    }

    // TikTok Marketing API authorization URL.
    // Scopes are configured in the developer app dashboard, not passed here.
    const authUrl =
      `https://business-api.tiktok.com/portal/auth` +
      `?app_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  }

  /**
   * Handle TikTok OAuth callback.
   *
   * TikTok returns: ?auth_code=...&state=...
   */
  async handleCallback(req, res) {
    const { auth_code, state } = req.query;
    const fallback = `${ALLOWED_REDIRECT_ORIGIN}?error=tiktok_auth_failed`;

    if (!auth_code) {
      return res.redirect(fallback);
    }

    let userId = null;
    let feUrl = ALLOWED_REDIRECT_ORIGIN;
    try {
      if (state) {
        const decodedState = JSON.parse(state);
        userId = decodedState.userId;
        feUrl = decodedState.feUrl || feUrl;
      }
    } catch (e) {
      logger.error(`Failed to parse TikTok auth state: ${e.message}`);
    }

    if (!userId) {
      return res.redirect(fallback);
    }

    try {
      const appId = process.env.TIKTOK_APP_ID;
      const appSecret = process.env.TIKTOK_APP_SECRET;

      if (!appId || !appSecret) {
        throw new Error("TikTok OAuth credentials not configured");
      }

      // 1. Exchange auth_code for access_token
      const tokenResponse = await axios.post(
        `${TIKTOK_API_BASE}/oauth2/access_token/`,
        {
          app_id: appId,
          secret: appSecret,
          auth_code,
        }
      );

      const tokenData = tokenResponse.data?.data || {};
      const {
        access_token,
        refresh_token,
        advertiser_ids,
        expires_in,
      } = tokenData;

      if (!access_token) {
        throw new Error("TikTok token exchange did not return access_token");
      }

      // 2. Fetch advertiser info for connected accounts
      let advertiserInfo = [];
      try {
        const advertiserResponse = await axios.get(
          `${TIKTOK_API_BASE}/advertiser/info/`,
          {
            headers: { "Access-Token": access_token },
            params: { advertiser_ids: JSON.stringify(advertiser_ids || []) },
          }
        );
        advertiserInfo = advertiserResponse.data?.data?.list || [];
      } catch (infoError) {
        logger.warn(
          `[tiktok] advertiser info fetch failed:`,
          infoError.response?.data || infoError.message
        );
      }

      // 3. Upsert user record with encrypted tokens
      const encryptedAccessToken = encrypt(access_token);
      const encryptedRefreshToken = encrypt(refresh_token || "");
      const tokenExpiresAt = new Date(
        Date.now() + (expires_in || 86400) * 1000
      );

      let user = await TiktokUsers.findOne({ userId });
      if (user) {
        user.tiktokAppId = appId;
        user.accessToken = encryptedAccessToken;
        if (refresh_token) user.refreshToken = encryptedRefreshToken;
        user.tokenExpiresAt = tokenExpiresAt;
        user.advertiserIds = advertiser_ids || [];
        user.advertiserInfo = advertiserInfo.map((adv) => ({
          advertiserId: String(adv.advertiser_id || adv.id || ""),
          name: adv.name || "",
          currency: adv.currency || "USD",
          timezone: adv.timezone || "",
          status: adv.status || "",
        }));
        user.isActive = true;
        await user.save();
      } else {
        user = await TiktokUsers.create({
          userId,
          tiktokAppId: appId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt,
          advertiserIds: advertiser_ids || [],
          advertiserInfo: advertiserInfo.map((adv) => ({
            advertiserId: String(adv.advertiser_id || adv.id || ""),
            name: adv.name || "",
            currency: adv.currency || "USD",
            timezone: adv.timezone || "",
            status: adv.status || "",
          })),
        });
      }

      // 4. Bust any existing TikTok cache for this user
      await invalidateAllUserTiktokCache(userId).catch(() => {});

      logger.info(`TikTok auth success for userId: ${userId}`);

      // 5. Redirect back to frontend
      const redirectUrl = new URL(feUrl);
      redirectUrl.searchParams.set("tiktok_auth", "success");
      redirectUrl.searchParams.set("name", encodeURIComponent(user.advertiserInfo?.[0]?.name || ""));
      res.redirect(redirectUrl.toString());
    } catch (error) {
      logger.error(
        `TikTok auth callback error:`,
        error.response?.data || error.message
      );
      const errorUrl = new URL(feUrl || ALLOWED_REDIRECT_ORIGIN);
      errorUrl.searchParams.set("error", "tiktok_token_exchange_failed");
      errorUrl.searchParams.set(
        "error_message",
        encodeURIComponent(error.userMessage || error.message)
      );
      res.redirect(errorUrl.toString());
    }
  }

  /**
   * Get connected TikTok user (without tokens).
   */
  async getCurrentUser(req, res) {
    try {
      const user = await TiktokUsers.findOne({
        userId: req.params.id,
        isActive: true,
      }).select("-accessToken -refreshToken");

      if (!user) {
        return res.status(404).json({
          error: "User not found. Please connect your TikTok account.",
        });
      }

      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tokenExpiringSoon =
        !user.tokenExpiresAt || user.tokenExpiresAt < oneDayFromNow;

      return res.json({
        ...user.toObject(),
        tokenExpiringSoon,
      });
    } catch (error) {
      logger.error(`TikTok getCurrentUser error: ${error.message}`);
      return res.status(500).json({ error: "Failed to fetch TikTok user" });
    }
  }

  /**
   * Disconnect TikTok user and clear cache.
   */
  async disconnectUser(req, res) {
    try {
      const { id } = req.params;
      await TiktokUsers.findOneAndUpdate(
        { userId: id },
        { isActive: false }
      );
      await invalidateAllUserTiktokCache(id).catch(() => {});
      return res.json({ success: true, message: "TikTok account disconnected" });
    } catch (error) {
      logger.error(`TikTok disconnect error: ${error.message}`);
      return res.status(500).json({ error: "Failed to disconnect TikTok account" });
    }
  }
}

module.exports = new TiktokAuthController();
