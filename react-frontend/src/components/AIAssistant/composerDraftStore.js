// In-memory cache of each conversation's unsent Composer text, keyed by a
// stable conversation identity (see ChatInterface's `draftKey`). Lives outside
// React/Redux state so switching between History conversations or starting a
// New Chat restores/preserves whatever the user was mid-typing, without a
// Redux dispatch (and the resulting store-wide re-render) on every keystroke.
// Intentionally not persisted beyond the tab's lifetime — reloading the AI
// Assistant already starts a fresh session by design.
const drafts = new Map();

export const getDraft = (key) => drafts.get(key) || '';

export const setDraft = (key, text) => {
  if (!key) return;
  if (text) drafts.set(key, text);
  else drafts.delete(key);
};
