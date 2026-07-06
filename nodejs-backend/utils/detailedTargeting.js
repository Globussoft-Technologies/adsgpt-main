/**
 * detailedTargeting.js — pure transformations between our flat
 * `detailedTargeting` form model and Meta's `flexible_spec` + `exclusions`
 * targeting payload.
 *
 * Pure module: no SDK, no env, no I/O. Safe to import from tests and any
 * controller without dragging the Redis / DB chain in (same architectural
 * call as utils/targetingGeo.js).
 *
 * Form-model (our shape — what the wizard collects):
 *
 *   {
 *     include: [{ type, id, name, audienceSize? }, ...],         // AND'd within
 *     narrow:  [[{ type, id, name }, ...], ...],                 // each array = AND group; groups AND'd in series
 *     exclude: [{ type, id, name }, ...],                        // OR'd within
 *   }
 *
 * Meta-shape (what gets sent on the AdSet):
 *
 *   targeting: {
 *     flexible_spec: [
 *       { interests: [...], behaviors: [...], ... },             // first group = Include
 *       { interests: [...], ... },                               // 2nd+ = Narrow further (AND)
 *     ],
 *     exclusions: { interests: [...], behaviors: [...], ... },   // OR'd within each class
 *   }
 *
 * Meta's flexible_spec semantics: top-level array is AND across groups
 * (every group must match), each group is OR within a class but AND
 * across classes. So:
 *
 *   flexible_spec: [
 *     { interests: [yoga, pilates] },          // (yoga OR pilates)
 *     { behaviors: [frequent_traveler] },      // AND frequent_traveler
 *   ]
 *
 * = "(yoga OR pilates) AND frequent_traveler" — which matches Meta Ads
 * Manager's "Include people who match (yoga or pilates)" → "Narrow audience
 * further (frequent traveler)" UX.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/audiences/reference/detailed-targeting
 */

// Meta's documented detailed-targeting classes — what we pass as `class=`
// to /search?type=adTargetingCategory. Each one shows up in Meta UI under
// one of the three pillar headers (Demographics / Interests / Behaviours)
// with appropriate sub-grouping. Some are region-restricted (e.g. `income`
// is US/EU only) — Meta returns empty results outside their region, which
// we surface cleanly with no error.
//
// Order matters for UI rendering (Meta UI's Browse-panel ordering); keep
// the most-common at the top.
const DETAILED_TARGETING_CLASSES = [
  // Pillar: Interests
  "interests",

  // Pillar: Behaviours
  "behaviors",

  // Pillar: Demographics — broken into sub-classes per Meta's schema
  "demographics",
  "life_events",
  "family_statuses",
  "industries",
  "income",
  "interested_in",
  "work_employers",
  "work_positions",
  "education_schools",
  "education_majors",
  "education_statuses",
  "relationship_statuses",
];

const CLASS_SET = new Set(DETAILED_TARGETING_CLASSES);

// Route-by-ID-shape (data-driven, no class allowlist):
//
// Meta's browse / search responses already encode the routing rule in
// the `id` shape itself:
//
//   • 13+ digit opaque numeric IDs (e.g. "6003584163107") → object-shape
//     items that live inside `flexible_spec` as `{id, name}` pairs.
//     Used for `interests`, `behaviors`, `industries`, `life_events`,
//     `family_statuses`, `income`, `demographics`, work_*, education_schools,
//     education_majors.
//
//   • 1–4 digit small enum codes (e.g. "1" = "At high school") → TOP-LEVEL
//     integer arrays on `targeting`. Used for `education_statuses`,
//     `relationship_statuses`, `interested_in`.
//
// Sending an enum-code item inside flexible_spec fires Meta subcode 1885097
// "Type Mismatch: The type integer is expected but a type array was
// received with value 1At high school." (Meta stringifies the rejected
// `{id, name}` object as `${id}${name}` in its error message — a clue,
// not noise.)
//
// Using the ID shape — rather than a class allowlist — keeps the rule
// self-describing per-item: if Meta returns a small enum code for any
// future class, the routing follows automatically. The signal lives in
// the browse response (see logs/dt-browse-*.json), not in our code.
function isEnumCodeId(id) {
  if (id == null) return false;
  const s = String(id);
  return /^\d{1,4}$/.test(s);
}

// Pillar grouping + class labels intentionally NOT held here. The browse
// response (`path[0]`) already carries the pillar per-item, and the
// frontend picker derives badge labels from `type` directly. Maintaining
// a server-side allowlist for either would duplicate Meta's response
// without serving any real consumer.

// Build the per-class arrays inside a flexible_spec group from a flat
// list of items. Meta groups by class within each spec entry; an empty
// class is omitted to keep the payload tight.
//
// Enum-code items (id matches `isEnumCodeId`) are skipped — those don't
// live inside flexible_spec at all (Meta expects integer arrays at the
// root of `targeting`). They're hoisted by `pickTopLevelIntegerFields`
// and spread by the caller (`buildExplicitTargeting`).
function bucketByClass(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const out = {};
  for (const item of items) {
    if (!item || !CLASS_SET.has(item.type) || !item.id) continue;
    if (isEnumCodeId(item.id)) continue;
    out[item.type] = out[item.type] || [];
    out[item.type].push({ id: String(item.id), name: item.name || String(item.id) });
  }
  return Object.keys(out).length ? out : null;
}

