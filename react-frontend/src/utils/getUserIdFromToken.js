import getCookies from './getCookies';

/**
 * Helper to safely extract the user_id from the stored JWT access token.
 *
 * The backend's authenticateJWT middleware applies a prefix to user_id before
 * storing in MongoDB:
 *   created_from === 'PAS' → 'PAS-<user_id>'
 *   created_from === 'GPT' → 'GPT-<user_id>'
 *
 * We mirror that transformation here so the frontend sends the correct userId
 * to the onboarding API, matching what is stored in MongoDB.
 */
export default function getUserIdFromToken() {
  const token = getCookies();
  if (!token) return null;
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const parsed = JSON.parse(jsonPayload);
    const rawId = parsed.user_id || parsed.id || null;
    if (!rawId) return null;

    // Mirror the prefix logic from backend authenticateJWT (authService.js)
    if (parsed.created_from === 'PAS') return `PAS-${rawId}`;
    if (parsed.created_from === 'GPT') return `GPT-${rawId}`;

    return String(rawId);
  } catch {
    return null;
  }
}
