exports.ugc_Payload = {
  type: "ugc",
  model: "veo-2",
  numberOfVideos: 1,
  productUrl: "https://brand.com/product",
  productName: "Glow Serum",
  script: "This serum changed my skin!",
  avatar: "female_1",
  duration: "15s",
  aspectRatio: "9:16",
};

exports.broll_Payload = {
  type: "broll",
  model: "veo-2",
  numberOfVideos: 1,
  productUrl: "https://brand.com/perfume",
  productName: "Luxury Perfume",
  image: "https://cdn.site.com/perfume.png",
  duration: "8s",
  aspectRatio: "1:1",
  promotion: "20% OFF",
  notes: "white background slow motion",
};

exports.avatar_Payload = {
  type: "avatar",
  model: "veo-2",
  numberOfVideos: 1,
  duration: "8s",
  aspectRatio: "1:1",
  avatarType: "uploaded",
  avatarId: "65f1a2b3c4d5e6f7890a1234",
  uploadedAvatars: [
    "https://example.com/avatar1.png",
    "https://example.com/avatar2.png",
  ],
  productName: "Test Product",
  image: "https://example.com/image.png",
  promotion: "",
  notes: null,
};

exports.clone_Payload = {
  type: "clone",
  model: "veo-2",
  numberOfVideos: 1,
  videoSample: "https://cdn.site.com/sample.mp4",
  script: "Hello everyone welcome to my channel",
  voiceClone: true,
  duration: "20s",
  aspectRatio: "9:16",
};

exports.updateVideoResultPayload = {
  subscription: { 23: "2026-04-01" },
  userId: "GPT-4096",
  model: "veo-2",
  url: "https://cdn.site.com/output.mp4",
  cleanVideoUrl: "https://cdn.site.com/output-clean.mp4",
  duration: "15s",
  error: null,
  videoStatus: 200,
};

exports.Avatar = {
  avatars: [
    {
      age: "Young Adult",
      gender: "Female",
      race: "South Asian",
      industry: "Business",
      outfit: "Formal / Business",
      background: "Coffee Shop Real",
      lighting: "Golden Hour",
      camera_distance: "Medium Shot",
      expression: "Confident",
      aspect_ratio: "9:16",
      image_size: "4K",
      s3_image_path: "/creatives/avatar/1773380063119.webp",
    },
  ],
};

// ── AI Ads Payloads ────────────────────────────────────────────────────────────

exports.aiAdsGenerateSceneProduct_Payload = {
  watermark: false,
  inputs: {
    type: "ai_ads",
    aiAdsType: "product",
    productName: "GlowSkin Vitamin C Serum",
    productDescription: "A premium anti-aging serum with 15% Vitamin C.",
    price: "$50",
    category: "Skincare",
    adStyle: "luxury",
    tone: "casual",
    duration: "24",
    aspectRatio: "9:16",
    ctaType: "Try it today",
    model: "veo-3.1-fast",
    numberOfVideos: 1,
    images: ["https://contents.adsgpt.io/creatives/avatar/sample.webp"],
    userPrompt: "hero shot of our new product on a marble pedestal",
  },
};

exports.aiAdsGenerateSceneBrand_Payload = {
  watermark: false,
  inputs: {
    type: "ai_ads",
    aiAdsType: "brand",
    brandName: "GlowSkin",
    tagline: "Glow Every Day",
    logoUrl: "https://contents.adsgpt.io/logos/glowskin.png",
    category: "Skincare",
    adStyle: "modern",
    tone: "professional",
    duration: "24",
    aspectRatio: "9:16",
    ctaType: "Shop Now",
    model: "veo-3.1-fast",
    numberOfVideos: 1,
    images: ["https://contents.adsgpt.io/creatives/avatar/sample.webp"],
    userPrompt: "evoke a premium, modern brand identity",
  },
};

exports.aiAdsRegenerateScene_Payload = {
  sessionId: "66f1a2b3c4d5e6f7890a0001",
  segments: [1, 2],
  regenerateType: "both",
  inputs: {
    type: "ai_ads",
    aiAdsType: "product",
    productName: "GlowSkin Vitamin C Serum",
    productDescription: "A premium anti-aging serum with 15% Vitamin C.",
    model: "veo-3.1-fast",
    numberOfVideos: 1,
    duration: "24",
    userPrompt: "make scene 2 more energetic with outdoor lighting",
  },
};

exports.aiAdsSceneResultCallback_Payload = {
  userId: "GPT-165",
  success: true,
  scenes: [
    {
      segmentNumber: 1,
      type: "both",
      goal: "HOOK",
      frameImageUrl: "https://cdn.site.com/scene1.jpg",
      script: [{ id: 1, start: "0s", end: "3s", text: "Glow like never before" }],
      sceneDescription: "Open with close-up of glowing skin",
      audioDirection: "upbeat background music",
    },
  ],
  totalSegments: 3,
  totalDuration: 24,
  isRegenerate: false,
};

exports.aiAdsBrand_Payload = {
  url: "https://www.nike.com",
  name: "Nike",
};

exports.aiAdsProduct_Payload = {
  url: "https://www.nike.com/t/air-max-270",
  name: "Nike Air Max 270",
};

exports.aiAdsVideoResultCallback_Payload = {
  userId: "GPT-165",
  success: true,
  videoStatus: 200,
  segments: [
    { segmentNumber: 1, videoUrl: "https://cdn.site.com/seg1.mp4", duration: 8 },
    { segmentNumber: 2, videoUrl: "https://cdn.site.com/seg2.mp4", duration: 8 },
    { segmentNumber: 3, videoUrl: "https://cdn.site.com/seg3.mp4", duration: 8 },
  ],
  totalDuration: 24,
  model: "veo-3.1-fast",
};
