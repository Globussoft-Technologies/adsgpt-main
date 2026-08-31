import React, { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { toast } from 'react-toastify';

import { SelectField } from './briefFields';
import { CONTROL, CONTROL_H, FAINT, INPUT, LABEL, MUTED, VALUE } from './_tokens';
import getCookies from '@/utils/getCookies';
import { checkGoogleUser } from '@/store/actions/adFactoryNew/adFactoryActions';
import {
  fetchGoogleAdsTemplates,
  fetchGoogleAdsTemplateById,
} from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import {
  selectGoogleAdsTemplates,
  selectGoogleAdsTemplatesLoading,
  selectGoogleAdsTemplatesError,
  selectGoogleAdsTemplateById,
} from '@/store/reducers/adFactoryAutomation/adFactoryAutomationSlice';

// ----------------------------------------------------------------------------
// GoogleLaunchConnection — the Google half of "Where these publish".
//
// The Meta half can be a two-picker affair because the backend SYNTHESIZES a
// Meta template from the objective and budget. Google has no such path:
// `googleTargetSchema` (Validations/adsFactoryAuto) requires a real `payload`
// object, so a Google job can only ever run off a template the user already
// saved in the Google Ads wizard. That single asymmetry is why this component
// asks for a template first and everything else second.
//
// It asks for TWO things, where Full control's TemplatePicker asks for four:
//
//   template          which saved campaign we clone
//   campaign name     overrides the template's own (written to name AND
//                     campaignName at build time, since the Google wizard
//                     stores the label under both)
//
// The other two are deliberately NOT here, because Quick setup already has
// them and asking twice on one screen is how a user ends up with two different
// answers to one question:
//
//   daily budget      the schedule's own "Daily budget" field, six inches to
//                     the left of this one. Passed into buildGoogleTarget and
//                     converted to dailyBudgetMicros there.
//   CTA + destination the brief's `offer.cta`, already collected for Meta.
//                     Only the URL crosses over — see buildGoogleTarget.
//
// The conversion to micros deliberately does not live in state. The caller
// hands over whole rupees; the build step owns the units.
//
// THERE IS NO AD ACCOUNT PICKER, and that is a backend limit, not a choice.
// `GET /google-ads/templates` projects `payload` away
// (googleCampaignTemplate.controller.listTemplates), so the account a template
// was saved against never reaches the browser — there is nothing to filter or
// group by without either a projection change or one fetch per template.
// Picking the template picks the account, exactly as Full control does.
// ----------------------------------------------------------------------------

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

const NAME_MAX = 120;

export const emptyGoogleConnection = () => ({
  templateId: null,
  templateName: '',
  objective: null,
  conversionLocation: null,
  customerId: null,
  payload: null,
  campaignName: '',
});

export const isGoogleAccountConnected = (googleUser) =>
  !!(googleUser?.email || googleUser?.googleId || googleUser?.sub);

// Ready to publish = OAuth done, a template picked, and its payload actually
// resolved. The payload is the part that matters: without it there is nothing
// to send, and the job would be rejected by the schema rather than by us.
export const isGoogleConnectionComplete = (g, connected) => {
  if (!connected) return false;
  return !!(g?.templateId && g?.payload);
};

// The `targets.google` block the autopilot job schema expects, built from what
// this component collected. A straight port of Full control's
// buildGoogleTemplateForJob (store/actions/adFactoryAutomation) — same overlay
// keys, same micros conversion, same dual name/campaignName and
// finalUrl/linkUrl writes — so a Quick setup Google job is byte-identical to a
// Full control one and the backend never has to tell them apart.
//
// Returns null when there is nothing postable, which is the caller's cue to
// omit `google` from the activation body entirely rather than send an empty
// target the schema would reject.
//
// `dailyBudget` is the schedule's budget in whole rupees, and `ctaUrl` the
// brief's destination — both passed in rather than read off `g`, because
// neither is asked for on the Google form.
export const buildGoogleTarget = (g, { dailyBudget, ctaUrl } = {}) => {
  if (!g?.templateId || !g?.payload) return null;

  const overlay = {};

  const budget = Number(dailyBudget);
  if (Number.isFinite(budget) && budget > 0) {
    // Whole rupees -> micros for the Google Ads API.
    overlay.dailyBudgetMicros = Math.round(budget * 1_000_000);
  }

  const name = typeof g.campaignName === 'string' ? g.campaignName.trim() : '';
  if (name) {
    // The Google wizard stores the campaign label under BOTH keys; set both so
    // the backend's `name || campaignName` fallback hits whichever it reads.
    overlay.name = name;
    overlay.campaignName = name;
  }

  // The brief's CTA URL, and ONLY the URL. A destination is platform-neutral;
  // the button is not — `offer.cta.button` is resolved against Meta's
  // wizardSchema cell, and Google's enum is a different list, so forwarding it
  // would hand Google a button it may not accept. The Google template's own
  // button stands.
  if (ctaUrl) {
    overlay.finalUrl = ctaUrl;
    overlay.linkUrl = ctaUrl;
  }

  return {
    template: {
      name: g.templateName || 'Google campaign',
      objective: g.objective || null,
      conversionLocation: g.conversionLocation || null,
      customerId: g.customerId || g.payload.customerId || g.payload.adAccountId || null,
      payload: { ...g.payload, templateId: g.templateId, ...overlay },
    },
  };
};

export default function GoogleLaunchConnection({ value, onChange, disabled = false }) {
  const dispatch = useDispatch();
  const g = value || emptyGoogleConnection();

  const { userData } = useSelector((state) => state.socket) || {};
  const { googleUser } = useSelector((state) => state.adFactoryNew) || {};
  const connected = isGoogleAccountConnected(googleUser);

  const templates = useSelector(selectGoogleAdsTemplates);
  const templatesLoading = useSelector(selectGoogleAdsTemplatesLoading);
  const templatesError = useSelector(selectGoogleAdsTemplatesError);

  const pickedBucket = useSelector((state) => selectGoogleAdsTemplateById(state, g.templateId));
  const pickedTemplate = pickedBucket?.template;

  // ── Fetches ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!userData?.user_id) return;
    dispatch(checkGoogleUser(userData.user_id));
  }, [dispatch, userData?.user_id]);

  useEffect(() => {
    if (!connected) return;
    dispatch(fetchGoogleAdsTemplates());
  }, [dispatch, connected]);

  // The wizard opens in a NEW TAB, so a template created there only appears
  // here on focus — without this the user comes back to the same empty list
  // the deep link just told them to go fix.
  useEffect(() => {
    if (!connected) return undefined;
    const onFocus = () => dispatch(fetchGoogleAdsTemplates());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dispatch, connected]);

  useEffect(() => {
    if (!g.templateId) return;
    if (pickedTemplate) return;
    dispatch(fetchGoogleAdsTemplateById(g.templateId));
  }, [dispatch, g.templateId, pickedTemplate]);

  // Mirror the resolved template onto the connection. Guarded on `payload`
  // already being present so this can't loop: onChange feeds straight back in.
  useEffect(() => {
    if (!pickedTemplate || !g.templateId) return;
    if (g.payload) return;
    const p = pickedTemplate.payload || {};
    onChange?.({
      ...g,
      templateName: pickedTemplate.name || g.templateName,
      objective: pickedTemplate.objective || null,
      conversionLocation: pickedTemplate.conversionLocation || null,
      customerId: p.customerId || p.adAccountId || null,
      payload: pickedTemplate.payload || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTemplate, g.templateId]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    if (!userData?.user_id) {
      toast.error('Please sign in to connect Google.');
      return;
    }
    const feUrl = window.location.href;
    window.location.href = `${BACKEND_HOST}/api/auth/google?userId=${userData.user_id}&token=${getCookies()}&feUrl=${encodeURIComponent(feUrl)}`;
  }, [userData?.user_id]);

  const patch = useCallback((next) => onChange?.({ ...g, ...next }), [g, onChange]);

  const handleTemplate = useCallback(
    (templateId) => {
      if (!templateId) return;
      const item = (templates || []).find((t) => (t._id || t.id) === templateId);
      // Swapping templates drops the resolved payload AND the objective it
      // came with — both belong to the template being replaced.
      patch({
        templateId,
        templateName: item?.name || '',
        objective: item?.objective || null,
        conversionLocation: item?.conversionLocation || null,
        customerId: null,
        payload: null,
      });
    },
    [templates, patch],
  );

  const templateOptions = useMemo(
    () =>
      (templates || []).map((t) => ({
        value: t._id || t.id,
        label: t.name || t._id || 'Template',
      })),
    [templates],
  );

  const noTemplates =
    connected && !templatesLoading && templateOptions.length === 0 && !templatesError;

  // ── Render ───────────────────────────────────────────────────────────────

  if (!connected) {
    return (
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Google account</span>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#F59E0B]/45 bg-[#F7E8CD] px-3 py-2 dark:border-[#F59E0B]/35 dark:bg-[#F59E0B]/10">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B45309] dark:text-[#E8A33D]" />
          <span className="text-[12px] text-[#8A4E0D] dark:text-[#E8A33D]">
            Google not connected — required to publish here
          </span>
          <button
            type="button"
            onClick={handleConnect}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-gray-900 transition hover:bg-gray-100 disabled:opacity-50"
          >
            <FcGoogle className="h-3.5 w-3.5" />
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Google account</span>
        <div
          className={`flex ${CONTROL_H} items-center gap-2 self-start rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3`}
        >
          <FcGoogle className="h-4 w-4 shrink-0" />
          <span className={VALUE}>{googleUser?.name || googleUser?.email || 'Connected'}</span>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Google campaign template</span>

        {templatesLoading ? (
          <div
            className={`flex ${CONTROL_H} items-center gap-2 rounded-md px-3 text-[13px] ${CONTROL} ${MUTED}`}
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading templates…
          </div>
        ) : noTemplates ? (
          // Google has no synthesize path, so an empty list is a dead end
          // until they build one — say that, and hand them the way out
          // rather than a disabled dropdown with no explanation.
          <div className="flex flex-col gap-1.5 rounded-md border border-[#F59E0B]/45 bg-[#F7E8CD] px-3 py-2.5 dark:border-[#F59E0B]/35 dark:bg-[#F59E0B]/10">
            <span className="text-[12px] font-medium text-[#8A4E0D] dark:text-[#E8A33D]">
              No saved Google templates yet.
            </span>
            <span className="text-[11px] text-[#8A4E0D]/85 dark:text-[#E8A33D]/85">
              Unlike Meta, Google campaigns run from a template you save first.
            </span>
            <a
              href="/google-ads?openWizard=create-full"
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1.5 self-start text-[12px] font-medium text-[#8A4E0D] underline-offset-2 hover:underline dark:text-[#E8A33D]"
            >
              Create a Google template
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <SelectField
            value={g.templateId || ''}
            options={templateOptions}
            onChange={handleTemplate}
            placeholder="Select a Google template"
            disabled={disabled}
          />
        )}

        {templatesError && (
          <span className="text-[11px] text-[#B45309] dark:text-[#E8A33D]">{templatesError}</span>
        )}
        {g.templateId && !g.payload && !templatesLoading && (
          <span className={`inline-flex items-center gap-1.5 ${FAINT}`}>
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading template…
          </span>
        )}
      </div>

      {/* The ONE override this panel asks for. Budget comes from the
          schedule's own "Daily budget" field — asking twice on one screen
          invited two different numbers for the same ad set — and the CTA
          button and destination URL come from the brief (offer.cta), which
          already collected them for Meta. Neither is a Google-specific
          decision, so neither is a Google-specific field. */}
      {g.templateId && (
        <>
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Campaign name</span>
            <input
              type="text"
              maxLength={NAME_MAX}
              value={g.campaignName || ''}
              disabled={disabled}
              onChange={(e) => patch({ campaignName: e.target.value })}
              placeholder={g.templateName || "Leave blank to use the template's name"}
              className={INPUT}
            />
          </div>

        </>
      )}
    </div>
  );
}
