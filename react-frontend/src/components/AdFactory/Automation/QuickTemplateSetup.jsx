import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getAdAccounts, getMetaPages } from '@/apis/metaAds/metaAdsApi';
import { CONTROL, CONTROL_H, LABEL, MENU, MENU_ITEM, MUTED } from '@/components/AdFactory/v2/_tokens';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ----------------------------------------------------------------------------
// QuickTemplateSetup — the "we'll set this up for you" path inside the Meta
// TemplatePicker card.
//
// Scheduling used to dead-end for anyone with no saved template: the picker
// told them to go build one in Meta Ads Manager and come back, which sends a
// user who came here to make ads off to finish a different product first.
//
// This collects the only three things the backend genuinely cannot infer —
// which ad account, which Page, and the daily budget (owned by the parent's
// budget field) — and hands them to the synthesizer, which reads every other
// default (optimization goal, billing event, bid strategy, CTA) from the
// objective's own cell in config/wizardSchema.js.
//
// Scope note: this first cut fixes the objective to Traffic → Website, the
// safe default and by far the most common case. Anything else is still served
// by picking a saved template. An objective picker here needs the wizard-schema
// endpoint to drive the conversion-location cascade, which is deliberately not
// in this change.
// ----------------------------------------------------------------------------

export const AUTO_OBJECTIVE = 'OUTCOME_TRAFFIC';
export const AUTO_CONVERSION_LOCATION = 'WEBSITE';

// Shape written into form state at `template.auto`.
export const emptyAutoSetup = () => ({
  adAccountId: '',
  adAccountName: '',
  pageId: '',
  pageName: '',
  objective: AUTO_OBJECTIVE,
  conversionLocation: AUTO_CONVERSION_LOCATION,
});

// An auto setup is only submittable once both ids are present. Budget lives on
// the parent form and is validated there, alongside the saved-path override.
export const isAutoSetupComplete = (auto) =>
  !!auto?.adAccountId && !!auto?.pageId;

