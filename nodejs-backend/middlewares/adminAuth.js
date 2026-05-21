const jwt = require("jsonwebtoken");
require("dotenv").config();

const ADMIN_JWT_OPTIONS = { algorithms: ["HS512"] };

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Missing admin token" });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  jwt.verify(token, process.env.JWT_SECRET_KEY, ADMIN_JWT_OPTIONS, (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid or expired admin token" });
    }
    if (decoded?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin role required" });
    }
    req.admin = decoded;
    next();
  });
}

module.exports = { requireAdmin };
