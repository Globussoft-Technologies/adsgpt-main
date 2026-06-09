// API client for the AI Creatives flow.
//
// Responsibility split (Option A — "thin gateway"):
//   - Brand list  : called directly from the browser against poweradspy.
//   - Autofill    : called directly from the browser against autofill.adsgpt.io.
//   - Generate    : called against our Go backend, which then talks to Gemini + S3.

import getCookies from '@/utils/getCookies';
import store from '@/store/store';

const env = import.meta.env;

const BRAND_API_BASE = env.VITE_BRAND_API_BASE ?? env.VITE_SOCKET_URL;
const AUTOFILL_API_BASE = env.VITE_AD_FACTORY_WEB_URL_AUTOFILL;
const GO_BACKEND_URL = env.VITE_GO_BACKEND_URL ?? 'http://localhost:8001';

// Resolve auth at request time: prefer the live access-token cookie (set by the
// real login flow) and the user_id pushed into Redux by the socket handshake;
// fall back to .env.local values for local dev when not logged in.
export function getAuthToken() {
  return getCookies() || env.VITE_DEV_AUTH_TOKEN || '';
}

export function getUserId() {
  const stateUserId = store.getState()?.socket?.userData?.user_id;
  return stateUserId || env.VITE_DEV_USER_ID || 'GPT-165';
}

// ── Brand list ─────────────────────────────────────────────────────────────

export async function fetchBrandList(userId, authToken, signal) {
  if (!authToken) throw new Error('Missing auth token');
  const url = `${BRAND_API_BASE}/adsgpt/brand/get-lists?userId=${encodeURIComponent(
    userId
  )}&skip=0&limit=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/json',
    },
    signal,
  });
  // if (!res.ok) throw new Error(`Brand list failed (${res.status})`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? []);
}

// ── Prompt templates ───────────────────────────────────────────────────────

// GET /adsgpt/prompt-templates?type=<type> — returns the curated prompt list
// shown in the "Templates" picker next to the Prompt label. `type` is one of
// lifestyle, product_shot, apps_saas, brand_awareness, ai_custom.
export async function fetchPromptTemplates(type, signal) {
  const authToken = getAuthToken();
  if (!authToken) throw new Error('Missing auth token');
  const url = `${BRAND_API_BASE}/adsgpt/prompt-templates?type=${encodeURIComponent(type)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: 'application/json',
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Failed to load templates (${res.status})`);
  }
  const json = await res.json();
  const templates = Array.isArray(json?.templates) ? json.templates : [];
  return templates;
}

// ── Autofill ───────────────────────────────────────────────────────────────

export const AUTOFILL_FAILURE_MESSAGE = 'Website fetching failed. Please add manually.';

export async function fetchAutofill(websiteUrl, signal) {
  let res;
  try {
    res = await fetch(`${AUTOFILL_API_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website_url: websiteUrl }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(AUTOFILL_FAILURE_MESSAGE);
  }
  if (!res.ok) throw new Error(AUTOFILL_FAILURE_MESSAGE);
  return await res.json();
}

// ── Generate (Go backend) ──────────────────────────────────────────────────

export async function generateAiCreatives(payload, signal) {
  const res = await fetch(`${GO_BACKEND_URL}/ai-creatives/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    let detail = `Generate failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* swallow */
    }
    throw new Error(detail);
  }
  const body = await res.json();
  if (body.status === 'failed') {
    throw new Error(body.error ?? 'Generation failed');
  }
  return body;
}

// ── Mapping helpers ────────────────────────────────────────────────────────

export function brandListItemToBrandInfo(item) {
  return {
    brand_name: item.name || null,
    brand_description: item.description || null,
    brand_logo: item.logoUrls?.[0] ?? null,
    brand_voice: [],
    tone_of_voice: null,
    color_palette: [],
    dos: [],
    donts: [],
  };
}

export function autofillToBrandInfo(a) {
  return {
    brand_name: a.brandInfo.brandName || null,
    brand_description: a.brandInfo.brandDescription || null,
    brand_logo: a.brandInfo.brandLogo?.[0] ?? null,
    brand_voice: a.brandInfo.brandVoice ?? [],
    tone_of_voice: a.brandInfo.brandGuidelines?.toneOfVoice || null,
    color_palette: a.brandInfo.brandGuidelines?.colorPalette ?? [],
    dos: a.brandInfo.brandGuidelines?.dos ?? [],
    donts: a.brandInfo.brandGuidelines?.donts ?? [],
  };
}

export function autofillToObjectives(a) {
  return {
    core_idea: a.objectives.coreIdea || null,
    target_audience: a.objectives.targetAudience ?? [],
    call_to_action: null,
    additional_guidelines: a.objectives.additionalGuidelines || null,
  };
}

export const EMPTY_BRAND_INFO = {
  brand_name: null,
  brand_description: null,
  brand_logo: null,
  brand_voice: [],
  tone_of_voice: null,
  color_palette: [],
  dos: [],
  donts: [],
};

export const EMPTY_OBJECTIVES = {
  core_idea: null,
  target_audience: [],
  call_to_action: null,
  additional_guidelines: null,
};
