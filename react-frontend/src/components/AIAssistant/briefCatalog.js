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

// ─── Brand assets (logos / product images) ──────────────────────────────────
// Field spellings vary by endpoint — same tolerance as the agent's brand
// normaliser (Agent/src/utils/brand.py) — and so does the SHAPE: the same key
// arrives as a bare string from one source and an array from another. The
// website scrape returns `brandLogo: ["…/logo-puma-black.png"]`, and the old
// code dropped that value straight into the list, so `.filter(Boolean)` kept
// the ARRAY as if it were a URL. Normalising every field through urlsFrom is
// what makes a logo actually reach the Logo field.
const urlsFrom = (value) =>
  (Array.isArray(value) ? value : value ? [value] : []).filter(
    (u) => typeof u === 'string' && u.trim(),
  );

export const brandLogosOf = (b) => [
  ...urlsFrom(b?.logoUrls),
  ...urlsFrom(b?.brandLogo),
  ...urlsFrom(b?.logoUrl),
  ...urlsFrom(b?.logo),
  ...urlsFrom(b?.iconUrl),
];

export const brandProductImagesOf = (b) => [
  ...urlsFrom(b?.imageUrl),
  ...urlsFrom(b?.imageUrls),
  ...urlsFrom(b?.brandImages),
  // What the website scrape calls its product imagery.
  ...urlsFrom(b?.images),
];

// The single logo to seed the Logo field with, from a saved brand record OR a
// website-scrape response (the two use different keys and shapes).
export const pickLogoUrl = (source) =>
  brandLogosOf(source)[0] ||
  urlsFrom(source?.meta?.logo)[0] ||
  urlsFrom(source?.favicon)[0] ||
  '';

// Ignore case, spacing and punctuation: "H&M", "h & m" and "HM" are one brand.
const brandKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The images to offer for the brand the brief is about.
 *
 * The old rule was `matched.length ? matched : brands` — so ANY brand whose
 * name didn't match a saved record exactly (a website-added brand, or "Acme"
 * vs "Acme Inc.") silently fell back to showing EVERY brand's images. The
 * options then looked identical no matter which brand was selected, which is
 * indistinguishable from "the options don't switch".
 *
 * Now: a named brand only ever offers its OWN assets — matching loosely enough
 * to survive punctuation and suffixes, and offering nothing rather than
 * something else if it can't be found. Only when NO brand is chosen do we show
 * everything, which is a genuinely useful menu rather than a wrong answer.
 */
export const brandAssetsFor = (brands, brandName, { logos = false } = {}) => {
  const list = Array.isArray(brands) ? brands : [];
  const pick = logos ? brandLogosOf : brandProductImagesOf;
  const dedupe = (pool) => [
    ...new Set(pool.flatMap(pick).map(String).filter((u) => u.trim())),
  ];

  const wanted = brandKey(brandName);
  if (!wanted) return dedupe(list);

  let matched = list.filter((b) => brandKey(b?.name) === wanted);
  if (!matched.length) {
    // "Acme" ⇄ "Acme Inc." — one name containing the other is the same brand.
    matched = list.filter((b) => {
      const key = brandKey(b?.name);
      return key && (key.includes(wanted) || wanted.includes(key));
    });
  }
  return dedupe(matched);
};

// ─── Brand-URL analysis failures ────────────────────────────────────────────
// One plain sentence, on OUR side of the fence. An earlier version explained
// the mechanics — "titan.co.in blocked our request, which some sites do
// automatically" — which reads as blaming the user's own brand site and
// exposes plumbing they can do nothing about. Whether the site blocked us,
// timed out, 404'd or we had an outage, the user's next step is identical, so
// there is nothing to gain from telling them which it was.
//
// The one exception is a brand that is ALREADY saved: that isn't a fetch
// failure and it sends them somewhere else (the list), so it keeps its own
// message.
export const brandFetchMessage = (err) => {
  if (err?.response?.status === 409) {
    return 'That brand is already saved — pick it from the list above.';
  }
  return "We're unable to fetch at this moment. Please fill it manually.";
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
