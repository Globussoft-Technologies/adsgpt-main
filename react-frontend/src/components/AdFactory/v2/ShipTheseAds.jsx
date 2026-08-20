import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Rocket } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { Panel, PanelFooter, PanelHeader, PrimaryBtn, GhostBtn, Notice } from './Panel';
import LaunchConnection, { isConnectionComplete } from './LaunchConnection';
import { FieldBlock, Section, SelectField } from './briefFields';
import { useMotionPresets } from './_motion';
import {
  BTN_LINK,
  CONTROL,
  FAINT,
  MUTED,
  NUM,
  PILL,
  PILL_ON,
  RULE_BORDER,
  VALUE,
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
// This posts the run being viewed, once, and creates nothing. No job, no cron,
// no next run.
//
// ─── The two destinations ────────────────────────────────────────────────────
//
//   Built for you   We create the campaign and ad set from the brief's own
//                   objective and daily budget, the same synthesis activation
//                   uses. Nothing to choose beyond the ad account and Page.
//                   Default, because it is Quick setup's whole thesis: Ads
//                   Manager is where you go afterwards, not a prerequisite.
//
//   Existing        The ads join a campaign and ad set the user already runs
//                   and inherit that ad set's budget, targeting and schedule.
//                   This is exactly what v1's Post Ad does, and it is what
//                   someone with a live campaign actually wants — the built-for
//                   -you path would give them a second campaign competing with
//                   the first for the same audience.
//
// Behind a disclosure rather than side by side: the second is the minority
// case, and two ad-set dropdowns on screen for everyone would put the thing
// Quick setup exists to avoid back in front of every user.
// ----------------------------------------------------------------------------

const ADS_MANAGER = 'https://adsmanager.facebook.com/adsmanager/manage/ads';

// The ad account id reaches us with or without Meta's `act_` prefix depending
// on which picker produced it. Ads Manager wants it bare.
const bareAccount = (id) => String(id || '').replace(/^act_/, '');

export default function ShipTheseAds({
  adCount = 0,
  connection,
  onConnectionChange,
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
  const M = useMotionPresets();

  const [mode, setMode] = useState('existing');
  void setMode; // kept because the tab switch block stays commented out below
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
  const readyExisting = mode !== 'existing' || (campaignId && adSetId);
  const canPost = connected && readyExisting && adCount > 0 && !publishing;

  const campaignHint = [
    objectiveLabel,
    budget ? `${currencySymbol}${Number(budget).toLocaleString('en-IN')}/day` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // ── Done ──────────────────────────────────────────────────────────────────
  //
  // A button that stops spinning is not evidence. This says what went live and
  // links to it, because the very next question is "where is it".
  if (result) {
    const account = bareAccount(result.adAccountId || adAccountId);
    const link = `${ADS_MANAGER}?act=${account}&selected_campaign_ids=${result.campaignId}`;
    return (
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-5 2xl:px-6">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold tracking-[-0.011em] text-[#0A0A0A] dark:text-[#ECEFF3]">
              <span className={NUM}>{result.requested ?? adCount}</span>{' '}
              {(result.requested ?? adCount) === 1 ? 'ad is' : 'ads are'} live
            </span>
            <span className={MUTED}>
              {result.mode === 'auto'
                ? 'In a new campaign we built for you.'
                : 'In the campaign you chose.'}{' '}
              Nothing is scheduled — press this again whenever you want more.
            </span>
          </div>
          <span className="grow" />
          {account && result.campaignId && (
            <a href={link} target="_blank" rel="noreferrer" className={BTN_LINK}>
              <span className="inline-flex items-center gap-1.5">
                Open in Ads Manager
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          )}
          <GhostBtn onClick={onDismissResult}>Done</GhostBtn>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Ship these ads"
        subtitle={`${adCount} ${adCount === 1 ? 'ad' : 'ads'} live now, once. Nothing recurring — the schedule is a separate choice.`}
        right={<GhostBtn onClick={onClose}>Cancel</GhostBtn>}
      />

      {error && (
        <div className={`border-b px-5 py-3 ${RULE_BORDER} 2xl:px-6`}>
          <Notice tone="error" icon={AlertTriangle}>
            <span className="flex flex-col gap-1">
              <span>{error.message}</span>
              {/* A half-finished launch leaves real objects in the user's ad
                  account. Saying which step failed is the difference between
                  "try again" and "you now have an empty campaign to delete". */}
              {error.step === 'adset' && error.campaignId && (
                <span className={FAINT}>
                  The campaign was created but the ad set wasn&apos;t — you may want to remove
                  campaign {error.campaignId} in Ads Manager before trying again.
                </span>
              )}
              {error.step === 'ads' && (
                <span className={FAINT}>
                  The campaign and ad set were created but no ads went into them.
                </span>
              )}
            </span>
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* ── Where ── the same pickers the schedule card uses. */}
        <Section title="Where these publish">
          <LaunchConnection
            value={connection}
            onChange={onConnectionChange}
            disabled={publishing}
          />
        </Section>

        {/* ── Which campaign ── */}
        <div className={`border-t lg:border-t-0 lg:border-l ${RULE_BORDER}`}>
          <Section title="Which campaign">
            <div className="flex flex-col gap-4">
              {/*
                Hidden per request: keep the tab options commented out and show
                only the "One I already run" form below.
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('auto')}
                    aria-pressed={mode === 'auto'}
                    disabled={publishing}
                    className={mode === 'auto' ? PILL_ON : PILL}
                  >
                    Built for you
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('existing')}
                    aria-pressed={mode === 'existing'}
                    disabled={publishing}
                    className={mode === 'existing' ? PILL_ON : PILL}
                  >
                    One I already run
                  </button>
                </div>
              */}

              <AnimatePresence initial={false} mode="wait">
                <motion.div key="existing" {...M.expand} className="flex flex-col gap-4">
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
                    Budget, targeting and schedule come from the ad set you pick — this brief&apos;s
                    daily budget is not used.
                  </p>
                  {listError && <p className={FAINT}>{listError}</p>}
                </motion.div>
              </AnimatePresence>
            </div>
          </Section>
        </div>
      </div>

      <PanelFooter>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          <p className={MUTED}>
            <b className={`font-semibold text-[#111827] dark:text-[#ECEFF3] ${NUM}`}>{adCount}</b>{' '}
            {adCount === 1 ? 'ad' : 'ads'} go live immediately · no credits, no schedule
          </p>
          <PrimaryBtn
            icon={publishing ? undefined : Rocket}
            onClick={() =>
              onPublish?.({
                mode,
                ...(mode === 'existing' ? { campaignId, adSetId } : {}),
              })
            }
            busy={publishing}
            disabled={!canPost}
          >
            {publishing ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Posting…
              </span>
            ) : connected ? (
              `Post ${adCount} ${adCount === 1 ? 'ad' : 'ads'}`
            ) : (
              'Connect Meta to post'
            )}
          </PrimaryBtn>
        </div>
      </PanelFooter>
    </Panel>
  );
}
