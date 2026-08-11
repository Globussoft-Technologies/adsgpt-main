const STORAGE_PREFIX = 'adsgpt_selected_facebook_id:';
const ACTIVE_SELECTION_KEY = 'adsgpt_active_facebook_selection';

const storageKey = (userId) => `${STORAGE_PREFIX}${String(userId || '')}`;

export const getSelectedFacebookId = (userId) => {
  if (typeof window === 'undefined') return '';
  if (!userId) return '';
  return window.localStorage.getItem(storageKey(userId)) || '';
};

export const setSelectedFacebookId = (userId, facebookId) => {
  if (typeof window === 'undefined') return;
  const value = facebookId ? String(facebookId) : '';
  const key = storageKey(userId);
  if (value) {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem(
      ACTIVE_SELECTION_KEY,
      JSON.stringify({ userId: String(userId), facebookId: value }),
    );
  } else {
    window.localStorage.removeItem(key);
    const active = getActiveFacebookSelection();
    if (active.userId === String(userId)) {
      window.sessionStorage.removeItem(ACTIVE_SELECTION_KEY);
    }
  }
};

export const clearSelectedFacebookId = (userId, facebookId) => {
  if (!facebookId || getSelectedFacebookId(userId) === String(facebookId)) {
    setSelectedFacebookId(userId, '');
  }
};

const getActiveFacebookSelection = () => {
  if (typeof window === 'undefined') return {};
  try {
    // `JSON.parse` succeeds on the literal strings "null" / "false" / "0",
    // returning a non-object that the callers then read `.facebookId` off.
    // Coalesce anything non-object back to {} so a poisoned sessionStorage
    // value can't crash the app on boot.
    const parsed = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_SELECTION_KEY) || '{}',
    );
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const facebookAccountHeader = (facebookId) => {
  const selectedId =
    facebookId === undefined
      ? getActiveFacebookSelection().facebookId
      : facebookId;
  const facebookIdValue = selectedId ? String(selectedId) : '';
  return facebookIdValue ? { 'X-Facebook-Id': facebookIdValue } : {};
};
