import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// -----------------------------------------------------------------------------
// Start a landing-page analysis.
// FE pastes a URL → backend creates the analysis doc and hands its _id to python
// as the sessionId. Python acks instantly; the backend replies with that ack.
// Returns: { success, message, data: { sessionId, status } }.
// The `sessionId` is what later GET-by-id / live-event calls key off of.
// -----------------------------------------------------------------------------
export const createAnalysis = async (url, { forceRefresh = false } = {}) => {
  const { data } = await axios.post(
    `${BASE_URL}/adsgpt/landing-page-analyzer/analyze`,
    { url, forceRefresh },
    { headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// List the signed-in user's analyses (lightweight — no result/lastEvent blobs).
// Returns: { success, data: [ { _id, inputUrl, status, createdAt, ... } ] }.
// -----------------------------------------------------------------------------
export const getAnalyses = async ({ page = 1, limit = 12 } = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/landing-page-analyzer/`,
    { params: { page, limit }, headers: headers() },
  );
  return data;
};

// -----------------------------------------------------------------------------
// Fetch one full analysis by id (incl. result + lastEvent). Owner-scoped.
// Returns: { success, data: { _id, inputUrl, status, result, lastEvent, ... } }.
// -----------------------------------------------------------------------------
export const getAnalysisById = async (id) => {
  const { data } = await axios.get(
    `${BASE_URL}/adsgpt/landing-page-analyzer/${id}`,
    { headers: headers() },
  );
  return data;
};
