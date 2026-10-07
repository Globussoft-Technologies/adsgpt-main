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
          className="h-4 w-4 object-contain dark:brightness-90 dark:invert"
        />
      );
    }
    return <SiOpenai className="h-4 w-4 text-zinc-900 dark:text-white" />;
  }
  if (lowLabel.includes('veo') || lowLabel.includes('gemini') || lowLabel.includes('imagen')) {
    if (lowLabel.includes('veo')) {
      return <RiGeminiFill className="h-4 w-4 text-[#4285F4]" />;
    }
    return <img src={geminiLogo} alt="Gemini" className="h-4 w-4 object-contain" />;
  }
  if (lowLabel.includes('seedance') || lowLabel.includes('seedream')) {
    return (
      <img src={seedanceLogo} alt="Seedance" className="h-4 w-4 object-contain" />
    );
  }
  if (lowLabel.includes('kling')) {
    return <img src={klingLogo} alt="Kling" className="h-4 w-4 object-contain" />;
  }
  return <img src={geminiLogo} alt="Model" className="h-4 w-4 object-contain" />;
};

// Splits a flat value string like "7 CREDITS/IMAGE" into number + unit.
const splitValue = (valueString) => {
  const parts = String(valueString || '0').split(' ');
  return { creditValue: parts[0], creditUnit: parts.slice(1).join(' ') || 'CREDITS/SECOND' };
};

const IconBadge = ({ label }) => (
  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] dark:bg-white/[0.05] dark:group-hover:bg-white/[0.09]">
    {getModelIcon(label)}
  </div>
);

const CHIP_BASE_CLASS =
  'group flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-2.5 py-2 transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.04]';

// Flat chip — used for video models and flat rates
const FlatChip = ({ label, value }) => {
  const { creditValue, creditUnit } = splitValue(value);
  return (
    <div className={CHIP_BASE_CLASS}>
      <div className="flex min-w-0 items-center gap-2.5">
        <IconBadge label={label} />
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-xs font-semibold text-zinc-900 dark:text-white leading-tight">
            {label}
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-[11px] font-extrabold text-[#3B82F6] dark:text-[#60A5FA] leading-none">
              {creditValue}
            </span>
            <span className="text-[8px] font-bold uppercase tracking-tight text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
              {creditUnit}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tiered image chip — shows a credit range and breakdown in a tooltip on hover
const TieredChip = ({ label, tiers, isImage = true }) => {
  const credits = tiers.map((t) => Number(t.creditsPerImage) || 0);
  const min = Math.min(...credits);
  const max = Math.max(...credits);
  const rangeText = min === max ? `${min}` : `${min}-${max}`;
  const unit = isImage ? 'CREDITS/IMAGE' : 'CREDITS/SECOND';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`${CHIP_BASE_CLASS} cursor-pointer`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <IconBadge label={label} />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-xs font-semibold text-zinc-900 dark:text-white leading-tight">
                {label}
              </p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[11px] font-extrabold text-[#3B82F6] dark:text-[#60A5FA] leading-none">
                  {rangeText}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-tight text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {unit}
                </span>
              </div>
            </div>
          </div>
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300" />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={6}
        className="rounded-xl border border-black/10 bg-white p-0 text-zinc-900 shadow-xl dark:border-white/10 dark:bg-[#1f1f2b] dark:text-white z-50"
      >
        <div className="min-w-[190px] px-3.5 py-2.5">
          <p className="mb-2 border-b border-black/10 pb-1.5 text-xs font-bold tracking-wider text-zinc-500 uppercase dark:border-white/10 dark:text-zinc-400">
            {label}
          </p>
          <div className="flex flex-col gap-1.5">
            {tiers.map((tier) => (
              <div key={tier.quality} className="flex items-center justify-between gap-6">
                <span className="text-xs font-medium text-zinc-600 uppercase dark:text-zinc-300">
                  {QUALITY_LABELS[tier.quality] || tier.quality}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-xs font-extrabold text-[#3B82F6] dark:text-[#60A5FA]">
                    {tier.creditsPerImage}
                  </span>
                  <span className="text-[9px] font-bold tracking-tighter text-zinc-400 uppercase dark:text-zinc-500">
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

const ModelCreditValue = ({ credits = [], isImage = false }) => {
  if (!credits || credits.length === 0) {
    return null;
  }

  return (
    <>
      {credits.map((item, index) => {
        const label = item.label || 'Unknown';
        const tiers = Array.isArray(item.qualityTiers) && item.qualityTiers.length > 0 ? item.qualityTiers : null;
        const key = `${label}-${index}`;

        return tiers ? (
          <TieredChip key={key} label={label} tiers={tiers} isImage={isImage} />
        ) : (
          <FlatChip key={key} label={label} value={item.value} />
        );
      })}
    </>
  );
};

export default ModelCreditValue;
