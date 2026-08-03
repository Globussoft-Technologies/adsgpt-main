// Cache of each conversation's unsent Composer text, keyed by a stable
// conversation identity (see ChatInterface's `draftKey`). Lives outside
// React/Redux state so switching between History conversations or starting a
// New Chat restores/preserves whatever the user was mid-typing, without a
// Redux dispatch (and the resulting store-wide re-render) on every keystroke.
//
// Backed by localStorage so a draft survives a reload or navigating away and
// back — it should only be lost when the user logs out, and `hooks/logout.js`
// already calls localStorage.clear(). The in-memory Map stays in front of it as
// the read path, so typing never pays a storage round-trip.
const STORAGE_KEY = 'adsgpt.assistant.composerDrafts';

const drafts = new Map();

// localStorage throws in private-mode Safari and when the quota is full, and
// the stored blob can be corrupted by an older/newer format. A draft is a
// convenience, never worth breaking the composer over — every access is
// best-effort and silently degrades to the in-memory Map.
let persistedOnce = false;

const hydrate = () => {
  if (persistedOnce) return;
  persistedOnce = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    Object.entries(parsed).forEach(([key, text]) => {
      if (typeof text === 'string' && text) drafts.set(key, text);
    });
  } catch {
    /* unreadable or unavailable — carry on with an empty cache */
  }
};

const persist = () => {
  try {
    if (drafts.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    /* quota/private mode — the in-memory cache still works for this tab */
  }
};

export const getDraft = (key) => {
  hydrate();
  return drafts.get(key) || '';
};

export const setDraft = (key, text) => {
  if (!key) return;
  hydrate();
  if (text) drafts.set(key, text);
  else drafts.delete(key);
  persist();
};
