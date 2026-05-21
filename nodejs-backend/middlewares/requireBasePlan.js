const UnifiedCreditController = require("../controllers/UnifiedCreditController");

const NO_BASE_PLAN_MESSAGE =
  "Sorry, you don't have a base plan to use this feature. Please subscribe to a base plan to continue.";

/**
 * Blocks the request if the authenticated user does not have an active base
 * subscription plan. Must run after authenticateJWT so that req.user.user_id
 * is populated (already prefixed with GPT-/PAS- by authService).
 */
const requireBasePlan = async (req, res, next) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const hasBase = await UnifiedCreditController.hasActiveBasePlan(userId);
    if (!hasBase) {
      return res.status(400).json({
        success: false,
        code: "NO_BASE_PLAN",
        message: NO_BASE_PLAN_MESSAGE,
      });
    }

    next();
  } catch (error) {
    console.error("requireBasePlan middleware error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to verify subscription plan" });
  }
};

module.exports = { requireBasePlan, NO_BASE_PLAN_MESSAGE };
