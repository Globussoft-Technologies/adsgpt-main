// API client for the Image Generation feature.
//
// Endpoints (all on VITE_SOCKET_URL):
//   POST /image/generate          — submit a generation request
//   GET  /image/all               — paginated history
//   GET  /my-space/images         — unified My Space image history
//   GET  /image/{imageId}         — single record (used for both polling and detail)
//
// Auth follows the project convention: Bearer ${getCookies()} from the
// `access-token` cookie. The PATCH /image/update-result endpoint is
// server-to-server (Python worker) and is intentionally NOT exposed here.

import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;

// Built fresh on each call so a re-login picks up the new JWT without a
// page reload (storing the header object once would freeze the old token).
const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// ── POST /image/generate ─────────────────────────────────────────────────
//
// `body` is the full request body produced by buildImageInputs(). Shape
// depends on the variant — see imageGenerationPayload.js for examples.
// We deliberately do NOT wrap with { inputs } — the new contract takes the
// shape directly: { type, brandInfo, userInputs } (or per-variant equivalent).
export const generateImage = async (body) => {
  const { data } = await axios.post(
    `${BASE_URL}/image/generate`,
    body,
    { headers: headers() },
  );
  return data;
};

// ── POST /image/save-edited ──────────────────────────────────────────────
//
// Persist a client-side edited image (logo editor "Save as new") as a new
// completed record. `body`: { url, sourceImageId, inputs }. The backend
// clones the source's inputs when sourceImageId resolves, else uses inputs.
export const saveEditedImage = async (body) => {
  const { data } = await axios.post(
    `${BASE_URL}/image/save-edited`,
    body,
    { headers: headers() },
  );
  return data;
};

// ── GET /image/all ───────────────────────────────────────────────────────
//
// Paginated history. All filters are optional; undefined values are dropped
// from the query string by axios automatically.
export const getAllImages = async ({
  type,
  model,
  status,
  skip = 0,
  limit = 20,
  startDate,
  endDate,
} = {}) => {
  const { data } = await axios.get(`${BASE_URL}/image/all`, {
    params: { type, model, status, skip, limit, startDate, endDate },
    headers: headers(),
  });
  return data;
};

// ── GET /my-space/images ─────────────────────────────────────────────────────
//
// Unified My Space image history. For now the backend supports source=all,
// adCreative, and adFactory; the React app uses this only for source=all.
export const getMySpaceImages = async ({
  source = 'all',
  type,
  model,
  status,
  skip = 0,
  limit = 20,
  startDate,
  endDate,
} = {}) => {
  const { data } = await axios.get(`${BASE_URL}/my-space/images`, {
    params: { source, type, model, status, skip, limit, startDate, endDate },
    headers: headers(),
  });
  return data;
};

// ── GET /image/{imageId} ─────────────────────────────────────────────────
//
// Single record. Used both for the polling loop (until imageStatus === 200)
// and for direct detail views.
export const getImageById = async (imageId) => {
  const { data } = await axios.get(
    `${BASE_URL}/image/${encodeURIComponent(imageId)}`,
    { headers: headers() },
  );
  return data;
};
