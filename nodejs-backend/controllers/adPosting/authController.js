const axios = require("axios");
const User = require("../../Module/adPosting/facebookUsers");
const { encrypt } = require("../../utils/crypto");
const { redisClient } = require("../../db/redis");

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
      feUrl: feUrl || process.env.FRONTEND_URL,
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
      // DORMANT — required to read captured Lead Form submissions (the
      // dashboard's Leads tab: /get-form-leads + /export-form-leads).
      // Kept commented out because the Facebook App does not yet have
      // this permission enabled, so Meta rejects the OAuth dialog with
      // "Invalid Scopes: leads_retrieval". To activate the Leads tab:
      //   1. Enable `leads_retrieval` on the Meta App Dashboard
      //      (App Review → Permissions and Features / Lead Ads use case).
      //   2. Uncomment the line below.
      //   3. Users re-connect Facebook so the new token carries the scope.
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

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
    }

    let userId = null;
    let feUrl = process.env.FRONTEND_URL;
    try {
      if (state) {
        const decodedState = JSON.parse(state);
        userId = decodedState.userId;
        feUrl = decodedState.feUrl || feUrl;
      }
    } catch (e) {
      console.error("Failed to parse state", e);
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

      // Save or Update User in MongoDB
      let user = await User.findOne({ facebookId: id });
      const encryptedToken = encrypt(accessToken);

      if (user) {
        user.accessToken = encryptedToken;
        user.name = name;
        user.email = email;
        // Default to 60 days if expiry not provided
        user.tokenExpiresAt = new Date(
          Date.now() + (expiresIn || 5184000) * 1000
        );
        if (userId) user.userId = userId; // Update userId if provided
        await user.save();
      } else {
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

      // Redirect back to frontend with MongoDB User ID
      // The frontend will then call /api/auth/me/:id to get details
      res.redirect(`${feUrl}`);
    } catch (error) {
      console.error(
        "Auth callback error:",
        error.response?.data || error.message
      );
      res.redirect(`${process.env.FRONTEND_URL}?error=token_exchange_failed`);
    }
  }
}

module.exports = new AuthController();
