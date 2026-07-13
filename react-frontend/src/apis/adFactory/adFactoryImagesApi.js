// API client for the "AdFactory images" MySpace view.
//
// Endpoint:
//   GET /adsgpt/campaign/images/:userId — all successful AdFactory images
//     (manual + automatic), plus in-progress placeholders and errored
//     entries. Supports skip/limit pagination and an optional dd-MM-yyyy
//     date range.
//
// Auth follows the project convention: Bearer ${getCookies()} from the
// `access-token` cookie.

import axios from 'axios';
import getCookies from '@/utils/getCookies';

const BASE_URL = `${import.meta.env.VITE_SOCKET_URL}/adsgpt`;

const headers = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

// undefined params are dropped from the query string by axios automatically.
export const getAdFactoryImages = async ({
  userId,
  skip = 0,
  limit = 10,
  startDate,
  endDate,
} = {}) => {
  const { data } = await axios.get(
    `${BASE_URL}/campaign/images/${encodeURIComponent(userId)}`,
    {
      params: { skip, limit, startDate, endDate },
      headers: headers(),
    },
  );
  return data;
};

// Syncs the campaign's manually-added content (images + copies) under the
// central customCreatives key. Sends the FULL current set, which the backend
// $sets — so this captures both additions and removals. Called on Save.
// `images` = [{ data, source }], `copies` = [{ primaryText, headline, description, platform, source }].
export const saveCustomCreatives = async ({ userId, campaignId, images, copies }) => {
  const res = await axios.post(
    `${BASE_URL}/campaign/custom-creatives`,
    { userId, campaignId, images, copies },
    { headers: { ...headers(), 'Content-Type': 'application/json' } },
  );
  return res.data;
};

// Persists a logo-edited (or otherwise altered) AdFactory image so it
// shows up in the campaign's results AND in the user's saved gallery.
// Backend = `saveEditedAdImage` in nodejs-backend/controllers/adFactory.js.
//
// Required: userId, campaignId, imageUrl.
// Optional: historyId + contextType: 'history' to attach to a history
// record instead of the current campaign; prompt for the result label
// (defaults to "Edited image" server-side).
export const saveEditedAdFactoryImage = async ({
  userId,
  campaignId,
  imageUrl,
  historyId,
  contextType,
  prompt,
}) => {
  const { data } = await axios.post(
    `${BASE_URL}/campaign/save-edited-image`,
    { userId, campaignId, imageUrl, historyId, contextType, prompt },
    { headers: { ...headers(), 'Content-Type': 'application/json' } },
  );
  return data;
};
