import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { getAuditRules } from '@/apis/autopilot/autopilotApi';
import { Dropdown } from '@/components/MetaAds/MetaAdsAtoms';
import { Banner, SeverityBadge } from './_atoms';

/**
 * Per-account rule-overrides editor — tabular layout.
 *
 * Storage shape: autopilotSettings.perAccountOverrides
 *   { 'act_xxx': { 'AUD-01': { min_spend: 100000 } } }
 *
 * One row per (rule × threshold). Account picker at top, severity filter
 * tabs, and a "customised only" toggle. The table groups consecutive rows
 * for the same rule visually, and customised rows highlight with a cyan
 * tint so users can spot what they've changed at a glance.
 *
 * Reads /audit-rules so threshold metadata (label/hint/type/step/default)
 * doesn't have to be hardcoded here.
 */
const RuleOverridesSection = ({
  selectedAccounts = [], // [{id, name}] — bare ids
  perAccountOverrides = {},
  onChange,
}) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [activeAccountId, setActiveAccountId] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [showOnlyCustomised, setShowOnlyCustomised] = useState(false);

  // ─── load rule catalog ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getAuditRules();
        if (alive) setRules(r?.rules || []);
      } catch (e) {
        if (alive)
          setError(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Default the active account to the first selected one once the list
  // hydrates. Preserve a still-valid prior pick if accounts get re-checked.
  useEffect(() => {
    if (!selectedAccounts.length) return;
    setActiveAccountId((prev) =>
      prev && selectedAccounts.find((a) => a.id === prev)
        ? prev
        : selectedAccounts[0].id,
    );
  }, [selectedAccounts]);

  const tunableRules = useMemo(
    () => rules.filter((r) => r.tunable && r.tunable.length > 0),
    [rules],
  );

  const activeAccount = selectedAccounts.find((a) => a.id === activeAccountId);
  const acctKey = activeAccount ? `act_${activeAccount.id}` : null;
  const acctOverrides = (acctKey && perAccountOverrides[acctKey]) || {};

  // Total customised threshold count across all rules for the active
  // account — drives the header counter.
  const totalCustomised = useMemo(
    () =>
      Object.values(acctOverrides).reduce(
        (sum, ruleOv) => sum + Object.keys(ruleOv || {}).length,
        0,
      ),
    [acctOverrides],
  );

  // Flatten rules into one row per (rule × threshold). Each row carries
  // its rule + threshold + the user's current override (if any).
  const tableRows = useMemo(() => {
    let rows = [];
    for (const rule of tunableRules) {
      for (const th of rule.tunable) {
        const currentValue = acctOverrides[rule.id]?.[th.key];
        rows.push({
          rule,
          threshold: th,
          currentValue,
          isOverridden:
            currentValue !== undefined && currentValue !== null,
        });
      }
    }
    if (severityFilter !== 'all') {
      rows = rows.filter((r) => r.rule.severity === severityFilter);
    }
    if (showOnlyCustomised) {
      rows = rows.filter((r) => r.isOverridden);
    }
    return rows;
  }, [tunableRules, acctOverrides, severityFilter, showOnlyCustomised]);

  // Group consecutive same-rule threshold rows so the table can render the
  // rule cell with rowSpan — making it visually obvious that 2+ threshold
  // rows belong to the same rule (instead of relying on a tiny ↳ arrow).
  const groupedRows = useMemo(() => {
    const out = [];
    for (const row of tableRows) {
      const last = out[out.length - 1];
      if (last && last.rule.id === row.rule.id) {
        last.thresholds.push(row);
      } else {
        out.push({ rule: row.rule, thresholds: [row] });
      }
    }
    return out;
  }, [tableRows]);

  // Severity tab counts so filter badges feel useful (not just toggles).
  const severityCounts = useMemo(() => {
    const all = tunableRules.flatMap((r) => r.tunable.map(() => r.severity));
    return {
      all: all.length,
      critical: all.filter((s) => s === 'critical').length,
      warning: all.filter((s) => s === 'warning').length,
      opportunity: all.filter((s) => s === 'opportunity').length,
    };
  }, [tunableRules]);

  const updateThreshold = (ruleId, thresholdKey, value) => {
    if (!acctKey) return;
    const ruleOv = { ...(acctOverrides[ruleId] || {}) };
    if (value === undefined || value === null) {
      delete ruleOv[thresholdKey];
    } else {
      ruleOv[thresholdKey] = value;
    }
    const acctOv = { ...acctOverrides };
    if (Object.keys(ruleOv).length === 0) {
      delete acctOv[ruleId];
    } else {
      acctOv[ruleId] = ruleOv;
    }
    const next = { ...perAccountOverrides };
    if (Object.keys(acctOv).length === 0) {
      delete next[acctKey];
    } else {
      next[acctKey] = acctOv;
    }
    onChange(next);
  };

  // ─── render ────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-white/6 bg-[#0a0a0a]/60 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-white/60">
            Rule overrides (advanced)
          </h4>
          <p className="mt-1 text-13 text-[#BEBEBE]">
            Tune rule thresholds per account when the defaults don't fit.
            Leave a row blank to use the default.
          </p>
        </div>
        {selectedAccounts.length > 0 && (
          <Dropdown
            anchor="right"
            open={accountOpen}
            onClose={() => setAccountOpen(false)}
            trigger={
              <button
                type="button"
                onClick={() => setAccountOpen((p) => !p)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white transition-all hover:border-white/10"
              >
                <span className="text-10 uppercase tracking-wider text-white/40">
                  Account
                </span>
                <span className="max-w-45 truncate font-medium">
                  {activeAccount?.name || 'Pick one'}
                </span>
                <ChevronDown className="h-3 w-3 text-[#BEBEBE]" />
              </button>
            }
          >
            <div className="w-72 p-1">
              <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
                {selectedAccounts.map((a) => {
                  const k = `act_${a.id}`;
                  const overrideCount = Object.keys(
                    perAccountOverrides[k] || {},
                  ).length;
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        setActiveAccountId(a.id);
                        setAccountOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/5 ${
                        activeAccountId === a.id ? 'bg-white/5' : ''
                      }`}
                    >
                      <span className="flex flex-col">
                        <span
                          className={`text-xs font-medium ${
                            activeAccountId === a.id
                              ? 'text-[#15DCFF]'
                              : 'text-white'
                          }`}
                        >
                          {a.name}
                        </span>
                        <span className="text-10 font-mono text-white/50">
                          act_{a.id}
                        </span>
                      </span>
                      {overrideCount > 0 && (
                        <span className="rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-1.5 py-0.5 text-10 font-medium text-[#15DCFF]">
                          {overrideCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </Dropdown>
        )}
      </div>

      {loading && (
        <p className="text-xs text-white/50">Loading rule catalog…</p>
      )}
      {error && (
        <Banner variant="error">Failed to load rule catalog: {error}</Banner>
      )}

      {!loading && !error && selectedAccounts.length === 0 && (
        <p className="text-13 text-[#BEBEBE]">
          Pick at least one account in "Which accounts to monitor" before
          customising rule thresholds.
        </p>
      )}

      {!loading && !error && selectedAccounts.length > 0 && activeAccount && (
        <>
          {/* Filter bar */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <SegBtn
                active={severityFilter === 'all'}
                onClick={() => setSeverityFilter('all')}
                count={severityCounts.all}
              >
                All
              </SegBtn>
              <SegBtn
                active={severityFilter === 'critical'}
                onClick={() => setSeverityFilter('critical')}
                count={severityCounts.critical}
                tone="critical"
              >
                Critical
              </SegBtn>
              <SegBtn
                active={severityFilter === 'warning'}
                onClick={() => setSeverityFilter('warning')}
                count={severityCounts.warning}
                tone="warning"
              >
                Warning
              </SegBtn>
              <SegBtn
                active={severityFilter === 'opportunity'}
                onClick={() => setSeverityFilter('opportunity')}
                count={severityCounts.opportunity}
                tone="opportunity"
              >
                Opportunity
              </SegBtn>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-10 uppercase tracking-wider text-white/55">
                <span className="font-bold text-[#15DCFF]">
                  {totalCustomised}
                </span>{' '}
                customised
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 text-10 text-white/70">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showOnlyCustomised}
                  onChange={(e) => setShowOnlyCustomised(e.target.checked)}
                />
                <span
                  className={`flex h-3.5 w-6 items-center rounded-full transition-all ${
                    showOnlyCustomised ? 'bg-[#15DCFF]/80' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                      showOnlyCustomised
                        ? 'translate-x-3'
                        : 'translate-x-0.5'
                    }`}
                  />
                </span>
                Customised only
              </label>
            </div>
          </div>

          {/* Table */}
          <div className="max-h-120 overflow-x-auto overflow-y-auto rounded-lg border border-white/6 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
                <tr className="border-b border-white/8 text-left">
                  <th className="px-3 py-2 text-10 font-bold uppercase tracking-wider text-white/40">
                    Rule
                  </th>
                  <th className="px-3 py-2 text-10 font-bold uppercase tracking-wider text-white/40">
                    Threshold
                  </th>
                  <th className="px-3 py-2 text-right text-10 font-bold uppercase tracking-wider text-white/40">
                    Default
                  </th>
                  <th className="px-3 py-2 text-10 font-bold uppercase tracking-wider text-white/40">
                    Your value
                  </th>
                  <th className="w-10 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-xs text-white/50"
                    >
                      {showOnlyCustomised
                        ? 'No customised thresholds for this account yet.'
                        : 'No rules match this filter.'}
                    </td>
                  </tr>
                )}
                {/* Render group-by-group. The rule cell uses rowSpan so
                    multiple thresholds for one rule visually merge into a
                    single block on the left. Bottom borders only at group
                    boundaries — no internal lines cutting through the
                    merged cell. */}
                {groupedRows.map((group, gIdx) => {
                  const isLastGroup = gIdx === groupedRows.length - 1;
                  // The merged rule cell's bottom edge lands at the bottom
                  // of the group's last row, so its border-b acts as the
                  // group separator on the rule column.
                  const ruleCellBorder = isLastGroup
                    ? ''
                    : 'border-b border-white/8';
                  return group.thresholds.map(
                    (
                      { rule, threshold, currentValue, isOverridden },
                      i,
                    ) => {
                      const isLastInGroup =
                        i === group.thresholds.length - 1;
                      const cellBottomBorder =
                        isLastInGroup && !isLastGroup
                          ? 'border-b border-white/8'
                          : '';
                      const rowTint = isOverridden
                        ? 'bg-[#15DCFF]/5'
                        : 'hover:bg-white/2';
                      return (
                        <tr
                          key={`${rule.id}-${threshold.key}`}
                          className={rowTint}
                        >
                          {i === 0 && (
                            <td
                              rowSpan={group.thresholds.length}
                              className={`border-r border-white/8 px-3 py-2 align-top ${ruleCellBorder} ${
                                group.thresholds.some((t) => t.isOverridden)
                                  ? 'bg-[#15DCFF]/4'
                                  : ''
                              }`}
                            >
                              <RuleCell rule={rule} />
                            </td>
                          )}
                          <td
                            className={`px-3 py-2 align-top ${cellBottomBorder}`}
                          >
                            <div className="text-xs font-medium text-white">
                              {threshold.label || threshold.key}
                            </div>
                            {threshold.hint && (
                              <p className="mt-0.5 text-10 leading-relaxed text-white/40">
                                {threshold.hint}
                              </p>
                            )}
                          </td>
                          <td
                            className={`px-3 py-2 text-right align-top font-mono text-xs text-white/70 ${cellBottomBorder}`}
                          >
                            {formatThresholdValue(threshold)}
                          </td>
                          <td
                            className={`px-3 py-2 align-top ${cellBottomBorder}`}
                          >
                            <OverrideInput
                              threshold={threshold}
                              value={currentValue}
                              onChange={(v) =>
                                updateThreshold(rule.id, threshold.key, v)
                              }
                            />
                          </td>
                          <td
                            className={`px-2 py-2 align-top ${cellBottomBorder}`}
                          >
                            {isOverridden && (
                              <button
                                type="button"
                                title="Reset to default"
                                onClick={() =>
                                  updateThreshold(
                                    rule.id,
                                    threshold.key,
                                    undefined,
                                  )
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-all hover:bg-white/5 hover:text-white"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  },
                );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ─── small atoms ───────────────────────────────────────────────────────────

const RuleCell = ({ rule }) => (
  <div className="flex flex-col gap-0.5">
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs font-semibold text-white">
        {rule.id}
      </span>
      <SeverityBadge severity={rule.severity} />
    </div>
    <span className="text-10 text-white/50">{rule.entity}</span>
    {rule.description && (
      <p className="mt-0.5 max-w-xs text-10 leading-relaxed text-white/55">
        {rule.description}
      </p>
    )}
  </div>
);

const SegBtn = ({ active, onClick, children, count, tone }) => {
  const base =
    'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-10 font-medium transition-all';
  const tones = {
    critical: active ? 'bg-red-500/15 text-red-300' : 'text-white/55 hover:text-white',
    warning: active ? 'bg-amber-500/15 text-amber-300' : 'text-white/55 hover:text-white',
    opportunity: active ? 'bg-emerald-500/15 text-emerald-300' : 'text-white/55 hover:text-white',
  };
  const fallback = active ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${tones[tone] || fallback}`}
    >
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-white/5 px-1.5 py-px text-10 font-mono text-white/55">
          {count}
        </span>
      )}
    </button>
  );
};

// One controlled number input. Empty string in the input ↔ no override.
const OverrideInput = ({ threshold, value, onChange }) => {
  const display =
    value === undefined || value === null || value === '' ? '' : String(value);

  const handle = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onChange(undefined);
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    onChange(num);
  };

  return (
    <input
      type="number"
      min={threshold.min ?? 0}
      max={threshold.max}
      step={threshold.step ?? 1}
      placeholder={String(threshold.default)}
      value={display}
      onChange={handle}
      className="h-7 w-28 rounded-md border border-white/10 bg-white/[0.06] px-2 text-xs text-white placeholder:text-white/30 focus:border-[#15DCFF]/40 focus:outline-none"
    />
  );
};

// Show the rule's default value in a more readable way per type. Falls
// back to the raw number for unknown types.
function formatThresholdValue(threshold) {
  const v = threshold.default;
  if (v === undefined || v === null) return '—';
  switch (threshold.type) {
    case 'currency':
      // Stored in smallest currency unit (paise / cents). Show with
      // thousand separator so 500000 reads as 500,000 — caller still
      // edits in the same unit, so we don't divide.
      return Number(v).toLocaleString();
    case 'percent':
      return `${v}%`;
    case 'ratio':
      // 0–1 ratios: show 2dp.
      return Number(v).toFixed(2);
    case 'multiplier':
      return `${v}×`;
    case 'count':
      return Number(v).toLocaleString();
    default:
      return String(v);
  }
}

export default RuleOverridesSection;
