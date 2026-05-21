const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const ENC_KEY = crypto
  .createHash("sha256")
  .update(process.env.ACCESS_TOKEN_SECRET)
  .digest(); // 32 bytes key
const IV_LENGTH = 16; // 128-bit IV

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, ENC_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return iv.toString("hex") + ":" + encrypted + ":" + authTag.toString("hex");
}

function decrypt(encryptedText) {
  const [ivHex, encrypted, authTagHex] = encryptedText.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGO, ENC_KEY, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

module.exports = { encrypt, decrypt };
