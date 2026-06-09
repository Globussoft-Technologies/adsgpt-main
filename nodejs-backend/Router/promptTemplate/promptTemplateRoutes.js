const express = require("express");
const router = express.Router();
const { authenticateJWT } = require("../../services/authService");
const promptTemplateController = require("../../controllers/promptTemplate/promptTemplateController");

// POST is intentionally OPEN — internal/dev use via Swagger to seed prompts.
router.post("/", promptTemplateController.createPromptTemplate);

// GET is behind user JWT — consumed by the frontend.
router.get(
  "/",
  authenticateJWT,
  promptTemplateController.getPromptTemplatesByType,
);

module.exports = router;
