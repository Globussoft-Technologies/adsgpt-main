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
    },

    schemas: {
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
