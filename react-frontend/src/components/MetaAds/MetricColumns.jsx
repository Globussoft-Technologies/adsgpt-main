import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { getTableMetrics, updateMetaAdsPreference } from '@/apis/metaAds/metaAdsApi';
import { formatMetricValue } from './metaAdsUtils';

/**
 * Shared pieces for the selectable metric COLUMNS on the campaign / ad set /
 * ad tables.
 *
 * Metrics are fetched separately from the entity lists on purpose: the list
 * endpoints cache for 2h because entity rows are stable, while metrics are
 * volatile (5 min). See metaTableMetricsController.js for the full rationale.
 * The date window therefore scopes the NUMBERS only — never which rows exist.
 */

/**
 * Fetch the selected metrics for one table level, keyed by entity id.
 * Makes no request at all when nothing is selected (the default), so a user
 * who hasn't opted in costs zero Meta calls.
 *
 * `nonce` is the refetch lever — bump it after the picker CLOSES rather than
 * on every debounced save, or toggling ten metrics costs ten Meta
 * round-trips (each a genuine cache miss under a new fingerprint).
 */
export function useMetricColumns({
  adAccountId,
  level,
  campaignId,
  adsetId,
  dateParams,
  entries,
  nonce = 0,
}) {
  const [metricsById, setMetricsById] = useState({});
  const [loading, setLoading] = useState(false);

  // Primitive dep so the effect doesn't re-run on every parent render just
  // because `entries` / `dateParams` are freshly-built objects.
  const entriesKey = (entries || []).map((e) => e.key).join(',');
  const dateKey = dateParams?.since
    ? `${dateParams.since}_${dateParams.until}`
    : dateParams?.datePreset || '';

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      if (!adAccountId || !entriesKey) {
        setMetricsById({});
        return;
      }
      setLoading(true);
      try {
        const r = await getTableMetrics({
          adAccountId,
          level,
          campaignId,
          adsetId,
          ...dateParams,
          refresh,
        });
        setMetricsById(r?.metrics || {});
      } catch {
        // Metrics are additive to a table that already renders without them —
        // failing quietly beats blanking the whole table.
        setMetricsById({});
      } finally {
        setLoading(false);
      }
      // dateParams/entries are covered by their primitive keys below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [adAccountId, level, campaignId, adsetId, dateKey, entriesKey],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
  }, [load, nonce]);

  return { metricsById, loading, refresh: () => load({ refresh: true }) };
}

/**
 * Everything one table needs for its metric columns, so the three tables
 * each stay a few lines instead of repeating this wiring.
 */
export function useTableMetricColumns({
  level,
  adAccountId,
  campaignId,
  adsetId,
  dateParams,
  metricsCatalog,
  metricKeys,
  onMetricKeysSaved,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Bumped on picker CLOSE (not per debounced save) so toggling ten metrics
  // costs one refetch instead of ten.
  const [nonce, setNonce] = useState(0);
  const dirtyRef = useRef(false);

  const keysCsv = (metricKeys || []).join(',');
  const entries = useMemo(
    () => {
      const set = new Set(metricKeys || []);
      return (metricsCatalog || []).filter((m) => set.has(m.key));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricsCatalog, keysCsv],
  );

  const { metricsById, loading } = useMetricColumns({
    adAccountId,
    level,
    campaignId,
    adsetId,
    dateParams,
    entries,
    nonce,
  });

  // Metric values live outside the row object, so sorting needs a resolver.
  // The dotted-path branch also fixes the Ads table's `creative.*` column,
  // which has never sorted with the plain flat lookup.
  const resolveSortValue = (row, sortKey) => {
    if (typeof sortKey === 'string' && sortKey.startsWith('__m.')) {
      // Absent metric sorts as 0 (renders "—") so zero-delivery entities sink
      // to the bottom on a descending spend sort rather than sorting as text.
      return metricsById[row.id]?.[sortKey.slice(4)] ?? 0;
    }
    if (typeof sortKey === 'string' && sortKey.includes('.')) {
      return sortKey.split('.').reduce((o, k) => o?.[k], row) ?? '';
    }
    return row[sortKey] ?? '';
  };

  return {
    entries,
    metricsById,
    loading,
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => {
      setPickerOpen(false);
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setNonce((n) => n + 1);
      }
    },
    onSaved: (nextKeys) => {
      dirtyRef.current = true;
      onMetricKeysSaved?.(level, nextKeys);
    },
    persist: (nextKeys) => updateMetaAdsPreference({ tables: { [level]: nextKeys } }),
    resolveSortValue,
  };
}

/**
 * `<th>` cells for the selected metrics, rendered inside an existing header
 * row. `SortTh` is injected rather than imported to avoid a circular import
 * (MetaAdsTableView owns it and also imports this module).
 */
export function MetricHeaderCells({ entries, SortTh, sortKey, sortDir, onSort }) {
  return (entries || []).map((entry) => (
    <SortTh
      key={entry.key}
      label={entry.label}
      colKey={`__m.${entry.key}`}
      align="right"
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
    />
  ));
}

/**
 * `<td>` cells for one row's metric values.
 *
 * `—` vs `0` is a real distinction here: no entry for this entity means Meta
 * returned no insights row at all (nothing delivered in the window), whereas
 * a 0 means it delivered and the metric is genuinely zero. Users read those
 * very differently, so don't collapse them.
 */
export function MetricBodyCells({ entries, values, loading, currency }) {
  return (entries || []).map((entry) => (
    <td
      key={entry.key}
      className="whitespace-nowrap px-4 py-3 text-right text-xs text-gray-900 tabular-nums dark:text-white"
    >
      {loading && !values
        ? <span className="text-gray-400 dark:text-white/30">…</span>
        : values && values[entry.key] !== undefined
          ? formatMetricValue(entry.format, values[entry.key], currency)
          : <span className="text-gray-400 dark:text-white/30">—</span>}
    </td>
  ));
}

/** Toolbar button that opens the column picker for one table. */
export function CustomizeColumnsButton({ onClick, count = 0 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Choose which metrics appear as columns"
      className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-10 font-medium text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 dark:border-white/[0.06] dark:bg-[#171717] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white"
    >
      <SlidersHorizontal className="h-3 w-3" />
      Columns{count > 0 ? ` (${count})` : ''}
    </button>
  );
}

/**
 * Muted label telling the user which window the metric columns cover.
 * Without it the numbers look unexplained next to date-independent columns
 * like Status and Budget ("why don't these match Ads Manager?").
 */
export function MetricsWindowLabel({ dateParams, label }) {
  if (!dateParams) return null;
  return (
    <span className="text-10 text-gray-400 dark:text-white/35">
      Metrics: {label}
    </span>
  );
}
