const HEADER_NAME = "x-meta-system-user-token";

// Partner API auth: unlike the internal /meta-ads surface (JWT-authenticated
// AdsGPT users, token pulled from FBUsers), a partner has no AdsGPT account.
// They supply their own Meta System User access token per request; we use it
// directly against the Graph API and never persist it.
function requireMetaSystemUserToken(req, res, next) {
  const token = req.headers[HEADER_NAME];

  if (!token) {
    return res.status(401).json({
      status: false,
      error: `Missing required header: ${HEADER_NAME}`,
    });
  }

  req.metaAccessToken = token;
  next();
}

module.exports = { requireMetaSystemUserToken, HEADER_NAME };
