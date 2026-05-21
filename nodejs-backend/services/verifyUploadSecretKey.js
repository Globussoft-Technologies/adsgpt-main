require("dotenv").config();

const verifyUploadSecretKey = (req, res, next) => {
  try {
    const secret = req.headers["x-secret-key"];

    if (!secret) {
      return res.status(401).json({
        error: "Missing secret key",
      });
    }

    if (secret !== process.env.UPLOAD_IMAGE_SECRET_KEY) {
      return res.status(403).json({
        error: "Invalid secret key",
      });
    }

    next();
  } catch (err) {
    console.error("Secret key validation error:", err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

module.exports = verifyUploadSecretKey;