export default function QuickTemplateSetup({
  value,
  onChange,
  facebookId,
  disabled = false,
}) {
  const auto = value || emptyAutoSetup();

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState('');

  const [pages, setPages] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState('');

  // Keep the latest onChange without making every effect depend on a prop the
  // parent re-creates each render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const patch = useCallback((next) => {
    onChangeRef.current?.({ ...emptyAutoSetup(), ...next });
  }, []);

  // ── Ad accounts ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!facebookId) {
      setAccounts([]);
      return undefined;
    }
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsError('');
    getAdAccounts({ facebookId })
      .then((res) => {
        if (cancelled) return;
        // The endpoint answers { adAccounts: [...] }. This read `res.data`,
        // which is never present, so the list was ALWAYS empty — the picker
        // just had no empty state to say so with, and rendered as a blank box.
        // MetaAdsDashboard and the campaign wizards all read `adAccounts`.
        const list = Array.isArray(res?.adAccounts) ? res.adAccounts : [];
        setAccounts(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setAccounts([]);
        setAccountsError(
          err?.response?.data?.message || 'Could not load your ad accounts.',
        );
      })
      .finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [facebookId]);

  // Auto-select when there is exactly one — asking someone to "choose" from a
  // list of one is a question with no information in it.
  useEffect(() => {
    if (accounts.length !== 1 || auto.adAccountId) return;
    const only = accounts[0];
    const id = only?.account_id || only?.id || '';
    if (!id) return;
    patch({ ...auto, adAccountId: String(id), adAccountName: only?.name || '' });
  }, [accounts, auto, patch]);

  // ── Pages (scoped to the chosen ad account) ───────────────────────────────

  useEffect(() => {
    if (!facebookId || !auto.adAccountId) {
      setPages([]);
      return undefined;
    }
    let cancelled = false;
    setPagesLoading(true);
    setPagesError('');
    getMetaPages(auto.adAccountId, { facebookId })
      .then((res) => {
        if (cancelled) return;
        // Same defect as the accounts read above: the endpoint answers
        // { pages: [...] }, which is what CreateCampaignWizardV2 and LeadsTab
        // both read.
        const list = Array.isArray(res?.pages) ? res.pages : [];
        setPages(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setPages([]);
        setPagesError(
          err?.response?.data?.message || 'Could not load your Facebook Pages.',
        );
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [facebookId, auto.adAccountId]);

  useEffect(() => {
    if (pages.length !== 1 || auto.pageId) return;
    const only = pages[0];
    const id = only?.id || '';
    if (!id) return;
    patch({ ...auto, pageId: String(id), pageName: only?.name || '' });
  }, [pages, auto, patch]);

  const accountOptions = useMemo(
    () =>
      accounts.map((a) => ({
        id: String(a?.account_id || a?.id || ''),
        label: a?.name || a?.account_id || a?.id || 'Ad account',
      })),
    [accounts],
  );

  const pageOptions = useMemo(
    () =>
      pages.map((p) => ({ id: String(p?.id || ''), label: p?.name || p?.id || 'Page' })),
    [pages],
  );

  const noPages = !pagesLoading && !pagesError && auto.adAccountId && pageOptions.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Ad account"
        value={auto.adAccountId}
        options={accountOptions}
        loading={accountsLoading}
        error={accountsError}
        disabled={disabled || accountsLoading}
        placeholder={accountsLoading ? 'Loading ad accounts…' : 'Select an ad account'}
        onSelect={(opt) =>
          patch({
            ...auto,
            adAccountId: opt.id,
            adAccountName: opt.label,
            // A different account has a different Page list — clear the old
            // pick rather than carrying a Page that may not belong to it.
            pageId: '',
            pageName: '',
          })
        }
      />

      <SelectField
        label="Facebook Page"
        value={auto.pageId}
        options={pageOptions}
        loading={pagesLoading}
        error={pagesError}
        disabled={disabled || !auto.adAccountId || pagesLoading}
        placeholder={
          !auto.adAccountId
            ? 'Pick an ad account first'
            : pagesLoading
              ? 'Loading Pages…'
              : 'Select a Page'
        }
        onSelect={(opt) => patch({ ...auto, pageId: opt.id, pageName: opt.label })}
      />

      {noPages && (
        <Notice>
          This ad account has no Facebook Pages available. Ads run under a Page,
          so pick a different ad account or add a Page to this one.
        </Notice>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------

function SelectField({
  label,
  value,
  options,
  loading,
  error,
  disabled,
  placeholder,
  onSelect,
}) {
  // The project's shadcn Select, as used by Full control's InputCommonDropdown
  // and the shared CommonDropdown. The native <select> this replaced had its
  // option list drawn by the OS, so it ignored the dark palette completely, and
  // its loading spinner sat on top of the browser's own chevron.
  const empty = !loading && (!options || options.length === 0);

  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL}>{label}</label>

      <Select
        value={value || ''}
        disabled={disabled || loading || empty}
        onValueChange={(id) => {
          const opt = options.find((o) => o.id === id);
          if (opt) onSelect(opt);
        }}
      >
        <SelectTrigger
          className={`${CONTROL_H}! w-full ${CONTROL} px-3 text-sm font-medium tracking-[-0.006em] shadow-none disabled:cursor-not-allowed disabled:opacity-55`}
        >
          {/* Loading is stated in the trigger rather than as a spinner layered
              over the chevron — one control, one message. */}
          {loading ? (
            <span className={`flex items-center gap-2 ${MUTED}`}>
              <Loader2 className="size-3.5 animate-spin" />
              Loading…
            </span>
          ) : (
            <SelectValue placeholder={empty ? 'None available' : placeholder} />
          )}
        </SelectTrigger>

        <SelectContent className={`z-9999 max-h-72 ${MENU}`}>
          {(options || []).map((o) => (
            <SelectItem key={o.id} value={o.id} className={MENU_ITEM}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && <span className="text-13 text-[#B45309] dark:text-[#E8A33D]">{error}</span>}
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-3.5 py-3">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[#B45309] dark:text-[#E8A33D]" />
      <p className="text-13 leading-relaxed text-[#92400E] dark:text-[#E8A33D]">{children}</p>
    </div>
  );
}