// Pull enum-code items out of a flat list (per `isEnumCodeId`) and return
// a `{class: [int, int]}` object suitable for spreading onto `targeting`.
// Returns null when no enum-code items are present. Dedup is per class
// across the union (Include + Narrow merge).
function pickTopLevelIntegerFields(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const out = {};
  for (const item of items) {
    if (!item || !CLASS_SET.has(item.type) || !isEnumCodeId(item.id)) continue;
    const n = Number(item.id);
    if (!Number.isFinite(n)) continue;
    out[item.type] = out[item.type] || [];
    if (!out[item.type].includes(n)) out[item.type].push(n);
  }
  return Object.keys(out).length ? out : null;
}

// Inverse of bucketByClass — flatten a per-class object into our form's
// flat array. Class becomes `type` on each item.
function unbucketFromClass(perClass) {
  const out = [];
  if (!perClass || typeof perClass !== "object") return out;
  for (const cls of DETAILED_TARGETING_CLASSES) {
    const items = perClass[cls];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      out.push({
        type: cls,
        id: String(item.id),
        name: item.name || String(item.id),
        // audienceSize hint, when Meta included it (Meta only returns it
        // on search responses, not on read-back of saved targeting).
        ...(item.audience_size_lower_bound != null && {
          audienceSize: Number(item.audience_size_lower_bound),
        }),
      });
    }
  }
  return out;
}

/**
 * Convert the wizard's form-model into Meta's targeting payload shape.
 * Returns `null` for any field when the corresponding form section is
 * empty, so callers can spread the result without sending empty arrays
 * Meta might reject.
 *
 * @param {object} detailedTargeting - { include, narrow, exclude }
 * @returns {{ flexible_spec: Array|null, exclusions: object|null, topLevel: object|null }}
 *
 * `topLevel` carries fields Meta requires at the root of `targeting`
 * (NOT inside flexible_spec) — see INTEGER_TOP_LEVEL_CLASSES above.
 * Caller spreads it onto the targeting spec via `Object.assign(spec, topLevel)`.
 *
 * Include + every Narrow group contribute to `topLevel` as a deduped
 * union. Meta has no "narrow further by integer field" semantic because
 * those fields already AND with the rest of targeting, so merging is
 * lossless. Exclude is dropped for integer-array classes — Meta does
 * not accept exclusions for those fields.
 */
function formToFlexibleSpec(detailedTargeting) {
  if (!detailedTargeting || typeof detailedTargeting !== "object") {
    return { flexible_spec: null, exclusions: null, topLevel: null };
  }
  const { include = [], narrow = [], exclude = [] } = detailedTargeting;

  // Build flexible_spec: first group = Include, each subsequent = Narrow.
  // Meta requires the array to be non-empty when present; we omit the
  // field entirely when both Include and Narrow are empty. Items of
  // INTEGER_TOP_LEVEL_CLASSES are skipped here — they get hoisted below.
  const specGroups = [];
  const includeGroup = bucketByClass(include);
  if (includeGroup) specGroups.push(includeGroup);
  for (const narrowGroup of Array.isArray(narrow) ? narrow : []) {
    const bucketed = bucketByClass(narrowGroup);
    if (bucketed) specGroups.push(bucketed);
  }

  // Exclusions is a single bucketed object — Meta OR's within each class.
  const exclusions = bucketByClass(exclude);

  // Top-level integer fields — union across Include + every Narrow group.
  const topLevelSource = [include, ...(Array.isArray(narrow) ? narrow : [])]
    .filter((g) => Array.isArray(g))
    .flat();
  const topLevel = pickTopLevelIntegerFields(topLevelSource);

  return {
    flexible_spec: specGroups.length ? specGroups : null,
    exclusions: exclusions || null,
    topLevel: topLevel || null,
  };
}

/**
 * Inverse: read Meta's targeting payload back into our form-model. Used by
 * `resolveAdSetForEdit` so the wizard's edit flow can round-trip an
 * existing ad set's detailed targeting.
 *
 * Handles two legacy paradigms gracefully:
 *   1. Modern `flexible_spec` array → first group becomes Include, rest Narrow
 *   2. Legacy flat arrays (interests, behaviors, etc.) on the targeting
 *      object itself — fold them into Include so the user can edit + save
 *      and the next launch will use flexible_spec.
 *
 * @param {object} targeting - Meta's targeting object (or a subset)
 * @returns {{ include: Array, narrow: Array<Array>, exclude: Array }}
 */
