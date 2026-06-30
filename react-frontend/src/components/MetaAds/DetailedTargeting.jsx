/**
 * DetailedTargeting.jsx — top-level Detailed Targeting container that
 * mirrors Meta Ads Manager's "Detailed targeting" surface.
 *
 * Three sections, each a `<DetailedTargetingPicker>`:
 *   1. Include people who match — `value.include`
 *   2. Narrow audience — `value.narrow` (array of AND-groups; users can
 *      add multiple to layer additional must-match criteria)
 *   3. Exclude people who match — `value.exclude`
 *
 * Plus:
 *   • "Browse" drawer (`<DetailedTargetingBrowse>`) — categorical tree
 *   • Suggestions row — Meta's related-items recommendations based on
 *     what's already in Include + Narrow
 *
 * SAC interaction: the parent decides whether to mount this component
 * (regulated SACs hide Detailed Targeting entirely per spec §6i). When
 * Advantage+ Audience is on, the section title relabels to "Audience
 * suggestions" — matches Meta UI's exact wording.
 *
 * Form-model shape (value):
 *   { include: [item, ...], narrow: [[item, ...], ...], exclude: [item, ...] }
 * where item = { type, id, name, audienceSize?, path? }
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Sparkles, Loader2 } from 'lucide-react';
import DetailedTargetingPicker, { typeBadge } from './DetailedTargetingPicker';
import { suggestDetailedTargeting } from '@/apis/metaAds/metaAdsApi';

const EMPTY = { include: [], narrow: [], exclude: [] };

export default function DetailedTargeting({
  // Required — all four backend endpoints (search / browse / suggestions /
  // validation) are scoped to the ad-account node per Meta docs.
  adAccountId,
  value = EMPTY,
  onChange,
  // When Advantage+ Audience is on, Meta relabels the section
  // "Audience suggestions" (detailed targeting becomes hint, not constraint).
  advantageAudienceOn = true,
  disabled = false,
}) {
  // Suggestions — fetched whenever Include or Narrow changes (debounced).
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const sectionTitle = advantageAudienceOn
    ? 'Audience suggestions'
    : 'Detailed targeting';
  const sectionHint = advantageAudienceOn
    ? "Meta's Advantage+ audience will use these as a starting point and may expand beyond them when it improves performance."
    : 'Add demographics, interests or behaviours to define who sees your ad.';

  const setSlot = useCallback(
    (slot, updater) => {
      const cur = value || EMPTY;
      const nextSlot =
        typeof updater === 'function' ? updater(cur[slot]) : updater;
      onChange?.({ ...cur, [slot]: nextSlot });
    },
    [value, onChange],
  );

  const setNarrowGroup = useCallback(
    (idx, items) => {
      const cur = value || EMPTY;
      const narrow = (cur.narrow || []).slice();
      narrow[idx] = items;
      onChange?.({ ...cur, narrow });
    },
    [value, onChange],
  );

  const addNarrowGroup = useCallback(() => {
    const cur = value || EMPTY;
    onChange?.({ ...cur, narrow: [...(cur.narrow || []), []] });
  }, [value, onChange]);

  const removeNarrowGroup = useCallback(
    (idx) => {
      const cur = value || EMPTY;
      const narrow = (cur.narrow || []).filter((_, i) => i !== idx);
      onChange?.({ ...cur, narrow });
    },
    [value, onChange],
  );

  // Suggestions — debounced refetch whenever Include or Narrow content
  // changes. Skipped when no items picked (the endpoint wants a non-empty
  // targeting_list). Exclude items NOT used as suggestion seeds (Meta's
  // API doesn't accept exclude-style seeds).
  useEffect(() => {
    const cur = value || EMPTY;
    const seedItems = [
      ...cur.include,
      ...(cur.narrow || []).flat(),
    ];
    if (!seedItems.length || !adAccountId) {
      setSuggestions([]);
      return undefined;
    }
    setLoadingSuggestions(true);
    const t = setTimeout(async () => {
      try {
        const r = await suggestDetailedTargeting({
          adAccountId,
          items: seedItems.map((i) => ({ type: i.type, id: i.id })),
        });
        // Strip any suggestions that are already picked in any section.
        const cur = value || EMPTY;
        const existing = new Set(
          [...cur.include, ...(cur.narrow || []).flat(), ...cur.exclude].map(
            (i) => `${i.type}:${i.id}`,
          ),
        );
        const fresh = (r?.suggestions || []).filter(
          (s) => !existing.has(`${s.type}:${s.id}`),
        );
        setSuggestions(fresh);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 600);
    return () => clearTimeout(t);
    // value is the canonical source for the suggestion seeds; depending
    // on it alone is correct here.
  }, [adAccountId, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSuggestionToInclude = useCallback(
    (s) => {
      const cur = value || EMPTY;
      const k = `${s.type}:${s.id}`;
      if (cur.include.some((i) => `${i.type}:${i.id}` === k)) return;
      onChange?.({
        ...cur,
        include: [
          ...cur.include,
          {
            type: s.type,
            id: String(s.id),
            name: s.name,
            ...(s.audienceSize != null && { audienceSize: s.audienceSize }),
            ...(Array.isArray(s.path) && s.path.length && { path: s.path }),
          },
        ],
      });
    },
    [value, onChange],
  );

  const v = value || EMPTY;

  return (
    <div className="flex flex-col gap-4">
      {/* Section heading */}
      <div>
        <h4 className="text-14 font-semibold text-gray-900 dark:text-white">
          {sectionTitle}
        </h4>
        <p className="mt-0.5 text-12 text-gray-500 dark:text-white/55">
          {sectionHint}
        </p>
      </div>

      {/* Include section */}
      <div className="rounded-2xl border border-gray-200 p-3 dark:border-white/10">
        <p className="mb-2 text-12 font-medium text-gray-700 dark:text-white/70">
          Include people who match
        </p>
        <DetailedTargetingPicker
          adAccountId={adAccountId}
          value={v.include}
          onChange={(next) => setSlot('include', next)}
          placeholder="Add demographics, interests or behaviours"
          disabled={disabled}
        />

        {/* Narrow groups — additional AND constraints (Meta's "Narrow further") */}
        {(v.narrow || []).map((group, idx) => (
          <div
            key={`narrow-${idx}`}
            className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-white/15 dark:bg-white/2"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-11 font-semibold uppercase tracking-wide text-gray-500 dark:text-white/55">
                AND must also match
              </p>
              <button
                type="button"
                onClick={() => removeNarrowGroup(idx)}
                disabled={disabled}
                className="rounded-full p-1 text-gray-500 hover:bg-gray-200 dark:text-white/55 dark:hover:bg-white/10"
                aria-label="Remove narrow group"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <DetailedTargetingPicker
              adAccountId={adAccountId}
              value={group}
              onChange={(next) => setNarrowGroup(idx, next)}
              placeholder="Add criteria that must ALSO match"
              disabled={disabled}
            />
          </div>
        ))}

        {/* Add-narrow button — only enabled when Include has at least one
            item (Meta UI's exact rule — narrowing without a base is meaningless). */}
        {v.include.length > 0 && (
          <button
            type="button"
            onClick={addNarrowGroup}
            disabled={disabled}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-12 font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white/70 dark:hover:border-white/25 dark:hover:bg-white/5"
          >
            <Plus className="h-3.5 w-3.5" />
            Narrow audience further
          </button>
        )}
      </div>

      {/* Exclude section removed 2026-06-30 — Meta UI hides it entirely
          under Advantage+ Audience (the default in our wizard). The
          form-model still has `value.exclude: []` (always empty now)
          and the backend payload-build path still handles exclusions if
          they exist, so flipping this back on is a one-block re-mount
          if a future cell needs it. Behind-the-scenes value.exclude
          stays at its default empty array via the EMPTY sentinel. */}

      {/* Related-item suggestions row — Meta's "Suggestions" panel. Only
          renders when Include or Narrow has seed items. */}
      {(v.include.length > 0 || (v.narrow || []).flat().length > 0) && (
        <div className="rounded-2xl border border-gray-200 p-3 dark:border-white/10">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
            <p className="text-12 font-medium text-gray-700 dark:text-white/70">
              Suggestions
            </p>
            {loadingSuggestions && (
              <Loader2 className="h-3 w-3 animate-spin text-gray-500 dark:text-white/55" />
            )}
          </div>
          {suggestions.length === 0 && !loadingSuggestions ? (
            <p className="text-11 text-gray-500 dark:text-white/45">
              No related suggestions for your current selections.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 12).map((s) => {
                // Pass the suggestion object so badge color reads from path[0].
                const badge = typeBadge(s);
                return (
                  <button
                    type="button"
                    key={`${s.type}:${s.id}`}
                    onClick={() => addSuggestionToInclude(s)}
                    disabled={disabled}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-12 text-gray-900 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/2 dark:text-white dark:hover:border-white/25 dark:hover:bg-white/5"
                  >
                    <Plus className="h-3 w-3 text-gray-500 group-hover:text-gray-700 dark:text-white/55 dark:group-hover:text-white" />
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-10 font-semibold uppercase tracking-wide ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    <span className="max-w-[20ch] truncate">{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal Browse drawer removed 2026-06-29 — the inline pillar tree
          inside each <DetailedTargetingPicker> now provides categorical
          browsing (matching Meta UI's "Include people who match" UX
          where Demographics / Interests / Behaviours appear as
          collapsible rows below the search input). */}
    </div>
  );
}
