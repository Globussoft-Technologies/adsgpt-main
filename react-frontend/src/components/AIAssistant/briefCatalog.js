// Pure logic behind the creative-brief card, kept out of the component so it
// can be reasoned about (and exercised) on its own. No React, no imports.

// ─── Model / quality / aspect-ratio catalogue ───────────────────────────────
// The card's catalogue comes from the `ad_creative` surface the BROWSER fetches
// (useAdCreativeConfig → /usage/model-credit-value) — the same source Ad Studio
// and the Profile credit table read, so the three can't disagree. The copy the
// agent inlines on the form is the fallback for when that fetch fails.
//
// "Auto (best available)" is the card's DEFAULT model and is NOT a row in the
// surface: the agent synthesises it (chat.py `_attach_credit_costs`) and so must
// we. Omitting it left `auto` with no config at all — the aspect-ratio field
// fell back to the MCP's full hardcoded list, so every model looked like it
// offered the same ratios, and the credit figure stopped tracking the quality
// tier. Auto = the union of every model's ratios and the MAX credit per tier,
// which is what graph.credit_for actually freezes.
export const buildModelConfigs = (surfaceModels, inlinedFallback) => {
  if (!surfaceModels?.length) {
    return Array.isArray(inlinedFallback) ? inlinedFallback : [];
  }
  const real = surfaceModels.map((m) => ({
    value: m.apiId,
    label: m.label,
    aspect_ratios: Array.isArray(m.aspectRatios) ? m.aspectRatios : [],
    qualities: Array.isArray(m.qualities) ? m.qualities : [],
    credits_by_quality: m.creditsByQuality || {},
  }));

  const autoRatios = [...new Set(real.flatMap((m) => m.aspect_ratios))];
  const autoCredits = {};
  real.forEach((m) => {
    Object.entries(m.credits_by_quality).forEach(([quality, cost]) => {
      if (typeof cost !== 'number') return;
      autoCredits[quality] = Math.max(autoCredits[quality] ?? cost, cost);
    });
  });

  return [
    {
      value: 'auto',
      label: 'Auto (best available)',
      aspect_ratios: autoRatios,
      qualities: Object.keys(autoCredits),
      credits_by_quality: autoCredits,
    },
    ...real,
  ];
};

// {model: {quality: credits}} — derived from the SAME list the picker renders,
// so "auto" can't drift out of sync with it.
export const buildCreditCostsByQuality = (modelConfigs, surfaceModels, inlinedFallback) => {
  if (!surfaceModels?.length) return inlinedFallback;
  const out = {};
  modelConfigs.forEach((m) => {
    if (m.value) out[m.value] = m.credits_by_quality || {};
  });
  return out;
};

// ─── Brand-URL analysis failures ────────────────────────────────────────────
// One generic "couldn't analyze that website" for every failure told the user
// nothing: they couldn't tell a typo from a site that blocks scrapers from our
// service being down, so they had no idea whether retrying was worth it. Name
// the host, say what happened, and give the next step — including the way out
// (fill the brand in by hand), which is always available.
export const brandFetchMessage = (err, site) => {
  const status = err?.response?.status;
  let host = site || 'that site';
  try {
    host = new URL(site).hostname.replace(/^www\./, '');
  } catch {
    /* keep the raw string */
  }
  const backend = err?.response?.data?.message;

  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return `${host} took too long to respond. It may be slow or blocking automated visits — try again, or enter the brand details manually.`;
  }
  if (status === 404) {
    return `We couldn't find ${host}. Check the address for a typo and try again.`;
  }
  if (status === 401 || status === 403) {
    return `${host} blocked our request, which some sites do automatically. Enter the brand details manually to continue.`;
  }
  if (status === 422 || status === 400) {
    return backend || `${host} doesn't look like a valid website address. Include the full domain, e.g. example.com.`;
  }
  if (status >= 500) {
    return `We couldn't reach ${host} just now — this one is on us. Try again in a moment, or enter the brand details manually.`;
  }
  if (err?.message === 'Network Error') {
    return `Couldn't reach ${host} — check your connection and try again.`;
  }
  return backend || `We couldn't read ${host}. Check the address, or enter the brand details manually to carry on.`;
};

