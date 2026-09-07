import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useSelector } from 'react-redux';
import {
  RefreshCw,
  Download,
  Loader2,
  Inbox,
  AlertCircle,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
  CalendarDays,
  Megaphone,
  Clock,
} from 'lucide-react';
import {
  getMetaPages,
  getLeadForms,
  getFormLeads,
  downloadFormLeadsCsv,
} from '@/apis/metaAds/metaAdsApi';
import { Dropdown } from './MetaAdsAtoms';
import { globalToast } from '@/utils/globalToast';
import { GA4Events } from '@/utils/ga4';

/**
 * Leads tab — view + download captured Lead Form submissions.
 *
 * Flow: pick a Page → pick a Lead Form on that Page → the form's
 * captured leads load into a table; "Download CSV" exports them all
 * (opens in Excel). Backed by GET /meta-ads/get-form-leads and
 * /export-form-leads, both of which need the connected Facebook
 * account to have granted the `leads_retrieval` OAuth scope — when it
 * hasn't, the 403 carries `code: LEADS_SCOPE_MISSING` and this tab offers
 * a reconnect button rather than a dead-end error.
 *
 * Both endpoints are served from a short-lived server-side cache (Meta
 * rate-limits the leads edge by lead volume). Only the Refresh button
 * bypasses it; the tab shows how old the data is so a cache hit is never
 * mistaken for a live read.
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

// Re-render cadence for the "Updated N min ago" label. The value only ever
// changes at minute granularity, so a 30s tick keeps it honest without a
// per-second render loop.
const FRESHNESS_TICK_MS = 30_000;

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

// The server's leads_retrieval 403 carries this discriminator. Matching on
// it (not on the message prose) is what lets us offer the reconnect CTA.
const SCOPE_MISSING_CODE = 'LEADS_SCOPE_MISSING';

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

// "Updated just now" / "Updated 4 min ago" / "Updated 2 hr ago". Reads the
// server's `fetchedAt`, which is when the rows came off Meta — on a server
// cache hit that is deliberately older than the request, so this reports the
// data's real age rather than the time we last asked for it.
const fmtFreshness = (iso) => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Updated ${hrs} hr ago`;
  return `Updated ${Math.floor(hrs / 24)} d ago`;
};

// The server flattens custom_disclaimer_responses to "key: Yes; key2: No"
// (see utils/metaLeads.js normalizeLead). Split it back into pairs so the
// table can render a tick/cross per consent box instead of a raw string.
// Anchored on the trailing Yes/No because a checkbox_key may itself contain
// a colon.
const parseConsent = (s) =>
  String(s || '')
    .split('; ')
    .map((part) => {
      const m = /^(.*):\s(Yes|No)$/.exec(part.trim());
      return m ? { key: m[1], checked: m[2] === 'Yes' } : null;
    })
    .filter(Boolean);

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
  // Toolbar variant: no label row, auto width, shorter control — so the
  // campaign filter sits beside Search/Refresh instead of stacking with the
  // full-width Page/Form pickers above.
  compact = false,
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
    <div className={compact ? '' : 'flex flex-col gap-1.5'}>
      {!compact && (
        <label className="text-[11px] font-medium text-gray-500 dark:text-white/50">
          {label}
        </label>
      )}
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
            className={`flex items-center gap-2 rounded-xl border border-gray-200 bg-white text-xs text-gray-900 backdrop-blur-xl transition-all hover:border-gray-300 disabled:cursor-default disabled:opacity-70 dark:border-white/6 dark:bg-[#171717] dark:text-white dark:hover:border-white/10 ${
              compact ? 'h-[30px] max-w-48 px-2.5' : 'h-9 w-full px-3'
            }`}
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

/**
 * StatTile — one figure of context above the table. `truncate` is for values
 * that are user-authored and unbounded (a campaign name), where the tile must
 * not be allowed to set the row height.
 */
