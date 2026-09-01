import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { AlertTriangle, CheckCircle2, ExternalLink, Rocket } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { Panel, PanelFooter, PanelHeader, PrimaryBtn, GhostBtn, Notice } from './Panel';
import LaunchConnection, { isConnectionComplete } from './LaunchConnection';
import {
  buildGoogleTarget,
  isGoogleAccountConnected,
  isGoogleConnectionComplete,
} from './GoogleLaunchConnection';
import { IS_GOOGLE_AUTOMATION_ENABLED } from '@/utils/featureFlags';
import { FieldBlock, Section, SelectField } from './briefFields';
import { useMotionPresets } from './_motion';
import {
  BTN_LINK,
  FAINT,
  MUTED,
  NUM,
  RULE_BORDER,
  SECTION,
} from './_tokens';
import { getAdSets, getCampaigns } from '@/apis/metaAds/metaAdsApi';

// ----------------------------------------------------------------------------
// ShipTheseAds — the manual half of Ad Factory, restored.
//
// v1 has had two paths on its canvas since day one: "Manual Fabrication"
// (generate ads, post them when ready) and "Auto-Forge" (generate and post on a
// schedule). Quick setup shipped only the second, so a user looking at three
// finished ads had exactly one way to get any of them live — subscribe to a
// recurring job. That is a strange thing to demand of someone who just wants
// the three ads on their screen.
//
// This posts the ads it is given, once, and creates nothing. No job, no cron,
// no next run.
//
// ─── The two destinations ────────────────────────────────────────────────────
//
//   Built for you   We create the campaign and ad set from the brief's own
//                   objective and daily budget, the same synthesis activation
//                   uses. Nothing to choose beyond the ad account and Page.
//
//   Existing        The ads join a campaign and ad set the user already runs
//                   and inherit that ad set's budget, targeting and schedule.
//                   This is exactly what v1's Post Ad does, and it is what
//                   someone with a live campaign actually wants — the built-for
//                   -you path would give them a second campaign competing with
//                   the first for the same audience.
//
// ─── Why this file exports parts ─────────────────────────────────────────────
//
// The gallery posts a hand-picked selection from a 360px column beside the
// grid, and this component's own layout is a full-width two-column card — drop
// it in that column and every dropdown truncates to "Nothing to…", which is
// exactly what it looked like when it briefly lived in the page's right rail.
//
// Rather than a second posting form (a second thing to keep in step with Meta,
// looking different for no reason), the PARTS are exported and the layouts are
// separate compositions of them:
//
//   usePublishTarget      campaign + ad set state, their fetches, readiness
//   PublishTargetFields   the fields, in one column or two
//   PublishResult         "N ads are live", with the Ads Manager link
//
// The default export composes all three exactly as before, so nothing that
// already renders <ShipTheseAds/> knows any of this happened.
// ----------------------------------------------------------------------------

const ADS_MANAGER = 'https://adsmanager.facebook.com/adsmanager/manage/ads';

// The ad account id reaches us with or without Meta's `act_` prefix depending
// on which picker produced it. Ads Manager wants it bare.
const bareAccount = (id) => String(id || '').replace(/^act_/, '');

// ─── The Meta side, once ─────────────────────────────────────────────────────

/**
 * Everything "which campaign" needs: the two ids, the two lists behind them,
 * and whether the pair is complete enough to post.
 *
 * Owned by a hook rather than a component so the fields can be laid out two
 * different ways without the fetches being written twice — and so the POST
 * button can live anywhere, including a footer that is not this component's.
 */
