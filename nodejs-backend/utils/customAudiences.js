/**
 * customAudiences — the targeting-spec slice for Custom Audiences.
 *
 * A Custom Audience is a SOURCE of people (customer list, website/pixel
 * traffic, engagement, or a lookalike derived from one). It is NOT the same
 * object as a Saved Audience, which is a saved targeting CONFIGURATION that
 * may reference custom audiences inside it. They live on different Meta edges
 * (`/customaudiences` vs `/saved_audiences`) and a custom audience never
 * appears in the saved-audience list — which is why a user with one in Meta
 * could not find it anywhere in the wizard.
 *
 * Pure module, deliberately: `buildExplicitTargeting` lives inside
 * metaAdLauncherV2.js, which opens DB and Redis connections at require time,
 * so nothing in it can be unit-tested. Keeping this piece out here means the
 * shape AND the special-ad-category rule below are both covered by tests.
 * Same reasoning as promotedObject.js and objectStorySpec.js.
 */

/**
 * buildCustomAudienceTargeting — the `custom_audiences` /
 * `excluded_custom_audiences` fragment of a Meta targeting spec.
 *
 * @param {object} targeting  wizard form targeting: `customAudiences` and
 *   `excludedCustomAudiences` are arrays of `{id, name, ...}`.
 * @param {object} opts
 * @param {boolean} opts.blocked  true when the campaign's special ad category
 *   forbids audience targeting. The CALLER decides this, using the same
 *   regulated-SAC set that hides Detailed Targeting, so there is one place in
 *   the codebase that answers "is this campaign regulated" rather than two
 *   that can drift.
 *
 * @returns {object} a fragment to merge onto the spec — `{}` when there is
 *   nothing to add, so the caller can always spread it.
 */
function buildCustomAudienceTargeting(targeting, opts = {}) {
  // Regulated categories (housing / employment / credit / financial products /
  // politics) restrict audience-based targeting for the same
  // anti-discrimination reason they restrict interests: Meta removed
  // lookalikes for these outright, and the Special Ad Audience that replaced
  // them has since been retired too.
  //
  // Exactly WHICH custom-audience subtypes Meta still permits under a
  // regulated SAC is not something we have verified against their own UI, so
  // this takes the restrictive path. Being more restrictive than Meta costs a
  // user one targeting option; being less restrictive costs them a rejected
  // launch they cannot diagnose from the error.
  if (opts.blocked) return {};

  const t = targeting || {};

  // Meta wants bare `{id}` objects. The form carries `{id, name, subtype, …}`
  // so the picker can render chips — including on edit-load, where the
  // alternative is one lookup per audience just to show a label — and all of
  // that display metadata is dropped here.
  //
  // Ids are de-duplicated: Meta rejects the whole ad set if the same audience
  // appears twice, and a user can easily add one from search and again from a
  // suggestion.
  const toRefs = (list) => {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
      const id = String(item?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id });
    }
    return out;
  };

  const included = toRefs(t.customAudiences);
  const excluded = toRefs(t.excludedCustomAudiences);

  const spec = {};
  // Only emit a key when it has content. An empty array is not the same as an
  // absent field to Meta, and sending `custom_audiences: []` on an ad set that
  // previously had audiences is how an edit silently widens the targeting.
  if (included.length) spec.custom_audiences = included;
  if (excluded.length) spec.excluded_custom_audiences = excluded;
  return spec;
}

/**
 * readCustomAudienceTargeting — the inverse, for edit-load.
 *
 * Meta returns `custom_audiences: [{id, name}]` on a read (it enriches the
 * bare ids we sent with names), so an edit can re-render chips without a
 * lookup. Anything missing a name still round-trips: the picker falls back to
 * showing the id, which is better than dropping the audience entirely and
 * silently widening the ad set's targeting on save.
 */
function readCustomAudienceTargeting(metaTargeting) {
  const t = metaTargeting || {};
  const fromMeta = (list) =>
    (Array.isArray(list) ? list : [])
      .map((a) => {
        const d = a?._data || a || {};
        const id = String(d.id || "").trim();
        return id ? { id, name: d.name || "" } : null;
      })
      .filter(Boolean);

  return {
    customAudiences: fromMeta(t.custom_audiences),
    excludedCustomAudiences: fromMeta(t.excluded_custom_audiences),
  };
}

module.exports = {
  buildCustomAudienceTargeting,
  readCustomAudienceTargeting,
};