function StatTile({ icon: Icon, label, value, sub = null, truncate = false }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-white/8 dark:bg-white/3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-gray-400 dark:bg-white/6 dark:text-white/40">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-10 font-semibold uppercase tracking-wide text-gray-400 dark:text-white/40">
          {label}
        </p>
        <p
          className={`text-sm font-bold text-gray-900 dark:text-white ${truncate ? 'truncate' : ''}`}
          title={truncate ? String(value) : undefined}
        >
          {value}
        </p>
        {sub && (
          <p className="truncate text-10 text-gray-400 dark:text-white/35">{sub}</p>
        )}
      </div>
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
  const [fetchedAt, setFetchedAt] = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Set when the failure is specifically a missing `leads_retrieval` scope,
  // which is recoverable by re-running OAuth — see the reconnect CTA below.
  const [scopeMissing, setScopeMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [tablePage, setTablePage] = useState(1);

  // Client-side narrowing over the already-loaded set. Deliberately NOT a
  // server round trip: the leads edge is rate-limited by lead volume (one
  // uncached read can cost 100 paginated calls), and everything the user
  // could filter on is already in hand.
  const [query, setQuery] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  // Bumped on a timer purely so the relative "Updated N min ago" label
  // re-renders as it ages; nothing reads the value itself.
  const [, setFreshnessTick] = useState(0);

  const { userData } = useSelector((state) => state.socket);

  // Monotonic request ids — a slow response from a previously-selected
  // Page/Form must not overwrite state belonging to the current one. Mirrors
  // the campaignsRequestRef / analyticsRequestRef pattern in
  // MetaAdsDashboard.jsx.
  const pagesRequestRef = useRef(0);
  const formsRequestRef = useRef(0);
  const leadsRequestRef = useRef(0);

  const selectedForm = forms.find((f) => f.id === formId) || null;

  useEffect(() => {
    GA4Events.adsManagerUsingLeads({ source: 'leads_tab', success: true });
  }, []);

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
        const list = r?.pages || [];
        setPages(list);
        // Auto-select rather than leaving the picker empty. Most accounts have
        // exactly one Page, and requiring a choice from a list of one meant
        // landing on a blank screen with two placeholders. The form effect
        // below then chains off this, so the common case is data on arrival
        // with no clicks at all.
        if (list.length) setPageId(list[0].id);
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
        const list = r?.forms || [];
        setForms(list);
        // Prefer a form that has captured something. Picking a genuinely empty
        // form first would land the user on "No leads captured on this form
        // yet", which reads like the feature is broken rather than like an
        // unused form. Falls back to the first form when none have leads.
        const withLeads = list.find((f) => Number(f.leadsCount) > 0);
        const pick = withLeads || list[0];
        if (pick) setFormId(pick.id);
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
  // `refresh` is passed only by the Refresh button. Meta rate-limits the
  // leads edge by lead volume and one uncached read can cost up to 100
  // paginated calls, so automatic loads (form switch, tab re-entry) ride the
  // server cache and only an explicit user action forces a fresh crawl.
  const loadLeads = useCallback(
    (refresh = false) => {
      if (!formId || !pageId || !facebookId) return;
      const requestId = ++leadsRequestRef.current;
      setLeadsLoading(true);
      setError(null);
      setScopeMissing(false);
      getFormLeads({ formId, pageId, facebookId, refresh })
        .then((r) => {
          if (requestId !== leadsRequestRef.current) return;
          setLeads(r?.leads || []);
          setFieldNames(r?.fieldNames || []);
          setTruncated(!!r?.truncated);
          setFetchedAt(r?.fetchedAt || null);
          setTablePage(1);
        })
        .catch((e) => {
          if (requestId !== leadsRequestRef.current) return;
          const d = e?.response?.data;
          setError(d?.details || d?.error || e.message);
          setScopeMissing(d?.code === SCOPE_MISSING_CODE);
          setLeads([]);
          setFieldNames([]);
          setTruncated(false);
          setFetchedAt(null);
        })
        .finally(() => {
          if (requestId !== leadsRequestRef.current) return;
          setLeadsLoading(false);
        });
    },
    [formId, pageId, facebookId],
  );

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Age the freshness label while the tab sits open. Only runs when there is
  // a timestamp to age.
  useEffect(() => {
    if (!fetchedAt) return undefined;
    const t = setInterval(
      () => setFreshnessTick((n) => n + 1),
      FRESHNESS_TICK_MS,
    );
    return () => clearInterval(t);
  }, [fetchedAt]);

  // Re-run Facebook OAuth to pick up `leads_retrieval`. The backend's
  // /api/auth/facebook already sends auth_type=rerequest, which is what
  // forces Facebook to re-show the permissions dialog for an
  // already-connected user instead of silently skipping the new scope.
  const handleReconnect = () => {
    if (!userData?.user_id) {
      globalToast.error('Please sign in to reconnect Facebook.');
      return;
    }
    window.location.href = `${BACKEND_HOST}/api/auth/facebook?userId=${userData.user_id}&feUrl=${encodeURIComponent(window.location.href)}`;
  };

  // Only render a Consent column when the form actually has disclaimer
  // checkboxes — otherwise every lead-form user pays a permanently empty
  // column. The data itself has always been fetched and exported to CSV;
  // it just never reached the table.
  const showConsent = useMemo(
    () => leads.some((l) => l.disclaimerResponses),
    [leads],
  );

  // Campaign options for the filter — derived from the loaded leads rather
  // than fetched, so it can only ever offer campaigns that actually appear in
  // this form's results.
  const campaignOptions = useMemo(() => {
    const seen = new Map();
    for (const l of leads) {
      const name = l.campaignName;
      if (name) seen.set(name, (seen.get(name) || 0) + 1);
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ id: name, name, sub: `${count} lead${count === 1 ? '' : 's'}` }));
  }, [leads]);

  // Free-text runs over every ANSWER field rather than a hardcoded
  // name/email/phone trio — Instant Forms are user-defined, so which fields
  // exist varies per form and guessing would silently miss the one someone
  // searches by. Attribution names are matched too, since "find that lead from
  // the diwali campaign" is the other way people look.
  const filteredLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !campaignFilter) return leads;
    return leads.filter((l) => {
      if (campaignFilter && l.campaignName !== campaignFilter) return false;
      if (!q) return true;
      const haystack = [
        ...Object.values(l.fields || {}),
        l.campaignName,
        l.adsetName,
        l.adName,
      ];
      return haystack.some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [leads, query, campaignFilter]);

  const isFiltered = !!(query.trim() || campaignFilter);

  // Header stats. Computed over ALL loaded leads, not the filtered view — they
  // describe the form, and having them move as you type would make them read
  // as search results rather than context.
  const stats = useMemo(() => {
    if (!leads.length) return null;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let thisWeek = 0;
    let mostRecent = null;
    const byCampaign = new Map();
    for (const l of leads) {
      const t = l.createdTime ? new Date(l.createdTime).getTime() : NaN;
      if (!Number.isNaN(t)) {
        if (t >= weekAgo) thisWeek += 1;
        if (mostRecent === null || t > mostRecent) mostRecent = t;
      }
      if (l.campaignName) {
        byCampaign.set(l.campaignName, (byCampaign.get(l.campaignName) || 0) + 1);
      }
    }
    const top = [...byCampaign.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    return {
      total: leads.length,
      thisWeek,
      topCampaign: top ? { name: top[0], count: top[1] } : null,
      mostRecent: mostRecent ? new Date(mostRecent).toISOString() : null,
    };
  }, [leads]);

  // Filtering changes how many pages exist; staying on page 4 of a now
  // 1-page result set renders an empty table.
  useEffect(() => {
    setTablePage(1);
  }, [query, campaignFilter]);

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

  const totalPages = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const safePage = Math.min(tablePage, totalPages);
  const visibleLeads = filteredLeads.slice(
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

      {/* Stats — context about the form, sitting where the page used to be
          blank. Hidden until leads exist so an empty form doesn't render four
          zeroes. */}
      {stats && !leadsLoading && (
        <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile
            icon={Users}
            label={truncated ? 'Leads loaded' : 'Total leads'}
            value={stats.total.toLocaleString()}
            sub={truncated ? 'capped — form has more' : null}
          />
          <StatTile
            icon={CalendarDays}
            label="Last 7 days"
            value={stats.thisWeek.toLocaleString()}
            sub={
              stats.total
                ? `${Math.round((stats.thisWeek / stats.total) * 100)}% of loaded`
                : null
            }
          />
          <StatTile
            icon={Megaphone}
            label="Top campaign"
            value={stats.topCampaign?.name || '—'}
            sub={stats.topCampaign ? `${stats.topCampaign.count} leads` : null}
            truncate
          />
          <StatTile
            icon={Clock}
            label="Most recent"
            value={stats.mostRecent ? fmtDate(stats.mostRecent) : '—'}
          />
        </div>
      )}

      {/* Toolbar */}
      {formId && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-gray-500 dark:text-white/50">
            {leadsLoading
              ? 'Loading leads…'
              : isFiltered
                ? // Say what's hidden. A bare "23 leads" while a filter is
                  // active reads as the form only having 23.
                  `${filteredLeads.length} of ${leads.length} lead${leads.length === 1 ? '' : 's'}`
                : `${truncated ? 'First ' : ''}${leads.length} lead${leads.length === 1 ? '' : 's'}`}
            {/* Freshness — the server may have served this from a short-lived
                cache, so without it a Refresh that changes nothing is
                indistinguishable from stale data. */}
            {!leadsLoading && fmtFreshness(fetchedAt) && (
              <span className="text-gray-400 dark:text-white/35">
                {' · '}
                {fmtFreshness(fetchedAt)}
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-white/40" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, phone…"
                className="w-56 rounded-xl border border-gray-200 bg-gray-100 py-1.5 pl-8 pr-7 text-xs text-gray-900 placeholder:text-gray-400 transition-colors hover:border-gray-300 focus:border-gray-400 focus:outline-none dark:border-white/6 dark:bg-[#171717] dark:text-white dark:placeholder:text-white/35 dark:hover:border-white/10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {/* Only worth showing once the leads actually span more than one
                campaign — a one-option filter is noise. */}
            {campaignOptions.length > 1 && (
              <FieldDropdown
                value={campaignFilter}
                onChange={setCampaignFilter}
                options={[
                  { id: '', name: 'All campaigns' },
                  ...campaignOptions,
                ]}
                placeholder="All campaigns"
                emptyText="No campaigns"
                compact
              />
            )}
            <button
              onClick={() => loadLeads(true)}
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

      {/* Error. A missing `leads_retrieval` scope is the one failure here the
          user can actually fix themselves, so it gets its own copy and a
          reconnect action rather than the generic dead-end banner. */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-13 text-red-600 dark:text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-300" />
          <div className="min-w-0">
            <div className="font-semibold text-red-700 dark:text-red-100">
              {scopeMissing
                ? 'Leads access not granted'
                : "Couldn't load leads"}
            </div>
            {scopeMissing
              ? 'Your Facebook connection is missing the permission needed to read Instant Form submissions. Reconnect and accept the leads access prompt to fix this.'
              : error}
            {scopeMissing && (
              <button
                type="button"
                onClick={handleReconnect}
                className="mt-2 flex items-center gap-1.5 rounded-xl bg-[#1877F2] px-3 py-1.5 text-10 2xl:text-xs font-semibold text-white transition-all hover:bg-[#1665d8]"
              >
                Reconnect Facebook
              </button>
            )}
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
        ) : filteredLeads.length === 0 ? (
          // Distinct from "no leads captured" — the form HAS leads, the filter
          // just excluded them all, and the fix is to clear it.
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400 dark:text-white/40">
            <Search className="h-6 w-6" />
            <p className="text-sm">No leads match your search.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCampaignFilter('');
              }}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 transition-all hover:border-gray-300 hover:text-gray-700 dark:border-white/10 dark:text-white/50 dark:hover:border-white/25 dark:hover:text-white"
            >
              Clear filters
            </button>
          </div>
        ) : filteredLeads.length > 0 ? (
          <table className="w-full border-collapse text-left text-13">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-500 shadow-[0_1px_0_rgba(0,0,0,0.06)] dark:bg-[#1A1A1A] dark:text-white/55 dark:shadow-[0_1px_0_rgba(255,255,255,0.08)]">
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
                {showConsent && (
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Consent</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => (
                <tr key={l.id} className="border-t border-gray-200 text-gray-700 dark:border-white/6 dark:text-white/85">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-gray-500 dark:text-white/55">
                    {fmtDate(l.createdTime)}
                  </td>
                  {fieldNames.map((f) => {
                    const v = l.fields?.[f];
                    return (
                      <td key={f} className="px-3 py-2 align-top">
                        {v ? (
                          // Clamped, not truncated: a two-line cap keeps every
                          // row the same height while still showing most
                          // answers in full, with the title carrying the rest.
                          // Free-text fields (a full postal address) otherwise
                          // ran to four lines and set the height for the table.
                          //
                          // The width cap sits on this div, NOT the <td>:
                          // browsers ignore max-width on a cell in an
                          // auto-layout table.
                          <div
                            className="line-clamp-2 max-w-56 break-words"
                            title={String(v)}
                          >
                            {v}
                          </div>
                        ) : (
                          <span className="text-gray-300 dark:text-white/25">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 align-top text-gray-500 dark:text-white/55">
                    <div className="max-w-44 truncate" title={l.campaignName || ''}>
                      {l.campaignName || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500 dark:text-white/55">
                    <div className="max-w-44 truncate" title={l.adsetName || ''}>
                      {l.adsetName || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500 dark:text-white/55">
                    <div className="max-w-44 truncate" title={l.adName || ''}>
                      {l.adName || '—'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 capitalize dark:text-white/55">
                    {l.platform || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-white/55">
                    {l.source || '—'}
                  </td>
                  {showConsent && (
                    <td className="px-3 py-2">
                      {l.disclaimerResponses ? (
                        <div className="flex flex-col gap-0.5">
                          {parseConsent(l.disclaimerResponses).map((c) => (
                            <span
                              key={c.key}
                              className="flex items-center gap-1 whitespace-nowrap text-10"
                              title={`${c.key}: ${c.checked ? 'Accepted' : 'Not accepted'}`}
                            >
                              {c.checked ? (
                                <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                              ) : (
                                <X className="h-3 w-3 shrink-0 text-red-500" />
                              )}
                              <span className="max-w-56 truncate text-gray-500 dark:text-white/55">
                                {prettifyField(c.key)}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-300 dark:text-white/25">—</span>
                      )}
                    </td>
                  )}
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
            Page {safePage} of {totalPages} ·{' '}
            {isFiltered
              ? `${filteredLeads.length.toLocaleString()} matching`
              : `${leads.length.toLocaleString()} loaded`}
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
