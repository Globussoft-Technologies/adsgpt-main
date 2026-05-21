import React, { useEffect } from 'react';
import WelcomeAdVideo from './AdVideoChats/WelcomeAdVideo';
import AdVideoChats from './AdVideoChats/AdVideoChats';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { setActiveSessionId } from '@/store/reducers/adStudio/adHistorySlice';

const AdVideoHome = () => {
  const { conversations } = useSelector((state) => state.adVideo);
  const { avs3, isVideoHistory } = useSelector((state) => state.adHistory);
  const dispatch = useDispatch();

  // Fetch Ad Video History on component mount if avs3 is available
  useEffect(() => {
    if (avs3 && !isVideoHistory) {
      dispatch(fetchAdHistory(avs3));
      dispatch(setActiveSessionId(avs3));
    }
  }, [avs3, dispatch, isVideoHistory]);

  return (
    <div
      className={`${Array.isArray(conversations) && conversations?.length > 0 ? '' : 'layout_for_chat'} mx-auto h-full min-h-[55vh] p-3 sm:p-0 2xl:min-h-[60vh]`}
    >
      {Array.isArray(conversations) && conversations?.length === 0 ? (
        <WelcomeAdVideo />
      ) : (
        <div className="adcopy_container max-h-[calc(100svh-94px)] w-full overflow-y-auto 2xl:max-h-[calc(100svh-128px)]">
          <div className="layout_for_chat mx-auto h-full min-h-[55vh] sm:p-0 lg:p-3 2xl:min-h-[60vh]">
            <AdVideoChats />
          </div>
        </div>
      )}
    </div>
  );
};

export default AdVideoHome;
