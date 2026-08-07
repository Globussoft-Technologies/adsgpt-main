const UserProfile = require("../Module/user/userProfileModel");
const { fetchProductMeta } = require("../controllers/auth/authController");

async function buildFeatureObject(userId, userObj = null) {
  let planName = "No Active Plan";
  let topPlan = false;
  let isFreePlan = false;

  const userSub = userObj?.userSubscriptionType || userObj?.subscriptions;
  const fallbackPlanId =
    userSub && typeof userSub === "object" ? Object.keys(userSub)[0] : null;

  if (userId) {
    try {
      const user = await UserProfile.findOne(
        { user_id: userId },
        {
          "plan_snapshot.planName": 1,
          subscription_plan_name: 1,
          subscription_plan_id: 1,
          subscriptions: 1,
          created_from: 1,
          platform: 1,
        },
      );

      const effectivePlanId =
        user?.subscription_plan_id ||
        (user?.subscriptions && Object.keys(user.subscriptions).length > 0
          ? Object.keys(user.subscriptions)[0]
          : null) ||
        fallbackPlanId;

      if (effectivePlanId) {
        const productMeta = await fetchProductMeta(effectivePlanId);
        if (productMeta) {
          planName = productMeta.title || planName;
          if (typeof productMeta.topPlan === "boolean") {
            topPlan = productMeta.topPlan;
          }
          if (productMeta.firstPrice === 0) {
            isFreePlan = true;
          }
        }
      }

      const trialPlanId = process.env.TRIAL_PLAN_ID;
      if (trialPlanId && String(effectivePlanId) === String(trialPlanId)) {
        isFreePlan = true;
      }

      const createdFrom = (
        user?.created_from ||
        userObj?.created_from ||
        ""
      ).toUpperCase();
      const platform = (
        user?.platform ||
        userObj?.platform ||
        ""
      ).toLowerCase();
      const isMobileStore =
        createdFrom === "APPLE" ||
        createdFrom === "GOOGLE" ||
        platform === "ios" ||
        platform === "android";

      if (isFreePlan) {
        topPlan = isMobileStore ? true : topPlan;
      }
    } catch (err) {
      console.error("buildFeatureObject: failed to load user", err);
    }
  }

  return {
    planDetails: {
      name: planName,
      topPlan: topPlan,
    },
    "Ad copy": 1000,
    "Ad Creative": 1000,
    "Ad Creative Video": 5000,
    "Number of prompts user can make per month": 10000,
    "Single Ad analytics": true,
    Networks: ["facebook", "google", "instagram", "youtube", "pinterest"],
    "Advertiser Search": true,
    "Market analysis": true,
    "Generate Similar Ads": true,
    "Target Audience": true,
    adsCopyNetworks: [
      "Google Search Ads",
      "Meta Ads",
      "LinkedIn Ads",
      "Google Performance Max Ads",
      "Google Video Ads",
      "Reddit Ads",
      "Twitter Ads",
      "Pinterest Ads",
      "Google Display Ads",
    ],
    "Ad Count by Post Owner": true,
    "Popularity Index": true,
    "Distribution of Call to Action": true,
    "Geographical Distribution of Ads": true,
    "Engagement Comparison Across Ad Formats": true,
    "Chat history": "ALL",
  };
}

module.exports = buildFeatureObject;
