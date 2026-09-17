// Ad-video Python service endpoints.
//
// Every video generator (b-roll, UGC, avatar, clone-yourself, AI ads,
// clone-your-ad) is a route on the same host under /api/v1, so only that
// host is configurable via AD_VIDEO_API_BASE. The paths are fixed by the
// Python service's contract, so they live here rather than as eighteen
// near-identical full-URL env vars.
const ROUTES = {
    // Direct generators — keys match the `type` values accepted by
    // generateVideo's typeToApiUrl map.
    broll: "/api/v1/broll/generate",
    ugc: "/api/v1/ugc/generate",
    avatar: "/api/v1/avatar/generate",
    ai_ads: "/api/v1/ai_ads/generate_video",

    // Avatar helpers
    avatar_image_script: "/api/v1/avatar/generate_avatar",
    avatar_script: "/api/v1/avatar/script_generation",

    // Clone-yourself
    clone_yourself_image_script: "/api/v1/clone-yourself/generate_avatar",
    clone_yourself_script_regeneration: "/api/v1/clone-yourself/script_generation",
    clone_yourself_generation: "/api/v1/clone-yourself/generate",
    clone_yourself_frame_regenerate: "/api/v1/clone-yourself/regenerate_first_frame",

    // AI ads pipeline
    ai_ads_validate: "/api/v1/ai_ads/validate",
    ai_ads_generate_scene: "/api/v1/ai_ads/generate_scenes",
    ai_ads_regenerate_scene: "/api/v1/ai_ads/regenerate_scenes",
    ai_ads_regenerate_voice: "/api/v1/ai_ads/regenerate_voice",
    ai_ads_preview_regenerate_script: "/api/v1/ai_ads/preview_regenerate_script",
    ai_ads_final_merge: "/api/v1/ai_ads/final_merge",

    // Clone-your-ad
    clone_your_ad_analyze: "/api/v1/clone-your-ad/analyze",
    clone_your_ad_generate: "/api/v1/clone-your-ad/generate",
};

// Read at call time, not module load, so tests can set the env var late.
const baseUrl = () =>
    String(process.env.AD_VIDEO_API_BASE || "").trim().replace(/\/+$/, "");

// Returns null when the base is unset or the route name is unknown, so the
// existing "not configured" guards at each call site keep working.
const apiUrl = (route) => {
    const base = baseUrl();
    const path = ROUTES[route];
    return base && path ? base + path : null;
};

module.exports = { ROUTES, baseUrl, apiUrl };
