const axios = require("axios");

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

let cache = null;
let inflight = null;

function extractUsers(data) {
  if (!data || typeof data !== "object") return [];
  const values = Array.isArray(data) ? data : Object.values(data);
  return values.filter(
    (value) => value && typeof value === "object" && value.user_id !== undefined,
  );
}

function normalizeDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:\s|T|$)/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

// aMember stores the signup number in `mobile_number`, with the dial code kept
// separately in `mobile_area_code` as "US+1" / "IN+91" (ISO country + dial).
// The built-in `phone` column is legacy - only the oldest members ever filled
// it, and no member has both.
function normalizeContactNo(raw) {
  const mobile = String(raw?.mobile_number || "").replace(/\D/g, "");
  if (!mobile) return String(raw?.phone || "").trim() || null;

  const dial = /\+(\d{1,4})\s*$/.exec(String(raw?.mobile_area_code || ""))?.[1];
  if (!dial) return mobile;

  // Some members typed the dial code into the number as well. NANP is the only
  // case we can strip safely: a US national number never starts with 1, so a
  // leading 1 on an 11-digit value is the country code. Elsewhere the dial code
  // collides with real national prefixes (an Indian mobile starting 91... is
  // not +91 repeated), so leave those untouched rather than mangle them.
  const national =
    dial === "1" && mobile.length === 11 && mobile.startsWith("1") ? mobile.slice(1) : mobile;
  return `+${dial} ${national}`;
}

function normalizeMember(raw) {
  const memberId = String(raw?.user_id ?? "").trim();
  if (!memberId) return null;
  return {
    memberId,
    email: String(raw?.email || "").trim(),
    contactNo: normalizeContactNo(raw),
    signUpDate: normalizeDateOnly(raw?.added),
  };
}

function resolveConfig() {
  const baseUrl = String(process.env.AMEMBER_BASE_API_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.AMEMBER_API_KEY;
  if (!baseUrl || !apiKey) {
    const error = new Error("aMember user directory is not configured");
    error.code = "AMEMBER_NOT_CONFIGURED";
    throw error;
  }
  return { baseUrl, apiKey };
}

async function loadAllMembers(httpClient) {
  const { baseUrl, apiKey } = resolveConfig();
  const byId = new Map();
  let page = 0;
  let total = null;

  do {
    const response = await httpClient.get(`${baseUrl}/users`, {
      params: { _key: apiKey, _count: PAGE_SIZE, _page: page },
      timeout: 10000,
    });
    const rows = extractUsers(response.data);
    if (total === null && Number.isFinite(Number(response.data?._total))) {
      total = Number(response.data._total);
    }
    rows.forEach((row) => {
      const member = normalizeMember(row);
      if (member) byId.set(member.memberId, member);
    });
    page += 1;
    if (rows.length < PAGE_SIZE) break;
  } while ((total === null || byId.size < total) && page < MAX_PAGES);

  return Array.from(byId.values());
}

async function fetchAllMembers({ httpClient = axios, now = Date.now() } = {}) {
  if (cache && now < cache.expiresAt) {
    return { members: cache.members, stale: false };
  }
  if (inflight) return inflight;

  inflight = loadAllMembers(httpClient)
    .then((members) => {
      cache = { members, expiresAt: now + CACHE_TTL_MS };
      return { members, stale: false };
    })
    .catch((error) => {
      if (cache?.members) return { members: cache.members, stale: true, error };
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

function resetCache() {
  cache = null;
  inflight = null;
}

module.exports = {
  fetchAllMembers,
  _internals: {
    CACHE_TTL_MS,
    PAGE_SIZE,
    extractUsers,
    normalizeDateOnly,
    normalizeContactNo,
    normalizeMember,
    resetCache,
  },
};
