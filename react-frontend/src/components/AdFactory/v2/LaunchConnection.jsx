import React, { useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import FacebookAccountSelector from '@/components/MetaAds/FacebookAccountSelector';
import QuickTemplateSetup, {
  emptyAutoSetup,
  isAutoSetupComplete,
} from '@/components/AdFactory/Automation/QuickTemplateSetup';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { FaFacebookF } from 'react-icons/fa6';
import { FcGoogle } from 'react-icons/fc';
import { IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';
import GoogleLaunchConnection, {
  emptyGoogleConnection,
  isGoogleAccountConnected,
  isGoogleConnectionComplete,
} from './GoogleLaunchConnection';
import DestinationFields from './destinationFields';
import { LABEL, CONTROL, CONTROL_H, MENU, MENU_ITEM, MUTED } from './_tokens';

// ----------------------------------------------------------------------------
// LaunchConnection — the four ids activation needs + optional saved template.
//
//   facebookId + connectionId  which Meta account we post through
//   adAccountId + pageId       which account pays, which Page it runs under
//   template (optional)        a saved Meta template to use instead of synthesis
//   ctaButton + ctaUrl         the button on the ad and where it goes
//
// The last pair used to be brief-level (AdjustPanel's Campaign band) and is
// per-platform now: Meta and Google each carry their own, so one destination
// can point somewhere the other doesn't. See destinationFields.jsx.
//
// When a template is selected it is serialised into conn.template so the
// activation payload builder can use its name + payload directly, skipping
// the synthesize path.
// ----------------------------------------------------------------------------

export const emptyConnection = () => ({
  facebookId: '',
  connectionId: '',
  template: null,          // { id, name, objective, payload, ... } when saved template picked
  ctaButton: '',           // Meta CTA enum, e.g. SHOP_NOW
  ctaUrl: '',              // where that button goes
  ...emptyAutoSetup(),
});

// Posting needs all four ids. Template stays optional HERE on purpose: the
// manual "Ship these ads" panel posts into a campaign and ad set the user picks
// by hand, so a template has nothing to contribute to it.
export const isConnectionComplete = (conn) =>
  Boolean(conn?.facebookId && conn?.connectionId) && isAutoSetupComplete(conn);

// A SCHEDULE additionally needs a template. The backend can still synthesize
// one, and did until now — but "Build one for me automatically" is no longer
// offered in Quick setup, so leaving the field optional would mean starting a
// recurring job against a template the user never saw and cannot inspect. A
// schedule runs unattended and spends on every cycle, which is exactly the case
// where an implicit choice is worth refusing.
export const isScheduleConnectionComplete = (conn) =>
  isConnectionComplete(conn) && Boolean(conn?.template?.id);

function MetaLaunchConnection({ value, onChange, disabled = false, requireTemplate = false }) {
  const dispatch = useDispatch();
  const conn = value || emptyConnection();
  const { userData } = useSelector((state) => state.socket) || {};

  // ── Template list ────────────────────────────────────────────────────────
  const templates = useSelector(selectMetaAdsTemplates);
  const templatesLoading = useSelector(selectMetaAdsTemplatesLoading);
  const templatesError = useSelector(selectMetaAdsTemplatesError);

  // Full template cache to pick up payload after selecting by id
  const pickedBucket = useSelector((state) =>
    selectMetaAdsTemplateById(state, conn.template?.id),
  );
  const pickedTemplate = pickedBucket?.template;

  // Fetch the list whenever facebookId is known (clearing it on account change)
  useEffect(() => {
    dispatch(fetchMetaAdsTemplates());
  }, [dispatch, conn.facebookId]);

  // When the list is ready and we have a selected id, fetch the full template
  // if we don't already have it cached (needed for payload)
  useEffect(() => {
    if (!conn.template?.id) return;
    if (pickedTemplate) return; // already cached
    dispatch(fetchMetaAdsTemplateById(conn.template.id));
  }, [dispatch, conn.template?.id, pickedTemplate]);

  // Mirror the resolved payload back into conn.template whenever the full
  // template arrives from the server.
  useEffect(() => {
    if (!pickedTemplate) return;
    if (!conn.template?.id) return;
    // Only patch if payload isn't already mirrored (avoids infinite loops)
    if (conn.template.payload) return;
    onChange?.({
      ...conn,
      template: {
        ...conn.template,
        name: pickedTemplate.name,
        objective: pickedTemplate.objective,
        conversionLocation: pickedTemplate.conversionLocation,
        payload: pickedTemplate.payload,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTemplate]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAccount = useCallback(
    (account) => {
      const facebookId = account?.facebookId || '';
      const connectionId = account?._id || '';
      const changedAccount = facebookId && facebookId !== conn.facebookId;
      onChange?.({
        ...conn,
        facebookId,
        connectionId,
        template: null, // clear template when account changes
        ...(changedAccount
          ? { adAccountId: '', adAccountName: '', pageId: '', pageName: '' }
          : {}),
      });
    },
    [conn, onChange],
  );

  const handleSetup = useCallback(
    (auto) => onChange?.({ ...conn, ...auto }),
    [conn, onChange],
  );

  // A patch, never a replace — DestinationFields edits one of the two fields
  // at a time and knows nothing about the rest of the connection.
  const handleDestination = useCallback(
    (patch) => onChange?.({ ...conn, ...patch }),
    [conn, onChange],
  );

  const handleTemplateSelect = useCallback(
    (templateId) => {
      if (!templateId || templateId === 'auto') {
        onChange?.({ ...conn, template: null });
        return;
      }
      const item = (templates || []).find((t) => t._id === templateId || t.id === templateId);
      onChange?.({
        ...conn,
        template: {
          id: templateId,
          name: item?.name || '',
          objective: item?.objective || null,
          conversionLocation: item?.conversionLocation || null,
          payload: null, // will be filled once fetchMetaAdsTemplateById resolves
        },
      });
    },
    [conn, onChange, templates],
  );

  const autoValue = useMemo(
    () => ({
      adAccountId: conn.adAccountId,
      adAccountName: conn.adAccountName,
      pageId: conn.pageId,
      pageName: conn.pageName,
      objective: conn.objective,
      conversionLocation: conn.conversionLocation,
    }),
    [conn],
  );

  const templateOptions = useMemo(
    () => (templates || []).map((t) => ({ id: t._id || t.id, label: t.name || t._id || 'Template' })),
    [templates],
  );

  // Empty string, not 'auto', when nothing is picked. Radix renders the
  // placeholder only for a value it cannot match to an item, and 'auto' USED to
  // match one — the "Build one for me automatically" row, now hidden — so the
  // trigger came up blank instead of saying what happens when you leave it
  // alone. The 'auto' default still lives in state; only the trigger differs.
  const selectedTemplateId = conn.template?.id || '';
  const hasTemplates = !templatesLoading && templateOptions.length > 0;
  const noTemplates = !templatesLoading && templateOptions.length === 0 && !templatesError;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Meta account</span>
        <FacebookAccountSelector
          userId={userData?.user_id}
          preferredFacebookId={conn.facebookId}
          onChange={handleAccount}
          disabled={disabled}
          dropdownAnchor="left"
          className="self-start"
        />
      </div>

      {conn.facebookId && (
        <QuickTemplateSetup
          value={autoValue}
          facebookId={conn.facebookId}
          disabled={disabled}
          onChange={handleSetup}
        />
      )}

      {conn.facebookId && (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>
            Campaign template
            {requireTemplate && <span className="ml-0.5 text-[#B45309] dark:text-[#E8A33D]">*</span>}
          </span>

          {templatesLoading ? (
            <div className={`flex h-9 items-center gap-2 rounded-xl px-3 text-sm ${CONTROL} ${MUTED}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading templates…
            </div>
          ) : (
            <Select
              value={selectedTemplateId}
              disabled={disabled || (!hasTemplates && !noTemplates)}
              onValueChange={handleTemplateSelect}
            >
              <SelectTrigger
                className={`${CONTROL_H}! w-full ${CONTROL} px-3 text-sm font-medium tracking-[-0.006em] shadow-none disabled:cursor-not-allowed disabled:opacity-55`}
              >
                <SelectValue
                  placeholder={
                    noTemplates
                      ? 'No templates — one will be built for you'
                      : 'Choose a saved template'
                  }
                >
                  {/* Rendered as children so the label shows even when the
                      picked id isn't in the list yet (the full template is
                      fetched after selection), and the placeholder is never
                      swallowed by an unmatched value. */}
                  {templateOptions.find((t) => t.id === selectedTemplateId)?.label ??
                    conn.template?.name ??
                    (noTemplates
                      ? 'No templates — one will be built for you'
                      : 'Use a saved template (optional)')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={`z-9999 max-h-72 ${MENU}`}>
                {/* HIDE-MARK — "Build one for me automatically" option hidden.
                    Unhide: uncomment the SelectItem below. The 'auto' value is
                    still the state default and handleTemplateSelect still
                    accepts it, so nothing downstream changes; the trigger just
                    falls back to its placeholder text. One edit covers both
                    screens — the schedule card and the manual "Ship these ads"
                    panel render this same component. */}
                {/* <SelectItem value="auto" className={MENU_ITEM}>
                  Build one for me automatically
                </SelectItem> */}
                {templateOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id} className={MENU_ITEM}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {templatesError && (
            <span className="text-xs text-[#B45309] dark:text-[#E8A33D]">{templatesError}</span>
          )}

          {/* Said once, where the choice is, rather than only as a disabled
              button at the bottom of a card the user has to scroll back up
              from to act on. */}
          {requireTemplate && !conn.template?.id && !templatesError && (
            <span className={MUTED}>
              {noTemplates
                ? 'Save a campaign template in Ads Manager first — a schedule needs one.'
                : 'Pick a template to start the schedule.'}
            </span>
          )}
        </div>
      )}

      {/* The button and its destination. Outside the facebookId gate on
          purpose: neither depends on which account posts, so asking for them
          before the account is picked loses nothing and keeps the panel's
          height stable while the account dropdown resolves. */}
      <DestinationFields
        ctaButton={conn.ctaButton}
        ctaUrl={conn.ctaUrl}
        onChange={handleDestination}
        objective={conn.template?.objective || conn.objective}
        conversionLocation={conn.template?.conversionLocation || conn.conversionLocation}
        disabled={disabled}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// The tab strip.
//
// A tab, not a dropdown, and not the pair of always-open cards Full control
// uses. The reason is what a tab can say that neither of the others can: each
// one carries its OWN readiness tick, so "Meta is set up, Google still needs a
// template" is legible without opening anything. A dropdown hides the state of
// whichever platform isn't selected; two stacked cards make the panel twice as
// tall for the common Meta-only case.
//
// Tabs are navigation only. Both platforms stay configured at once — the job
// schema takes `targets.meta` AND `targets.google` on one job, which is how
// Full control has always worked — so switching tabs never discards anything.
//
// When Google isn't ticked in Output (or the env flag is off) there is nothing
// to switch between and the strip doesn't render at all: the Meta body is the
// panel, exactly as before.
// ----------------------------------------------------------------------------

function TabButton({ active, done, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all duration-200 ${
        active
          ? 'bg-[#15DCFF]/15 text-[#00829B] dark:bg-[#15DCFF]/10 dark:text-[#15DCFF]'
          : 'text-gray-500 hover:text-gray-900 dark:text-[#8B939E] dark:hover:text-[#ECEFF3]'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {/* The whole point of the tab: this platform is ready to post. */}
      {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
    </button>
  );
}

export default function LaunchConnection({
  value,
  onChange,
  disabled = false,
  // The brief's own `delivery.platforms`. Google only becomes a destination
  // when the user ticked it in Output — generating Google sizes and POSTING to
  // Google are the same decision as far as this panel is concerned.
  platforms = [],
  googleValue,
  onGoogleChange,
  activeTab,
  onTabChange,
  // The schedule demands a saved template; the manual post panel does not.
  requireTemplate = false,
}) {
  const googleChosen =
    IS_GOOGLE_AUTOMATION_ENABLED &&
    (Array.isArray(platforms) ? platforms : []).includes('google');

  const [internalTab, setInternalTab] = React.useState('meta');
  const tab = activeTab !== undefined ? activeTab : internalTab;
  const setTab = onTabChange || setInternalTab;
  const { googleUser } = useSelector((state) => state.adFactoryNew) || {};

  // Untick Google in Output while sitting on its tab and the tab vanishes
  // underneath you — fall back rather than render an empty panel.
  React.useEffect(() => {
    if (!googleChosen && tab === 'google') setTab('meta');
  }, [googleChosen, tab, setTab]);

  const metaDone = isConnectionComplete(value);
  const googleDone = isGoogleConnectionComplete(googleValue, isGoogleAccountConnected(googleUser));

  if (!googleChosen) {
    return (
      <MetaLaunchConnection
        value={value}
        onChange={onChange}
        disabled={disabled}
        requireTemplate={requireTemplate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap items-center gap-1">
        <TabButton
          active={tab === 'meta'}
          done={metaDone}
          icon={FaFacebookF}
          label="Meta"
          onClick={() => setTab('meta')}
        />
        <TabButton
          active={tab === 'google'}
          done={googleDone}
          icon={FcGoogle}
          label="Google"
          onClick={() => setTab('google')}
        />
      </div>

      {tab === 'meta' ? (
        <MetaLaunchConnection
          value={value}
          onChange={onChange}
          disabled={disabled}
          requireTemplate={requireTemplate}
        />
      ) : (
        <GoogleLaunchConnection
          value={googleValue || emptyGoogleConnection()}
          onChange={onGoogleChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
