import axios from 'axios';
import getCookies from '@/utils/getCookies';

// All endpoints live under `/voice-selector/*` on the Node backend (see
// nodejs-backend/Router/voiceSelectorRoutes.js). The router is JWT-guarded —
// every wrapper attaches `Authorization: Bearer <token>` via getAuthHeaders.
// Routing through Node also solves the CORS issue we hit when calling
// ElevenLabs / the Python catalog directly from the browser, and keeps the
// xi-api-key off the client.

const BASE_URL = import.meta.env.VITE_SOCKET_URL;
const ROOT = `${BASE_URL}/adsgpt/voice-selector`;

const getAuthHeaders = () => ({
  Authorization: `Bearer ${getCookies()}`,
});

const pickParams = (filters = {}) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    )
  );

export const getVoiceSelectorStats = async () => {
  const { data } = await axios.get(`${ROOT}/stats`, {
    headers: getAuthHeaders(),
  });
  return data;
};

// → [{ code: 'en', label: 'English' }, ...]
// The Python service already returns this shape, so we pass it through
// untouched. (Earlier we tried to map raw codes → objects here; the
// double-transform broke the chip dropdown.)
export const getLanguages = async () => {
  const { data } = await axios.get(`${ROOT}/languages`, {
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// → ['female', 'male']
export const getGenders = async (filters = {}) => {
  const { data } = await axios.get(`${ROOT}/genders`, {
    params: pickParams(filters),
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// → ['american', 'british', ...]
export const getAccents = async (filters = {}) => {
  const { data } = await axios.get(`${ROOT}/accents`, {
    params: pickParams(filters),
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// → ['young', 'middle_aged', 'old']
export const getAges = async (filters = {}) => {
  const { data } = await axios.get(`${ROOT}/ages`, {
    params: pickParams(filters),
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// → [{ voice_id, name, language, gender, accent, age, descriptive, use_case, preview_url }, ...]
export const getVoices = async (filters = {}) => {
  const { data } = await axios.get(`${ROOT}/voices`, {
    params: pickParams(filters),
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// Free-text search across the whole catalog. Escape hatch for languages we
// don't surface in /languages (Telugu, Kannada, Malayalam, …) whose voices are
// cataloged under English/Hindi — the target language only shows in the name.
// → [{ voice_id, name, language, accent, gender, preview_url }, ...]
export const searchVoices = async (q) => {
  const term = (q || '').trim();
  if (!term) return [];
  const { data } = await axios.get(`${ROOT}/search`, {
    params: { q: term },
    headers: getAuthHeaders(),
  });
  return Array.isArray(data) ? data : [];
};

// Code → name map for the language dropdown. The catalog returns ISO codes
// like "en" / "hi"; the UI shows English names. Anything not in the map
// falls back to the raw code so a new ElevenLabs language never breaks the
// dropdown — it just renders as the code until we extend the map.
export const LANGUAGE_NAMES = {
  ar: 'Arabic',
  bg: 'Bulgarian',
  bn: 'Bengali',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  fi: 'Finnish',
  fil: 'Filipino',
  fr: 'French',
  gu: 'Gujarati',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  kn: 'Kannada',
  ko: 'Korean',
  ml: 'Malayalam',
  mr: 'Marathi',
  ms: 'Malay',
  nl: 'Dutch',
  no: 'Norwegian',
  pa: 'Punjabi',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  sk: 'Slovak',
  sl: 'Slovenian',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

export const labelForLanguage = (code) =>
  LANGUAGE_NAMES[code] || (code ? code.toUpperCase() : '');

// Cosmetic helper for gender / accent / age — the API returns lowercased
// machine values. Display them title-cased and with underscores replaced.
export const prettify = (value) => {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
