import axios from "axios";
import { clearAdminToken, getAdminToken } from "./auth";

const BASE_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:7000";

export const api = axios.create({
  baseURL: `${BASE_URL}/adsgpt/admin`,
});

api.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 || err?.response?.status === 403) {
      clearAdminToken();
      if (typeof window !== "undefined" && !window.location.pathname.endsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

export const adminApi = {
  login: (username, password) => api.post("/login", { username, password }),
  me: () => api.get("/me"),
  overview: (params) => api.get("/overview", { params }),
  usersFilterOptions: (params) => api.get("/users/filter-options", { params }),
  users: (params) => api.get("/users", { params }),
  userDetail: (userId, params) => api.get(`/users/${encodeURIComponent(userId)}`, { params }),
  partnerApiKeys: () => api.get("/partner-api-keys"),
  createPartnerApiKey: (partnerName) => api.post("/partner-api-keys", { partnerName }),
  revokePartnerApiKey: (id) => api.patch(`/partner-api-keys/${encodeURIComponent(id)}/revoke`),
  tokenUsageOverview: (params) => api.get("/token-usage/overview", { params }),
  tokenUsageUserDetail: (userId, params) =>
    api.get(`/token-usage/users/${encodeURIComponent(userId)}`, { params }),
  plans: () => api.get("/plans"),
  updatePlanLimit: (planId, patch) => api.patch(`/plans/${encodeURIComponent(planId)}`, patch),
  models: (params) => api.get("/models", { params }),
  createModel: (payload) => api.post("/models", payload),
  updateModel: (canonicalKey, payload) => api.patch(`/models/${encodeURIComponent(canonicalKey)}`, payload),
  updateModelStatus: (canonicalKey, status) =>
    api.patch(`/models/${encodeURIComponent(canonicalKey)}/status/${status}`),
  updateModelSurfaces: (canonicalKey, surfaces) =>
    api.patch(`/models/${encodeURIComponent(canonicalKey)}/surfaces`, { surfaces }),
  archiveModel: (canonicalKey) => api.delete(`/models/${encodeURIComponent(canonicalKey)}`),
};

// Page-view summaries live under /adsgpt/analytics (a different base than the
// admin API). The route is public on the backend; we still attach the admin
// token for parity.
const analytics = axios.create({
  baseURL: `${BASE_URL}/adsgpt/analytics`,
});

analytics.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const analyticsApi = {
  // GET /analytics/summary/:user_id — page visits & time spent for one user
  userSummary: (userId) => analytics.get(`/summary/${encodeURIComponent(userId)}`),
};

export const fetchModelCredits = async () => {
  try {
    const token = getAdminToken();
    const response = await axios.get(`${BASE_URL}/adsgpt/usage/model-credit-value`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.data.success) {
      return {
        imageModels: response.data.data.imageModels || [],
        videoModels: response.data.data.videoModels || [],
      };
    }
    return { imageModels: [], videoModels: [] };
  } catch (error) {
    console.error("Error fetching model credits:", error);
    return { imageModels: [], videoModels: [] };
  }
};

// Per-quality image credits from the `ad_creative` surface. Legacy
// fetchModelCredits (above) is kept for video + as a flat fallback. Each model
// returned carries qualityTiers: [{ quality, creditsPerImage }] so the
// estimator can show credits per quality (images are priced per tier).
export const fetchAdCreativeImageTiers = async () => {
  try {
    const token = getAdminToken();
    const response = await axios.get(`${BASE_URL}/adsgpt/usage/model-credit-value`, {
      params: { media: "ad_creative", type: "image" },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.data.success) {
      return response.data.data.imageModels || [];
    }
    return [];
  } catch (error) {
    console.error("Error fetching ad creative image tiers:", error);
    return [];
  }
};
