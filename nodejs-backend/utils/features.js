require("dotenv").config();

let features = {};
if (process.env.MODE === "PROD") {
  //
  features = {
    planDetails: {
      8: {
        name: "FREE - 7 Days",
        description:
          "Offers limited features with 100 prompts per month, 35 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 5,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      2: {
        name: "Individual",
        description:
          "Provides access for 30 days with 10,000 prompts per month, 1000 ad copies, 100 ad creative and networks like Facebook, Google Text, and Pinterest.",
        access: "30 days",
        prompts: "1000 adCopies, 100 adCreatives, and 10000 prompts per month",
        adCopies: 1000,
        price: "$99/month",
        topPlan: false,
        more: "Basic customer support, no premium networks access.",
      },
      4: {
        name: "Standard Subscription",
        description:
          "Offers access for 30 days with 1000 prompts per month, 150 ad copies, 50 ad creatives and additional networks including Facebook, Google Text, Instagram, and YouTube.",
        access: "30 days",
        prompts: "150 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 150,
        price: "$129/month",
        topPlan: false,
        more: "Priority support, access to more networks and increased ad copies.",
      },
      5: {
        name: "Premium Subscription",
        description:
          "Grants access for 30 days with 3000 prompts per month, 1000 ad copies, 50 ad creatives, and the most extensive network coverage, including Meta Ads, Google Video Ads, Reddit Ads, Twitter Ads, Pinterest Ads, and more.",
        access: "30 days",
        prompts: "1000 adCopies, 50 adCreatives, and 3000 prompts per month",
        adCopies: 1000,
        price: "$179/month",
        topPlan: false,
        more: "Premium customer support, access to exclusive networks, unlimited features.",
      },
      3: {
        name: "Agency",
        description:
          "Delivers the highest level of access with unlimited prompts per month, unlimited ad copies, 500 ad creatives, and access to all major networks including Meta Ad, LinkedIn Ads, Google Video Ads, Reddit Ads, Twitter Ads, Pinterest Ads, and Google Display Ads.",
        access: "30 days",
        prompts:
          "Unlimited adCopies, 500 adCreatives, and Unlimited prompts per month",
        adCopies: "Unlimited",
        price: "$279/month",
        topPlan: false,
        more: "Dedicated account manager, unlimited access to all networks, fast-track support.",
      },
      PAS: {
        name: "Free Plan",
        description:
          "Offers limited features with 100 prompts per month, 5 ad copies, 5 ad creatives and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 5 adCreatives, and 100 prompts per month",
        adCopies: 5,
        price: "Free",
        topPlan: false,
        pasUserAccess: true,
        more: "Limited support and access to basic features.",
      },
      9: {
        name: "Annual Individual Plan",
        description:
          "Provides access for 365 days with 50,000 prompts per year, 1000 ad copies, 1200 ad creatives and networks like YouTube and Pinterest.",
        access: "365 days",
        prompts:
          "12000 adCopies, 1200 adCreatives, and 120000 prompts per year",
        adCopies: 1000,
        price: "$349/year",
        topPlan: false,
        more: "Basic customer support with access to networks for a full year.",
      },
      10: {
        name: "Annual Standard Plan",
        description:
          "Offers access for 365 days with 500 prompts per month, 500 ad copies, 150 ad creatives and additional networks such as Facebook, Google Text, and Pinterest.",
        access: "365 days",
        prompts: "500 adCopies, 150 adCreatives, and 500 prompts per month",
        adCopies: 500,
        price: "$499/year",
        topPlan: false,
        more: "Priority support, one year of access to additional networks and ad copies.",
      },
      11: {
        name: "Annual Premium Plan",
        description:
          "Grants access for 365 days with 1000 prompts per month, 150 ad copies, 50 ad creatives, and a wider range of networks including Facebook, Google Text, Instagram, and YouTube.",
        access: "365 days",
        prompts: "150 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 150,
        price: "$799/year",
        topPlan: false,
        more: "Premium support, access to more networks, and additional ad copies for one year.",
      },
      12: {
        name: "Annual Agency Plan",
        description:
          "Delivers access for 365 days with unlimited prompts per month, unlimited ad copies, 6000 ad creatives and the most extensive network coverage, including Meta Ads, LinkedIn Ads, Google Video Ads, Reddit Ads, and more.",
        access: "365 days",
        prompts:
          "Unlimited adCopies, 6000 adCreatives, and Unlimited prompts per month",
        adCopies: "Unlimited",
        price: "$999/year",
        topPlan: true,
        more: "Dedicated account manager, access to all networks, priority support, and premium features for an entire year.",
      },
      15: {
        name: "Monthly Custom Plan",
        description:
          "Delivers access for 30 days with 50,000 prompts per month, 5000 ad copies, 150 ad creatives.",
        access: "30 days",
        prompts: "5000 adCopies, 150 adCreatives, and 50000 prompts per month",
        adCopies: 5000,
        price: "$49/month",
        topPlan: true,
        more: "Dedicated account manager, access to all networks, priority support, and premium features for an entire year.",
      },
      16: {
        name: "Custom Plan",
        description:
          "Delivers access for 365 days with 50,000 prompts per month, 5000 ad copies, 150 ad creatives, and the most extensive network coverage Meta Ads.",
        access: "365 days",
        prompts: "5000 adCopies, 150 adCreatives, and 50000 prompts per month",
        adCopies: 5000,
        price: "$179/year",
        topPlan: true,
        more: "Dedicated account manager, access to all networks, priority support, and premium features for an entire year.",
      },
      17: {
        name: "Basic Monthly Plan",
        description:
          "Offers essential features with 1000 prompts per month, 100 ad copies, and access to core networks.",
        access: "30 days",
        prompts: "100 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 100,
        price: "$49/month",
        topPlan: false,
        more: "Standard support and access to basic features.",
      },
      19: {
        name: "Free Plan",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      20: {
        name: "Starter plan",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      21: {
        name: "ANNUAL Starter Plan",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      23: {
        name: "Creator Monthly Plan",
        description:
          "Ideal for individuals getting started with ad creation. Includes access to essential features and major ad networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "30 days",
        prompts: "2000 credits for generating ad copies and creatives",
        adCopies: 2000,
        price: "₹99",
        topPlan: false,
        more: "Basic support with access to core features.",
      },
      24: {
        name: "Growth Monthly Plan",
        description:
          "Perfect for growing marketers and small teams. Offers higher limits, faster generation, and access to advanced features across all supported ad platforms.",
        access: "30 days",
        prompts: "4100 credits for generating ad copies and creatives",
        adCopies: 4100,
        price: "₹199",
        topPlan: true,
        more: "Priority support with enhanced feature access.",
      },
      25: {
        name: "Scale Monthly Plan",
        description:
          "Built for professionals and agencies managing large-scale campaigns. Unlocks maximum credits, premium features, and priority performance.",
        access: "30 days",
        prompts: "6200 credits for generating ad copies and creatives",
        adCopies: 6200,
        price: "₹299",
        topPlan: false,
        more: "Premium support with full feature access and highest limits.",
      },
      26: {
        name: "Basic Monthly Plan",
        description:
          "Offers essential features with 1000 prompts per month, 100 ad copies, and access to core networks.",
        access: "30 days",
        prompts: "100 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 100,
        price: "$49/month",
        topPlan: false,
        more: "Standard support and access to basic features.",
      },
      27: {
        name: "Test Plan",
        description:
          "Offers essential features with 1000 prompts per month, 100 ad copies, and access to core networks.",
        access: "30 days",
        prompts: "100 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 100,
        price: "$1/month",
        topPlan: false,
        more: "Standard support and access to basic features.",
      }
    },
    "Ad copy": {
      plans: {
        PAS: 5,
        8: 5, // Free
        2: 1000, // Individual Subscription
        4: 150, // Standard Subscription
        5: 1000, // Premium Subscription
        3: 500000000, // Agency Subscription
        9: 12000, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 150, // Annual Premium Plan
        12: 500000000, // Annual Agency Plan
        15: 5000, // custom
        16: 5000, // custom
        19: 50,
        20: 500, // Basic Monthly Plan
        21: 500 * 12,
        23: 2000,
        24: 4100,
        25: 6200,
        26: 100,
        27: 100,
      },
    },
    "Ad Creative": {
      plans: {
        PAS: 5,
        8: 35, // Free
        2: 1000, // Individual Subscription
        4: 50, // Standard Subscription
        5: 50, // Premium Subscription
        3: 3000, // Agency Subscription
        9: 12000, // Annual Individual Plan
        10: 150, // Annual Standard Plan
        11: 50, // Annual Premium Plan
        12: 36000, // Annual Agency Plan
        15: 150, // custom
        16: 150, // custom
        21: 500 * 12, // Basic Monthly Plan
        20: 500,
        19: 7,
        23: 2000,
        24: 4100,
        25: 6200,
        26: 50,
        27: 50,
      },
    },
    "Ad Creative Video": {
      plans: {
        PAS: 5,
        8: 0, // Free
        2: 16, // Individual Subscription
        4: 0, // Standard Subscription
        5: 0, // Premium Subscription
        3: 60, // Agency Subscription
        9: 16 * 12, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 150, // Annual Premium Plan
        12: 60 * 12, // Annual Agency Plan
        15: 0, // custom
        16: 0, // custom
        21: 8 * 12, // starter annual Plan
        20: 8, // starter monthly
        19: 0,
        23: 2000,
        24: 4100,
        25: 6200,
        26: 500,
        27: 500,
      },
    },
    "Number of prompts user can make per month": {
      plans: {
        PAS: 100,
        8: 100, // Free
        2: 10000, // Individual Subscription
        4: 1000, // Standard Subscription
        5: 3000, // Premium Subscription
        3: 500000000, // Agency Subscription
        9: 50000, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 1000, // Annual Premium Plan
        12: 500000000, // Annual Agency Plan
        15: 50000, // custom
        16: 50000, // custom
        21: 1000, // Basic Monthly Plan
        20: 100, // Free
        19: 100, // Free
        23: 2000,
        24: 4100,
        25: 6200,
        26: 1000,
        27: 1000,
      },
    },
    "Generate Similar Ads": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: 2000,
        24: 4100,
        25: 6200,
        26: 100,
        27: 100,
      },
    },
    Networks: {
      details: ["facebook", "google", "instagram", "youtube", "pinterest"],
      plans: {
        8: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        2: ["facebook", "google", "instagram", "youtube", "pinterest"], // Individual Subscription
        4: ["facebook", "google", "instagram", "youtube", "pinterest"], // Standard Subscription
        5: ["facebook", "google", "instagram", "youtube", "pinterest"], // Premium Subscription
        3: ["facebook", "google", "instagram", "youtube", "pinterest"], // Agency Subscription
        PAS: ["facebook", "google", "instagram", "youtube", "pinterest"],
        9: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Individual Plan
        10: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Standard Plan
        11: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Premium Plan
        12: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Agency Plan
        15: ["facebook", "instagram"], // custom
        16: ["facebook", "instagram"], // custom
        21: ["facebook", "google", "instagram", "youtube", "pinterest"], // Basic Monthly Plan
        20: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        19: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        23: ["facebook", "google", "instagram", "youtube", "pinterest"],
        24: ["facebook", "google", "instagram", "youtube", "pinterest"],
        25: ["facebook", "google", "instagram", "youtube", "pinterest"],
        26: ["facebook", "google", "instagram", "youtube", "pinterest"],
        27: ["facebook", "google", "instagram", "youtube", "pinterest"],
      },
    },
    adsCopyNetworks: {
      details: [
        "Google Performance Max Ads",
        "Google Video Ads",
        "Reddit Ads",
        "Twitter Ads",
        "Pinterest Ads",
        "Google Display Ads",
        "Meta Ads",
        "LinkedIn Ads",
        "Google Search Ads",
      ],
      plans: {
        8: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        2: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Individual Subscription
        4: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Standard Subscription
        5: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Premium Subscription
        3: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Agency Subscription
        PAS: [
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
        9: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Individual Plan
        10: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Standard Plan
        11: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Premium Plan
        12: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Agency Plan
        15: ["Meta Ads"], // custom
        16: ["Meta Ads"], // custom
        21: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Basic Monthly Plan
        20: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        19: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        23: [
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
        24: [
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
        25: [
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
        26: [
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
        27: [
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
      },
    },
    "Target Audience": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Single Ad analytics": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Advertiser Search": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Market analysis": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Ad Count by Post Owner": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Popularity Index": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Distribution of Call to Action": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Geographical Distribution of Ads": {
      plans: {
        PAS: 12,
        8: 12, // Free
        2: 12, // Individual Subscription
        4: 12, // Standard Subscription
        5: 12, // Premium Subscription
        3: 12, // Agency Subscription
        9: 12, // Annual Individual Plan
        10: 12, // Annual Standard Plan
        11: 12, // Annual Premium Plan
        12: 12, // Annual Agency Plan
        15: 12, // custom
        16: 12, // custom
        21: 12,
        20: 12,
        19: 12,
        23: 12,
        24: 12,
        25: 12,
        26: 12,
        27: 12,
      },
    },
    "Engagement Comparison Across Ad Formats": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        21: true,
        20: true,
        19: true,
        23: true,
        24: true,
        25: true,
        26: true,
        27: true,
      },
    },
    "Chat history": {
      plans: {
        PAS: "6 months",
        8: "30 days", // Free
        2: "30 days", // Individual Subscription
        4: "3 months", // Standard Subscription
        5: "6 months", // Premium Subscription
        3: "All", // Agency Subscription
        9: "30 days", // Annual Individual Plan
        10: "3 months", // Annual Standard Plan
        11: "6 months", // Annual Premium Plan
        12: "All", // Annual Agency Plan
        15: "All", // custom
        16: "All", // custom
        21: "30 days", // Basic Monthly Plan
        20: "30 days", // Basic Monthly Plan
        19: "30 days",
        23: "All",
        24: "All",
        25: "All",
        26: "All",
        27: "All",
      },
    },
  };
} else {
  features = {
    planDetails: {
      8: {
        name: "FREE - 7 Days",
        description:
          "Offers limited features with 100 prompts per month, 35 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 5,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      2: {
        name: "Individual",
        description:
          "Provides access for 30 days with 10,000 prompts per month, 1000 ad copies, 100 ad creative and networks like Facebook, Google Text, and Pinterest.",
        access: "30 days",
        prompts: "1000 adCopies, 100 adCreatives, and 10000 prompts per month",
        adCopies: 1000,
        price: "$99/month",
        topPlan: false,
        more: "Basic customer support, no premium networks access.",
      },
      4: {
        name: "Standard Subscription",
        description:
          "Offers access for 30 days with 1000 prompts per month, 150 ad copies, 50 ad creatives and additional networks including Facebook, Google Text, Instagram, and YouTube.",
        access: "30 days",
        prompts: "150 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 150,
        price: "$129/month",
        topPlan: false,
        more: "Priority support, access to more networks and increased ad copies.",
      },
      5: {
        name: "GROWTH",
        description:
          "Grants access for 30 days with 3000 prompts per month, 1000 ad copies, 50 ad creatives, and the most extensive network coverage, including Meta Ads, Google Video Ads, Reddit Ads, Twitter Ads, Pinterest Ads, and more.",
        access: "30 days",
        prompts: "1000 adCopies, 50 adCreatives, and 3000 prompts per month",
        adCopies: 1000,
        price: "$179/month",
        topPlan: false,
        more: "Premium customer support, access to exclusive networks, unlimited features.",
      },
      3: {
        name: "CREATOR",
        description:
          "Delivers the highest level of access with unlimited prompts per month, unlimited ad copies, 500 ad creatives, and access to all major networks including Meta Ad, LinkedIn Ads, Google Video Ads, Reddit Ads, Twitter Ads, Pinterest Ads, and Google Display Ads.",
        access: "30 days",
        prompts:
          "Unlimited adCopies, 500 adCreatives, and Unlimited prompts per month",
        adCopies: "Unlimited",
        price: "$279/month",
        topPlan: false,
        more: "Dedicated account manager, unlimited access to all networks, fast-track support.",
      },
      PAS: {
        name: "Free Plan",
        description:
          "Offers limited features with 100 prompts per month, 5 ad copies, 5 ad creatives and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 5 adCreatives, and 100 prompts per month",
        adCopies: 5,
        price: "Free",
        topPlan: false,
        pasUserAccess: true,
        more: "Limited support and access to basic features.",
      },
      9: {
        name: "SCALE",
        description:
          "Provides access for 365 days with 50,000 prompts per year, 1000 ad copies, 1200 ad creatives and networks like YouTube and Pinterest.",
        access: "365 days",
        prompts:
          "12000 adCopies, 1200 adCreatives, and 120000 prompts per year",
        adCopies: 1000,
        price: "$349/year",
        topPlan: false,
        more: "Basic customer support with access to networks for a full year.",
      },
      10: {
        name: "Annual Standard Plan",
        description:
          "Offers access for 365 days with 500 prompts per month, 500 ad copies, 150 ad creatives and additional networks such as Facebook, Google Text, and Pinterest.",
        access: "365 days",
        prompts: "500 adCopies, 150 adCreatives, and 500 prompts per month",
        adCopies: 500,
        price: "$499/year",
        topPlan: false,
        more: "Priority support, one year of access to additional networks and ad copies.",
      },
      11: {
        name: "Annual Premium Plan",
        description:
          "Grants access for 365 days with 1000 prompts per month, 150 ad copies, 50 ad creatives, and a wider range of networks including Facebook, Google Text, Instagram, and YouTube.",
        access: "365 days",
        prompts: "150 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 150,
        price: "$799/year",
        topPlan: false,
        more: "Premium support, access to more networks, and additional ad copies for one year.",
      },
      12: {
        name: "ANNUAL INDIVIDUAL",
        description:
          "Delivers access for 365 days with unlimited prompts per month, unlimited ad copies, 6000 ad creatives and the most extensive network coverage, including Meta Ads, LinkedIn Ads, Google Video Ads, Reddit Ads, and more.",
        access: "365 days",
        prompts:
          "Unlimited adCopies, 6000 adCreatives, and Unlimited prompts per month",
        adCopies: "Unlimited",
        price: "$999/year",
        topPlan: true,
        more: "Dedicated account manager, access to all networks, priority support, and premium features for an entire year.",
      },
      15: {
        name: "Monthly Custom Plan",
        description:
          "Delivers access for 30 days with 50,000 prompts per month, 5000 ad copies, 150 ad creatives.",
        access: "30 days",
        prompts: "5000 adCopies, 150 adCreatives, and 50000 prompts per month",
        adCopies: 5000,
        price: "$49/month",
        topPlan: true,
        more: "Dedicated account manager, access to all networks, priority support, and premium features for an entire year.",
      },
      19: {
        name: "Top-Up",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      21: {
        name: "Basic Monthly Plan",
        description:
          "Offers essential features with 1000 prompts per month, 100 ad copies, and access to core networks.",
        access: "30 days",
        prompts: "100 adCopies, 50 adCreatives, and 1000 prompts per month",
        adCopies: 100,
        price: "$49/month",
        topPlan: false,
        more: "Standard support and access to basic features.",
      },
      22: {
        name: "Free Plan",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      23: {
        name: "Starter",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      24: {
        name: "ANNUAL STARTER",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      },
      25: {
        name: "Basic",
        description:
          "Offers limited features with 100 prompts per month, 7 ad creative, and access to networks like Facebook, Google, Instagram, YouTube, and Pinterest.",
        access: "1 day",
        prompts: "5 adCopies, 35 adCreatives, and 100 prompts per month",
        adCopies: 50,
        price: "Free",
        topPlan: false,
        more: "Limited support and access to basic features.",
      }
    },
    "Ad copy": {
      plans: {
        PAS: 5,
        8: 5, // Free
        2: 1000, // Individual Subscription
        4: 150, // Standard Subscription
        5: 1000, // Premium Subscription
        3: 500000000, // Agency Subscription
        9: 12000, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 150, // Annual Premium Plan
        12: 500000000, // Annual Agency Plan
        15: 5000, // custom
        16: 5000, // custom
        19: 50,
        21: 100, // Basic Monthly Plan
        22: 50,
        23: 500,
        24: 500 * 12,
        25: 500 * 12,
      },
    },
    "Ad Creative": {
      plans: {
        PAS: 5,
        8: 35, // Free
        2: 1000, // Individual Subscription
        4: 50, // Standard Subscription
        5: 50, // Premium Subscription
        3: 3000, // Agency Subscription
        9: 12000, // Annual Individual Plan
        10: 150, // Annual Standard Plan
        11: 50, // Annual Premium Plan
        12: 36000, // Annual Agency Plan
        15: 150, // custom
        16: 150, // custom
        19: 7,
        21: 50, // Basic Monthly Plan
        22: 7,
        23: 500,
        24: 6000,
        25: 6000,
      },
    },
    "Ad Creative Video": {
      plans: {
        PAS: 5,
        8: 0, // Free
        2: 16, // Individual Subscription
        4: 0, // Standard Subscription
        5: 8 * 12, // Premium Subscription
        3: 60, // Agency Subscription
        9: 16 * 12, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 150, // Annual Premium Plan
        12: 60 * 12, // Annual Agency Plan
        15: 0, // custom
        16: 0, // custom
        19: 0,
        21: 0, // Basic Monthly Plan
        22: 0,
        23: 8,
        24: 8 * 12,
        25: 8 * 12,
      },
    },
    "Number of prompts user can make per month": {
      plans: {
        PAS: 100,
        8: 100, // Free
        2: 10000, // Individual Subscription
        4: 1000, // Standard Subscription
        5: 3000, // Premium Subscription
        3: 500000000, // Agency Subscription
        9: 50000, // Annual Individual Plan
        10: 500, // Annual Standard Plan
        11: 1000, // Annual Premium Plan
        12: 500000000, // Annual Agency Plan
        15: 50000, // custom
        16: 50000, // custom
        21: 1000, // Basic Monthly Plan
        22: 100, // Free
        19: 100, // Free
        23: 1000,
        25: 1000,
      },
    },
    "Generate Similar Ads": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    Networks: {
      details: ["facebook", "google", "instagram", "youtube", "pinterest"],
      plans: {
        8: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        2: ["facebook", "google", "instagram", "youtube", "pinterest"], // Individual Subscription
        4: ["facebook", "google", "instagram", "youtube", "pinterest"], // Standard Subscription
        5: ["facebook", "google", "instagram", "youtube", "pinterest"], // Premium Subscription
        3: ["facebook", "google", "instagram", "youtube", "pinterest"], // Agency Subscription
        PAS: ["facebook", "google", "instagram", "youtube", "pinterest"],
        9: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Individual Plan
        10: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Standard Plan
        11: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Premium Plan
        12: ["facebook", "google", "instagram", "youtube", "pinterest"], // Annual Agency Plan
        15: ["facebook", "instagram"], // custom
        16: ["facebook", "instagram"], // custom
        21: ["facebook", "google", "instagram", "youtube", "pinterest"], // Basic Monthly Plan
        22: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        19: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        23: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        24: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
        25: ["facebook", "google", "instagram", "youtube", "pinterest"], // Free Plan
      },
    },
    adsCopyNetworks: {
      details: [
        "Google Performance Max Ads",
        "Google Video Ads",
        "Reddit Ads",
        "Twitter Ads",
        "Pinterest Ads",
        "Google Display Ads",
        "Meta Ads",
        "LinkedIn Ads",
        "Google Search Ads",
      ],
      plans: {
        8: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        2: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Individual Subscription
        4: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Standard Subscription
        5: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Premium Subscription
        3: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Agency Subscription
        PAS: [
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
        9: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Individual Plan
        10: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Standard Plan
        11: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Premium Plan
        12: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Annual Agency Plan
        15: ["Meta Ads"], // custom
        16: ["Meta Ads"], // custom
        21: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Basic Monthly Plan
        22: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        19: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        23: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        24: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
        25: [
          "Google Search Ads",
          "Meta Ads",
          "LinkedIn Ads",
          "Google Performance Max Ads",
          "Google Video Ads",
          "Reddit Ads",
          "Twitter Ads",
          "Pinterest Ads",
          "Google Display Ads",
        ], // Free - 1 day
      },
    },
    "Target Audience": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Single Ad analytics": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Advertiser Search": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Market analysis": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Ad Count by Post Owner": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Popularity Index": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Distribution of Call to Action": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        23: true,
        24: true,
        25: true,
      },
    },
    "Geographical Distribution of Ads": {
      plans: {
        PAS: 12,
        8: 12, // Free
        2: 12, // Individual Subscription
        4: 12, // Standard Subscription
        5: 12, // Premium Subscription
        3: 12, // Agency Subscription
        9: 12, // Annual Individual Plan
        10: 12, // Annual Standard Plan
        11: 12, // Annual Premium Plan
        12: 12, // Annual Agency Plan
        15: 12, // custom
        16: 12, // custom
        19: 12,
        21: 12,
        22: 12,
        23: 12,
        24: 12,
        25: 12,
      },
    },
    "Engagement Comparison Across Ad Formats": {
      plans: {
        PAS: true,
        8: true, // Free
        2: true, // Individual Subscription
        4: true, // Standard Subscription
        5: true, // Premium Subscription
        3: true, // Agency Subscription
        9: true, // Annual Individual Plan
        10: true, // Annual Standard Plan
        11: true, // Annual Premium Plan
        12: true, // Annual Agency Plan
        15: true, // custom
        16: true, // custom
        19: true,
        21: true,
        22: true,
        22: true,
        23: true,
        24: true,
      },
    },
    "Chat history": {
      plans: {
        PAS: "6 months",
        8: "30 days", // Free
        2: "30 days", // Individual Subscription
        4: "3 months", // Standard Subscription
        5: "6 months", // Premium Subscription
        3: "All", // Agency Subscription
        9: "30 days", // Annual Individual Plan
        10: "3 months", // Annual Standard Plan
        11: "6 months", // Annual Premium Plan
        12: "All", // Annual Agency Plan
        15: "All", // custom
        16: "All", // custom
        19: "30 days",
        21: "30 days",
        22: "30 days", // Basic Monthly Plan
        23: "30 days",
        24: "30 days",
        25: "30 days",
      },
    },
  };
}

module.exports = { features };
