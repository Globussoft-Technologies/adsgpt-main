/**
 * signingKeyService — manages the RS256 keypairs used to sign OAuth JWTs.
 *
 * Public API:
 *   getActiveSigningKey()   → key for signing NEW tokens (creates one if none exist)
 *   getVerificationKeys()   → all keys currently published in JWKS (for verify)
 *   rotateSigningKey()      → mint a new active key + retire the outgoing one
 *   getJwks()               → { keys: [...] } shaped for /.well-known/jwks.json
 *
 * Caching: verification keys are cached in-process for CACHE_TTL_MS. The cache
 * is small (a handful of keys) and we accept a brief lag before a freshly-
 * rotated key becomes visible on every worker. `invalidateCache()` is exposed
 * for the rotation path.
 *
 * Env:
 *   OAUTH_SIGNING_KEY_ROTATION_DAYS  default 90
 *   OAUTH_JWT_ACCESS_TTL_SECONDS     default 3600 (60 min) — used to size the
 *                                    grace window before a retired key stops
 *                                    verifying tokens issued while it was active
 */

const crypto = require("node:crypto");
const OAuthSigningKey = require("../../Module/oauth/oauthSigningKeyModel");

const CACHE_TTL_MS = 60 * 1000;
const ROTATION_DAYS = Number(process.env.OAUTH_SIGNING_KEY_ROTATION_DAYS || 90);
const ACCESS_TTL_SECONDS = Number(
  process.env.OAUTH_JWT_ACCESS_TTL_SECONDS || 3600,
);

let verificationCache = { at: 0, keys: [] };

function generateRsaKeypair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function newKid() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${y}-${m}-${d}-${suffix}`;
}

function invalidateCache() {
  verificationCache = { at: 0, keys: [] };
}

/**
 * Ensure there is at least one active signing key. Returns the newest active
 * key. Called on every /oauth/token issuance path.
 */
async function getActiveSigningKey() {
  const existing = await OAuthSigningKey.findOne({ is_active: true })
    .sort({ activated_at: -1 })
    .lean();

  if (existing) return existing;

  console.warn("[oauth] no active signing key — generating initial keypair");
  return await createNewSigningKey();
}

async function createNewSigningKey() {
  const { publicKey, privateKey } = generateRsaKeypair();
  const kid = newKid();

  // JWKS grace: keep the JUST-CREATED key in JWKS for at least
  // ROTATION_DAYS + one access-token lifetime (so tokens signed with the
  // outgoing key still verify until they expire).
  const publishedUntil = new Date(
    Date.now() +
      ROTATION_DAYS * 24 * 60 * 60 * 1000 +
      ACCESS_TTL_SECONDS * 1000,
  );

  const doc = await OAuthSigningKey.create({
    kid,
    alg: "RS256",
    public_key_pem: publicKey,
    private_key_pem: privateKey,
    is_active: true,
    published_until: publishedUntil,
    activated_at: new Date(),
  });

  invalidateCache();
  console.log(`[oauth] created signing key kid=${kid}`);
  return doc.toObject();
}

/**
 * Called by the rotation cron / manual rotation. Steps:
 *   1. Retire every currently-active key (is_active=false, retired_at=now).
 *      They stay in JWKS until published_until so already-issued tokens still
 *      verify.
 *   2. Mint a new active key.
 */
async function rotateSigningKey() {
  await OAuthSigningKey.updateMany(
    { is_active: true },
    { $set: { is_active: false, retired_at: new Date() } },
  );
  invalidateCache();
  return await createNewSigningKey();
}

/**
 * All keys whose published_until is still in the future — these are what
 * appear in JWKS and are eligible to verify inbound JWTs.
 */
async function getVerificationKeys() {
  const now = Date.now();
  if (
    verificationCache.at &&
    now - verificationCache.at < CACHE_TTL_MS &&
    verificationCache.keys.length > 0
  ) {
    return verificationCache.keys;
  }

  const keys = await OAuthSigningKey.find({
    $or: [
      { published_until: { $gt: new Date() } },
      { published_until: null, is_active: true },
    ],
  })
    .sort({ activated_at: -1 })
    .lean();

  verificationCache = { at: now, keys };
  return keys;
}

/**
 * JWKS document — RFC 7517 shape. Only public material.
 */
async function getJwks() {
  const keys = await getVerificationKeys();
  return {
    keys: keys.map((k) => {
      const jwk = crypto.createPublicKey(k.public_key_pem).export({
        format: "jwk",
      });
      return { ...jwk, kid: k.kid, alg: k.alg, use: "sig" };
    }),
  };
}

module.exports = {
  getActiveSigningKey,
  getVerificationKeys,
  rotateSigningKey,
  getJwks,
  invalidateCache,
  _internal: { generateRsaKeypair, newKid, createNewSigningKey },
};
