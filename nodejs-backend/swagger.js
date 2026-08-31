require("dotenv").config();

const swaggerAutogen = require("swagger-autogen")({ openapi: "3.0.0" });

const {
  access_Routes,
  User_Management,
  createCampaignPayload,
  updateCampaignPayload,
  updateCampaignResult,
} = require("./resources/payloadBody/dashboard_DraftData");

const {
  ugc_Payload,
  broll_Payload,
  avatar_Payload,
  clone_Payload,
  updateVideoResultPayload,
  Avatar,
  aiAdsGenerateSceneProduct_Payload,
  aiAdsGenerateSceneBrand_Payload,
  aiAdsRegenerateScene_Payload,
  aiAdsSceneResultCallback_Payload,
  aiAdsVideoResultCallback_Payload,
} = require("./resources/payloadBody/videoGenerationPayload");

const {
  lifestyleImagePayload,
  productShotImagePayload,
  appsSaasImagePayload,
  brandAwarenessImagePayload,
  aiAdsImagePayload,
  updateImageResultPayload,
} = require("./resources/payloadBody/imageGenerationPayload");

const {
  createAutopilotJobPayload,
  updateAutopilotJobPayload,
  autopilotJobResponse,
  autopilotJobListResponse,
  autopilotRunHistoryResponse,
} = require("./resources/payloadBody/adsFactoryAutoPilotPayload");

const {
  mobileSignupPayload,
  googleSignupPayload,
  googleLoginPayload,
  appleSignupPayload,
  appleLoginPayload,
  deleteAccountPayload,
  acceptMobileTermsPayload,
  verifyApplePaymentPayload,
  restoreApplePurchasesPayload,
  verifyGooglePaymentPayload,
  appleWebhookPayload,
  googleWebhookPayload,
  mobileAuthResponse,
  mobilePaymentVerifyResponse,
  mobileSubscriptionDetailsResponse,
  mobileWebhookResponse,
  v2EmailAuthPayload,
  v2GoogleAuthPayload,
  v2AppleAuthPayload,
  v2UpdateProfilePayload,
  v2AuthSuccessResponse,
} = require("./resources/payloadBody/mobilePayload");

// For local development on port 7000, detect if MODE=DEV
const isLocalDev = process.env.MODE === "local" || !process.env.SWAGGER_HOST;
const SwaggerHost = isLocalDev ? "http://localhost:7000" : process.env.SWAGGER_HOST;

