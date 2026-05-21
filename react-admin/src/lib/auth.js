const STORAGE_KEY = "adsgpt_admin_token";

export function getAdminToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAdminToken() {
  setAdminToken("");
}

export function isAuthenticated() {
  return !!getAdminToken();
}
