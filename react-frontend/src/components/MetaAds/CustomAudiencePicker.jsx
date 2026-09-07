/**
 * CustomAudiencePicker — include / exclude the Custom Audiences an advertiser
 * already built in Meta.
 *
 * This is Tier 1 of custom audiences: USE what exists. Creating audiences (and
 * especially customer-list upload, which handles PII) is deliberately not here.
 *
 * Worth stating because it caused the original confusion: a Custom Audience is
 * a SOURCE of people (customer list, website/pixel traffic, engagement, or a
 * lookalike derived from one). A Saved Audience — the picker above this one —
 * is a saved targeting CONFIGURATION that may reference custom audiences
 * inside it. They live on different Meta edges, and a custom audience never
 * appears in the saved-audience list, which is why users with one couldn't
 * find it anywhere in the wizard.
 *
 * The parent hides this entirely under a regulated special ad category, the
 * same way it hides Detailed Targeting — see the backend's SAC gate in
 * utils/customAudiences.js for why.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Search, X, Plus, Minus, AlertCircle, Loader2 } from 'lucide-react';
import { getCustomAudiences } from '@/apis/metaAds/metaAdsApi';
import { FieldShell } from './wizardFields';

// Compact size label — Meta returns a lower bound, so this is a floor, not a
// count. "12,400+" reads honestly; "12,400" would not.
const fmtSize = (n) =>
  typeof n === 'number' && n > 0 ? `${n.toLocaleString()}+ people` : null;

function AudienceChip({ audience, tone, onRemove }) {
  const isExclude = tone === 'exclude';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-11 ${
        isExclude
          ? 'border-red-400/30 bg-red-400/10 text-red-700 dark:text-red-300'
          : 'border-sky-400/30 bg-sky-400/10 text-sky-700 dark:text-sky-300'
      }`}
    >
      <span className="truncate font-medium" title={audience.name || audience.id}>
        {audience.name || audience.id}
      </span>
      {audience.subtypeLabel && (
        <span className="shrink-0 opacity-60">{audience.subtypeLabel}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${audience.name || audience.id}`}
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function CustomAudiencePicker({
  adAccountId,
  facebookId,
  included = [],
  excluded = [],
  onChange,
  error,
}) {
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!adAccountId) {
      setAudiences([]);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    getCustomAudiences(adAccountId, { facebookId })
      .then((r) => {
        if (requestId !== requestRef.current) return;
        setAudiences(r?.customAudiences || []);
      })
      .catch((e) => {
        if (requestId !== requestRef.current) return;
        setLoadError(e?.response?.data?.error || e.message);
        setAudiences([]);
      })
      .finally(() => {
        if (requestId !== requestRef.current) return;
        setLoading(false);
      });
  }, [adAccountId, facebookId]);

  const pickedIds = useMemo(
    () => new Set([...included, ...excluded].map((a) => a.id)),
    [included, excluded],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return audiences.filter(
      (a) =>
        !pickedIds.has(a.id) &&
        (!q ||
          (a.name || '').toLowerCase().includes(q) ||
          (a.subtypeLabel || '').toLowerCase().includes(q)),
    );
  }, [audiences, query, pickedIds]);

  // Only the fields the backend keeps — the rest is display metadata that
  // buildCustomAudienceTargeting strips anyway, and carrying it into form
  // state just makes the payload noisier.
  const toRef = (a) => ({
    id: a.id,
    name: a.name || '',
    subtype: a.subtype || '',
    subtypeLabel: a.subtypeLabel || '',
    size: a.size ?? null,
  });

  const add = (a, bucket) => {
    const ref = toRef(a);
    onChange(
      bucket === 'exclude'
        ? { included, excluded: [...excluded, ref] }
        : { included: [...included, ref], excluded },
    );
    setQuery('');
  };

  const remove = (id, bucket) =>
    onChange(
      bucket === 'exclude'
        ? { included, excluded: excluded.filter((a) => a.id !== id) }
        : { included: included.filter((a) => a.id !== id), excluded },
    );

  return (
    <FieldShell
      label="Custom audiences"
      error={error || loadError}
      hint={
        loadError
          ? undefined
          : 'Audiences you built in Meta — customer lists, website visitors, engagement and lookalikes. Create them in Ads Manager; they appear here.'
      }
    >
      <div className="flex flex-col gap-3">
        {(included.length > 0 || excluded.length > 0) && (
          <div className="flex flex-col gap-2">
            {included.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-10 font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
                  Include
                </span>
                {included.map((a) => (
                  <AudienceChip
                    key={a.id}
                    audience={a}
                    tone="include"
                    onRemove={() => remove(a.id, 'include')}
                  />
                ))}
              </div>
            )}
            {excluded.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-10 font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
                  Exclude
                </span>
                {excluded.map((a) => (
                  <AudienceChip
                    key={a.id}
                    audience={a}
                    tone="exclude"
                    onRemove={() => remove(a.id, 'exclude')}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/40" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={
              loading ? 'Loading audiences…' : 'Search your custom audiences…'
            }
            disabled={loading || !!loadError}
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-300 focus:border-gray-400 focus:outline-none disabled:opacity-60 dark:border-white/6 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/35 dark:hover:border-white/10"
          />
          {loading && (
            <Loader2 className="absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
          )}
        </div>

        {open && !loading && !loadError && (
          <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white dark:border-white/8 dark:bg-[#171717]">
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-3 py-6 text-center">
                <Users className="h-5 w-5 text-gray-300 dark:text-white/20" />
                <p className="text-11 text-gray-400 dark:text-white/40">
                  {audiences.length === 0
                    ? 'No custom audiences on this ad account yet — build one in Meta Ads Manager.'
                    : query
                      ? 'No audiences match your search.'
                      : 'Every audience is already picked.'}
                </p>
              </div>
            ) : (
              results.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 last:border-b-0 dark:border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-12 font-medium text-gray-900 dark:text-white">
                      {a.name}
                    </p>
                    <p className="truncate text-10 text-gray-400 dark:text-white/40">
                      {[a.subtypeLabel, fmtSize(a.size)].filter(Boolean).join(' · ')}
                      {/* Meta keeps returning audiences it can't currently
                          deliver (too small, still populating, expired). Shown
                          with the reason rather than hidden — an audience that
                          exists in Meta but is missing here reads as a bug. */}
                      {a.ready === false && (
                        <span className="ml-1 text-amber-600 dark:text-amber-400">
                          · {a.statusLabel || 'not ready to target'}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => add(a, 'include')}
                    title="Include this audience"
                    className="flex h-6 items-center gap-1 rounded-lg border border-gray-200 px-2 text-10 font-semibold text-gray-600 transition-all hover:border-sky-400/40 hover:text-sky-600 dark:border-white/10 dark:text-white/60 dark:hover:text-sky-300"
                  >
                    <Plus className="h-3 w-3" />
                    Include
                  </button>
                  <button
                    type="button"
                    onClick={() => add(a, 'exclude')}
                    title="Exclude this audience"
                    className="flex h-6 items-center gap-1 rounded-lg border border-gray-200 px-2 text-10 font-semibold text-gray-600 transition-all hover:border-red-400/40 hover:text-red-600 dark:border-white/10 dark:text-white/60 dark:hover:text-red-300"
                  >
                    <Minus className="h-3 w-3" />
                    Exclude
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {loadError && (
          <p className="flex items-start gap-1.5 text-11 text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            Couldn&apos;t load custom audiences. Targeting still works without them.
          </p>
        )}
      </div>
    </FieldShell>
  );
}
