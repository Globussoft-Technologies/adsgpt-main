const crypto = require("crypto");
const https = require("https");
const http = require("http");
const axios = require("axios");
const { redisClient } = require("../db/redis");


// Base64URL encode/decode
exports.toBase64Url = (obj) => {
  const json = JSON.stringify(obj);
  return Buffer.from(json)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

exports.fromBase64Url = (str) => {
  if (typeof str !== "string") return null;
  try {
    const padded = str
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
};


// Create state + code_challenge, store verifier
exports.prepareOAuthResponse = async (user_id, image_url) => {
  const codeVerifier = crypto.randomBytes(96).toString("base64url");
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const statePayload = { user_id, image_url, nonce: crypto.randomBytes(16).toString("hex") };
  const state = exports.toBase64Url(statePayload);

  await redisClient.hset(`canva_user:${user_id}`, { codeVerifier });
  return { state, codeChallenge };
};

exports.isTokenExpired = (created, expiresIn) => {
  const now = Date.now() / 1000; // seconds
  return now >= created + expiresIn - 300; // refresh 5 min early
};

exports.refreshAccessToken = async (userId) => {
  const userKey = `canva_user:${userId}`;
  const refreshToken = await redisClient.hget(userKey, "refresh_token");

  if (!refreshToken) throw new Error("No refresh token available");

  // Refresh token API call
  const response = await axios.post(
    `${process.env.CANVA_BASE_URL}/rest/v1/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token", 
      refresh_token: refreshToken,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
        ).toString("base64")}`,
      },
    }
  );

  const {
    access_token,
    expires_in,
    refresh_token: newRefreshToken,
  } = response.data;

  // Update Redis
  await redisClient.hmset(userKey, {
    access_token,
    refresh_token: newRefreshToken || refreshToken, // fallback to old
    created: Math.floor(Date.now() / 1000),
    expires_in,
  });

  return access_token;
};

// const generateRandomString = (length) => {
//   const charset =
//     "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
//   const randomBytes = crypto.randomBytes(length);
//   return Array.from(randomBytes)
//     .map((b) => charset[b % charset.length])
//     .join("");
// };

// const generateCodeChallenge = async (codeVerifier) => {
//   const hash = crypto.createHash("sha256").update(codeVerifier).digest();
//   return hash
//     .toString("base64")
//     .replace(/\+/g, "-")
//     .replace(/\//g, "_")
//     .replace(/=+$/, "");
// };

exports.pollJobStatus = async (
  jobId,
  accessToken,
  maxAttempts = 10,
  intervalMs = 1000
) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    const statusRes = await fetch(
      `${process.env.CANVA_BASE_URL}/rest/v1/asset-uploads/${jobId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const statusData = await statusRes.json();

    if (statusRes.ok && statusData?.job?.asset?.id) {
      return statusData?.job?.asset?.id; // This will now be available
    }

    if (statusData.status === "failed") {
      throw new Error("Asset upload job failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    attempt++;
  }

  throw new Error("Timed out waiting for job to complete.");
};

exports.downloadImage = (url) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(`Failed to get image. Status code: ${res.statusCode}`)
          );
        }

        const data = [];
        res.on("data", (chunk) => data.push(chunk));
        res.on("end", () => resolve(Buffer.concat(data)));
      })
      .on("error", reject);
  });
};
