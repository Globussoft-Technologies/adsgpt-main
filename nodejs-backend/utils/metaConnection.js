const FBUsers = require("../Module/adPosting/facebookUsers");
const { decrypt } = require("./crypto");

const META_TOKEN_MIN_VALIDITY_MS = 24 * 60 * 60 * 1000;

function getFacebookConnectionStatus(connection, now = Date.now()) {
  const expiresAt = connection?.tokenExpiresAt
    ? new Date(connection.tokenExpiresAt).getTime()
    : NaN;
  const isUsable =
    Number.isFinite(expiresAt) &&
    expiresAt > now + META_TOKEN_MIN_VALIDITY_MS;

  return {
    isUsable,
    connectionStatus: isUsable ? "connected" : "reconnect_required",
  };
}

function getFacebookIdFromRequest(req) {
  const raw =
    req?.headers?.["x-facebook-id"] ||
    req?.query?.facebookId ||
    req?.body?.facebookId;
  return raw == null ? "" : String(raw).trim();
}

function connectionError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.status = statusCode;
  error.code = code;
  return error;
}

function assertFacebookConnectionId(connection, connectionId) {
  if (
    connectionId &&
    String(connection?._id || "") !== String(connectionId)
  ) {
    throw connectionError(
      "The selected Facebook account does not match the requested connection",
      403,
      "FACEBOOK_ACCOUNT_MISMATCH",
    );
  }
}

async function resolveFacebookConnection({
  userId,
  facebookId,
  allowSingleFallback = true,
} = {}) {
  if (!userId) {
    throw connectionError("User ID is required", 400, "USER_ID_REQUIRED");
  }

  const requestedFacebookId =
    facebookId == null ? "" : String(facebookId).trim();

  let connection;
  if (requestedFacebookId) {
    connection = await FBUsers.findOne({
      userId,
      facebookId: requestedFacebookId,
    });
    if (!connection) {
      throw connectionError(
        "The selected Facebook account is not connected to this AdsGPT user",
        403,
        "FACEBOOK_ACCOUNT_NOT_CONNECTED",
      );
    }
  } else {
    const connections = await FBUsers.find({ userId })
      .sort({ updatedAt: -1 })
      .limit(2);
    if (connections.length === 0) {
      throw connectionError(
        "Facebook user not found",
        404,
        "FACEBOOK_NOT_CONNECTED",
      );
    }
    if (connections.length > 1 && !allowSingleFallback) {
      throw connectionError(
        "Select a Facebook account before continuing",
        400,
        "FACEBOOK_ACCOUNT_REQUIRED",
      );
    }
    connection = connections[0];
  }

  if (!getFacebookConnectionStatus(connection).isUsable) {
    throw connectionError(
      "The selected Facebook account token is expired or expiring soon. Please reconnect it.",
      401,
      "FACEBOOK_TOKEN_EXPIRED",
    );
  }

  let accessToken;
  try {
    accessToken = decrypt(connection.accessToken);
  } catch {
    throw connectionError(
      "The selected Facebook account token could not be read. Please reconnect it.",
      401,
      "FACEBOOK_TOKEN_INVALID",
    );
  }
  if (!accessToken) {
    throw connectionError(
      "The selected Facebook account has no access token",
      401,
      "FACEBOOK_TOKEN_MISSING",
    );
  }

  return {
    connection,
    facebookId: connection.facebookId,
    accessToken,
  };
}

async function resolveFacebookConnectionFromRequest(
  req,
  { allowSingleFallback = true } = {},
) {
  return resolveFacebookConnection({
    userId: req?.user?.user_id,
    facebookId: getFacebookIdFromRequest(req),
    allowSingleFallback,
  });
}

async function resolveFacebookConnectionForRecord({
  userId,
  facebookId,
  connectionId,
} = {}) {
  let requestedFacebookId =
    facebookId == null ? "" : String(facebookId).trim();

  // Backward compatibility for existing callers that already persist the
  // FacebookUsers record id. Resolve it only inside the authenticated user's
  // scope, then run the same token-validity checks as the explicit selector.
  if (!requestedFacebookId && connectionId) {
    const ownedConnection = await FBUsers.findOne({
      _id: connectionId,
      userId,
    })
      .select("facebookId")
      .lean();
    if (!ownedConnection) {
      throw connectionError(
        "The requested Facebook connection does not belong to this AdsGPT user",
        403,
        "FACEBOOK_ACCOUNT_NOT_CONNECTED",
      );
    }
    requestedFacebookId = ownedConnection.facebookId;
  }

  const resolved = await resolveFacebookConnection({
    userId,
    facebookId: requestedFacebookId,
    allowSingleFallback: false,
  });
  assertFacebookConnectionId(resolved.connection, connectionId);
  return resolved;
}

function metaCacheScope(userId, facebookId) {
  return `${userId}:${facebookId}`;
}

module.exports = {
  META_TOKEN_MIN_VALIDITY_MS,
  assertFacebookConnectionId,
  getFacebookConnectionStatus,
  getFacebookIdFromRequest,
  resolveFacebookConnection,
  resolveFacebookConnectionForRecord,
  resolveFacebookConnectionFromRequest,
  metaCacheScope,
};