// ─── Keeping the brief in step with its selections ──────────────────────────
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Acme Inc." → ["Acme Inc.", "Acme"]. Longest first so the fuller name wins.
export const brandNameVariants = (name) => {
  const full = (name || '').trim();
  if (!full) return [];
  const variants = [full];
  const firstWord = full.split(/[\s,]+/)[0]?.replace(/[.,]$/, '');
  // A 1-2 character first word ("A", "H&") is too generic to swap on.
  if (firstWord && firstWord.length > 2 && firstWord.toLowerCase() !== full.toLowerCase()) {
    variants.push(firstWord);
  }
  return variants;
};

export const mentions = (text, name) =>
  !!name &&
  new RegExp(`(^|[^\\w])${escapeRe(name)}(?=[^\\w]|$)`, 'i').test(String(text || ''));

// The brief's prompt is prose the agent wrote for ONE creative type and ONE
// brand. Changing either left it describing the old one, so the card looked
// unchanged and the brief read wrong.
//
// We don't rewrite the user's sentences (that's a model's job and risks making
// them worse) — we maintain single trailing markers, replaced on each change so
// they never stack. Plain text, so "restore previous" still undoes it.
const CREATIVE_TYPE_MARKER = /\s*Creative type:\s*[^.]*\.\s*$/i;
const BRAND_MARKER = /\s*Brand:\s*[^.]*\.\s*/gi;

const stripMarkers = (text) =>
  String(text || '')
    .replace(CREATIVE_TYPE_MARKER, '')
    .replace(BRAND_MARKER, ' ')
    .replace(/\s{2,}/g, ' ')
    .trimEnd();

// Re-append whichever markers apply, in a stable order, so switching brand and
// creative type repeatedly can't accumulate or reorder them.
const withMarkers = (base, { brand, creativeType }) => {
  let out = String(base || '').replace(/[.\s]+$/, '');
  if (!out) return '';
  if (brand) out += `. Brand: ${brand}`;
  if (creativeType) out += `. Creative type: ${creativeType}`;
  return `${out}.`;
};

export const creativeTypeLabel = (value) => (value || '').replace(/_/g, ' ').trim();

// Switching creative type: keep the prose, restate the type.
export const applyCreativeTypeToPrompt = (text, typeValue, brandName = '') => {
  const base = stripMarkers(text);
  if (!base) return base;
  return withMarkers(base, {
    brand: mentions(base, brandName) ? '' : (brandName || '').trim(),
    creativeType: creativeTypeLabel(typeValue),
  });
};

// Switching brand: rename every plausible spelling of the outgoing brand. An
// exact `brand_name` swap alone wasn't enough — the prompt often names the
// brand differently to the saved record ("Acme" vs "Acme Inc"), and when the
// agent left `brand_name` empty there was nothing to match at all, so the
// prompt stayed on the old brand. When nothing matches we state the new brand
// rather than silently doing nothing.
export const applyBrandToPrompt = (text, oldNames, to, creativeTypeValue = '') => {
  const before = stripMarkers(text);
  const newName = (to || '').trim();
  if (!before.trim() || !newName) return String(text || '');

  const typeLabel = creativeTypeLabel(creativeTypeValue);
  if (mentions(before, newName)) {
    return withMarkers(before, { brand: '', creativeType: typeLabel });
  }

  let out = before;
  let renamed = false;
  const candidates = [...new Set((oldNames || []).flatMap(brandNameVariants))]
    .filter((n) => n && n.toLowerCase() !== newName.toLowerCase())
    .sort((a, b) => b.length - a.length);

  candidates.forEach((oldName) => {
    // \b doesn't work around names with punctuation ("H&M"), so guard on
    // non-word neighbours instead.
    const re = new RegExp(`(^|[^\\w])${escapeRe(oldName)}(?=[^\\w]|$)`, 'gi');
    if (re.test(out)) {
      renamed = true;
      out = out.replace(re, (_m, lead) => `${lead}${newName}`);
    }
  });

  return withMarkers(out, {
    brand: renamed ? '' : newName,
    creativeType: typeLabel,
  });
};
