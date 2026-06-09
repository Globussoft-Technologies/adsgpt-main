import React from 'react';
import { SiOpenai } from 'react-icons/si';
import { RiGeminiFill } from 'react-icons/ri';

import openaiLogo from '@/assets/layouts/profile/download (2).png';
import geminiLogo from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceLogo from '@/assets/layouts/profile/seedance_logo_transparent.png';
import klingLogo from '@/assets/layouts/profile/kling-color.png';

const ModelCreditValue = ({ credits = [] }) => {
  const getModelIcon = (label) => {
    const lowLabel = label.toLowerCase();
    if (lowLabel.includes('sora') || lowLabel.includes('openai')) {
      if (lowLabel.includes('openai')) {
        return (
          <img
            src={openaiLogo}
            alt="OpenAI"
            className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6 dark:brightness-80 dark:invert"
          />
        );
      }
      return <SiOpenai className="h-5 w-5 text-zinc-900 2xl:h-6 2xl:w-6 dark:text-white" />;
    }
    if (lowLabel.includes('veo') || lowLabel.includes('gemini') || lowLabel.includes('imagen')) {
      if (lowLabel.includes('veo')) {
        return <RiGeminiFill className="h-5 w-5 text-[#4285F4] 2xl:h-6 2xl:w-6" />;
      }
      return (
        <img src={geminiLogo} alt="Gemini" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />
      );
    }
    if (lowLabel.includes('seedance')) {
      return (
        <img
          src={seedanceLogo}
          alt="Seedance"
          className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6"
        />
      );
    }
    if (lowLabel.includes('kling')) {
      return (
        <img
          src={klingLogo}
          alt="Kling"
          className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6"
        />
      );
    }
    return <img src={geminiLogo} alt="Model" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />;
  };

  if (!credits || credits.length === 0) {
    return null;
  }

  return (
    <>
      {credits.map((item, index) => {
        const label = item.label || 'Unknown';
        const valueString = item.value || '0';

        // Split value like "7 CREDITS/IMAGE" to show number highlighted
        const parts = valueString.split(' ');
        const creditValue = parts[0];
        const creditUnit = parts.slice(1).join(' ');

        return (
          <div
            key={`${label}-${index}`}
            className="flex w-[172px] shrink-0 items-center gap-2 rounded-xl border border-black/10 bg-zinc-50 p-4 2xl:w-[200px] 2xl:gap-3 dark:border-white/5 dark:bg-[#333333]/50"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 2xl:h-10 2xl:w-10 dark:bg-white/5">
              {getModelIcon(label)}
            </div>
            <div className="flex min-w-0 flex-col">
              <p className="text-xs leading-tight font-bold whitespace-nowrap text-zinc-900 dark:text-white">
                {label}
              </p>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[11px] leading-none font-black text-[#3F51B5] 2xl:text-[13px] dark:text-[#7EA7F3]">
                  {creditValue}
                </span>
                <span className="text-[8px] font-bold tracking-tighter whitespace-nowrap text-zinc-500 uppercase 2xl:text-[9px] dark:text-white/70">
                  {creditUnit}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

export default ModelCreditValue;