function flexibleSpecToForm(targeting) {
  const empty = { include: [], narrow: [], exclude: [] };
  if (!targeting || typeof targeting !== "object") return empty;

  const result = { include: [], narrow: [], exclude: [] };

  // Modern path: flexible_spec array.
  if (Array.isArray(targeting.flexible_spec) && targeting.flexible_spec.length) {
    const [first, ...rest] = targeting.flexible_spec;
    result.include = unbucketFromClass(first);
    result.narrow = rest.map(unbucketFromClass).filter((g) => g.length);
  } else {
    // Legacy fallback: flat per-class arrays directly on `targeting`.
    // Meta still accepts these on ad-set create, but the modern paradigm
    // is flexible_spec — once the user saves through our wizard, they'll
    // migrate automatically. Per-item detection by shape: an object item
    // is treated as legacy `{id, name}`; a primitive (int / numeric string)
    // is treated as a top-level enum code and lifted via the same handler
    // as the dedicated block below.
    const legacyBucket = {};
    let hasLegacy = false;
    for (const cls of DETAILED_TARGETING_CLASSES) {
      const arr = targeting[cls];
      if (!Array.isArray(arr) || !arr.length) continue;
      // Top-level integer arrays (primitives) get handled by the dedicated
      // block below — skip here to avoid double-counting.
      if (arr.every((v) => typeof v !== "object")) continue;
      legacyBucket[cls] = arr;
      hasLegacy = true;
    }
    if (hasLegacy) {
      result.include = unbucketFromClass(legacyBucket);
    }
  }

  // Exclusions — Meta's shape is a single object with per-class arrays.
  // No "narrow exclusions" concept (excludes are inherently OR'd).
  if (targeting.exclusions && typeof targeting.exclusions === "object") {
    result.exclude = unbucketFromClass(targeting.exclusions);
  }

  // Top-level enum-code fields. Meta stores these on the root of targeting
  // as integer arrays (e.g. `targeting.education_statuses = [1, 2]`); lift
  // them back into Include so the picker shows previously-saved selections.
  // Detection is by ARRAY shape (every element a primitive) rather than a
  // class allowlist — matches the same data-driven rule used on the way
  // out (`isEnumCodeId`). Chip name degrades to the integer code on
  // read-back (Meta returns no labels for these fields); re-search via
  // the picker re-attaches the localised name from /targetingsearch.
  for (const cls of DETAILED_TARGETING_CLASSES) {
    const arr = targeting[cls];
    if (!Array.isArray(arr) || !arr.length) continue;
    if (!arr.every((v) => typeof v !== "object")) continue;
    for (const c of arr) {
      const n = Number(c);
      if (!Number.isFinite(n)) continue;
      result.include.push({ type: cls, id: String(n), name: String(n) });
    }
  }

  return result;
}

/**
 * Helper for the search-validation flow on edit-load. Given a flat list
 * of items, returns the `targeting_list` payload shape Meta's
 * /act_<AD_ACCOUNT_ID>/targetingvalidation edge expects (corrected
 * 2026-07-06 — originally documented as a `/search?type=
 * adTargetingValidation` call, which doesn't exist and errored on every
 * request) so we can confirm the user's previously-saved targeting items
 * are still valid (Meta removes interest IDs sometimes — silently — and
 * a stale ID at launch is an opaque rejection). Frontend can pass the
 * result to the picker with a "removed by Meta" tag on dead items.
 */
function asTargetingValidationList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && CLASS_SET.has(i.type) && i.id)
    .map((i) => ({ type: i.type, id: String(i.id) }));
}

/**
 * Diff a `targeting_list` payload against Meta's `targetingvalidation`
 * response rows to find items Meta has since discontinued (real trigger:
 * subcode 1870211 "Some detailed targeting options are being
 * discontinued" — Meta rejects publish but doesn't say WHICH item is
 * stale). Pure diff by presence rather than trusting an explicit
 * "invalid" flag from Meta: we don't have a live-confirmed response shape
 * for a discontinued item, but "the input id simply isn't in Meta's
 * output" is the one signal guaranteed to work regardless of shape.
 *
 * @param {{type: string, id: string}[]} targetingList - from asTargetingValidationList
 * @param {{type: string, id: string|number}[]} validRows - Meta's targetingvalidation response rows
 * @returns {{type: string, id: string}[]} items from targetingList Meta did NOT confirm as live
 */
function diffInvalidTargetingItems(targetingList, validRows) {
  const validKeys = new Set(
    (Array.isArray(validRows) ? validRows : [])
      .filter((r) => r && r.id)
      .map((r) => `${r.type}:${String(r.id)}`),
  );
  return (Array.isArray(targetingList) ? targetingList : []).filter(
    (i) => i && !validKeys.has(`${i.type}:${i.id}`),
  );
}

module.exports = {
  DETAILED_TARGETING_CLASSES,
  CLASS_SET,
  formToFlexibleSpec,
  flexibleSpecToForm,
  asTargetingValidationList,
  diffInvalidTargetingItems,
  // Exported for direct testing
  isEnumCodeId,
  bucketByClass,
  unbucketFromClass,
  pickTopLevelIntegerFields,
};
