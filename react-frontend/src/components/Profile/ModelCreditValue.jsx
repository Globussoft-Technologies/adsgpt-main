import React from 'react';
import { SiOpenai } from 'react-icons/si';
import { RiGeminiFill } from 'react-icons/ri';
import { ChevronDown } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import openaiLogo from '@/assets/layouts/profile/download (2).png';
import geminiLogo from '@/assets/layouts/profile/Google_Gemini_icon_2025.svg.png';
import seedanceLogo from '@/assets/layouts/profile/seedance_logo_transparent.png';
import klingLogo from '@/assets/layouts/profile/kling-color.png';

const QUALITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra_high: 'Ultra High',
};

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
    return <img src={geminiLogo} alt="Gemini" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />;
  }
  if (lowLabel.includes('seedance') || lowLabel.includes('seedream')) {
    return (
      <img src={seedanceLogo} alt="Seedance" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />
    );
  }
  if (lowLabel.includes('kling')) {
    return <img src={klingLogo} alt="Kling" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />;
  }
  return <img src={geminiLogo} alt="Model" className="h-5 w-5 object-contain 2xl:h-6 2xl:w-6" />;
};

// Splits a flat value string like "7 CREDITS/IMAGE" into number + unit.
const splitValue = (valueString) => {
  const parts = String(valueString || '0').split(' ');
  return { creditValue: parts[0], creditUnit: parts.slice(1).join(' ') };
};

const IconBadge = ({ label }) => (
  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 2xl:h-10 2xl:w-10 dark:bg-white/5">
    {getModelIcon(label)}
  </div>
);

const CHIP_CLASS =
  'flex w-[172px] shrink-0 items-center gap-2 rounded-xl border border-black/10 bg-zinc-50 p-4 2xl:w-[200px] 2xl:gap-3 dark:border-white/5 dark:bg-[#333333]/50';

// Flat chip — used for video models and as fallback when no quality tiers exist.
const FlatChip = ({ label, value }) => {
  const { creditValue, creditUnit } = splitValue(value);
  return (
    <div className={CHIP_CLASS}>
      <IconBadge label={label} />
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
};

// Tiered image chip — shows a credit range on the chip and a per-quality
// breakdown in a portal tooltip on hover (portal avoids overflow clipping).
const TieredChip = ({ label, tiers }) => {
  const credits = tiers.map((t) => Number(t.creditsPerImage) || 0);
  const min = Math.min(...credits);
  const max = Math.max(...credits);
  const rangeText = min === max ? `${min}` : `${min}-${max}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`${CHIP_CLASS} cursor-default`}>
          <IconBadge label={label} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-xs leading-tight font-bold whitespace-nowrap text-zinc-900 dark:text-white">
              {label}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[11px] leading-none font-black whitespace-nowrap text-[#3F51B5] 2xl:text-[13px] dark:text-[#7EA7F3]">
                {rangeText}
              </span>
              <span className="text-[8px] font-bold tracking-tighter whitespace-nowrap text-zinc-500 uppercase 2xl:text-[9px] dark:text-white/70">
                CREDITS/IMAGE
              </span>
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 self-center text-zinc-400 dark:text-white/40" />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="rounded-xl border border-black/10 bg-white p-0 text-zinc-900 shadow-2xl dark:border-white/10 dark:bg-[#2a2a2a] dark:text-white"
      >
        <div className="min-w-[210px] px-4 py-3">
          <p className="mb-2 border-b border-black/10 pb-2 text-xs font-bold tracking-wider text-zinc-600 uppercase dark:border-white/10 dark:text-white/70">
            {label}
          </p>
          <div className="flex flex-col gap-2">
            {tiers.map((tier) => (
              <div key={tier.quality} className="flex items-center justify-between gap-8">
                <span className="text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:text-white/70">
                  {QUALITY_LABELS[tier.quality] || tier.quality}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-black text-[#3F51B5] dark:text-[#7EA7F3]">
                    {tier.creditsPerImage}
                  </span>
                  <span className="text-[9px] font-bold tracking-tighter text-zinc-400 uppercase dark:text-white/50">
                    cr
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

const ModelCreditValue = ({ credits = [] }) => {
  if (!credits || credits.length === 0) {
    return null;
  }

  return (
    <>
      {credits.map((item, index) => {
        const label = item.label || 'Unknown';
        const tiers = Array.isArray(item.qualityTiers) ? item.qualityTiers : null;
        const key = `${label}-${index}`;

        return tiers && tiers.length > 0 ? (
          <TieredChip key={key} label={label} tiers={tiers} />
        ) : (
          <FlatChip key={key} label={label} value={item.value} />
        );
      })}
    </>
  );
};

export default ModelCreditValue;
