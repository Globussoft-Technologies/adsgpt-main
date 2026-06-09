import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download, Loader2, Inbox, AlertCircle } from 'lucide-react';
import {
  getMetaPages,
  getLeadForms,
  getFormLeads,
  downloadFormLeadsCsv,
} from '@/apis/metaAds/metaAdsApi';
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
 */

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

const selectClass =
  'w-full appearance-none rounded-xl border border-gray-300 bg-gray-100 px-3 py-2 ' +
  'text-sm text-gray-900 transition-colors hover:border-gray-400 focus:border-gray-400 ' +
  'focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ' +
  'dark:border-white/10 dark:bg-[#171717] dark:text-white dark:hover:border-white/20 dark:focus:border-white/30';

export default function LeadsTab({ adAccountId }) {
  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pageId, setPageId] = useState('');

  const [forms, setForms] = useState([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formId, setFormId] = useState('');

  const [leads, setLeads] = useState([]);
  const [fieldNames, setFieldNames] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const selectedForm = forms.find((f) => f.id === formId) || null;

  // ── load Pages for the selected ad account ──────────────────────────
  useEffect(() => {
    if (!adAccountId) return;
    setPagesLoading(true);
    setPages([]);
    setPageId('');
    setForms([]);
    setFormId('');
    setLeads([]);
    getMetaPages(adAccountId)
      .then((r) => setPages(r?.pages || []))
      .catch(() => setPages([]))
      .finally(() => setPagesLoading(false));
  }, [adAccountId]);

  // ── load Lead Forms when a Page is picked ───────────────────────────
  useEffect(() => {
    if (!pageId) {
      setForms([]);
      setFormId('');
      return;
    }
    setFormsLoading(true);
    setForms([]);
    setFormId('');
    setLeads([]);
    setError(null);
    getLeadForms(pageId)
      .then((r) => setForms(r?.forms || []))
      .catch((e) => setError(e?.response?.data?.error || e.message))
      .finally(() => setFormsLoading(false));
  }, [pageId]);

  // ── load leads when a Form is picked ────────────────────────────────
  const loadLeads = useCallback(() => {
    if (!formId || !pageId) return;
    setLeadsLoading(true);
    setError(null);
    getFormLeads({ formId, pageId })
      .then((r) => {
        setLeads(r?.leads || []);
        setFieldNames(r?.fieldNames || []);
      })
      .catch((e) => {
        const d = e?.response?.data;
        setError(d?.details || d?.error || e.message);
        setLeads([]);
        setFieldNames([]);
      })
      .finally(() => setLeadsLoading(false));
  }, [formId, pageId]);

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
        formName: selectedForm?.name,
      });
    } catch (e) {
      globalToast.error(
        e?.response?.data?.error || e.message || 'Failed to download leads',
      );
    } finally {
      setDownloading(false);
    }
  };

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
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-gray-500 dark:text-white/50">
            Facebook Page
          </label>
          <select
            className={selectClass}
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            disabled={pagesLoading}
          >
            <option value="">
              {pagesLoading
                ? 'Loading pages…'
                : pages.length
                ? 'Select a Page'
                : 'No Pages on this ad account'}
            </option>
            {pages.map((p) => (
              <option key={p.id} value={p.id} className="bg-gray-100 dark:bg-[#171717]">
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-gray-500 dark:text-white/50">
            Lead Form
          </label>
          <select
            className={selectClass}
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            disabled={!pageId || formsLoading}
          >
            <option value="">
              {!pageId
                ? 'Pick a Page first'
                : formsLoading
                ? 'Loading forms…'
                : forms.length
                ? 'Select a Lead Form'
                : 'No Lead Forms on this Page'}
            </option>
            {forms.map((f) => (
              <option key={f.id} value={f.id} className="bg-gray-100 dark:bg-[#171717]">
                {f.name}
                {f.leadsCount ? ` · ${f.leadsCount} leads` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Toolbar */}
      {formId && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500 dark:text-white/50">
            {leadsLoading
              ? 'Loading leads…'
              : `${leads.length} lead${leads.length === 1 ? '' : 's'}`}
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
              {leads.map((l) => (
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
    </div>
  );
}
