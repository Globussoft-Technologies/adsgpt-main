/**
 * DetailedTargetingBrowse.jsx — modal drawer with Meta's categorical
 * hierarchy of Demographics / Interests / Behaviours. Two-pane layout:
 * column 1 = expandable category tree; column 2 = leaf items the user
 * can multi-select and bulk-add.
 *
 * Behaviour:
 *   • Top-level (no `root`) returns Meta's pillar list (Demographics /
 *     Interests / Behaviours) + a "Suggested for you" section.
 *   • Clicking a non-leaf row expands it (fetches children).
 *   • Leaf rows toggle into a "pending" multi-selection set.
 *   • "Add" button at the bottom flushes the selection to the parent.
 *
 * Server-side caching (1h via Redis) means re-opening the drawer is
 * effectively instant after first load.
 *
 * Returns picked items in the same shape as the search picker:
 *   { type, id, name, audienceSize?, path? }
 */

import { useCallback, useEffect, useState } from 'react';
import { X, ChevronRight, ChevronDown, Loader2, Check } from 'lucide-react';
import { browseDetailedTargeting } from '@/apis/metaAds/metaAdsApi';
import { typeBadge, formatAudienceSize } from './DetailedTargetingPicker';

export default function DetailedTargetingBrowse({
  // Required — Meta's targetingbrowse endpoint lives on the ad-account
  // node. Drawer renders an empty state when omitted.
  adAccountId,
  open,
  onClose,
  onPick,
  // Items the parent already holds — disable adding duplicates.
  existingKeys = new Set(),
}) {
  const [rootRows, setRootRows] = useState([]);
  const [loadingRoot, setLoadingRoot] = useState(false);
  // Map<rootId, { rows: [...], loading: bool }> — lazy-loaded children
  // cached locally so re-expanding doesn't re-fetch within a drawer session.
  const [childrenByRoot, setChildrenByRoot] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  // Pending = items the user has checked but not yet bulk-added. Map
  // keyed by `type:id` so dedup is free.
  const [pending, setPending] = useState({});

  // Load root tree on every open. Backend Redis cache (1h) makes repeat
  // opens essentially free.
  //
  // Deps minimal — open + adAccountId only. The earlier draft included
  // rootRows.length / loadingRoot in deps; setting loadingRoot true would
  // immediately re-run the effect, fire the cleanup, and cancel the
  // in-flight request before the response could land, so the modal got
  // stuck on "Loading categories…". Avoid that by NOT depending on state
  // we write inside the effect.
  useEffect(() => {
    if (!open || !adAccountId) return undefined;
    let cancelled = false;
    setLoadingRoot(true);
    (async () => {
      try {
        const r = await browseDetailedTargeting({ adAccountId });
        if (cancelled) return;
        setRootRows(r?.tree || []);
      } catch {
        if (!cancelled) setRootRows([]);
      } finally {
        if (!cancelled) setLoadingRoot(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adAccountId, open]);

  // Reset on close — fresh state next open so dynamic selections don't
  // carry over into a re-mount.
  useEffect(() => {
    if (open) return;
    setPending({});
    setExpanded(new Set());
  }, [open]);

  const expand = useCallback(
    async (row) => {
      const next = new Set(expanded);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      setExpanded(next);
      // Lazy-load children if we haven't yet.
      if (!childrenByRoot[row.id]) {
        setChildrenByRoot((prev) => ({
          ...prev,
          [row.id]: { rows: [], loading: true },
        }));
        try {
          const r = await browseDetailedTargeting({ adAccountId, root: row.id });
          setChildrenByRoot((prev) => ({
            ...prev,
            [row.id]: { rows: r?.tree || [], loading: false },
          }));
        } catch {
          setChildrenByRoot((prev) => ({
            ...prev,
            [row.id]: { rows: [], loading: false },
          }));
        }
      }
    },
    [adAccountId, expanded, childrenByRoot],
  );

  const togglePending = useCallback((row) => {
    const k = `${row.type}:${row.id}`;
    setPending((prev) => {
      const next = { ...prev };
      if (next[k]) {
        delete next[k];
      } else {
        next[k] = {
          type: row.type,
          id: String(row.id),
          name: row.name,
          ...(row.audienceSize != null && { audienceSize: row.audienceSize }),
          ...(Array.isArray(row.path) && row.path.length && { path: row.path }),
        };
      }
      return next;
    });
  }, []);

  const flushPending = useCallback(() => {
    const items = Object.values(pending);
    if (items.length) onPick?.(items);
    onClose?.();
  }, [pending, onPick, onClose]);

  if (!open) return null;

  const pendingCount = Object.keys(pending).length;

  // Recursive row renderer — Meta UI uses indentation for nesting.
  const renderRow = (row, depth = 0) => {
    const k = `${row.type}:${row.id}`;
    const alreadyAdded = existingKeys.has(k);
    const checked = !!pending[k];
    const isOpen = expanded.has(row.id);
    const child = childrenByRoot[row.id];
    const badge = typeBadge(row.type);
    const sizeText = formatAudienceSize(row.audienceSize);

    return (
      <div key={k}>
        <div
          className="flex items-center gap-2 border-b border-gray-100 px-2 py-2 transition-colors hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
          style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        >
          {row.leaf ? (
            // Leaf — clickable checkbox.
            <button
              type="button"
              onClick={() => !alreadyAdded && togglePending(row)}
              disabled={alreadyAdded}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                alreadyAdded
                  ? 'cursor-not-allowed border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5'
                  : checked
                    ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400'
                    : 'border-gray-300 hover:border-gray-400 dark:border-white/20 dark:hover:border-white/40'
              }`}
            >
              {checked && <Check className="h-3 w-3" />}
            </button>
          ) : (
            // Non-leaf — expand caret.
            <button
              type="button"
              onClick={() => expand(row)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-white/55 dark:hover:text-white"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}

          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-13 ${
                alreadyAdded
                  ? 'text-gray-400 dark:text-white/35'
                  : 'text-gray-900 dark:text-white'
              }`}
            >
              {row.name}
              {alreadyAdded && (
                <span className="ml-2 text-11 text-gray-400 dark:text-white/35">
                  (already added)
                </span>
              )}
            </p>
            {Array.isArray(row.path) && row.path.length > 0 && depth === 0 && (
              <p className="truncate text-11 text-gray-500 dark:text-white/45">
                {row.path.join(' > ')}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {sizeText && (
              <span className="text-11 text-gray-500 dark:text-white/45">{sizeText}</span>
            )}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-semibold uppercase tracking-wide ${badge.color}`}
            >
              {badge.label}
            </span>
          </div>
        </div>

        {/* Children — recursive. */}
        {isOpen && (
          <div>
            {child?.loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-12 text-gray-500 dark:text-white/45">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            )}
            {child?.rows?.length === 0 && !child?.loading && (
              <div className="px-3 py-2 text-12 text-gray-500 dark:text-white/45">
                No items in this category.
              </div>
            )}
            {child?.rows?.map((c) => renderRow(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1A1A1A]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <div>
            <h3 className="text-14 font-semibold text-gray-900 dark:text-white">
              Browse detailed targeting
            </h3>
            <p className="text-12 text-gray-500 dark:text-white/45">
              Categories from Meta. Expand a section to see options.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:text-white/55 dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tree body */}
        <div className="scrollbar-thin max-h-[70vh] flex-1 overflow-y-auto">
          {loadingRoot ? (
            <div className="flex items-center gap-2 px-4 py-6 text-13 text-gray-500 dark:text-white/45">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading categories…
            </div>
          ) : rootRows.length === 0 ? (
            <div className="px-4 py-6 text-13 text-gray-500 dark:text-white/45">
              No categories available for this account.
            </div>
          ) : (
            rootRows.map((r) => renderRow(r))
          )}
        </div>

        {/* Footer with bulk-add */}
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-white/10">
          <span className="text-12 text-gray-500 dark:text-white/55">
            {pendingCount === 0
              ? 'No items selected'
              : `${pendingCount} item${pendingCount === 1 ? '' : 's'} selected`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-12 font-medium text-gray-700 hover:bg-gray-100 dark:text-white/70 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={flushPending}
              disabled={pendingCount === 0}
              className="rounded-full bg-sky-600 px-3 py-1.5 text-12 font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add {pendingCount > 0 ? `(${pendingCount})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
