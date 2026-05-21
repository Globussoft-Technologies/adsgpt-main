const jwt = require("jsonwebtoken");
require("dotenv").config();

// Static admin credentials live in env vars (no DB-backed admin role).
// Use ADMIN_USERNAME / ADMIN_PASSWORD if present; fall back to the legacy
// UI_USERNAME / UI_PASSWORD that the existing /admin-panel route already uses.
function getAdminCreds() {
  return {
    username: process.env.ADMIN_USERNAME || process.env.UI_USERNAME,
    password: process.env.ADMIN_PASSWORD || process.env.UI_PASSWORD,
  };
}

exports.login = (req, res) => {
  try {
    const { username, password } = req.body || {};
    const creds = getAdminCreds();

    if (!creds.username || !creds.password) {
      return res.status(500).json({
        success: false,
        message: "Admin credentials are not configured on the server",
      });
    }
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password are required" });
    }
    if (username.trim() !== creds.username || password !== creds.password) {
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { role: "admin", username: creds.username },
      process.env.JWT_SECRET_KEY,
      { algorithm: "HS512", expiresIn: "12h" },
    );
    return res.json({ success: true, token, expiresIn: 12 * 60 * 60 });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.me = (req, res) => {
  return res.json({ success: true, admin: { username: req.admin?.username, role: req.admin?.role } });
};
