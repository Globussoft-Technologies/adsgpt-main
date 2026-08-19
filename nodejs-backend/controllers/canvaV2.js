const axios = require("axios");
const sharp = require("sharp");
const crypto = require("crypto");
const CanvaToken = require("../Module/canva/CanvaToken");
const { trackBackendGA4Event } = require("../utils/ga4");

const CLIENT_ID = process.env.CANVA_CLIENT_ID;
const CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.CANVA_REDIRECT_URI;
const CANVA_BASE_URL = process.env.CANVA_BASE_URL;

// ── helpers ───────────────────────────────────────────────────────────────────

const toBase64Url = (obj) =>
  Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/={1,2}$/, "");

const fromBase64Url = (str) => {
  if (typeof str !== "string") return null;
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
};

const isTokenExpired = (created, expiresIn) =>
  Date.now() / 1000 >= created + expiresIn - 300;

const buildPKCE = () => {
  const codeVerifier = crypto.randomBytes(96).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/={1,2}$/, "");
  return { codeVerifier, codeChallenge };
};

const downloadImage = (url) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? require("https") : require("http");
    client
      .get(url, (res) => {
        if (res.statusCode !== 200)
          return reject(new Error(`Failed to fetch image: ${res.statusCode}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });

const pollJobStatus = async (jobId, accessToken, maxAttempts = 30, intervalMs = 3000) => {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${CANVA_BASE_URL}/rest/v1/asset-uploads/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (res.ok && data?.job?.asset?.id) return data.job.asset;
    if (data?.job?.status === "failed") throw new Error("Asset upload job failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for asset upload job");
};

const refreshAccessToken = async (userId) => {
  const doc = await CanvaToken.findOne({ user_id: userId });
  if (!doc?.refresh_token) throw new Error("No refresh token available");

  const res = await axios.post(
    `${CANVA_BASE_URL}/rest/v1/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: doc.refresh_token,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
    }
  );

  const { access_token, refresh_token, expires_in } = res.data;
  await CanvaToken.findOneAndUpdate(
    { user_id: userId },
    {
      access_token,
      refresh_token: refresh_token || doc.refresh_token,
      expires_in,
      created: Math.floor(Date.now() / 1000),
    }
  );

  return access_token;
};

// ── controllers ───────────────────────────────────────────────────────────────

// POST /canva/v2/check-auth
exports.checkAuth = async (req, res) => {
  const user_id = req.user.user_id;
  const { image_url } = req.body;

  try {
    const doc = await CanvaToken.findOne({ user_id });

    if (!doc?.access_token) {
      const { codeVerifier, codeChallenge } = buildPKCE();
      const state = toBase64Url({ user_id, image_url, nonce: crypto.randomBytes(16).toString("hex") });

      await CanvaToken.findOneAndUpdate(
        { user_id },
        { code_verifier: codeVerifier },
        { upsert: true, new: true }
      );

      return res.json({ status: false, state, codeChallenge });
    }

    if (isTokenExpired(doc.created, doc.expires_in)) {
      try {
        await refreshAccessToken(user_id);
        return res.json({ status: true, refreshed: true });
      } catch {
        const { codeVerifier, codeChallenge } = buildPKCE();
        const state = toBase64Url({ user_id, image_url, nonce: crypto.randomBytes(16).toString("hex") });

        await CanvaToken.findOneAndUpdate(
          { user_id },
          { code_verifier: codeVerifier },
          { upsert: true }
        );

        return res.json({ status: false, state, codeChallenge });
      }
    }

    return res.json({ status: true, refreshed: false });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

// GET /canva/v2/oauth/redirect  (Canva callback)
exports.oauthRedirect = async (req, res) => {
  try {
    const { code, state } = req.query;
    const { user_id, image_url } = fromBase64Url(state);

    const doc = await CanvaToken.findOne({ user_id });
    if (!doc?.code_verifier) return res.status(400).send("Missing code verifier — please try again");

    const tokenRes = await axios.post(
      `${CANVA_BASE_URL}/rest/v1/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: doc.code_verifier,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Fetch Canva user profile to store account details
    let profileFields = {};
    try {
      const profileRes = await axios.get(`${CANVA_BASE_URL}/rest/v1/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const teamUser = profileRes.data?.team_user;
      profileFields = {
        canva_user_id: teamUser?.user_id || null,
        connected_at: new Date(),
      };
    } catch (profileErr) {
      console.error("[Canva] /users/me fetch failed:", profileErr?.response?.data || profileErr.message);
      profileFields = { connected_at: new Date() };
    }

    await CanvaToken.findOneAndUpdate(
      { user_id },
      {
        access_token,
        refresh_token,
        expires_in,
        created: Math.floor(Date.now() / 1000),
        code_verifier: null,
        ...profileFields,
      },
      { upsert: true }
    );

    trackBackendGA4Event('account_connected', {
      user_id,
      platform: 'canva',
      success: true,
    });

    if (!image_url) {
      // Connected from Profile page — no image to edit, just close/redirect
      const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.send(`<html><body><script>
        if (window.opener) { window.opener.postMessage('canva-connected', '*'); window.close(); }
        else { window.location.href = '${frontendOrigin}'; }
      </script></body></html>`);
    }

    return res.redirect(
      `/adsgpt/canva/v2/upload?id=${user_id}&url=${encodeURIComponent(image_url)}`
    );
  } catch (err) {
    trackBackendGA4Event('account_connection_failed', {
      platform: 'canva',
      success: false,
      error_code: 'OAUTH_FAILED',
    });
    return res.status(500).send("OAuth token exchange failed");
  }
};

// GET /canva/v2/upload
exports.uploadImage = async (req, res) => {
  try {
    const { id: user_id, url: rawUrl } = req.query;
    const doc = await CanvaToken.findOne({ user_id });

    if (!doc?.access_token) return res.status(401).send("Not authenticated with Canva");

    const decodedUrl = decodeURIComponent(rawUrl);
    const fileData = await downloadImage(decodedUrl);

    const metadata = await sharp(fileData).metadata();
    const { width, height } = metadata;
    const formatToMime = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
    const mimeType = formatToMime[metadata.format] || "image/jpeg";
    const fileName = `adsgpt_image.${metadata.format || "jpg"}`;

    const assetMetadata = JSON.stringify({
      name_base64: Buffer.from(fileName).toString("base64"),
      mime_type: mimeType,
    });

    const uploadRes = await axios.post(
      `${CANVA_BASE_URL}/rest/v1/asset-uploads`,
      fileData,
      {
        headers: {
          Authorization: `Bearer ${doc.access_token}`,
          "Content-Type": "application/octet-stream",
          "Asset-Upload-Metadata": assetMetadata,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );

    const asset = await pollJobStatus(uploadRes.data.job.id, doc.access_token);
    const finalW = asset.metadata?.width || width;
    const finalH = asset.metadata?.height || height;

    return res.redirect(
      `/adsgpt/canva/v2/create-design?id=${user_id}&asset_id=${asset.id}&w=${finalW}&h=${finalH}`
    );
  } catch (err) {
    return res.status(500).json({ error: "Asset upload to Canva failed" });
  }
};

// GET /canva/v2/create-design
exports.createDesign = async (req, res) => {
  try {
    const { id: user_id, asset_id, w, h } = req.query;
    const doc = await CanvaToken.findOne({ user_id });

    if (!doc?.access_token) return res.status(401).send("Not authenticated with Canva");

    const designRes = await axios.post(
      `${CANVA_BASE_URL}/rest/v1/designs`,
      {
        design_type: { type: "custom", width: Number(w), height: Number(h) },
        asset_id,
        title: "AdsGPT Image",
      },
      {
        headers: {
          Authorization: `Bearer ${doc.access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.redirect(designRes.data.design.urls.edit_url);
  } catch (err) {
    return res.status(500).json({ error: "Canva design creation failed" });
  }
};

// GET /canva/v2/status
exports.getStatus = async (req, res) => {
  const user_id = req.user.user_id;
  try {
    const doc = await CanvaToken.findOne({ user_id });
    if (!doc?.access_token) {
      return res.json({ connected: false });
    }
    return res.json({
      connected: true,
      canva_user_id: doc.canva_user_id || null,
      connected_at: doc.connected_at || null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /canva/v2/disconnect
exports.disconnect = async (req, res) => {
  const user_id = req.user.user_id;
  try {
    const doc = await CanvaToken.findOne({ user_id });
    if (!doc?.access_token) {
      return res.status(404).json({ error: "No Canva connection found" });
    }

    // Attempt to revoke the token with Canva (best-effort)
    try {
      await axios.post(
        `${CANVA_BASE_URL}/rest/v1/oauth/token/revoke`,
        new URLSearchParams({ token: doc.access_token }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
          },
        }
      );
    } catch (_) {
      // Revocation failure is non-fatal — proceed with local cleanup
    }

    await CanvaToken.deleteOne({ user_id });
    return res.json({ success: true, message: "Canva account disconnected" });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};
