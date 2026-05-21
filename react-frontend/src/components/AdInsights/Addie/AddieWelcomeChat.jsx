import { useSidebar } from '@/components/ui/sidebar';
import { submitAddieRequest } from '@/store/actions/adInsights/addieActions';
import { setShowWelcomePage } from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import React from 'react';
import { useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';

const QuickPrompt = ({ children, onClick, isLoading = false }) => {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#1E1E1E] p-4 text-sm sm:p-3 2xl:p-4 2xl:text-base">
        <div className="h-10 animate-pulse rounded bg-gradient-to-r from-[#2A2A2A] via-[#3A3A3A] to-[#2A2A2A]"></div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-white/10 bg-[#1E1E1E] p-4 text-xs text-[#AFAFAF] transition-all hover:border-[#6b72f8]/30 hover:bg-[#2A2A2A] hover:text-white sm:p-3 2xl:p-4 2xl:text-base"
    >
      {children}
    </div>
  );
};

const SkeletonLoader = () => {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center text-center">
      <div className="mb-5 h-7 w-48 animate-pulse rounded bg-gradient-to-r from-[#2A2A2A] via-[#3A3A3A] to-[#2A2A2A] sm:mb-4 2xl:mb-8 2xl:h-8"></div>
      <div className="mb-6 h-4 w-64 animate-pulse rounded bg-gradient-to-r from-[#2A2A2A] via-[#3A3A3A] to-[#2A2A2A] 2xl:h-5"></div>
      <div className="grid w-full grid-cols-2 gap-4 sm:gap-3">
        {[...Array(4)].map((_, index) => (
          <QuickPrompt key={index} isLoading={true} />
        ))}
      </div>
    </div>
  );
};

const AddieWelcomeChat = ({ faqData, isLoading = false }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const currentRoute = location?.pathname;
  const { open: isSidebarOpen } = useSidebar();

  // Handle prompt selection
  const handlePromptSelect = (question) => {
    if (question) {
      dispatch(submitAddieRequest(question, isSidebarOpen, currentRoute));
    }
  };

  // Show skeleton loader while loading
  // if (isLoading) {
  //   return <SkeletonLoader />;
  // }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center text-center">
      <h1 className="mb-5 bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-xl font-semibold text-transparent sm:mb-4 2xl:mb-8 2xl:text-2xl">
        Welcome!
      </h1>
      <p className="mb-6 text-sm text-[#AFAFAF] 2xl:text-base">
        Get started with these popular questions or type your own
      </p>
      <div className="grid w-full grid-cols-2 gap-4 sm:gap-3">
        {faqData?.length > 0
          ? faqData.slice(0, 4).map((faq, index) => (
              <QuickPrompt
                key={faq?._id || index}
                onClick={() => handlePromptSelect(faq?.question)}
              >
                {faq?.question}
              </QuickPrompt>
            ))
          : // Fallback skeleton if no data but not loading
            [...Array(4)].map((_, index) => <QuickPrompt key={index} isLoading={true} />)}
      </div>
    </div>
  );
};

export default AddieWelcomeChat;