export function usePublishTarget({ connection, publishing = false }) {
  // 'auto' is still reachable in the payload but has no control: the tab that
  // switched it stays commented out in the fields below.
  const [mode, setMode] = useState('existing');
  void setMode;

  const [campaignId, setCampaignId] = useState('');
  const [adSetId, setAdSetId] = useState('');

  const [campaigns, setCampaigns] = useState([]);
  const [adSets, setAdSets] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAdSets, setLoadingAdSets] = useState(false);
  const [listError, setListError] = useState('');

  const adAccountId = connection?.adAccountId || '';
  const facebookId = connection?.facebookId || '';

  // ── Campaigns, once an ad account is chosen ───────────────────────────────
  useEffect(() => {
    if (mode !== 'existing' || !adAccountId) return undefined;

    let cancelled = false;
    setLoadingCampaigns(true);
    setListError('');

    getCampaigns(adAccountId, { facebookId })
      .then((data) => {
        if (cancelled) return;
        const list = data?.campaigns || data?.data || [];
        setCampaigns(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setListError("We couldn't load your campaigns.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCampaigns(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, adAccountId, facebookId]);

  // ── Ad sets, once a campaign is chosen ────────────────────────────────────
  useEffect(() => {
    if (mode !== 'existing' || !campaignId || !adAccountId) {
      setAdSets([]);
      return undefined;
    }

    let cancelled = false;
    setLoadingAdSets(true);

    getAdSets(campaignId, adAccountId)
      .then((data) => {
        if (cancelled) return;
        const list = data?.adSets || data?.data || [];
        setAdSets(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setListError("We couldn't load that campaign's ad sets.");
      })
      .finally(() => {
        if (!cancelled) setLoadingAdSets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, campaignId, adAccountId]);

  // A different campaign has different ad sets — drop the old pick rather than
  // carrying one that belongs to somewhere else, which Meta would reject at the
  // very last step.
  const pickCampaign = useCallback((next) => {
    setCampaignId(next);
    setAdSetId('');
  }, []);

  const campaignOptions = useMemo(
    () =>
      campaigns.map((c) => ({
        value: String(c.id || c.campaignId),
        label: c.name || String(c.id),
      })),
    [campaigns],
  );

  const adSetOptions = useMemo(
    () =>
      adSets.map((a) => ({
        value: String(a.id || a.adSetId),
        label: a.name || String(a.id),
      })),
    [adSets],
  );

  const connected = isConnectionComplete(connection);
  const targeted = mode !== 'existing' || Boolean(campaignId && adSetId);

  return {
    mode,
    campaignId,
    adSetId,
    setAdSetId,
    pickCampaign,
    campaignOptions,
    adSetOptions,
    loadingCampaigns,
    loadingAdSets,
    listError,
    adAccountId,
    connected,
    targeted,
    // Everything the server needs to be told about WHERE, in the shape
    // `onPublish` has always taken.
    publishArgs: { mode, ...(mode === 'existing' ? { campaignId, adSetId } : {}) },
    /** Whether pressing Post now would be a real request. */
    canPublish: (adCount) => connected && targeted && adCount > 0 && !publishing,
  };
}

// ─── The fields ──────────────────────────────────────────────────────────────

// A band of the form. In a card it is a padded `Section`; embedded in a column
// it is a heading and a hairline, because a bordered box inside a bordered
// panel inside a modal is three frames around two dropdowns.
function Band({ title, stacked, first, children }) {
  if (!stacked) return title ? <Section title={title}>{children}</Section> : <Section unstyled>{children}</Section>;
  return (
    <section className={first ? '' : `border-t pt-5 ${RULE_BORDER}`}>
      {title && <h4 className={`mb-3 ${SECTION}`}>{title}</h4>}
      {children}
    </section>
  );
}

/**
 * "Where these publish" + "Which campaign".
 *
 * `stacked` is the only difference between the two layouts: side by side in the
 * card, one under the other in a column. Every control inside already stacks —
 * LaunchConnection and QuickTemplateSetup are single-column with full-width
 * inputs — so nothing needs a narrow variant of its own.
 */
export function PublishTargetFields({
  target,
  connection,
  onConnectionChange,
  publishing = false,
  stacked = false,
  platforms = [],
  googleValue,
  onGoogleChange,
  activePlatform,
  onActivePlatformChange,
  hideWhereTitle = false,
}) {
  const [internalPlatform, setInternalPlatform] = useState('meta');
  const currentPlatform = activePlatform !== undefined ? activePlatform : internalPlatform;
  const handlePlatformChange = onActivePlatformChange || setInternalPlatform;

  const M = useMotionPresets();
  const {
    campaignId,
    adSetId,
    setAdSetId,
    pickCampaign,
    campaignOptions,
    adSetOptions,
    loadingCampaigns,
    loadingAdSets,
    listError,
    adAccountId,
  } = target;

  const where = (
    <Band title={hideWhereTitle && stacked ? undefined : 'Where these publish'} stacked={stacked} first>
      <LaunchConnection
        value={connection}
        onChange={onConnectionChange}
        disabled={publishing}
        platforms={platforms}
        googleValue={googleValue}
        onGoogleChange={onGoogleChange}
        activeTab={currentPlatform}
        onTabChange={handlePlatformChange}
      />
    </Band>
  );

  const metaWhich = (
    <Band title="Which campaign" stacked={stacked}>
      <div className="flex flex-col gap-4">
        <AnimatePresence initial={false} mode="wait">
          <motion.div key="meta-existing" {...M.expand} className="flex flex-col gap-4">
            <FieldBlock label="Campaign">
              <SelectField
                value={campaignId}
                options={campaignOptions}
                onChange={pickCampaign}
                disabled={publishing || loadingCampaigns || !adAccountId}
                placeholder={
                  !adAccountId
                    ? 'Pick an ad account first'
                    : loadingCampaigns
                      ? 'Loading campaigns…'
                      : 'Choose a campaign'
                }
              />
            </FieldBlock>
            <FieldBlock label="Ad set">
              <SelectField
                value={adSetId}
                options={adSetOptions}
                onChange={setAdSetId}
                disabled={publishing || loadingAdSets || !campaignId}
                placeholder={
                  !campaignId
                    ? 'Pick a campaign first'
                    : loadingAdSets
                      ? 'Loading ad sets…'
                      : 'Choose an ad set'
                }
              />
            </FieldBlock>
            <p className={MUTED}>
              Budget, targeting and schedule come from the ad set you pick — this brief&apos;s daily
              budget is not used.
            </p>
            {listError && <p className={FAINT}>{listError}</p>}
          </motion.div>
        </AnimatePresence>
      </div>
    </Band>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-5">
        {where}
        {currentPlatform === 'meta' && metaWhich}
      </div>
    );
  }

  if (currentPlatform === 'google') {
    return <div className="grid grid-cols-1">{where}</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      {where}
      <div className={`border-t lg:border-t-0 lg:border-l ${RULE_BORDER}`}>{metaWhich}</div>
    </div>
  );
}

// ─── Errors and results ──────────────────────────────────────────────────────

/**
 * A half-finished launch leaves real objects in the user's ad account. Saying
 * which step failed is the difference between "try again" and "you now have an
 * empty campaign to delete".
 */
export function PublishError({ error }) {
  if (!error) return null;
  return (
    <Notice tone="error" icon={AlertTriangle}>
      <span className="flex flex-col gap-1">
        <span>{error.message}</span>
        {error.step === 'adset' && error.campaignId && (
          <span className={FAINT}>
            The campaign was created but the ad set wasn&apos;t — you may want to remove campaign{' '}
            {error.campaignId} in Ads Manager before trying again.
          </span>
        )}
        {error.step === 'ads' && (
          <span className={FAINT}>
            The campaign and ad set were created but no ads went into them.
          </span>
        )}
      </span>
    </Notice>
  );
}

/**
 * Done.
 *
 * A button that stops spinning is not evidence. This says what went live and
 * links to it, because the very next question is "where is it".
 */
export function PublishResult({ result, adCount, adAccountId, onDismiss, stacked = false }) {
  if (!result) return null;
  const isGoogle = result?.platform === 'google' || Boolean(result?.adGroupId && !result?.adSetId);
  const account = bareAccount(result.adAccountId || adAccountId);
  const cleanGoogleAccount = String(result.adAccountId || adAccountId || '').replace(/-/g, '').trim();

  let link = '';
  let linkLabel = 'Open in Ads Manager';

  if (isGoogle) {
    linkLabel = 'Open in Google Ads';
    if (result.adGroupId && result.campaignId) {
      link = `https://ads.google.com/aw/ads?campaignId=${result.campaignId}&adGroupId=${result.adGroupId}${cleanGoogleAccount ? `&ocid=${cleanGoogleAccount}` : ''}`;
    } else if (result.campaignId) {
      link = `https://ads.google.com/aw/adgroups?campaignId=${result.campaignId}${cleanGoogleAccount ? `&ocid=${cleanGoogleAccount}` : ''}`;
    } else if (cleanGoogleAccount) {
      link = `https://ads.google.com/aw/overview?ocid=${cleanGoogleAccount}`;
    } else {
      link = 'https://ads.google.com/aw/overview';
    }
  } else {
    linkLabel = 'Open in Ads Manager';
    if (account && result.campaignId) {
      link = `${ADS_MANAGER}?act=${account}&selected_campaign_ids=${result.campaignId}`;
    }
  }

  const count = result.requested ?? adCount;

  return (
    <div
      className={
        stacked
          ? 'flex flex-col items-start gap-3'
          : 'flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5 2xl:px-6'
      }
    >
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold tracking-[-0.011em] text-[#0A0A0A] dark:text-[#ECEFF3]">
          <span className={NUM}>{count}</span> {count === 1 ? 'ad is' : 'ads are'} live
        </span>
        <span className={MUTED}>
          {result.mode === 'auto'
            ? 'In a new campaign we built for you.'
            : 'In the campaign you chose.'}{' '}
          Nothing is scheduled — press this again whenever you want more.
        </span>
      </div>
      {!stacked && <span className="grow" />}
      <span className="flex flex-wrap items-center gap-3">
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className={BTN_LINK}>
            <span className="inline-flex items-center gap-1.5">
              {linkLabel}
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </a>
        )}
        <GhostBtn onClick={onDismiss}>Done</GhostBtn>
      </span>
    </div>
  );
}

// ─── The card ────────────────────────────────────────────────────────────────

export default function ShipTheseAds({
  adCount = 0,
  connection,
  onConnectionChange,
  platforms = [],
  googleConnection,
  onGoogleConnectionChange,
  objectiveLabel,
  budget,
  currencySymbol = '₹',
  onPublish,
  publishing = false,
  result = null,
  error = null,
  onDismissResult,
  onClose,
}) {
  const [platform, setPlatform] = useState('meta');
  const { googleUser } = useSelector((state) => state.adFactoryNew) || {};

  const googleChosen =
    IS_GOOGLE_AUTOMATION_ENABLED &&
    (Array.isArray(platforms) ? platforms : []).includes('google');

  useEffect(() => {
    if (!googleChosen && platform === 'google') setPlatform('meta');
  }, [googleChosen, platform]);

  const target = usePublishTarget({ connection, publishing });

  const isGoogleConnected = isGoogleAccountConnected(googleUser);
  const isGoogleReady = isGoogleConnectionComplete(googleConnection, isGoogleConnected);

  const canPost =
    platform === 'google'
      ? isGoogleConnected && isGoogleReady && adCount > 0 && !publishing
      : target.canPublish(adCount);

  const handlePost = useCallback(() => {
    if (platform === 'google') {
      onPublish?.({
        platform: 'google',
        mode: 'existing',
        adAccountId: googleConnection?.adAccountId,
        campaignId: googleConnection?.campaignId,
        adGroupId: googleConnection?.adGroupId,
        googleConnection,
      });
    } else {
      onPublish?.({ platform: 'meta', ...target.publishArgs });
    }
  }, [platform, onPublish, googleConnection, target.publishArgs]);

  if (result) {
    return (
      <Panel>
        <PublishResult
          result={result}
          adCount={adCount}
          adAccountId={target.adAccountId}
          onDismiss={onDismissResult}
        />
      </Panel>
    );
  }

  const blockerButtonText =
    platform === 'google'
      ? !isGoogleConnected
        ? 'Connect Google to post'
        : !isGoogleReady
          ? 'Select account, campaign & ad group'
          : `Post ${adCount} ${adCount === 1 ? 'ad' : 'ads'}`
      : target.connected
        ? `Post ${adCount} ${adCount === 1 ? 'ad' : 'ads'}`
        : 'Connect Meta to post';

  return (
    <Panel>
      <PanelHeader
        title="Ship these ads"
        subtitle={`${adCount} ${adCount === 1 ? 'ad' : 'ads'} live now, once. Nothing recurring — the schedule is a separate choice.`}
        right={<GhostBtn onClick={onClose}>Cancel</GhostBtn>}
      />

      {error && (
        <div className={`border-b px-5 py-3 ${RULE_BORDER} 2xl:px-6`}>
          <PublishError error={error} />
        </div>
      )}

      <PublishTargetFields
        target={target}
        connection={connection}
        onConnectionChange={onConnectionChange}
        publishing={publishing}
        platforms={platforms}
        googleValue={googleConnection}
        onGoogleChange={onGoogleConnectionChange}
        activePlatform={platform}
        onActivePlatformChange={setPlatform}
      />

      <PanelFooter>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <p className={MUTED}>
            <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>{adCount}</b>{' '}
            {adCount === 1 ? 'ad' : 'ads'} go live immediately · no credits, no schedule
          </p>
          <PrimaryBtn
            icon={publishing ? undefined : Rocket}
            onClick={handlePost}
            busy={publishing}
            disabled={!canPost}
          >
            {publishing ? 'Posting…' : blockerButtonText}
          </PrimaryBtn>
        </div>
      </PanelFooter>
    </Panel>
  );
}
