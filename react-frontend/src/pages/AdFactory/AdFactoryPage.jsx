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
import { IS_AUTOMATION_ENABLED } from '@/utils/featureFlags';

export default function AdFactoryPage() {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
// console.log(userData,"userdata")
  const [searchParams] = useSearchParams();

  const rawCampaignId = searchParams.get('campaignId');
  const queryCampaignId = rawCampaignId ? rawCampaignId.split('?')[0] : null;
  const googleAuth = searchParams.get('google_auth');
  // console.log(rawCampaignId)
  // console.log(queryCampaignId)

  useEffect(() => {
    dispatch(fetchBrands(userData?.user_id));
  }, [dispatch, userData?.user_id]);

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
    dispatch(checkFbUser(userData?.user_id));
    dispatch(checkGoogleUser(userData?.user_id));
  }, [dispatch, userData?.user_id]);

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
    if (!queryCampaignId) return undefined;
    dispatch(
      fetchCampaignById({ campaignId: queryCampaignId, userId: userData?.user_id }),
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
  }, [queryCampaignId, userData?.user_id, dispatch]);

  return (
    <div className="relative h-full w-full">
      {/* <h3 className="absolute top-3 left-4 text-2xl font-medium 2xl:text-[32px]">Ad Factory</h3> */}
      <div className="w-full overflow-y-auto">
        {queryCampaignId ? <AdFactoryWorkflowDarkReal /> : <NoCompaignScreen />}
      </div>
    </div>
  );
}
