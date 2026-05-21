import React, { useEffect } from 'react';
import WelcomeAdCopy from './WelcomeAdCopy';
import ChatInterface from './ChatInterface';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAdHistory } from '@/store/actions/adStudio/adHistoryActions';
import { setActiveSessionId } from '@/store/reducers/adStudio/adHistorySlice';

const AdCopyHome = () => {
  const { conversations } = useSelector((state) => state.adCopy);
  const { acs1, isCopyHistory } = useSelector((state) => state.adHistory);
  const dispatch = useDispatch();

  // Fetch Ad Copy History on component mount if acs1 is available
  useEffect(() => {
    if (acs1 && !isCopyHistory) {
      dispatch(fetchAdHistory(acs1));
      dispatch(setActiveSessionId(acs1));
    }
  }, [acs1, dispatch, isCopyHistory]);

  return (
    <div className="layout_for_chat mx-auto h-full min-h-[70vh] p-3 sm:p-0 lg:min-h-[55vh] 2xl:min-h-[60vh]">
      {Array.isArray(conversations) && conversations.length === 0 ? (
        <WelcomeAdCopy />
      ) : (
        <ChatInterface />
      )}
    </div>
  );
};

export default AdCopyHome;
