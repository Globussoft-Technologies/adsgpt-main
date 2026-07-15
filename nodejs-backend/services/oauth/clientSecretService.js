/**
 * clientSecretService — small helpers for generating and verifying OAuth
 * client_secrets. Also handles the sha256 token hashing used for refresh
 * tokens and authorization codes (high-entropy, no need for memory-hard KDF).
 *
 * Storage format for client_secret hashes:
 *   scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 *
 * Rationale: scrypt is built into Node, no new dep. Memory-hard is arguably
 * overkill for 256-bit random secrets, but future-proofs us if we ever accept
 * user-chosen secrets.
 */

const crypto = require("node:crypto");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function generateRandomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function generateClientId() {
  // 12 bytes → 24 hex chars → easy to eyeball in logs.
  return `adsgpt_${crypto.randomBytes(12).toString("hex")}`;
}

function hashClientSecret(plaintext) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

function verifyClientSecret(plaintext, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = crypto.scryptSync(plaintext, salt, expected.length, {
    N,
    r,
    p,
  });
  return derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected);
}

// sha256 hex — used for refresh tokens + auth codes (high-entropy random
// strings; no need for a memory-hard KDF).
function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = {
  generateRandomToken,
  generateClientId,
  hashClientSecret,
  verifyClientSecret,
  sha256Hex,
};
