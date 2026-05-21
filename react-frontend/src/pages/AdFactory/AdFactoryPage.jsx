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
import { setAdsDialogOpen, setAdsDialogType } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { emitWhenConnected } from '@/utils/socketEmitter';
import { useSearchParams } from 'react-router-dom';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';

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

  useEffect(() => {
    if (queryCampaignId) {
      const payload = {
        campaignId: queryCampaignId,
        userId: userData?.user_id,
      };
      const timer = setTimeout(() => {
        emitWhenConnected('adFactoryRequest', queryCampaignId);
      }, 900);
      dispatch(fetchCampaignById(payload));
      return () => clearTimeout(timer);
    }
    // dispatch(fetchCampaigns(userData?.user_id));
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
