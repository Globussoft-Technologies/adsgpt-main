import SpeechToText from '@/components/common/AdPrompt/AddieSpeechToText';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { submitAddieRequest } from '@/store/actions/adInsights/addieActions';
import { setShowWelcomePage } from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import { setAddieField } from '@/store/reducers/adInsights/Addie/addiePromptSlice';
import { Mic, Send } from 'lucide-react';
import React, { useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

const AddiePromptBox = ({ handleSearchSubmit }) => {
  const inputRef = useRef(null);
  const { open: isSidebarOpen } = useSidebar();
  const location = useLocation();
  const currentRoute = location?.pathname;
  const dispatch = useDispatch();
  const { prompt, isListening } = useSelector((state) => state?.addiePrompt);
  const { brandInput = '', selectedBrands = [] } = useSelector((state) => state?.addie);

  const handleRequestSubmit = (e) => {
    if (e) e.preventDefault();

    if (prompt?.trim()) {
      // dispatch(setShowWelcomePage(false));
      dispatch(submitAddieRequest('', isSidebarOpen, currentRoute));
    }
  };

  const handlePromptChange = (e) => {
    dispatch(setAddieField({ key: 'prompt', value: e?.target?.value }));
  };

  const handleEnterKeyPress = (event) => {
    if (event?.key === 'Enter' && !event?.shiftKey) {
      event.preventDefault();
      if (prompt?.trim()) handleRequestSubmit();
    }
  };

  return (
    <div className="px-4 pt-2 pb-4 sm:px-5">
      <div
        id="tour_addie_chatbox"
        className="rounded-2xl border border-white/20 bg-[#0D0D0D]/50 p-2 pl-4"
      >
        <form onSubmit={handleRequestSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={prompt ?? ''}
            ref={inputRef}
            onChange={handlePromptChange}
            onKeyDown={handleEnterKeyPress}
            placeholder="Write Something"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#AFAFAF] placeholder:italic focus:outline-none"
          />

          {(prompt || brandInput || selectedBrands?.length > 0) && !isListening ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white hover:bg-white/80"
            >
              <ShadcnTooltip label={prompt && !isListening && 'Generate Ads'}>
                <Send
                  className="h-4 w-4 text-black"
                  onClick={() => {
                    handleRequestSubmit?.();
                    handleSearchSubmit?.();
                    dispatch(setAddieField({ key: 'prompt', value: '' }));
                  }}
                />
              </ShadcnTooltip>
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white hover:bg-white/80"
            >
              <SpeechToText />
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default AddiePromptBox;
