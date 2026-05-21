const { default: axios } = require("axios");
const sharp = require("sharp");
const { redisClient } = require("../db/redis");
const {
  isTokenExpired,
  refreshAccessToken,
  pollJobStatus,
  downloadImage,
  prepareOAuthResponse,
  fromBase64Url,
} = require("../utils/canva");

// controller.js
exports.checkAuth = async (req, res) => {
  const user_id = req.user.user_id;
  const image_url = req.body.image_url;
  const userKey = `canva_user:${user_id}`;
  const data = await redisClient.hgetall(userKey);

  // No existing code → first‑time auth
  if (!data.code) {
    const { state, codeChallenge } = await prepareOAuthResponse(user_id, image_url);
    return res.status(200).json({
      status: false,
      state,
      codeChallenge,
    });
  }

  // Token expired → try refresh
  const created = +data.created;
  const expiresIn = +data.expires_in;
  if (isTokenExpired(created, expiresIn)) {
    try {
      await refreshAccessToken(user_id);
      return res.json({ status: true, refreshed: true });
    } catch (err) {
      // On refresh failure, fall back to a brand‑new OAuth flow
      const { state, codeChallenge } = await prepareOAuthResponse(user_id, image_url);
      return res.status(200).json({
        status: false,
        state,
        codeChallenge,
        refreshed: false,
      });
    }
  }

  // All good
  return res.json({ status: true, refreshed: false });
};


exports.oauthRedirect = async (req, res) => {
  try {
    const { code, state } = req.query;
    const { user_id, image_url } = fromBase64Url(state);
    const codeVerifier = await redisClient.hget(
      `canva_user:${user_id}`,
      "codeVerifier"
    );

    const response = await axios.post(
      `${process.env.CANVA_BASE_URL}/rest/v1/oauth/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI,
        code_verifier: codeVerifier,
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

    const tokenData = response.data;

    await redisClient.hset(`canva_user:${user_id}`, {
      code,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      created: Math.floor(Date.now() / 1000),
    });

    return res.redirect(
      `/adsgpt/canva/edit-in-canva/upload?id=${user_id}&url=${image_url}`
    );
  } catch (error) {
    console.error("OAuth error:", error);
    return res.status(500).send("OAuth token exchange failed");
  }
};

exports.uploadImage = async (req, res) => {
  const user_id = req.query.id;
  const accessToken = await redisClient.hget(
    `canva_user:${user_id}`,
    "access_token"
  );
  const imageUrl = req.query.url;

  const imageName = "temp_image.jpg";
  const mimeType = "image/jpg";

  try {
    const imageData = await downloadImage(imageUrl);

    // Get image dimensions using Sharp
    const metadata = await sharp(imageData).metadata();
    const { width, height } = metadata;

    const uploadRes = await axios.post(
      `${process.env.CANVA_BASE_URL}/rest/v1/asset-uploads`,
      imageData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
          "Asset-Upload-Metadata": JSON.stringify({
            name_base64: Buffer.from(imageName).toString("base64"),
            mime_type: mimeType,
          }),
        },
      }
    );

    const uploadData = uploadRes.data;
    const assetId = await pollJobStatus(uploadData.job.id, accessToken);

    return res.redirect(
      `/adsgpt/canva/edit-in-canva/create-design?id=${user_id}&asset_id=${assetId}&w=${width}&h=${height}`
    );
  } catch (error) {
    console.error("Upload error:", error.response?.data || error.message);
    return res.status(500).send("Image upload failed");
  }
};

exports.createDesign = async (req, res) => {
  const user_id = req.query.id;
  const accessToken = await redisClient.hget(
    `canva_user:${user_id}`,
    "access_token"
  );
  const assetId = req.query.asset_id;
  const width = req.query.w;
  const height = req.query.h;

  try {
    const designRes = await axios.post(
      `${process.env.CANVA_BASE_URL}/rest/v1/designs`,
      {
        design_type: { type: "custom", width, height },
        asset_id: assetId,
        title: "AdsGPT Image",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const designData = designRes.data;
    const editUrl = designData.design.urls.edit_url;
    return res.redirect(editUrl);
  } catch (error) {
    console.error(
      "Design creation error:",
      error.response?.data || error.message
    );
    return res.status(500).send("Design creation failed");
  }
};
