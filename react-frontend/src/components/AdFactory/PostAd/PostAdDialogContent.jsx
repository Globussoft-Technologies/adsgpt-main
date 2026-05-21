import React, { useEffect, useState } from 'react';
import FbConnectStep from './FbConnectStep';
import FbAccountReady from './FbAccountReady';
import GoogleAccount from './GoogleAccount';
import { useDispatch, useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import { fetchAdAccounts, fetchFacebookPages, fetchGoogleAdAccounts } from '@/store/actions/adFactoryNew/adFactoryActions';

export const PostAdDialogContent = () => {
  const { fbUser, googleUser } = useSelector((state) => state.adFactoryNew);
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const googleAuth = searchParams.get('google_auth');

  const [selectedPlatform, setSelectedPlatform] = useState(
    googleAuth === 'success' ? 'google' : null
  );

  useEffect(() => {
    if (googleAuth === 'success') {
      setSearchParams((prev) => {
        prev.delete('google_auth');
        prev.delete('name');
        prev.delete('email');
        return prev;
      }, { replace: true });
    }
  }, [googleAuth, setSearchParams]);

  useEffect(() => {
    if (fbUser?._id) {
      dispatch(fetchAdAccounts(fbUser._id));
      dispatch(fetchFacebookPages(fbUser._id));
    }
  }, [fbUser?._id, dispatch]);

  useEffect(() => {
    if (googleUser?.userId) {
      dispatch(fetchGoogleAdAccounts(googleUser.userId));
    }
  }, [googleUser?.userId, dispatch]);

  const back = () => setSelectedPlatform(null);

  if (selectedPlatform === 'facebook' && fbUser?.facebookId) {
    return (
      <div className="post_ad_content_container pb-10">
        <FbAccountReady onBack={back} />
      </div>
    );
  }

  if (selectedPlatform === 'google') {
    return (
      <div className="post_ad_content_container pb-10">
        <GoogleAccount onBack={back} />
      </div>
    );
  }

  return (
    <div className="post_ad_content_container pb-10">
      <FbConnectStep onSelectPlatform={setSelectedPlatform} />
    </div>
  );
};
