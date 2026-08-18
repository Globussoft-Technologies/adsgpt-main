import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCheck, ChevronDown, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { updateAnalyticsMetricsPreference } from '@/apis/metaAds/metaAdsApi';
import { METRIC_ICONS, METRIC_GROUP_LABELS } from './metaAdsUtils';

// ─── SaveStatus ───────────────────────────────────────────────────────────────
// Same inline auto-save narrator pattern as Autopilot/AutopilotSettings.jsx's
// SaveStatus (that one isn't exported, so this is a copy, not an import).
const SaveStatus = ({ saving, dirty, saveMessage }) => {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/75">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (saveMessage && !saveMessage.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400" title={saveMessage.text}>
        <span className="h-1.5 w-1.5 rounded-full bg-red-600 dark:bg-red-400" />
        Save failed
      </span>
    );
  }
  if (saveMessage?.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" strokeWidth={3} /> Saved
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/75">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" /> Unsaved changes
      </span>
    );
  }
  return null;
};

const GROUP_ORDER = [
  'performance',
  'video',
  'engagement',
  'messaging',
  'leads',
  'commerce',
  'app',
  'offline',
  'roas',
];

// Marketers search by shorthand, not by the metric's full display label
// ("cpi" for "Cost per App Install", "cpa" for any cost-per-action metric).
// A plain substring match on the label alone misses these — expand the query
// through this alias map and OR the two searches together. Add an entry here
// whenever a real search complaint surfaces (this list started from a user
// report that searching "cpi" returned nothing).
const SEARCH_ALIASES = {
  cpi: 'install',
  cpa: 'action',
  cpl: 'lead',
  roas: 'return',
};

/**
 * "Customize metrics" modal — lets the user pick which config/metricsCatalog.js
 * entries show as KPI cards on the Analytics tab. Self-contained: owns its own
 * selection state + debounced auto-save (mirrors Autopilot/AutopilotSettings.jsx's
 * dirty/saving/SaveStatus pattern), so MetaAdsDashboard.jsx only needs to render
 * the trigger button and receive the saved key list back via `onSaved`.
 *
 * Global per user — not scoped to a specific ad account or Facebook connection
 * (confirmed with the user: one preference across every connected account).
 */
