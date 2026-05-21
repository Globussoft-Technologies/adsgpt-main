const express = require("express");
const userRoutes = require("./adPosting/userRoutes");
const pageRoutes = require("./adPosting/pageRoutes");
const adRoutes = require("./adPosting/adRoutes");
const router = express.Router();

router.use("/users", userRoutes);
router.use("/pages", pageRoutes);
router.use("/ads", adRoutes);

module.exports = router;
