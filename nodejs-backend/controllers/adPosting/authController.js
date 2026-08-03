const axios = require("axios");
const User = require("../../Module/adPosting/facebookUsers");
const { encrypt } = require("../../utils/crypto");
const { redisClient } = require("../../db/redis");
const {
  safeFacebookReturnUrl,
  buildFacebookReturnUrl,
} = require("../../utils/oauthReturnUrl");

// Cache prefixes that are scoped per-user and embed Meta data which becomes
// stale the moment a user re-auths Facebook (new ad accounts granted, token
// refreshed, etc.). Bust them after every successful OAuth callback so the
// next page render hits Meta fresh.
const PER_USER_META_CACHE_PREFIXES = [
  "metaAdAccounts",
  "metaCampaigns",
  "metaAdsets",
  "metaCampaignAds",
  "metaAdSetAds",
  "metaDashboard",
  "metaAnalytics",
  "metaInsights",
  "metaAudit",
];

async function bustPerUserCaches(userId) {
  if (!userId) return;
  const keysToDelete = [];
  for (const prefix of PER_USER_META_CACHE_PREFIXES) {
    try {
      const stream = redisClient.scanStream({
        match: `${prefix}:${userId}*`,
        count: 100,
      });
      for await (const keys of stream) {
        if (keys.length) keysToDelete.push(...keys);
      }
    } catch (err) {
      // scan failure is non-fatal — auth flow still completes.
      console.warn(`[fb-auth] cache scan failed for ${prefix}: ${err.message}`);
    }
  }
  if (keysToDelete.length) {
    try {
      await redisClient.del(...keysToDelete);
    } catch (err) {
      console.warn(`[fb-auth] cache del failed: ${err.message}`);
    }
  }
}

class AuthController {
  constructor() {
    this.initiateAuth = this.initiateAuth.bind(this);
    this.handleCallback = this.handleCallback.bind(this);
  }

  /**
   * Initiate Facebook OAuth flow
   */
  initiateAuth(req, res) {
    const { userId, feUrl } = req.query;

    const state = JSON.stringify({
      userId: userId || null,
      feUrl: safeFacebookReturnUrl(feUrl, process.env.FRONTEND_URL),
    });

    const appId = process.env.FACEBOOK_APP_ID;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI;

    const scope = [
      "pages_show_list",
      "pages_read_engagement",
      // "pages_manage_posts",
      // "pages_manage_metadata",
      "ads_management",
      // "ads_read",
      "business_management",
      "public_profile",
      "pages_manage_ads",
      // Required for the Sales/CATALOG (Dynamic Product Ads) cell — lists
      // product catalogs accessible to the user's Business Manager + lists
      // product sets within a catalog. Approved via Meta App Review
      // 2026-07-01 (App Review → Permissions and Features → catalog_management).
      // "catalog_management",
      // Required to read captured Lead Form submissions (the dashboard's
      // Leads tab: /get-form-leads + /export-form-leads). Approved via Meta
      // App Review 2026-07-01 alongside catalog_management (Lead Ads use
      // case). Already-connected users need to re-connect Facebook once
      // (auth_type=rerequest below handles this) so their token picks up
      // the new scope — until then, /get-form-leads returns Meta's
      // permission-denied error for their existing token.
      "leads_retrieval",
    ].join(",");

    // `auth_type=rerequest` forces Facebook to re-show the permissions
    // dialog even for users who already connected the app — required so
    // already-connected users are re-prompted for newly added scopes
    // (e.g. leads_retrieval). Without it, Facebook silently skips the
    // dialog and the new scope never lands on the token.
    const authUrl = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${scope}&response_type=code&auth_type=rerequest&state=${encodeURIComponent(
      state
    )}`;

    res.redirect(authUrl);
  }

  /**
   * Handle Facebook OAuth callback
   */
  async handleCallback(req, res) {
    const { code, state } = req.query;

    let userId = null;
    let feUrl = process.env.FRONTEND_URL;
    try {
      if (state) {
        const decodedState = JSON.parse(state);
        userId = decodedState.userId;
        feUrl = safeFacebookReturnUrl(
          decodedState.feUrl,
          process.env.FRONTEND_URL,
        );
      }
    } catch (e) {
      console.error("Failed to parse state", e);
    }

    if (!code) {
      return res.redirect(
        buildFacebookReturnUrl(
          feUrl,
          { error: "auth_failed" },
          process.env.FRONTEND_URL,
        ),
      );
    }

    try {
      const appId = process.env.FACEBOOK_APP_ID;
      const appSecret = process.env.FACEBOOK_APP_SECRET;
      const redirectUri = process.env.FACEBOOK_REDIRECT_URI;

      // Exchange code for access token
      const tokenResponse = await axios.get(
        "https://graph.facebook.com/v22.0/oauth/access_token",
        {
          params: {
            client_id: appId,
            client_secret: appSecret,
            redirect_uri: redirectUri,
            code: code,
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;
      const expiresIn = tokenResponse.data.expires_in;

      // Get user info
      const userResponse = await axios.get(
        "https://graph.facebook.com/v22.0/me",
        {
          params: {
            access_token: accessToken,
            fields: "id,name,email",
          },
        }
      );

      const { id, name, email } = userResponse.data;

      // Save or update this Facebook connection. Multiple Facebook rows may
      // belong to the same AdsGPT user; facebookId identifies the connection.
      let user = await User.findOne({ facebookId: id });
      const encryptedToken = encrypt(accessToken);

      if (user) {
        if (userId && user.userId !== userId) {
          const conflictError = new Error(
            "This Facebook account is already connected to another AdsGPT user",
          );
          conflictError.oauthErrorCode = "facebook_account_taken";
          throw conflictError;
        }
        user.accessToken = encryptedToken;
        user.name = name;
        user.email = email;
        // Default to 60 days if expiry not provided
        user.tokenExpiresAt = new Date(
          Date.now() + (expiresIn || 5184000) * 1000
        );
        await user.save();
      } else {
        if (!userId) {
          throw new Error("AdsGPT userId is required to connect Facebook");
        }
        user = await User.create({
          facebookId: id,
          name,
          email,
          accessToken: encryptedToken,
          tokenExpiresAt: new Date(Date.now() + (expiresIn || 5184000) * 1000),
          userId: userId, // Save userId
        });
      }

      // Bust per-user Meta caches so the next /get-ad-accounts (and other
      // /meta-ads/* reads) hit Meta fresh with the new token. Without this,
      // a stale 2-hour Redis cache would keep serving the previous OAuth's
      // account list and the user wouldn't see newly granted accounts.
      await bustPerUserCaches(user.userId);

      // Return to the initiating web page or mobile app callback.
      const redirectUrl = buildFacebookReturnUrl(
        feUrl,
        { auth: "success", facebookId: id },
        process.env.FRONTEND_URL,
      );
      res.redirect(redirectUrl);
    } catch (error) {
      console.error(
        "Auth callback error:",
        error.response?.data || error.message
      );
      res.redirect(
        buildFacebookReturnUrl(
          feUrl,
          { error: error.oauthErrorCode || "token_exchange_failed" },
          process.env.FRONTEND_URL,
        ),
      );
    }
  }
}

module.exports = new AuthController();