export default function MetricsPicker({
  open,
  onClose,
  catalog,
  visibleKeys,
  onSaved,
  // Where a save goes. Defaults to the Analytics surface so that call site
  // needs no changes; the table column pickers pass a `tables.<level>` save.
  persist = (keys) => updateAnalyticsMetricsPreference(keys),
  title = 'Customize metrics',
  subtitle,
  // Analytics keeps its "at least one" floor (an empty KPI dashboard isn't a
  // valid state). Table pickers pass 0 — zero metric columns is exactly how
  // the tables looked before this feature, so clearing them all is fine.
  minSelected = 1,
  // What "Reset" restores. Analytics leaves this unset and falls back to the
  // catalog's `defaultVisible` flags (the same set getDefaultVisibleKeys()
  // computes server-side). Table pickers pass [] explicitly — their real
  // default, per the locked decision, is no columns at all.
  defaultKeys,
  // Upper bound on selections. Must mirror the backend Joi cap for this
  // surface (Validations/metaAdsPreference.validator.js — analytics.max(80),
  // TABLE_METRIC_CAP=20) or "Select all" can build a payload the server
  // rejects wholesale, undoing every change in the batch.
  maxSelected = Infinity,
}) {
  const [selectedKeys, setSelectedKeys] = useState(visibleKeys || []);
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set(GROUP_ORDER));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  const selectedRef = useRef(selectedKeys);
  useEffect(() => {
    selectedRef.current = selectedKeys;
  }, [selectedKeys]);
  const saveInFlightRef = useRef(false);

  // `visibleKeys` read via a ref rather than as a reactive effect dependency
  // below — every successful save calls `onSaved`, which updates the
  // PARENT's state and hands back a new array reference as this same prop.
  // If the re-seed effect depended on `visibleKeys` directly, that save-
  // triggered prop change would re-fire it while the modal is still open,
  // resetting `query` (and `openGroups`) mid-search — exactly the bug this
  // avoids. Depending on `open` alone means it only re-seeds on the
  // closed→open transition, which is the one case that actually needs it
  // (showing a stale selection from a previous open).
  const visibleKeysRef = useRef(visibleKeys);
  useEffect(() => {
    visibleKeysRef.current = visibleKeys;
  }, [visibleKeys]);

  useEffect(() => {
    if (open) {
      setSelectedKeys(visibleKeysRef.current || []);
      setDirty(false);
      setSaveMessage(null);
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSave = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const snapshot = selectedRef.current;
    setSaving(true);
    setSaveMessage(null);
    try {
      const r = await persist(snapshot);
      if (r.status) {
        // Only clear dirty if nothing changed while the save was in flight —
        // otherwise the next debounced tick picks up the newer edit.
        if (selectedRef.current === snapshot) setDirty(false);
        setSaveMessage({ ok: true, text: 'Saved.' });
        // Hand back the snapshot we sent, not a field plucked out of the
        // response — the response shape differs per surface (analytics vs
        // tables) and the snapshot is what was actually persisted.
        onSaved?.(snapshot);
      } else {
        setSaveMessage({ ok: false, text: r.error || 'Save failed.' });
      }
    } catch (e) {
      setSaveMessage({
        ok: false,
        text: e?.response?.data?.error || e.message || 'Save failed.',
      });
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };

  // Debounce persistence by 800ms so a burst of toggles collapses to one
  // PATCH — same timing as AutopilotSettings.jsx's auto-save.
  useEffect(() => {
    if (!dirty) return undefined;
    if (saveInFlightRef.current) return undefined;
    const t = setTimeout(() => {
      onSave();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, selectedKeys]);

  useEffect(() => {
    if (!saveMessage?.ok) return undefined;
    const t = setTimeout(() => setSaveMessage(null), 1500);
    return () => clearTimeout(t);
  }, [saveMessage]);

  // Flush a pending debounced save immediately — called before the modal
  // closes so a rapid toggle-then-close doesn't lose the edit.
  const flushPendingSave = async () => {
    if (dirty && !saveInFlightRef.current) await onSave();
  };

  const toggle = (key) => {
    setSelectedKeys((prev) => {
      const has = prev.includes(key);
      // Require at least 1 selected — block unchecking the last one rather
      // than letting the user save an empty dashboard.
      if (has && prev.length <= minSelected) return prev;
      if (!has && prev.length >= maxSelected) return prev;
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      return next;
    });
    setDirty(true);
    setSaveMessage(null);
  };

  const resolvedDefaultKeys = useMemo(
    () => defaultKeys ?? catalog.filter((m) => m.defaultVisible).map((m) => m.key),
    [defaultKeys, catalog],
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const aliasExpansion = SEARCH_ALIASES[q];
    const filtered = q
      ? catalog.filter((m) => {
          const label = m.label.toLowerCase();
          return label.includes(q) || (aliasExpansion && label.includes(aliasExpansion));
        })
      : catalog;
    const byGroup = new Map();
    for (const entry of filtered) {
      if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
      byGroup.get(entry.group).push(entry);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      label: METRIC_GROUP_LABELS[g] || g,
      items: byGroup.get(g),
    }));
  }, [catalog, query]);

  // Flattened keys currently matching the search — "Select all" adds exactly
  // these, so searching "video" then hitting it only adds video metrics
  // instead of the entire 233-entry catalog.
  const filteredKeys = useMemo(
    () => grouped.flatMap((g) => g.items.map((m) => m.key)),
    [grouped],
  );
  const allFilteredSelected =
    filteredKeys.length > 0 && filteredKeys.every((k) => selectedKeys.includes(k));
  const atCap = selectedKeys.length >= maxSelected;
  const isAtDefault =
    selectedKeys.length === resolvedDefaultKeys.length &&
    resolvedDefaultKeys.every((k) => selectedKeys.includes(k));

  const selectAll = () => {
    setSelectedKeys((prev) => {
      const merged = Array.from(new Set([...prev, ...filteredKeys]));
      // Cap rather than reject — filling up to the limit is more useful than
      // a no-op, and matches what the server would accept anyway.
      return merged.slice(0, maxSelected);
    });
    setDirty(true);
    setSaveMessage(null);
  };

  const resetToDefault = () => {
    setSelectedKeys(resolvedDefaultKeys.slice(0, maxSelected));
    setDirty(true);
    setSaveMessage(null);
  };

  const toggleGroup = (group) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (!open) return null;

  // Rendered into <body> via createPortal — same reason wizardFields.jsx's
  // SelectField does it, plus one specific to the table call sites: each
  // table is wrapped in a <motion.div> that animates `y`, and framer-motion
  // applies a CSS `transform`. A transformed ancestor becomes the containing
  // block for `position: fixed` AND opens a new stacking context, so without
  // the portal this overlay sized itself to the table area instead of the
  // viewport and its z-index only competed inside that subtree — no amount
  // of raising the number fixes it. The surrounding `overflow-auto` scroll
  // container would clip it as well.
  return createPortal(
    <div
      className="fixed inset-0 z-300 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={async () => {
        await flushPendingSave();
        onClose?.();
      }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl workspace-card shadow-2xl dark:border-white/8 dark:bg-[#161616]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/8">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-[#BEBEBE]">
              {selectedKeys.length}
              {Number.isFinite(maxSelected) ? ` / ${maxSelected}` : ''} selected
              {subtitle ? ` · ${subtitle}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await flushPendingSave();
              onClose?.();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* search */}
        <div className="border-b border-gray-200 px-5 py-3 dark:border-white/8">
          <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/10 dark:bg-white/4">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/45" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search metrics…"
              className="w-full bg-transparent text-13 text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-white dark:placeholder:text-white/40"
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={selectAll}
              disabled={allFilteredSelected || atCap}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-[#eef1f4] px-2.5 py-1 text-11 font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-[#e2e7ec] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <CheckCheck className="h-3 w-3" />
              Select all{query ? ` (${filteredKeys.length})` : ''}
            </button>
            <button
              type="button"
              onClick={resetToDefault}
              disabled={isAtDefault}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-[#eef1f4] px-2.5 py-1 text-11 font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-[#e2e7ec] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </button>
          </div>
        </div>

        {/* grouped checkbox list */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-2">
          {grouped.length === 0 && (
            <div className="px-3 py-8 text-center text-12 text-gray-500 dark:text-white/50">
              No metrics match "{query}".
            </div>
          )}
          {grouped.map(({ group, label, items }) => {
            const isOpen = openGroups.has(group);
            const selectedInGroup = items.filter((m) => selectedKeys.includes(m.key)).length;
            return (
              <div key={group} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <span className="text-12 font-semibold uppercase tracking-wide text-gray-500 dark:text-white/55">
                    {label} <span className="font-normal normal-case text-gray-400 dark:text-white/35">({selectedInGroup}/{items.length})</span>
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform dark:text-white/45 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-0.5 px-1 pb-1">
                    {items.map((entry) => {
                      const Icon = METRIC_ICONS[entry.icon];
                      const checked = selectedKeys.includes(entry.key);
                      const isLastChecked = checked && selectedKeys.length <= minSelected;
                      const isBlockedByCap = !checked && atCap;
                      return (
                        <button
                          type="button"
                          key={entry.key}
                          onClick={() => toggle(entry.key)}
                          disabled={isLastChecked || isBlockedByCap}
                          title={
                            isLastChecked
                              ? 'At least one metric must stay selected'
                              : isBlockedByCap
                                ? `Maximum ${maxSelected} metrics selected`
                                : undefined
                          }
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5 ${checked ? 'bg-gray-50 dark:bg-white/[0.03]' : ''}`}
                        >
                          <span
                            className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              checked
                                ? 'border-transparent bg-gradient-to-r from-[#02C8C4] to-[#5867EB]'
                                : 'border-gray-300 dark:border-white/20'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                          </span>
                          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/50" />}
                          <span className="truncate text-13 text-gray-900 dark:text-white">{entry.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-white/8">
          <SaveStatus saving={saving} dirty={dirty} saveMessage={saveMessage} />
          <button
            type="button"
            onClick={async () => {
              await flushPendingSave();
              onClose?.();
            }}
            className="rounded-full bg-gradient-to-r from-[#02C8C4] to-[#5867EB] px-4 py-1.5 text-12 font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
