import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  BookOpen,
  Loader2,
  Pencil,
  Copy,
  Trash2,
  AlertCircle,
  Shield,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Info,
  Bell,
  PauseCircle,
} from 'lucide-react';
import {
  listUserRules,
  deleteUserRule,
  updateUserRule,
} from '@/apis/autopilot/autopilotApi';
import { globalToast } from '@/utils/globalToast';
import { Dropdown } from '@/components/MetaAds/MetaAdsAtoms';
import {
  Banner,
  PrimaryButton,
  SecondaryButton,
  CollapsibleCard,
  InfoTip,
} from '../_atoms';
import { SEVERITIES, EVALUATE_ON, ACTION_TYPES } from './ruleFieldsCatalog';
import RuleFormModal from './RuleFormModal';
import TemplatesModal from './TemplatesModal';

/**
 * Top-level "Your Autopilot rules" section for the Settings tab.
 *
 * Owns:
 *   - the user's rules list (CRUD + filters + client pagination)
 *   - opening / closing the form + templates modals
 *   - persisting per-row enable toggles + deletes
 *
 * Rendering model:
 *   - Toolbar = search input + filter dropdowns (state / severity / scope).
 *   - Rows = single-line, minimal — name reads "enabled" via brighter text,
 *     "disabled" via dimmer text. Severity dot + pill, scope pill, action
 *     pill all share the same flat chip look.
 *   - Pagination = client-side, 8 per page (mirrors the design mock).
 *
 * Drag-handle on each row is visual-only for now — backend has no ordering
 * field and the cron evaluates by createdAt today. Reorder semantics come
 * in a later phase; the affordance just signals where the handle WILL live.
 */
const PAGE_SIZE = 8;

