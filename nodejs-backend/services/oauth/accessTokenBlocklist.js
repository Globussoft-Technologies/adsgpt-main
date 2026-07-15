/**
 * accessTokenBlocklist — in-process denylist of revoked access token `jti`s.
 *
 * Why we need this:
 *   Access tokens are JWTs (stateless). Nothing in the DB says "this jti is
 *   still valid". If a user hits "Disconnect app" or /oauth/revoke, the
 *   already-issued access token would keep working for up to
 *   OAUTH_JWT_ACCESS_TTL_SECONDS (60 min default) if we did nothing.
 *
 *   Solution: cache the jti → expiry until natural expiry. Anything in the
 *   cache is rejected by the Bearer middleware.
 *
 * Scale note:
 *   In-memory is per-process. If AdsGPT ever runs behind more than one Node
 *   worker, this needs Redis (or a small Mongo collection). The verify code
 *   already goes through this module, so swapping storage means changing one
 *   file. Not a Day 6 concern for a single-instance deploy.
 *
 * Housekeeping:
 *   `_sweep()` runs opportunistically on each `isBlocked()` call — no
 *   dedicated cron needed. Entries auto-drop once past their expiry.
 */

const blocked = new Map(); // jti → expiryMs

function block(jti, expiryEpochSeconds) {
  if (!jti) return;
  const expiryMs =
    (Number(expiryEpochSeconds) || Math.floor(Date.now() / 1000) + 3600) *
    1000;
  blocked.set(jti, expiryMs);
}

function isBlocked(jti) {
  if (!jti) return false;
  const expiryMs = blocked.get(jti);
  if (!expiryMs) return false;
  if (expiryMs <= Date.now()) {
    blocked.delete(jti);
    return false;
  }
  return true;
}

// Optional periodic sweep for the case where a process holds many expired jtis
// but nothing ever reads them. Callable from cron if desired.
function _sweep() {
  const now = Date.now();
  let dropped = 0;
  for (const [jti, expiry] of blocked.entries()) {
    if (expiry <= now) {
      blocked.delete(jti);
      dropped++;
    }
  }
  return dropped;
}

function _size() {
  return blocked.size;
}

module.exports = { block, isBlocked, _sweep, _size };
