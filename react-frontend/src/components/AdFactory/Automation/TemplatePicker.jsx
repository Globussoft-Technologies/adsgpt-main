import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Target, FileText, ExternalLink, Coins, Loader2, Inbox, AlertCircle } from 'lucide-react';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import {
  fetchMetaAdsTemplates,
  fetchMetaAdsTemplateById,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectMetaAdsTemplates,
  selectMetaAdsTemplatesLoading,
  selectMetaAdsTemplatesError,
  selectMetaAdsTemplateById,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';

// ----------------------------------------------------------------------------
// TemplatePicker — replaces the old TargetSection cascade (ad account /
// campaign / ad sets / page) with a single dropdown sourced from the user's
// Meta Ads V2 templates. The picked template carries the full wizard form
// state inside `payload` — adAccountId, ad set targeting, page, CTA, budgets,
// everything. We just attach it on the autopilot job and the backend uses it.
//
// `value` shape:
//   {
//     id: string,                  // template id (also serves as "picked" flag)
//     dailyBudgetOverride: number, // optional — user can edit; null = use template's
//     objective: string,           // mirrored from template so CallToActionSection
//                                  // can look up CTA options without a second fetch
//   }
//
// The dailyBudgetOverride is the ONE override we surface inline (per the
// product spec). Everything else is locked to whatever the template carries.
// ----------------------------------------------------------------------------

export default function TemplatePicker({ value, onChange, disabled }) {
  const dispatch = useDispatch();
  const templates = useSelector(selectMetaAdsTemplates);
  const loadingList = useSelector(selectMetaAdsTemplatesLoading);
  const listError = useSelector(selectMetaAdsTemplatesError);

  const picked = value || {};
  const pickedBucket = useSelector((state) =>
    selectMetaAdsTemplateById(state, picked.id)
  );
  const pickedTemplate = pickedBucket?.template;
  const pickedLoading = pickedBucket?.loading;

  useEffect(() => {
    dispatch(fetchMetaAdsTemplates());
  }, [dispatch]);

  // When the user picks an id, fetch the full template if we don't have it
  // cached. We also mirror the resolved objective onto `value` so the CTA
  // section in AutomationForm can react without a second slice round-trip.
  useEffect(() => {
    if (!picked.id) return;
    dispatch(fetchMetaAdsTemplateById(picked.id));
  }, [picked.id, dispatch]);

  useEffect(() => {
    if (!pickedTemplate) return;
    // Sync the template's objective + dailyBudget defaults into the form
    // value the first time we resolve a template.
    if (picked.objective !== pickedTemplate.objective) {
      onChange?.({
        ...picked,
        objective: pickedTemplate.objective || null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTemplate?.id]);

  const templateOptions = (templates || []).map((t) => ({
    value: t.id,
    label: t.name,
  }));

  const handlePick = (id) => {
    onChange?.({
      id: id || null,
      dailyBudgetOverride: null,
      objective: null,
    });
  };

  // Budget bounds: Meta itself enforces a minimum (currency-dependent, but
  // documented as 100 in the template api); 10 lakh (1,000,000) is the upper
  // cap per the product spec. Positive integers only — no negatives, no
  // scientific notation, no symbols.
  const BUDGET_MIN = 100;
  const BUDGET_MAX = 1_000_000;
  const DIGITS_RE = /^\d+$/;

  const handleBudgetChange = (raw) => {
    // Empty input clears the override (template default takes over).
    if (raw === '') {
      onChange?.({ ...picked, dailyBudgetOverride: null });
      return;
    }
    // Reject anything that isn't a digit string. type=number lets the browser
    // accept '-', '+', '.', 'e' — we discard those characters silently so the
    // user can't even get the field into an invalid state. The visible error
    // below covers the range checks (min/max) since those need feedback.
    if (!DIGITS_RE.test(raw)) return;
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    onChange?.({ ...picked, dailyBudgetOverride: n });
  };

  // Validation state surfaced under the input. We accept null (no override)
  // as valid; only flag when the user has typed a value that breaks bounds.
  const budgetOverride = picked.dailyBudgetOverride;
  const budgetError =
    budgetOverride == null
      ? null
      : budgetOverride < BUDGET_MIN
        ? `Minimum daily budget is ${BUDGET_MIN.toLocaleString()}.`
        : budgetOverride > BUDGET_MAX
          ? `Maximum daily budget is ${BUDGET_MAX.toLocaleString()} (10 lakhs).`
          : null;

  const templatePayload = pickedTemplate?.payload || {};
  const templateDailyBudget = templatePayload.dailyBudget;
  const effectiveBudget =
    picked.dailyBudgetOverride != null
      ? picked.dailyBudgetOverride
      : templateDailyBudget;

  const noTemplates = !loadingList && templateOptions.length === 0;

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/2 px-4 py-3 transition ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-white 2xl:text-base">
            Ad template
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
        {loadingList && <Loader2 className="size-3.5 animate-spin text-[#AFAFAF]" />}
      </div>

      {noTemplates ? (
        <EmptyState />
      ) : (
        <>
          <Field
            label="Template"
            empty={
              listError ||
              (pickedTemplate?.objective
                ? `${humanizeObjective(pickedTemplate.objective)}${
                    pickedTemplate.conversionLocation
                      ? ` · ${humanizeLocation(pickedTemplate.conversionLocation)}`
                      : ''
                  }`
                : null)
            }
          >
            <InputCommonDropdown
              label="Select a template"
              options={templateOptions}
              value={picked.id || ''}
              onChange={handlePick}
              disabled={disabled || loadingList}
            />
          </Field>

          {/* Budget — pre-filled from the template, editable inline. Sent only
              when the user actually changes it (null = use template's value). */}
          <Field
            label="Daily budget (overrides template)"
            empty={
              !picked.id
                ? 'Pick a template first.'
                : pickedLoading
                  ? 'Loading template…'
                  : templateDailyBudget != null
                    ? `Template default: ${formatBudget(templateDailyBudget)}`
                    : null
            }
          >
            <div className="relative">
              <Coins className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#AFAFAF]" />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={7}
                placeholder={
                  templateDailyBudget != null
                    ? String(templateDailyBudget)
                    : 'Enter daily budget'
                }
                value={
                  picked.dailyBudgetOverride != null
                    ? String(picked.dailyBudgetOverride)
                    : ''
                }
                // Block non-digit keystrokes at the source so '-', '+', '.',
                // 'e', emojis, and other symbols never reach state. paste is
                // still possible — handleBudgetChange filters those too.
                onKeyDown={(e) => {
                  if (
                    e.key === 'Backspace' ||
                    e.key === 'Delete' ||
                    e.key === 'Tab' ||
                    e.key === 'ArrowLeft' ||
                    e.key === 'ArrowRight' ||
                    e.key === 'Home' ||
                    e.key === 'End' ||
                    (e.ctrlKey || e.metaKey)
                  ) return;
                  if (!/^\d$/.test(e.key)) e.preventDefault();
                }}
                onChange={(e) => handleBudgetChange(e.target.value)}
                disabled={disabled || !picked.id || pickedLoading}
                className={`h-10 w-full rounded-full bg-[#383838]/50 pr-5 pl-11 text-sm text-white outline-none transition placeholder:text-[#AFAFAF] focus:bg-[#383838]/70 disabled:cursor-not-allowed disabled:opacity-50 ${
                  budgetError ? 'ring-1 ring-red-500/60' : ''
                }`}
              />
            </div>
            {budgetError && (
              <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                <AlertCircle className="size-3" />
                {budgetError}
              </div>
            )}
          </Field>

          {picked.id && pickedTemplate && (
            <TemplateSummary template={pickedTemplate} effectiveBudget={effectiveBudget} />
          )}
        </>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <Inbox className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div className="flex flex-col gap-1.5 text-xs text-amber-200/90">
        <p>
          No saved templates yet. Create one in the Meta Ads wizard to use it for
          automation.
        </p>
        <a
          href="/meta-ads"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-100 hover:bg-amber-400/20"
        >
          Open Meta Ads
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

function TemplateSummary({ template, effectiveBudget }) {
  const payload = template?.payload || {};
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/5 bg-[#0D0D0D]/40 px-3 py-2.5 text-xs text-[#AFAFAF]">
      <div className="flex items-center gap-2 text-white">
        <FileText className="size-3.5 text-[#15DCFF]" />
        <span className="font-medium">{template.name}</span>
      </div>
      <Row label="Campaign" value={payload.name || '—'} />
      <Row label="Page" value={payload.pageId || '—'} />
      <Row
        label="Ad account"
        value={payload.adAccountId ? payload.adAccountId.replace(/^act_/, '') : '—'}
      />
      <Row label="Effective budget" value={formatBudget(effectiveBudget)} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="truncate text-[#E3E3E3]">{value}</span>
    </div>
  );
}

function Field({ label, children, empty }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs text-[#AFAFAF]">{label}</label>
      {children}
      {empty && <span className="text-[11px] text-[#AFAFAF] italic">{empty}</span>}
    </div>
  );
}

function formatBudget(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

function humanizeObjective(o) {
  if (!o) return '';
  return o.replace(/^OUTCOME_/, '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function humanizeLocation(l) {
  if (!l) return '';
  return l.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}
