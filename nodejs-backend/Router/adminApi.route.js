const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middlewares/adminAuth");
const adminAuth = require("../controllers/admin/adminAuth.controller");
const adminDashboard = require("../controllers/admin/adminDashboard.controller");

router.post("/login", adminAuth.login);
router.get("/me", requireAdmin, adminAuth.me);

router.get("/overview", requireAdmin, adminDashboard.overview);
router.get("/users", requireAdmin, adminDashboard.usersList);
router.get("/users/:userId", requireAdmin, adminDashboard.userDetail);

module.exports = router;
