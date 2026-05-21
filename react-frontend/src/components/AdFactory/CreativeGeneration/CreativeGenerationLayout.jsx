import React from 'react';
import ChatWithBotInterface from './ChatWithBotInterface';
import AdPromptComponent from '@/components/common/AdPrompt/AdPromptComponent';

const CreativeGenerationLayout = ({ onClose }) => {
  return (
    <div className="backdrop-blur-100 fixed inset-0 z-[999999] flex flex-col bg-[#0D0D0D]/50">
      <div className="absolute top-[1.5vw] right-[2vw] w-fit scale-100 rounded-xl bg-gradient-to-r from-transparent to-transparent p-[2px] transition-all duration-300 ease-out hover:from-[#02C8C4] hover:to-[#5867EB] lg:scale-90 2xl:right-[3vw] 2xl:scale-100">
        <button
          onClick={() => onClose()}
          type="button"
          className="rounded-[12px] bg-[#1A1A1A] px-7 py-1.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#151515]"
        >
          Cancel
        </button>
      </div>

      <div className="w-full flex-1 overflow-y-auto px-4 pt-20 pb-3 md:pt-7 2xl:pt-10">
        <div className="mx-auto max-w-3xl 2xl:max-w-4xl">
          <ChatWithBotInterface />
        </div>
      </div>

      <div className="h-[140px] w-full 2xl:h-[150px]">
        <AdPromptComponent />
      </div>
    </div>
  );
};

export default CreativeGenerationLayout;
