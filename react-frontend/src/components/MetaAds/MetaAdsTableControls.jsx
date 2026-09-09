/**
 * Shared table controls — filter pills, row selection, and the bulk action bar.
 *
 * The three drilldown levels (campaigns / ad sets / ads) are separate
 * components with their own state, so anything added to "the table" otherwise
 * gets written three times and drifts. Everything here is level-agnostic: it
 * takes rows, a level string, and callbacks.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Copy, Trash2, Loader2, X, AlertTriangle } from 'lucide-react';
import { TABLE_FILTERS, countByFilter } from './metaAdsUtils';
import {
  updateAdStatus,
  duplicateMetaEntity,
  deleteMetaCampaign,
  deleteMetaAdSet,
  deleteMetaAd,
} from '@/apis/metaAds/metaAdsApi';
import { globalToast } from '@/utils/globalToast';

// ─── filter pills ─────────────────────────────────────────────────────────────

/**
 * FilterPills — status / delivery filter over the already-fetched rows.
 *
 * Counts come from the UNFILTERED list so a bucket that's empty still shows
 * "0" rather than disappearing. An empty bucket that vanishes reads as a
 * broken tab — the same mistake the Audit tab's severity filter made.
 */
export function FilterPills({ rows, value, onChange }) {
  const counts = useMemo(() => countByFilter(rows), [rows]);

  return (
    <div className="flex items-center gap-1">
      {TABLE_FILTERS.map((f) => {
        const active = value === f.key;
        const count = counts[f.key] ?? 0;
        const attention = f.key === 'issues' && count > 0;
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active
                ? 'border-gray-400 bg-gray-200 text-gray-900 dark:border-white/25 dark:bg-white/10 dark:text-white'
                : 'border-gray-200 bg-gray-100 text-gray-500 hover:bg-gray-200 dark:border-white/8 dark:bg-white/3 dark:text-white/50 dark:hover:bg-white/8'
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 text-[10px] font-bold ${
                attention
                  ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                  : 'bg-black/5 text-gray-500 dark:bg-white/10 dark:text-white/50'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── selection ────────────────────────────────────────────────────────────────

/**
 * useTableSelection — multi-select state for one table.
 *
 * Selection is keyed by id and intersected with the currently visible rows on
 * read, so filtering or searching a row out of view also drops it from the
 * effective selection. Without that, a user could filter to "Active", select
 * all, switch to "All", and silently act on rows they never saw.
 */
export function useTableSelection(visibleRows, { selectable = () => true } = {}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Deliberately NOT memoised on `visibleRows` alone: `selectable` is a fresh
  // closure each render and closes over state that changes independently of the
  // row list (the campaign table's managed-slot set, for one). Memoising on the
  // rows would keep a row un-selectable after it became managed, until the next
  // refetch happened to replace the array. A filter over one page of rows costs
  // nothing next to rendering the table.
  const selectableRows = (visibleRows || []).filter(selectable);

  const effective = selectableRows.filter((r) => selectedIds.has(r.id));

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected =
    selectableRows.length > 0 && effective.length === selectableRows.length;

  // Not a useCallback: `selectableRows` is recomputed each render (see above),
  // so a memo keyed on it would be invalidated every render anyway.
  const toggleAll = () => {
    setSelectedIds((prev) => {
      const allSelected =
        selectableRows.length > 0 && selectableRows.every((r) => prev.has(r.id));
      if (allSelected) return new Set();
      return new Set(selectableRows.map((r) => r.id));
    });
  };

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return {
    selectedRows: effective,
    selectedCount: effective.length,
    isSelected: (id) => selectedIds.has(id),
    toggle,
    toggleAll,
    allVisibleSelected,
    someVisibleSelected: effective.length > 0 && !allVisibleSelected,
    clear,
    selectableCount: selectableRows.length,
  };
}

/** Header checkbox. Indeterminate when only some visible rows are selected. */
export function SelectAllCheckbox({ checked, indeterminate, onChange, disabled }) {
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select all rows"
      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 accent-[#0082FB] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20"
    />
  );
}

export function RowCheckbox({ checked, onChange, disabled, label }) {
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={onChange}
      // The row itself is a drill-down click target.
      onClick={(e) => e.stopPropagation()}
      aria-label={label || 'Select row'}
      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 accent-[#0082FB] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20"
    />
  );
}

const LEVEL_NOUNS = {
  campaign: ['campaign', 'campaigns'],
  adset: ['ad set', 'ad sets'],
  ad: ['ad', 'ads'],
};

export const levelNoun = (level, n) => {
  const [one, many] = LEVEL_NOUNS[level] || ['item', 'items'];
  return n === 1 ? one : many;
};

// ─── delete confirmation ──────────────────────────────────────────────────────

/**
 * DeleteConfirmModal — single-row delete confirmation for ad sets and ads.
 *
 * The campaign table keeps its own copy: campaign deletion has extra
 * consequences (it frees a plan slot and cascades two levels) and its copy
 * says so.
 */
export function DeleteConfirmModal({ entity, level, busy, onCancel, onConfirm }) {
  return (
    <AnimatePresence>
      {entity && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !busy && onCancel()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl workspace-card p-6 shadow-2xl dark:border-white/8 dark:bg-[#161616]"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="mb-1 text-sm font-bold text-gray-900 dark:text-white">
              Delete this {levelNoun(level, 1)}?
            </h2>
            <p className="mb-2 text-xs text-gray-500 dark:text-[#BEBEBE]">
              <span className="font-semibold text-gray-900 dark:text-white">{entity.name}</span> will
              be permanently removed from Meta
              {level === 'adset' ? ', along with its ads' : ''}. This cannot be undone.
            </p>
            <p className="mb-6 font-mono text-[11px] text-gray-400 dark:text-white/40">
              ID: {entity.id}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={busy}
                className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-medium text-gray-900 transition-all hover:bg-gray-200 disabled:opacity-50 dark:border-white/8 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-xl bg-red-500/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── bulk runner ──────────────────────────────────────────────────────────────

/**
 * runBulk — applies `fn` to each row one at a time and collects failures.
 *
 * SEQUENTIAL on purpose. Meta meters Business Use Case rate limits by CPU time
 * as well as call count, and firing twenty mutations in parallel is exactly the
 * shape that trips an account into a throttle window (see
 * services/autopilot/metaRateLimiter.js). One partial failure also shouldn't
 * abort the rest, so each row is caught individually and reported at the end.
 */
export async function runBulk(rows, fn, onProgress) {
  const failures = [];
  let done = 0;

  for (const row of rows) {
    try {
      await fn(row);
    } catch (err) {
      failures.push({
        row,
        message:
          err?.response?.data?.error ||
          err?.message ||
          'Unknown error',
      });
    } finally {
      done += 1;
      onProgress?.(done, rows.length);
    }
  }

  return { failures, succeeded: rows.length - failures.length };
}

/**
 * useBulkActions — the four bulk operations, wired to the API for one level.
 *
 * Returns handlers ready to hand to <BulkActionBar>. Each reports a single
 * summary toast rather than one per row: twenty toasts for twenty rows buries
 * the one failure that actually needs reading.
 */
export function useBulkActions({ level, adAccountId, campaignId, selection, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const run = useCallback(
    async (rows, fn, verb) => {
      if (!rows.length) return;
      setBusy(true);
      setProgress({ done: 0, total: rows.length });
      try {
        const { failures, succeeded } = await runBulk(rows, fn, (done, total) =>
          setProgress({ done, total }),
        );

        if (succeeded > 0) {
          globalToast.success(`${verb} ${succeeded} ${levelNoun(level, succeeded)}`);
        }
        if (failures.length > 0) {
          // Name the first failure — "3 failed" with no reason is unactionable,
          // and in practice a bulk failure is usually the same cause for all.
          globalToast.error(
            failures.length === 1
              ? `${failures[0].row?.name || failures[0].row?.id}: ${failures[0].message}`
              : `${failures.length} ${levelNoun(level, failures.length)} failed — ${failures[0].message}`,
          );
        }

        selection.clear();
        await onRefresh?.();
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [level, selection, onRefresh],
  );

  const setStatus = useCallback(
    (status) =>
      run(
        selection.selectedRows,
        (row) =>
          updateAdStatus(
            level,
            row.id,
            status,
            level === 'campaign' ? undefined : campaignId,
            adAccountId,
          ),
        status === 'ACTIVE' ? 'Activated' : 'Paused',
      ),
    [run, selection.selectedRows, level, campaignId, adAccountId],
  );

  const duplicate = useCallback(
    () =>
      run(
        selection.selectedRows,
        (row) =>
          duplicateMetaEntity({
            adAccountId,
            level,
            id: row.id,
            campaignId,
            // Copies land PAUSED (backend default) so a bulk duplicate can
            // never start spending across many entities at once.
          }),
        'Duplicated',
      ),
    [run, selection.selectedRows, level, adAccountId, campaignId],
  );

  const remove = useCallback(
    () =>
      run(
        selection.selectedRows,
        (row) => {
          if (level === 'campaign') {
            return deleteMetaCampaign({ adAccountId, campaignId: row.id });
          }
          if (level === 'adset') {
            return deleteMetaAdSet({ adAccountId, adSetId: row.id, campaignId });
          }
          return deleteMetaAd({ adAccountId, adId: row.id, campaignId });
        },
        'Deleted',
      ),
    [run, selection.selectedRows, level, adAccountId, campaignId],
  );

  return {
    busy,
    progress,
    onActivate: () => setStatus('ACTIVE'),
    onPause: () => setStatus('PAUSED'),
    onDuplicate: duplicate,
    onDelete: remove,
  };
}

// ─── bulk action bar ──────────────────────────────────────────────────────────

/**
 * BulkActionBar — floats over the table once rows are selected.
 *
 * Delete asks for confirmation; the other three don't, because pause/resume is
 * reversible in one click and a duplicate is created PAUSED so it can't spend
 * before the user looks at it.
 */
export function BulkActionBar({
  level,
  count,
  busy,
  progress,
  onActivate,
  onPause,
  onDuplicate,
  onDelete,
  onClear,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (count === 0) return null;

  const noun = levelNoun(level, count);

  const action = (label, Icon, handler, extraClass = '') => (
    <button
      type="button"
      onClick={handler}
      disabled={busy}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        extraClass ||
        'border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-[0_12px_32px_rgba(80,70,58,0.18)] dark:border-white/10 dark:bg-[#1B1B1B] dark:shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
      >
        <span className="px-1 text-xs font-semibold text-gray-900 dark:text-white">
          {busy && progress
            ? `${progress.done} of ${progress.total}…`
            : `${count} ${noun} selected`}
        </span>

        <span className="h-4 w-px bg-gray-200 dark:bg-white/10" />

        {busy ? (
          <span className="flex items-center gap-1.5 px-2 text-[11px] font-semibold text-gray-500 dark:text-white/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            Working…
          </span>
        ) : confirmingDelete ? (
          <>
            <span className="flex items-center gap-1.5 px-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              Delete {count} {noun} permanently?
            </span>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete?.();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/85 px-2.5 py-1.5 text-[11px] font-bold text-white transition-all hover:bg-red-500"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </>
        ) : (
          <>
            {onActivate && action('Activate', Play, onActivate)}
            {onPause && action('Pause', Pause, onPause)}
            {/* HIDDEN 2026-09-07 — see the note on the row duplicate buttons in
                MetaAdsTableView.jsx. Hiding it here covers bulk duplicate at
                all three levels in one place. useBulkActions still builds
                onDuplicate; nothing calls it while this is commented.
            {onDuplicate && action('Duplicate', Copy, onDuplicate)}
            */}
            {onDelete &&
              action(
                'Delete',
                Trash2,
                () => setConfirmingDelete(true),
                'border-gray-200 bg-gray-100 text-gray-700 hover:border-red-500/40 hover:bg-red-50 hover:text-red-600 dark:border-white/10 dark:bg-white/5 dark:text-white/80 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400',
              )}
          </>
        )}

        <span className="h-4 w-px bg-gray-200 dark:bg-white/10" />

        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          aria-label="Clear selection"
          className="flex h-6 w-6 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
