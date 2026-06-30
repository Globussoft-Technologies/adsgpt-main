/**
 * DetailedTargetingPillarTree.jsx — Meta UI parity browse component.
 *
 * Renders the three pillar accordions (Demographics / Interests /
 * Behaviours) INLINE under the picker's search input — NOT in a separate
 * modal. Matches Meta Ads Manager's "Detailed targeting" expandable tree.
 *
 * Data model:
 *   • Backend `/detailed-targeting/browse` returns a flat list of leaves;
 *     each leaf carries `path[]` representing its categorical breadcrumb
 *     (e.g. ['Behaviours', 'Digital activities', 'Facebook page admins']).
 *   • We rebuild the hierarchy client-side by walking each leaf's path
 *     and inserting into a nested-children map.
 *   • Render as a recursive accordion: each node is either a category
 *     (expandable) or a leaf (clickable checkbox).
 *
 * Multi-select semantics:
 *   • Each leaf renders a checkbox tied to the parent picker's `value`
 *     via `existingKeys`. Clicking a leaf calls `onPick(item)` which the
 *     parent maps to either an append (add) or filter (remove).
 *   • Branch nodes (categories) are not selectable — only leaves.
 *
 * Why a separate component (vs inlining in the picker):
 *   • Same tree is used by Include / Narrow / Exclude pickers.
 *   • Browse data lives at the component level; lifting it would either
 *     refetch per picker (wasteful) or thread props deeper.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Check, Loader2 } from 'lucide-react';
import { browseDetailedTargeting } from '@/apis/metaAds/metaAdsApi';
import { formatAudienceRange } from './DetailedTargetingPicker';

// Meta UI's three top-level pillars. Hard-coded labels — the backend
// returns items where path[0] is the pillar name as a localised string,
// but for our English-only wizard the canonical labels below match
// Meta UI exactly. The `match` predicate identifies items whose path[0]
// belongs to this pillar — Meta's path uses 'Behaviors' (US English) on
// some accounts and 'Behaviours' (UK English) on others; same for the
// other pillars, so we match case-insensitively against both spellings.
const PILLARS = [
  {
    id: 'demographics',
    label: 'Demographics',
    matches: (s) => /^demographic/i.test(s),
  },
  {
    id: 'interests',
    label: 'Interests',
    matches: (s) => /^interest/i.test(s),
  },
  {
    id: 'behaviors',
    label: 'Behaviours',
    matches: (s) => /^behavio/i.test(s),
  },
];

// Search-only category support intentionally deferred 2026-06-30.
// Earlier code rendered hardcoded rows (Schools, Employers, Job titles,
// Fields of study, Interested in) with a 🔍 icon + inline scoped search.
// Removed because (a) the placement-metadata + data-driven hybrid added
// substantial code for 5 rows, (b) users can already find those items
// via the picker's top-of-section typeahead which searches across all
// classes. Re-introduce when there's a clear product need; the
// `SEARCH_ONLY_CATEGORIES` approach in the spec doc §10 is the design
// to copy.

// Build a hierarchical tree from a flat list of items with `path[]`.
// Returns: { [pillarId]: { children: Map<name, node>, items: [...] } }
// where node = { children: Map<name, node>, items: [...] } recursively.
function buildPillarForest(items) {
  const forest = {
    demographics: { children: new Map(), items: [] },
    interests: { children: new Map(), items: [] },
    behaviors: { children: new Map(), items: [] },
    other: { children: new Map(), items: [] },
  };
  for (const item of items) {
    const path = Array.isArray(item.path) ? item.path : [];
    if (!path.length) continue; // skip items Meta didn't categorise
    const pillarId =
      PILLARS.find((p) => p.matches(path[0]))?.id || 'other';
    let node = forest[pillarId];
    // Descend into path[1..] — path[0] is the pillar itself, already
    // matched into the forest bucket.
    for (let i = 1; i < path.length; i++) {
      const seg = path[i];
      if (!node.children.has(seg)) {
        node.children.set(seg, { children: new Map(), items: [] });
      }
      node = node.children.get(seg);
    }
    node.items.push(item);
  }
  return forest;
}

// Stable id for a node so the expand-set can address it deterministically.
const pathId = (segments) => segments.join(' / ');

// Recursive renderer for an interior node's children + leaves.
// Receives the current path so child keys can build on it.
function renderChildren({
  node,
  pathSegments,
  expandedPaths,
  toggleExpand,
  existingKeys,
  onPick,
  depth,
}) {
  const childEntries = Array.from(node.children.entries());
  const indent = `${0.5 + depth * 1.25}rem`;

  return (
    <>
      {childEntries.map(([name, child]) => {
        const childPath = [...pathSegments, name];
        const pid = pathId(childPath);
        const isOpen = expandedPaths.has(pid);
        // Count of leaves transitively under this branch — Meta UI shows
        // these as a hint to the right of the row name.
        const leafCount = countLeaves(child);
        return (
          <div key={pid}>
            <button
              type="button"
              onClick={() => toggleExpand(pid)}
              className="flex w-full items-center gap-2 border-b border-gray-100 py-2 text-left text-13 text-gray-900 transition-colors hover:bg-gray-50 dark:border-white/5 dark:text-white dark:hover:bg-white/5"
              style={{ paddingLeft: indent, paddingRight: '0.75rem' }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-500 dark:text-white/55">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="shrink-0 text-11 text-gray-500 dark:text-white/45">
                {leafCount}
              </span>
            </button>
            {isOpen && (
              <>
                {renderChildren({
                  node: child,
                  pathSegments: childPath,
                  expandedPaths,
                  toggleExpand,
                  existingKeys,
                  onPick,
                  depth: depth + 1,
                })}
              </>
            )}
          </div>
        );
      })}
      {node.items.map((item) => {
        const k = `${item.type}:${item.id}`;
        const checked = existingKeys.has(k);
        const sizeText = formatAudienceRange(item.audienceSize, item.audienceSizeUpperBound);
        return (
          <button
            type="button"
            key={`leaf:${k}`}
            onClick={() => onPick(item)}
            className="flex w-full items-center gap-2 border-b border-gray-100 py-2 text-left transition-colors hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5"
            style={{ paddingLeft: indent, paddingRight: '0.75rem' }}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                checked
                  ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400'
                  : 'border-gray-300 dark:border-white/20'
              }`}
            >
              {checked && <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate text-13 text-gray-900 dark:text-white">
              {item.name}
            </span>
            {/* Type badge intentionally omitted in the tree view —
                pillar context already conveys the type and Meta UI
                doesn't show badges here either. Badges still render in
                the picker's search dropdown + selected chips, where
                the type isn't otherwise obvious. */}
            {sizeText && (
              <span className="shrink-0 text-11 text-gray-500 dark:text-white/45">
                {sizeText}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

// Count leaves under a node (transitive sum across children + own items).
function countLeaves(node) {
  let n = node.items.length;
  for (const child of node.children.values()) {
    n += countLeaves(child);
  }
  return n;
}

// `SearchOnlyRow` lived here — inline scoped-search row for categories
// Meta exposes via search-only (Schools / Employers / Fields of study /
// etc.). Removed 2026-06-30 alongside CLASS_TREE_LOCATIONS +
// deriveSearchOnlyEntries. The picker's top-level typeahead is the
// user's escape hatch in the meantime — re-add when there's a clear
// product need; design lives in the spec doc §10.

export default function DetailedTargetingPillarTree({
  adAccountId,
  onPick,
  existingKeys = new Set(),
}) {
  const [rawTree, setRawTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expandedPillars, setExpandedPillars] = useState(new Set());
  const [expandedPaths, setExpandedPaths] = useState(new Set());

  // Fetch the full browse tree on mount. Backend Redis cache (1h) makes
  // repeat picker mounts cheap. Race-condition-safe via `cancelled` flag.
  useEffect(() => {
    if (!adAccountId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    (async () => {
      try {
        const r = await browseDetailedTargeting({ adAccountId });
        if (cancelled) return;
        setRawTree(r?.tree || []);
      } catch {
        if (!cancelled) {
          setRawTree([]);
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adAccountId]);

  // Re-bucket whenever raw data changes. useMemo so re-renders don't
  // recompute the entire tree on every keystroke in the parent.
  const forest = useMemo(() => buildPillarForest(rawTree), [rawTree]);
  const togglePillar = (id) => {
    setExpandedPillars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleExpand = (pid) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  if (loadFailed) {
    return (
      <p className="px-3 py-3 text-12 text-gray-500 dark:text-white/45">
        Couldn't load categories for this account.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-white/10">
      {PILLARS.map((p) => {
        const node = forest[p.id];
        const count = countLeaves(node);
        const isOpen = expandedPillars.has(p.id);
        return (
          <div key={p.id} className="border-b border-gray-200 last:border-b-0 dark:border-white/10">
            <button
              type="button"
              onClick={() => togglePillar(p.id)}
              disabled={loading && count === 0}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-13 font-medium text-gray-900 transition-colors hover:bg-gray-50 disabled:cursor-wait dark:text-white dark:hover:bg-white/5"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-500 dark:text-white/55">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
              <span className="flex-1">{p.label}</span>
              {loading && count === 0 ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500 dark:text-white/55" />
              ) : (
                <span className="text-11 text-gray-500 dark:text-white/45">
                  {count.toLocaleString()}
                </span>
              )}
            </button>
            {isOpen && (
              <div className="scrollbar-thin max-h-96 overflow-y-auto bg-gray-50/40 dark:bg-white/2">
                {renderChildren({
                  node,
                  pathSegments: [p.label],
                  expandedPaths,
                  toggleExpand,
                  existingKeys,
                  onPick,
                  depth: 0,
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
