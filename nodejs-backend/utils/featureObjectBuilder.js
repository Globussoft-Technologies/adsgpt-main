const UserProfile = require("../Module/user/userProfileModel");

async function buildFeatureObject(userId) {
  let planName = "No Active Plan";

  if (userId) {
    try {
      const user = await UserProfile.findOne(
        { user_id: userId },
        { "plan_snapshot.planName": 1, subscription_plan_name: 1 },
      );
      planName =
        user?.plan_snapshot?.planName ||
        user?.subscription_plan_name ||
        "No Active Plan";
    } catch (err) {
      console.error("buildFeatureObject: failed to load user", err);
    }
  }

  return {
    planDetails: {
      name: planName,
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
