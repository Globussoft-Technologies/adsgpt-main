const User = require("../../Module/adPosting/facebookUsers");
const { invalidateAllUserMetaCache } = require("./metaAdLauncher");

class UserController {
  constructor() {
    this.getCurrentUser = this.getCurrentUser.bind(this);
    this.disconnectUser = this.disconnectUser.bind(this);
  }

  /**
   * Get current user details by ID
   */
  async getCurrentUser(req, res) {
    try {
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const user = await User.findOne({
        userId: req.params.id,
        tokenExpiresAt: { $gt: oneDayFromNow },
      }).select("-accessToken");

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
      const user = await User.findOneAndDelete({ userId });

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
      });
    } catch (error) {
      console.error("Disconnect user error:", error);
      return res.status(500).json({ error: "Failed to disconnect user" });
    }
  }
}

module.exports = new UserController();
