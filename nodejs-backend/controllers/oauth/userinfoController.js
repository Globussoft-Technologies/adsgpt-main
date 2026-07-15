/**
 * GET/POST /oauth/userinfo — OIDC UserInfo endpoint.
 *
 * Auth: OAuth Bearer JWT via verifyOAuthAccessToken. Requires the `openid`
 * scope (spec-mandatory).
 *
 * Claims returned depend on scopes in the presented access token:
 *   - always:  sub
 *   - email:   email, email_verified
 *   - profile: name
 *   - plan:    plan (subscription_plan_name from UserProfile)
 *
 * We deliberately never echo internal metadata (aMember id, credit balances,
 * etc.) — this endpoint is for identity, not general data access.
 */

const UserProfile = require("../../Module/user/userProfileModel");

exports.userinfo = async (req, res) => {
  const { userId, scopes = [] } = req.oauth || {};
  if (!userId) {
    // Should be unreachable — verifyOAuthAccessToken would have 401'd first.
    return res.status(401).json({ error: "invalid_token" });
  }
  if (!scopes.includes("openid")) {
    res.set(
      "WWW-Authenticate",
      'Bearer error="insufficient_scope", error_description="userinfo requires openid scope"',
    );
    return res.status(403).json({
      error: "insufficient_scope",
      error_description: "userinfo requires the openid scope",
    });
  }

  const profile = await UserProfile.findOne({ user_id: userId }).lean();
  if (!profile) {
    // Rare — token verified but user record is gone. Treat as 401.
    return res.status(401).json({
      error: "invalid_token",
      error_description: "user no longer exists",
    });
  }

  const claims = { sub: userId };

  if (scopes.includes("email") && profile.email) {
    claims.email = profile.email;
    claims.email_verified = true;
  }
  if (scopes.includes("profile")) {
    const name =
      profile.name ||
      [profile.name_f, profile.name_l].filter(Boolean).join(" ") ||
      "";
    if (name) claims.name = name;
  }
  if (scopes.includes("plan") && profile.subscription_plan_name) {
    claims.plan = profile.subscription_plan_name;
  }

  res.set("Cache-Control", "no-store");
  return res.json(claims);
};
