// Ad-creative Python service endpoints.
//
// Every generator (the six creative types plus ad copy) is a single route on
// the same host, so only that host is configurable via AD_CREATIVE_API_BASE.
// The paths are fixed by the Python service's contract, so they live here
// rather than as seven near-identical full-URL env vars.
const ROUTES = {
    lifestyle: "/lifestyle-ads/generate",
    product_shot: "/product-shot/generate",
    apps_saas: "/saas-ads/generate",
    brand_awareness: "/brand-awareness/generate",
    ai_ads: "/ai-creatives/generate",
    recreate_ads: "/recreate-competitor-ads/generate",
    ad_copy: "/adcopy/generate",
};

// Read at call time, not module load, so tests can set the env var late.
// Trailing slashes are stripped so a base of ".../adsgpt.io/" still joins
// cleanly against a leading-slash route.
const baseUrl = () =>
    String(process.env.AD_CREATIVE_API_BASE || "").trim().replace(/\/+$/, "");

// Returns null when the base is unset or the route name is unknown, so
// callers can keep whatever they already do for "not configured".
const apiUrl = (route) => {
    const base = baseUrl();
    const path = ROUTES[route];
    return base && path ? base + path : null;
};

module.exports = { ROUTES, baseUrl, apiUrl };
