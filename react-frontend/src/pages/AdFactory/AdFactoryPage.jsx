import React, { useEffect } from 'react';
import AdPromptComponent from '@/components/common/AdPrompt/AdPromptComponent';
import AdFactoryWorkflowDarkReal from '../../components/AdFactory/AdFactoryWorkflow';
import NoCompaignScreen from '@/components/AdFactory/NoCompaignScreen';
import { useDispatch, useSelector } from 'react-redux';
import {
  checkFbUser,
  checkGoogleUser,
  fetchCampaignById,
  fetchCampaigns,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { fetchAutomation } from '@/store/actions/adFactoryAutomation/adFactoryAutomationActions';
import { isAutomationVisibleStatus } from '@/store/reducers/adFactoryAutomation/constants';
import { setAdsDialogOpen, setAdsDialogType } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { useSearchParams } from 'react-router-dom';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { IS_AUTOMATION_ENABLED, IS_AD_FACTORY_V2 } from '@/utils/featureFlags';
import AdFactoryV2Page from './v2/AdFactoryV2Page';
import { selectUiMode } from '@/store/reducers/adFactoryBrief/adFactoryBriefSlice';

export default function AdFactoryPage() {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const userId = userData?.user_id;
  const uiMode = useSelector(selectUiMode);
// console.log(userData,"userdata")
  const [searchParams] = useSearchParams();

  const rawCampaignId = searchParams.get('campaignId');
  const queryCampaignId = rawCampaignId ? rawCampaignId.split('?')[0] : null;
  const googleAuth = searchParams.get('google_auth');
  // console.log(rawCampaignId)
  // console.log(queryCampaignId)

  useEffect(() => {
    if (!userId) return;
    dispatch(fetchBrands(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    if (googleAuth === 'success') {
      dispatch(setAdsDialogType('post-ad'));
      dispatch(setAdsDialogOpen(true));
      // Remove google_auth from URL so refresh doesn't reopen the dialog
      const next = new URL(window.location.href);
      next.searchParams.delete('google_auth');
      next.searchParams.delete('name');
      next.searchParams.delete('email');
      window.history.replaceState({}, '', next.toString());
    }
  }, [googleAuth, dispatch]);

  useEffect(() => {
    if (!userId) return;
    dispatch(checkFbUser(userId));
    dispatch(checkGoogleUser(userId));
  }, [dispatch, userId]);

  // Bootstrap a campaign on mount: load its data, and trigger the MANUAL
  // pipeline only if it isn't currently running under automation.
  //
  // History: this used to fire `adFactoryRequest` after a hardcoded 900ms
  // `setTimeout` — which was both pointless (`emitWhenConnected` already
  // queues until the socket is up) AND wrong, because it kicked off the
  // manual image/text/post pipeline even on campaigns whose automation
  // was actively running its own cycles. The result was duplicate work:
  // the cron worker generated ads on schedule AND the manual pipeline
  // generated a fresh set on every page navigation.
  //
  // Fix: await fetchAutomation, then skip the emit if the entry's status
  // is in the "automation visible" set (active/paused/completed/failed).
  // `cancelled` flag prevents the emit from firing after unmount.
  useEffect(() => {
    if (!queryCampaignId || !userId) return undefined;
    dispatch(
      fetchCampaignById({ campaignId: queryCampaignId, userId }),
    );

    // Pre-automation behavior: kick the manual pipeline unconditionally. The
    // fetchAutomation-gated branch below only matters when automation is
    // enabled; with the flag off, no cron worker can be running so there's
    // no risk of duplicate work and we can take the simpler path.
    if (!IS_AUTOMATION_ENABLED) {
      emitWhenConnected('adFactoryRequest', queryCampaignId);
      return undefined;
    }

    let cancelled = false;
    dispatch(fetchAutomation(queryCampaignId)).then((action) => {
      if (cancelled) return;
      const status = action?.payload?.entry?.status;
      if (status && isAutomationVisibleStatus(status)) return;
      emitWhenConnected('adFactoryRequest', queryCampaignId);
    });
    return () => {
      cancelled = true;
    };
  }, [queryCampaignId, userId, dispatch]);

  // ── Which UI renders ──────────────────────────────────────────────────────
  // IS_AD_FACTORY_V2 decides whether Quick setup EXISTS in this build. With it
  // off, everything below collapses to exactly what shipped before — no
  // switch, no extra wrapper, the canvas rendered as it always was.
  //
  // FULL CONTROL IS THE DEFAULT FOR EVERYONE. Quick setup is only reached by
  // deliberately flipping the switch; nobody is moved into a different UI
  // without asking for it.
  //
  // The mode is a session preference rather than a per-campaign field. Quick
  // setup works on briefs and the canvas works on campaigns; a brief owns its
  // campaign, so "which document am I looking at" is answered by the URL
  // (?briefId= or ?campaignId=), not by a flag on one of them.
  const renderQuickSetup = IS_AD_FACTORY_V2 && uiMode === 'quick';

  if (!IS_AD_FACTORY_V2) {
    return (
      <div className="relative h-full w-full">
        <div className="w-full overflow-y-auto">
          {queryCampaignId ? <AdFactoryWorkflowDarkReal /> : <NoCompaignScreen />}
        </div>
      </div>
    );
  }

  // The mode switch lives in TopHeader now, beside the page title, in the same
  // slot /adstudio and /brandiq use for their tabs. It was floating at the top
  // of the page body with nothing to align to.
  return (
    <div className="relative flex h-full w-full flex-col">
      {renderQuickSetup ? (
        <AdFactoryV2Page />
      ) : (
        <div className="w-full flex-1 overflow-y-auto">
          {queryCampaignId ? <AdFactoryWorkflowDarkReal /> : <NoCompaignScreen />}
        </div>
      )}
    </div>
  );
}