const UserRulesSection = () => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state — only one open at a time.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Per-row busy ids for inline toggle / delete.
  const [busyId, setBusyId] = useState(null);

  // Toolbar state.
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState(''); // '', 'enabled', 'disabled'
  const [severityFilter, setSeverityFilter] = useState(''); // '', 'low', 'medium', 'high'
  const [scopeFilter, setScopeFilter] = useState(''); // '', 'campaign', 'adset', 'ad'
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listUserRules();
      setRules(Array.isArray(r?.rules) ? r.rules : []);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setPrefill(null);
    setFormOpen(true);
  };
  const openEdit = (rule) => {
    setEditing(rule);
    setPrefill(null);
    setFormOpen(true);
  };
  const onTemplatePicked = (templateBody) => {
    setEditing(null);
    setPrefill(templateBody);
    setFormOpen(true);
  };
  // Clone — open the form in CREATE mode (editing=null) pre-filled from an
  // existing rule, so Save calls createUserRule and produces a brand-new
  // rule. We reuse the template `prefill` path the form already supports.
  // Attachments are sanitized down to the fields the create validator
  // accepts: a stale `orphan`/`orphanedAt`/`_id` copied from the source
  // rule shouldn't ride along into a fresh rule.
  const openClone = (rule) => {
    setEditing(null);
    setPrefill({
      name: `${rule.name || 'Rule'} (copy)`,
      description: rule.description || '',
      severity: rule.severity || 'medium',
      evaluateOn: rule.evaluateOn || 'campaign',
      lookbackDays: rule.lookbackDays || 14,
      conditions: rule.conditions,
      action: rule.action,
      attachments: (rule.attachments || []).map((a) => ({
        adAccountId: a.adAccountId,
        campaignId: a.campaignId,
        ...(a.campaignName ? { campaignName: a.campaignName } : {}),
      })),
    });
    setFormOpen(true);
  };

  const onToggle = async (rule) => {
    setBusyId(rule._id);
    try {
      const r = await updateUserRule(rule._id, { enabled: !rule.enabled });
      if (r?.status && r.rule) {
        setRules((prev) =>
          prev.map((x) => (x._id === r.rule._id ? r.rule : x)),
        );
      }
    } catch (e) {
      globalToast.error(
        e?.response?.data?.error || e.message || 'Failed to toggle',
      );
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (rule) => {
    if (
      !window.confirm(
        `Delete "${rule.name}"? This is permanent — the cron will stop evaluating it immediately.`,
      )
    )
      return;
    setBusyId(rule._id);
    try {
      const r = await deleteUserRule(rule._id);
      if (r?.status) {
        setRules((prev) => prev.filter((x) => x._id !== rule._id));
        globalToast.success('Rule deleted.');
      }
    } catch (e) {
      globalToast.error(
        e?.response?.data?.error || e.message || 'Failed to delete',
      );
    } finally {
      setBusyId(null);
    }
  };

  const onSaved = (saved) => {
    setRules((prev) => {
      const idx = prev.findIndex((r) => r._id === saved._id);
      if (idx === -1) return [saved, ...prev];
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
  };

  // Filtered + paginated view of the rules list.
  const filteredRules = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (stateFilter === 'enabled' && r.enabled === false) return false;
      if (stateFilter === 'disabled' && r.enabled !== false) return false;
      if (severityFilter && r.severity !== severityFilter) return false;
      if (scopeFilter && r.evaluateOn !== scopeFilter) return false;
      if (s) {
        const hay = `${r.name || ''} ${r.description || ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rules, search, stateFilter, severityFilter, scopeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  // Snap back to a valid page if filters shrink the list.
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);
  const pagedRules = filteredRules.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  // Collapsed-state preview text — shows on the right of the card header
  // when closed so users can scan rule status without expanding.
  const enabledCount = rules.filter((r) => r.enabled !== false).length;
  const orphanCount = rules.reduce(
    (n, r) =>
      n + ((r.attachments || []).filter((a) => a.orphan).length > 0 ? 1 : 0),
    0,
  );
  let preview = '';
  if (loading) preview = 'Loading…';
  else if (error) preview = 'Failed to load';
  else if (rules.length === 0) preview = 'No rules yet';
  else
    preview = [
      `${rules.length} rule${rules.length === 1 ? '' : 's'}`,
      <span key="en" className="text-emerald-300">
        {enabledCount} enabled
      </span>,
      orphanCount > 0 ? `${orphanCount} with orphans` : null,
    ]
      .filter(Boolean)
      // Inline the elements with a separator while keeping the React key.
      .reduce((acc, v, i) => (i === 0 ? [v] : [...acc, ' · ', v]), []);

  return (
    <>
      <CollapsibleCard
        title={
          <span className="inline-flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/6 text-white/75">
              <Shield className="h-3.5 w-3.5" />
            </span>
            <span>Your Autopilot rules</span>
            <span className="hidden text-13 font-normal text-white/65 2xl:text-sm sm:inline">
              · Performance triggers and budget guardrails
            </span>
            <InfoTip text="Pause campaigns or get alerts when conditions match. Drag to reorder — rules run top to bottom." />
          </span>
        }
        preview={preview}
        warn={!!error || orphanCount > 0}
        defaultOpen
      >
        {/* Top action row — search field expands, buttons stay shrink-0. */}
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <SecondaryButton onClick={() => setTemplatesOpen(true)}>
            <BookOpen className="h-3 w-3" /> Browse templates
          </SecondaryButton>
          <PrimaryButton onClick={openCreate}>
            <Plus className="h-3 w-3" /> New rule
          </PrimaryButton>
        </div>

        {/* Filter toolbar. Lives ABOVE the rule list so users can narrow
            without scrolling — keeps the row design uncluttered (no inline
            filter chips on the rows themselves). */}
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-white/35" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search rules…"
              className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.03] pr-3 pl-9 text-xs text-white placeholder:text-white/35 focus:border-[#15DCFF]/40 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LabeledDropdown
              label="State"
              value={stateFilter}
              options={[
                { value: '', label: 'All' },
                { value: 'enabled', label: 'Enabled' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              onChange={(v) => {
                setStateFilter(v);
                setPage(1);
              }}
            />
            <LabeledDropdown
              label="Severity"
              value={severityFilter}
              options={[
                { value: '', label: 'Any severity' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
              onChange={(v) => {
                setSeverityFilter(v);
                setPage(1);
              }}
            />
            <LabeledDropdown
              label="Scope"
              value={scopeFilter}
              options={[
                { value: '', label: 'Any scope' },
                { value: 'campaign', label: 'Campaign' },
                { value: 'adset', label: 'Ad set' },
                { value: 'ad', label: 'Ad' },
              ]}
              onChange={(v) => {
                setScopeFilter(v);
                setPage(1);
              }}
            />
          </div>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-xs text-white/75 2xl:text-13">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading rules…
          </p>
        )}
        {error && (
          <Banner variant="error">Failed to load rules: {error}</Banner>
        )}

        {!loading && !error && rules.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-white">No rules yet.</p>
            <p className="mt-1 text-xs text-white/75 2xl:text-13">
              Start from a template, or build one from scratch.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <SecondaryButton onClick={() => setTemplatesOpen(true)}>
                <BookOpen className="h-3 w-3" /> Browse templates
              </SecondaryButton>
              <PrimaryButton onClick={openCreate}>
                <Plus className="h-3 w-3" /> New rule
              </PrimaryButton>
            </div>
          </div>
        )}

        {!loading && !error && rules.length > 0 && pagedRules.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/2 px-4 py-6 text-center text-xs text-white/75 2xl:text-13">
            No rules match these filters.
          </div>
        )}

        {!loading && !error && pagedRules.length > 0 && (
          <div className="flex flex-col">
            {pagedRules.map((rule) => (
              <RuleRow
                key={rule._id}
                rule={rule}
                busy={busyId === rule._id}
                onToggle={() => onToggle(rule)}
                onEdit={() => openEdit(rule)}
                onClone={() => openClone(rule)}
                onDelete={() => onDelete(rule)}
              />
            ))}
          </div>
        )}

        {!loading && !error && filteredRules.length > PAGE_SIZE && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={filteredRules.length}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        )}
      </CollapsibleCard>

      {/* Modals live outside the CollapsibleCard so closing the card
          doesn't unmount an open modal mid-edit. */}
      <RuleFormModal
        open={formOpen}
        rule={editing}
        prefill={prefill}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setPrefill(null);
        }}
        onSaved={onSaved}
      />

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={onTemplatePicked}
      />
    </>
  );
};

// ─── RuleRow ───────────────────────────────────────────────────────────────
// One-line, minimal row. Enabled rules read brighter (text-white, accent
// toggle); disabled rules dim down so the eye can scan the list for
// what's actually live without parsing per-row chrome. Hover lifts the
// row a touch so the drag handle + actions read as interactive.
const RuleRow = ({ rule, busy, onToggle, onEdit, onClone, onDelete }) => {
  const sev =
    SEVERITIES.find((s) => s.value === rule.severity) || SEVERITIES[1];
  const level = EVALUATE_ON.find((e) => e.value === rule.evaluateOn);
  const action = ACTION_TYPES.find((a) => a.value === rule.action?.type);
  const orphanCount = (rule.attachments || []).filter((a) => a.orphan).length;
  const enabled = rule.enabled !== false;
  const ActionIcon = rule.action?.type === 'pause' ? PauseCircle : Bell;

  return (
    <div
      className={`group flex items-start gap-2 border-b border-white/8 py-2.5 transition-colors last:border-b-0 hover:bg-white/2.5 sm:items-center sm:gap-3 ${
        enabled ? '' : 'opacity-70'
      }`}
    >
      <span
        className="hidden h-7 w-5 shrink-0 items-center justify-center text-white/30 transition-colors hover:text-white/60 sm:flex"
        title="Drag to reorder (coming soon)"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      {/* toggle */}
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        title={enabled ? 'Click to disable' : 'Click to enable'}
        className={`relative mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 sm:mt-0 ${
          enabled ? 'bg-emerald-500' : 'bg-white/15'
        }`}
      >
        <span
          className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>

      <span
        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full sm:mt-0 ${sev.dot}`}
        aria-hidden
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <span
          className={`min-w-0 truncate text-sm font-semibold ${
            enabled ? 'text-white' : 'text-white/65'
          }`}
          title={rule.description || ''}
        >
          {rule.name}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <SeverityPill sev={sev} />
          <ScopePill label={level?.label || rule.evaluateOn} />
          <ActionPill
            icon={<ActionIcon className="h-3 w-3" />}
            label={action?.label || rule.action?.type}
          />
          {orphanCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-10 font-medium text-amber-300 2xl:px-2 2xl:text-[11px]"
              title="One or more attached campaigns no longer exist on Meta."
            >
              <AlertCircle className="h-3 w-3" />
              {orphanCount} orphan
            </span>
          )}
        </div>
      </div>

      {/* actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          onClick={undefined}
          title={rule.description || rule.name}
          disabled={busy}
        >
          <Info className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onEdit} title="Edit" disabled={busy}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton onClick={onClone} title="Clone" disabled={busy}>
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          onClick={onDelete}
          title="Delete"
          disabled={busy}
          danger
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
};

// ─── small UI primitives ──────────────────────────────────────────────────
const SeverityPill = ({ sev }) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-10 font-bold uppercase tracking-wide 2xl:px-2 2xl:text-[11px] ${sev.tone}`}
  >
    <span className={`h-1 w-1 rounded-full ${sev.dot}`} />
    {sev.label}
  </span>
);

const ScopePill = ({ label }) => (
  <span className="inline-flex shrink-0 items-center rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-10 font-medium text-white/80 2xl:px-2 2xl:text-[11px]">
    {label}
  </span>
);

const ActionPill = ({ icon, label }) => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-10 font-medium text-white/80 2xl:px-2 2xl:text-[11px]">
    {icon}
    {label}
  </span>
);

const IconButton = ({ children, onClick, title, disabled, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || !onClick}
    title={title}
    className={`flex h-7 w-7 items-center justify-center rounded-md text-white/70 transition-all disabled:opacity-40 2xl:h-8 2xl:w-8 ${
      danger
        ? 'hover:bg-red-500/10 hover:text-red-400'
        : 'hover:bg-white/5 hover:text-white'
    } ${!onClick ? 'cursor-default' : ''}`}
  >
    {children}
  </button>
);

// ─── Labeled dropdown ─────────────────────────────────────────────────────
// `STATE  All ▾` style trigger — label is muted, selected value sits beside
// it. Mirrors the Action log filter bar's visual rhythm.
const LabeledDropdown = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) || options[0];
  return (
    <Dropdown
      anchor="left"
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs transition-all hover:border-white/20 hover:bg-white/[0.06]"
        >
          <span className="text-10 font-bold tracking-wider text-white/60 uppercase 2xl:text-[11px]">
            {label}
          </span>
          <span className="font-medium text-white">{selected.label}</span>
          <ChevronDown className="h-3 w-3 text-white/70 2xl:h-3.5 2xl:w-3.5" />
        </button>
      }
    >
      <div className="w-44 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-white/5 ${
              value === o.value ? 'bg-white/5 text-[#15DCFF]' : 'text-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Dropdown>
  );
};

// ─── Pagination ───────────────────────────────────────────────────────────
const Pagination = ({ page, totalPages, total, pageSize, onPage }) => {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  // Compact page-number list — small enough to render all pages inline for
  // the typical rule count (<20 rules). Falls back to current/next-only
  // when the rule list grows unusually large.
  const pageButtons =
    totalPages <= 6
      ? Array.from({ length: totalPages }, (_, i) => i + 1)
      : [1, page, totalPages].filter(
          (v, i, a) => v >= 1 && v <= totalPages && a.indexOf(v) === i,
        );
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-3">
      <span className="text-10 text-white/70 2xl:text-[11px]">
        Showing{' '}
        <span className="text-white">
          {from}–{to}
        </span>{' '}
        of <span className="text-white">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <PagerButton
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-2.5 w-2.5" /> Prev
        </PagerButton>
        {pageButtons.map((p) => (
          <PagerButton
            key={p}
            onClick={() => onPage(p)}
            active={page === p}
          >
            {p}
          </PagerButton>
        ))}
        <PagerButton
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next <ChevronRight className="h-2.5 w-2.5" />
        </PagerButton>
      </div>
    </div>
  );
};

const PagerButton = ({ active, disabled, onClick, children, ...rest }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    {...rest}
    className={`inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md border px-1.5 text-10 font-medium transition-all disabled:opacity-40 2xl:h-7 2xl:min-w-7 2xl:px-2 2xl:text-[11px] ${
      active
        ? 'border-[#15DCFF]/40 bg-[#15DCFF]/10 text-[#15DCFF]'
        : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-white/20 hover:bg-white/[0.07] hover:text-white'
    }`}
  >
    {children}
  </button>
);

export default UserRulesSection;
