import React from 'react';
import { Layers } from 'lucide-react';
import InputCommonDropdown from '@/components/AdFactory/NodeForms/InputCommonDropdown';
import { MODEL_OPTIONS, FALLBACK_CREDITS_PER_IMAGE } from './imageModels';

// ----------------------------------------------------------------------------
// AdsPerCycleSection — how many ad pairs (image creative + ad copy variant)
// each cycle should produce + which image model generates them. Default 1
// ad, max 50. Cost per cycle = ads × 7 credits (image cost; text is free).
// Header pill surfaces the live cost.
//
// Model options mirror the existing ServicesForm Image Ads dropdown so the
// backend image-generation worker contract stays unchanged. Labels kept
// short so the panel doesn't overflow on narrower screens.
// ----------------------------------------------------------------------------

const MIN_ADS = 1;
const MAX_ADS = 50;

export default function PairsPerCycleSection({
  value,
  onChange,
  model,
  onModelChange,
  creditsPerImage,
  modelOptions = MODEL_OPTIONS,
  disabled,
}) {
  const ads = clamp(Number(value) || MIN_ADS, MIN_ADS, MAX_ADS);
  const perImage = Number(creditsPerImage) || FALLBACK_CREDITS_PER_IMAGE;
  const cost = ads * perImage;

  const set = (next) => onChange?.(clamp(next, MIN_ADS, MAX_ADS));

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 transition dark:border-white/10 dark:bg-white/2 ${
        disabled ? 'pointer-events-none opacity-70 dark:opacity-50' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-[#15DCFF]" />
          <h3 className="text-sm font-semibold text-gray-900 2xl:text-base dark:text-white">
            Ads per cycle
            <span className="ml-0.5 text-red-400">*</span>
          </h3>
        </div>
        <span className="rounded-full border border-black/10 bg-black/[0.04] px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-[#E3E3E3]">
          {cost} credit{cost === 1 ? '' : 's'} / cycle
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-center">
        <input
          type="number"
          min={MIN_ADS}
          max={MAX_ADS}
          value={ads}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return; // let the user clear-then-retype
            const n = parseInt(raw, 10);
            if (Number.isNaN(n)) return;
            set(n);
          }}
          disabled={disabled}
          placeholder="Enter quantity"
          className="adfactory-automation-input h-10 w-full rounded-full bg-gray-200 px-5 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#383838]/50 dark:text-white dark:placeholder:text-[#AFAFAF] dark:focus:bg-[#383838]/70 dark:disabled:opacity-50"
        />

        <InputCommonDropdown
          label="Image model"
          options={modelOptions}
          value={model || modelOptions[0]?.value || 'google'}
          onChange={(next) => onModelChange?.(next)}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
