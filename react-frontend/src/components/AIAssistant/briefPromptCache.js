// Session cache of brand-specific creative briefs.
//
// Regenerating the brief costs a model round-trip, and switching back and forth
// between two brands in the dropdown is a normal thing to do while comparing
// directions. The first switch to a brand pays for the call; every later switch
// back to it is instant.
//
// Keyed by brand + creative type because the brief legitimately differs per
// type — a product shot for Nvidia is not the same brief as a social post for
// Nvidia. Deliberately NOT keyed by the outgoing brief: the whole point is that
// the result depends on the brand being switched TO, not on what happened to be
// on the card at the time.
//
// In memory only. A brief is cheap to regenerate and a stale one across
// sessions would be worse than a fresh call.
const cache = new Map();

const keyFor = (brandName, creativeType) =>
  `${String(brandName || '').trim().toLowerCase()}::${String(creativeType || '').trim().toLowerCase()}`;

export const getCachedBrief = (brandName, creativeType) => {
  if (!brandName) return '';
  return cache.get(keyFor(brandName, creativeType)) || '';
};

export const setCachedBrief = (brandName, creativeType, prompt) => {
  if (!brandName || !prompt) return;
  cache.set(keyFor(brandName, creativeType), prompt);
};

// The user edited the brief by hand, so the cached version for that brand is no
// longer what they want back when they return to it.
export const forgetCachedBrief = (brandName, creativeType) => {
  if (!brandName) return;
  cache.delete(keyFor(brandName, creativeType));
};

export const _clearBriefCache = () => cache.clear(); // tests only
