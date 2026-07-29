const User = require("../../Module/adPosting/facebookUsers");
const { invalidateAllUserMetaCache } = require("./metaAdLauncher");
const {
  META_TOKEN_MIN_VALIDITY_MS,
  getFacebookConnectionStatus,
  getFacebookIdFromRequest,
} = require("../../utils/metaConnection");

class UserController {
  constructor() {
    this.getCurrentUser = this.getCurrentUser.bind(this);
    this.listFacebookAccounts = this.listFacebookAccounts.bind(this);
    this.disconnectUser = this.disconnectUser.bind(this);
  }

  async listFacebookAccounts(req, res) {
    try {
      const userId = req.user.user_id;
      if (req.params.id && req.params.id !== userId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const accounts = await User.find({ userId })
        .sort({ updatedAt: -1 })
        .select("-accessToken")
        .lean();
      const accountsWithStatus = accounts.map((account) => ({
        ...account,
        ...getFacebookConnectionStatus(account),
      }));
      return res.status(200).json({
        status: true,
        accounts: accountsWithStatus,
        count: accountsWithStatus.length,
        usableCount: accountsWithStatus.filter((account) => account.isUsable)
          .length,
      });
    } catch (error) {
      console.error("List Facebook accounts error:", error);
      return res.status(500).json({ error: "Failed to list Facebook accounts" });
    }
  }

  /**
   * Get current user details by ID
   */
  async getCurrentUser(req, res) {
    try {
      const usableAfter = new Date(Date.now() + META_TOKEN_MIN_VALIDITY_MS);

      if (req.params.id !== req.user.user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const facebookId = getFacebookIdFromRequest(req);
      const query = {
        userId: req.params.id,
        tokenExpiresAt: { $gt: usableAfter },
      };
      if (facebookId) query.facebookId = facebookId;
      const user = await User.findOne(query)
        .sort({ updatedAt: -1 })
        .select("-accessToken");

      if (!user) {
        return res.status(404).json({
          error:
            "User not found or Facebook token expiring soon. Please reconnect.",
        });
      }

      return res.status(200).json({
        message: "User fetched successfully",
        data: user,
      });
    } catch (error) {
      console.error("Get user error:", error);
      return res.status(500).json({ error: "Failed to fetch user" });
    }
  }

  /**
   * Disconnect Facebook account by removing the user record. Also wipes any
   * cached Meta data keyed to this userId — the FB token is gone, so cached
   * accounts/campaigns/insights would be stale and could leak if the user
   * later reconnects under a different FB account.
   */
  async disconnectUser(req, res) {
    try {
      const userId = req.params.id;
      if (userId !== req.user.user_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const facebookId =
        req.params.facebookId || getFacebookIdFromRequest(req);
      let query = { userId };
      if (facebookId) {
        query.facebookId = facebookId;
      } else {
        const count = await User.countDocuments({ userId });
        if (count > 1) {
          return res.status(400).json({
            error: "facebookId is required when multiple Facebook accounts are connected",
            code: "FACEBOOK_ACCOUNT_REQUIRED",
          });
        }
      }
      const user = await User.findOneAndDelete(query);

      if (!user) {
        return res.status(404).json({
          error: "User not found or already disconnected.",
        });
      }

      // Best-effort cache wipe — never fail the disconnect on a Redis hiccup.
      try {
        await invalidateAllUserMetaCache(userId);
      } catch (cacheErr) {
        console.error("Disconnect cache invalidation failed:", cacheErr);
      }

      return res.status(200).json({
        message: "Facebook account disconnected successfully",
        facebookId: user.facebookId,
      });
    } catch (error) {
      console.error("Disconnect user error:", error);
      return res.status(500).json({ error: "Failed to disconnect user" });
    }
  }
}

module.exports = new UserController();