const doc = {
  openapi: "3.0.0",

  info: {
    title: "AdsGPT APIs",
    description: "Documentation for AdsGPT APIs",
    version: "1.0.0",
  },

  servers: [
    {
      url: `${SwaggerHost}/adsgpt`,
      description: "AdsGPT API Server",
    },
  ],

  tags: [
    {
      name: "Mobile Native Auth & Payments",
      description: "Mobile native email signup, Google & Apple social sign-in, StoreKit 2 & Google Play billing verifications, and webhooks",
    },
    {
      name: "Ad Factory",
      description: "Campaign creation and management",
    },
    {
      name: "Meta Ads Launcher",
      description: "Meta ads related APIs",
    },
    {
      name: "Video Generation",
      description: "AI Video Generation (UGC, B-Roll, Avatar, Clone, AI Ads)",
    },
    {
      name: "Image Generation",
      description: "AI Image Generation (Lifestyle, Product Shot, Apps/SaaS, Brand Awareness, AI Ads)",
    },
    {
      name: "Avatar Management",
      description: "Avatar management APIs",
    },
    {
      name: "Google Ads",
      description: "Google Ads account, campaign, ad group and ad management",
    },
    {
      name: "TikTok Ads",
      description: "TikTok Ads Manager — account connection, campaign/ad group/ad CRUD, wizard config, targeting pickers, reporting, and campaign templates",
    },
    {
      name: "Ads Factory Autopilot",
      description: "Autopilot job management — schedule, pause, resume, and monitor automated ad generation jobs",
    },
    {
      name: "Prompt Templates",
      description: "Store and fetch module prompt templates by type",
    },
    {
      name: "Usage",
      description: "Usage logging, generation stats, and model credit values",
    },
    {
      name: "Device Tokens",
      description: "Register/unregister native app FCM tokens for push notifications",
    },
    {
      name: "Partner API",
      description: "External partner-facing Meta Ads reporting APIs — authenticated via a partner-supplied Meta System User access token, not an AdsGPT JWT",
    },
    {
      name: "Workspaces",
      description: "Workspace management, member invitations, member roles, active session switching, and member authentication APIs",
    },
    {
      name: "BrandIQ",
      description: "Brand intelligence & management APIs — create/update brands, search brands, competitor ads discovery, logo removal, and audience suggestions",
    },
    {
      name: "Voice Selector",
      description: "AI voice catalog, voice filters (languages, genders, accents, ages), voice search, and Sarvam voice catalog APIs",
    },
    {
      name: "Admin",
      description: "Admin panel APIs — admin authentication, dashboard metrics, user management, partner API keys, token usage, plan limits, and AI model configurations",
    },
    {
      name: "default",
      description: "Miscellaneous APIs",
    },
  ],

  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter JWT Bearer token",
      },
      MetaSystemUserToken: {
        type: "apiKey",
        in: "header",
        name: "x-meta-system-user-token",
        description: "Meta System User access token supplied by the partner",
      },
      PartnerApiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "AdsGPT-issued partner API key (see /admin/partner-api-keys)",
      },
    },

    schemas: {
      // Mobile Native Auth & Payments
      mobileSignupPayload,
      googleSignupPayload,
      googleLoginPayload,
      appleSignupPayload,
      appleLoginPayload,
      deleteAccountPayload,
      acceptMobileTermsPayload,
      verifyApplePaymentPayload,
      restoreApplePurchasesPayload,
      verifyGooglePaymentPayload,
      appleWebhookPayload,
      googleWebhookPayload,
      mobileAuthResponse,
      mobilePaymentVerifyResponse,
      mobileSubscriptionDetailsResponse,
      mobileWebhookResponse,

      // V2 Auth & Onboarding Payloads
      v2EmailAuthPayload,
      v2GoogleAuthPayload,
      v2AppleAuthPayload,
      v2UpdateProfilePayload,
      v2AuthSuccessResponse,

      // Dashboard
      access_Routes,
      User_Management,
      createCampaignPayload,
      updateCampaignPayload,
      updateCampaignResult,

      // Regular video generation
      ugc_Payload,
      broll_Payload,
      avatar_Payload,
      clone_Payload,
      updateVideoResultPayload,
      Avatar,

      // AI Ads
      aiAdsGenerateSceneProduct_Payload,
      aiAdsGenerateSceneBrand_Payload,
      aiAdsRegenerateScene_Payload,
      aiAdsSceneResultCallback_Payload,
      aiAdsVideoResultCallback_Payload,

      // Image generation
      lifestyleImagePayload,
      productShotImagePayload,
      appsSaasImagePayload,
      brandAwarenessImagePayload,
      aiAdsImagePayload,
      updateImageResultPayload,

      // Ads Factory Autopilot
      createAutopilotJobPayload,
      updateAutopilotJobPayload,
      autopilotJobResponse,
      autopilotJobListResponse,
      autopilotRunHistoryResponse,
    },
  },

  security: [
    {
      BearerAuth: [],
    },
  ],
};

const outputFile = "./resources/views/swagger-api-view.json";
const endpointsFiles = ["./Router/MainRouter.js"];

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
  console.log(
    `\n✓ Swagger documentation generated successfully!\n` +
    `  Location: ${outputFile}\n` +
    `  Server: ${SwaggerHost}/adsgpt\n` +
    `  Swagger UI: ${SwaggerHost}/api-docs\n` +
    `  Credentials: admin / admin\n`
  );
}).catch((err) => {
  console.error("✗ Error generating Swagger:", err.message);
  process.exit(1);
});
