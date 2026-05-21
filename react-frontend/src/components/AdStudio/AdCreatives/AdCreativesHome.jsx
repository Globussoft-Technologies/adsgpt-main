import React, { useEffect, useMemo } from 'react';
import AdCreativesCard from './Cards/AdCreativeCard';
import MasonryAdCreativeLayout from './Cards/layout/MasonryAdCreativeLayout';
import MasonryLayout from './Cards/layout/MasonryLayout';
import AdCreativeChat from './CreativeChat/AdCreativeChat';
import MasonryVirtualizedLayout from './Cards/layout/MasonryVirtualizedLayout';
import MasonryResponsiveLayout from './Cards/layout/MasonryResponsiveLayout';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { setActiveSessionId } from '@/store/reducers/adStudio/adHistorySlice';
import { fetchExploreAds } from '@/store/actions/adStudio/adCreativeActions';
import AdCreativeWelcome from './CreativeChat/AdCreativeWelcome';

const AdCreativesHome = () => {
  const { conversations } = useSelector((state) => state.adCreative);
  const { acs2, isCreativeHistory } = useSelector((state) => state.adHistory);
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const user_id = userData?.user_id;

  useEffect(() => {
    if (acs2 && !isCreativeHistory) {
      dispatch(fetchAdHistory(acs2));
      dispatch(setActiveSessionId(acs2));
    }
  }, [acs2, dispatch, isCreativeHistory]);

  useEffect(() => {
    if (user_id) dispatch(fetchExploreAds());
  }, [dispatch, user_id]);

  const renderMasonryResponsiveLayout = useMemo(() => {
    return <MasonryResponsiveLayout />;
  }, []);

  const renderAdCreativesWelcomeLayout = useMemo(() => {
    return <AdCreativeWelcome />;
  }, []);

  return (
    <div className="h-full w-full">
      {Array.isArray(conversations) && conversations.length > 0 ? (
        <div className="adcopy_container max-h-[calc(100svh-240px)] w-full overflow-y-auto 2xl:max-h-[calc(100svh-290px)]">
          <div className="layout_for_chat mx-auto h-full min-h-[55vh] p-0 2xl:min-h-[60vh]">
            <AdCreativeChat />
          </div>
        </div>
      ) : (
        // <MasonryAdCreativeLayout />
        // <MasonryLayout toggleOpenAdCreativeChat={toggleOpenAdCreativeChat} />
        // <MasonryResponsiveLayout toggleOpenAdCreativeChat={toggleOpenAdCreativeChat} />
        // <MasonryVirtualizedLayout toggleOpenAdCreativeChat={toggleOpenAdCreativeChat} />
        renderMasonryResponsiveLayout
        // renderAdCreativesWelcomeLayout
      )}
    </div>
  );
};

export default AdCreativesHome;
