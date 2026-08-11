import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Download,
  Loader2,
  Inbox,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  getMetaPages,
  getLeadForms,
  getFormLeads,
  downloadFormLeadsCsv,
} from '@/apis/metaAds/metaAdsApi';
import { Dropdown } from './MetaAdsAtoms';
import { globalToast } from '@/utils/globalToast';

/**
 * Leads tab — view + download captured Lead Form submissions.
 *
 * Flow: pick a Page → pick a Lead Form on that Page → the form's
 * captured leads load into a table; "Download CSV" exports them all
 * (opens in Excel). Backed by GET /meta-ads/get-form-leads and
 * /export-form-leads, both of which need the connected Facebook
 * account to have granted the `leads_retrieval` OAuth scope.
 *
 * Only Instant-Form leads are retrievable — leads captured on the
 * advertiser's own website (the Leads/Website cell) never reach Meta,
 * so they can't appear here.
 *
 * `facebookId` is required, not optional: every other surface in
 * MetaAdsDashboard threads the active connection explicitly and waits for
 * it. Falling back to the ambient sessionStorage selection would let this
 * tab resolve Pages against a different connection than the rest of the
 * dashboard is showing whenever the two disagree.
 */

// Rows rendered at a time. The server caps a fetch at 5,000 leads; painting
// that many <tr> at once is what made a busy form feel broken.
const PAGE_SIZE = 100;

// "full_name" → "Full name", "phone_number" → "Phone number".
const prettifyField = (name) =>
  String(name || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

/**
 * Labelled picker built on the shared `Dropdown` atom — the same trigger +
 * menu treatment as the Facebook account and ad account selectors, so the
 * Leads tab doesn't fall back to an unstyled native <select>.
 *
 * `options` are `{ id, name, sub }`; `sub` renders as the dimmed second line.
 */
function FieldDropdown({
  label,
  value,
  options,
  onChange,
  loading = false,
  disabled = false,
  loadingText,
  emptyText,
  placeholder,
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) || null;
  const isDisabled = disabled || loading || options.length === 0;

  const triggerText = loading
    ? loadingText
    : options.length === 0
      ? emptyText
      : selected?.name || placeholder;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium text-gray-500 dark:text-white/50">
        {label}
      </label>
      <Dropdown
        open={open}
        onClose={() => setOpen(false)}
        anchor="left"
        trigger={
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            onClick={() => !isDisabled && setOpen((v) => !v)}
            disabled={isDisabled}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 backdrop-blur-xl transition-all hover:border-gray-300 disabled:cursor-default disabled:opacity-70 dark:border-white/6 dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
          >
            {loading && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500 dark:text-white/60" />
            )}
            <span
              className={`flex-1 truncate text-left font-medium ${
                selected ? '' : 'text-gray-500 dark:text-white/50'
              }`}
            >
              {triggerText}
            </span>
            {!isDisabled && (
              <ChevronDown className="h-3 w-3 shrink-0 text-gray-500 dark:text-[#BEBEBE]" />
            )}
          </button>
        }
      >
        {/* Definite width, matching the Facebook / ad-account selectors: the
            shared Dropdown panel is absolutely positioned and shrink-to-fit,
            so a w-full child would size to its content, not to the trigger. */}
        <div className="w-72 p-1">
          <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
            {options.map((o) => {
              const active = o.id === value;
              return (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                    active ? 'bg-gray-100 dark:bg-white/5' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-xs font-medium ${
                        active ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {o.name}
                    </p>
                    {o.sub && (
                      <p className="truncate text-10 text-gray-500 dark:text-white/55">
                        {o.sub}
                      </p>
                    )}
                  </div>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />}
                </button>
              );
            })}
          </div>
        </div>
      </Dropdown>
    </div>
  );
}

export default function LeadsTab({ adAccountId, facebookId }) {
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageId, setPageId] = useState('');

  const [forms, setForms] = useState([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formId, setFormId] = useState('');

  const [leads, setLeads] = useState([]);
  const [fieldNames, setFieldNames] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [tablePage, setTablePage] = useState(1);

  // Monotonic request ids — a slow response from a previously-selected
  // Page/Form must not overwrite state belonging to the current one. Mirrors
  // the campaignsRequestRef / analyticsRequestRef pattern in
  // MetaAdsDashboard.jsx.
  const pagesRequestRef = useRef(0);
  const formsRequestRef = useRef(0);
  const leadsRequestRef = useRef(0);

  const selectedForm = forms.find((f) => f.id === formId) || null;

  // ── load Pages for the selected ad account ──────────────────────────
  useEffect(() => {
    if (!adAccountId || !facebookId) return;
    const requestId = ++pagesRequestRef.current;
    setPagesLoading(true);
    setPages([]);
    setPageId('');
    setForms([]);
    setFormId('');
    setLeads([]);
    setTruncated(false);
    getMetaPages(adAccountId, { facebookId })
      .then((r) => {
        if (requestId !== pagesRequestRef.current) return;
        setPages(r?.pages || []);
      })
      .catch(() => {
        if (requestId !== pagesRequestRef.current) return;
        setPages([]);
      })
      .finally(() => {
        if (requestId !== pagesRequestRef.current) return;
        setPagesLoading(false);
      });
  }, [adAccountId, facebookId]);

  // ── load Lead Forms when a Page is picked ───────────────────────────
  useEffect(() => {
    if (!pageId || !facebookId) {
      setForms([]);
      setFormId('');
      return;
    }
    const requestId = ++formsRequestRef.current;
    setFormsLoading(true);
    setForms([]);
    setFormId('');
    setLeads([]);
    setTruncated(false);
    setError(null);
    getLeadForms(pageId, { facebookId })
      .then((r) => {
        if (requestId !== formsRequestRef.current) return;
        setForms(r?.forms || []);
      })
      .catch((e) => {
        if (requestId !== formsRequestRef.current) return;
        setError(e?.response?.data?.error || e.message);
      })
      .finally(() => {
        if (requestId !== formsRequestRef.current) return;
        setFormsLoading(false);
      });
  }, [pageId, facebookId]);

  // ── load leads when a Form is picked ────────────────────────────────
  const loadLeads = useCallback(() => {
    if (!formId || !pageId || !facebookId) return;
    const requestId = ++leadsRequestRef.current;
    setLeadsLoading(true);
    setError(null);
    getFormLeads({ formId, pageId, facebookId })
      .then((r) => {
        if (requestId !== leadsRequestRef.current) return;
        setLeads(r?.leads || []);
        setFieldNames(r?.fieldNames || []);
        setTruncated(!!r?.truncated);
        setTablePage(1);
      })
      .catch((e) => {
        if (requestId !== leadsRequestRef.current) return;
        const d = e?.response?.data;
        setError(d?.details || d?.error || e.message);
        setLeads([]);
        setFieldNames([]);
        setTruncated(false);
      })
      .finally(() => {
        if (requestId !== leadsRequestRef.current) return;
        setLeadsLoading(false);
      });
  }, [formId, pageId, facebookId]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const onDownload = async () => {
    if (!formId || !pageId) return;
    setDownloading(true);
    try {
      await downloadFormLeadsCsv({
        formId,
        pageId,
        facebookId,
        formName: selectedForm?.name,
        truncated,
      });
    } catch (e) {
      globalToast.error(
        e?.response?.data?.error || e.message || 'Failed to download leads',
      );
    } finally {
      setDownloading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const visibleLeads = leads.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <p className="text-base font-bold text-gray-900 2xl:text-xl dark:text-white">Leads</p>
        <p className="text-xs 2xl:text-sm text-gray-500 dark:text-[#BEBEBE]">
          View and download leads captured by your Instant Forms. Export to
          Excel to follow up directly.
        </p>
      </div>

      {/* Page + Form pickers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 shrink-0">
        <FieldDropdown
          label="Facebook Page"
          value={pageId}
          onChange={setPageId}
          loading={pagesLoading}
          options={pages.map((p) => ({ id: p.id, name: p.name }))}
          loadingText="Loading pages…"
          emptyText="No Pages on this ad account"
          placeholder="Select a Page"
        />
        <FieldDropdown
          label="Lead Form"
          value={formId}
          onChange={setFormId}
          loading={formsLoading}
          disabled={!pageId}
          options={forms.map((f) => ({
            id: f.id,
            name: f.name,
            sub: f.leadsCount ? `${f.leadsCount} leads` : null,
          }))}
          loadingText="Loading forms…"
          emptyText={pageId ? 'No Lead Forms on this Page' : 'Pick a Page first'}
          placeholder="Select a Lead Form"
        />
      </div>

      {/* Toolbar */}
      {formId && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500 dark:text-white/50">
            {leadsLoading
              ? 'Loading leads…'
              : `${truncated ? 'First ' : ''}${leads.length} lead${leads.length === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={loadLeads}
              disabled={leadsLoading}
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-100 px-3 py-1.5 text-10 2xl:text-xs font-medium text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 dark:border-white/6 dark:bg-[#171717] dark:text-[#BEBEBE] dark:hover:border-white/10 dark:hover:text-white"
            >
              <RefreshCw className={`h-3 w-3 ${leadsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={onDownload}
              disabled={downloading || leadsLoading || leads.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-1.5 text-10 2xl:text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Download Excel (CSV)
            </button>
          </div>
        </div>
      )}

      {/* Truncation notice — the count above is a floor, not the form's
          total, and the export is partial in exactly the same way. */}
      {truncated && formId && !leadsLoading && (
        <div className="flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-13 text-amber-700 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
          <div>
            <div className="font-semibold text-amber-800 dark:text-amber-100">
              Showing the first {leads.length.toLocaleString()} leads
            </div>
            This form has more leads than we load at once, and the CSV export
            is limited the same way — it downloads as a “partial” file.
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-13 text-red-600 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-300" />
          <div>
            <div className="font-semibold text-red-700 dark:text-red-100">Couldn&apos;t load leads</div>
            {error}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-xl border border-gray-200 dark:border-white/8">
        {leadsLoading ? (
          <div className="flex h-40 items-center justify-center gap-2 text-gray-500 dark:text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
          </div>
        ) : !formId ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-gray-400 dark:text-white/40">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Pick a Page and a Lead Form to see captured leads.</p>
          </div>
        ) : leads.length === 0 && !error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-gray-400 dark:text-white/40">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">No leads captured on this form yet.</p>
          </div>
        ) : leads.length > 0 ? (
          <table className="w-full border-collapse text-left text-13">
            <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-[#1A1A1A] dark:text-white/55">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Captured</th>
                {fieldNames.map((f) => (
                  <th key={f} className="whitespace-nowrap px-3 py-2 font-semibold">
                    {prettifyField(f)}
                  </th>
                ))}
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Campaign</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Ad set</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Ad</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Platform</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => (
                <tr key={l.id} className="border-t border-gray-200 text-gray-700 dark:border-white/6 dark:text-white/85">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {fmtDate(l.createdTime)}
                  </td>
                  {fieldNames.map((f) => (
                    <td key={f} className="px-3 py-2">
                      {l.fields?.[f] || <span className="text-gray-300 dark:text-white/25">—</span>}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {l.campaignName || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {l.adsetName || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {l.adName || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 capitalize dark:text-white/55">
                    {l.platform || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {l.source || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Pager — the export always covers every loaded lead, not just the
          visible page. */}
      {!leadsLoading && totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between text-xs text-gray-500 dark:text-white/55">
          <span>
            Page {safePage} of {totalPages} · {leads.length.toLocaleString()} loaded
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setTablePage(safePage - 1)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 transition-all hover:border-gray-300 disabled:opacity-40 dark:border-white/10 dark:hover:border-white/25"
            >
              <ChevronLeft className="h-3 w-3" /> Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setTablePage(safePage + 1)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 transition-all hover:border-gray-300 disabled:opacity-40 dark:border-white/10 dark:hover:border-white/25"
            >
              Next <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
