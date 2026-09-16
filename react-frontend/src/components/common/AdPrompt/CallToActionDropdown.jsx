import React from 'react';
import { Check, ChevronDown, MousePointerClick } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

const CTA_OPTIONS = [
  { value: '', label: 'No CTA' },
  { value: 'Learn More', label: 'Learn More' },
  { value: 'Shop Now', label: 'Shop Now' },
  { value: 'Sign Up', label: 'Sign Up' },
  { value: 'Contact Us', label: 'Contact Us' },
  { value: 'Download', label: 'Download' },
  
  { value: 'Get Quote', label: 'Get Quote' },
  { value: 'Book Now', label: 'Book Now' },
];

const CallToActionDropdown = () => {
  const dispatch = useDispatch();
  const cta = useSelector((state) => state.prompt.cta) || '';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={cta ? `Call to action: ${cta}` : 'Select call to action'}
          className="prompt_selection_button_no_gradient group relative flex h-6! items-center gap-2 rounded-[50px] px-3! py-0! text-[9px] opacity-80 shadow-none transition-all duration-200 ease-in hover:bg-slate-100 hover:opacity-100 md:text-[11px] 2xl:h-8! 2xl:px-4! 2xl:text-[13px] dark:border-none dark:bg-[#202020]/50 dark:text-[#AFAFAF]"
        >
          <MousePointerClick className="h-3 w-3 shrink-0 text-current 2xl:h-4 2xl:w-4" />
          <span className="max-w-24 truncate font-light text-zinc-800 dark:text-[#AFAFAF] dark:group-data-[state=open]:text-white 2xl:max-w-32">
            {cta || 'Call to Action'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-current transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="adcopy-cta-popover z-[999999] w-64 max-w-[calc(100vw-1rem)] rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7]/95 p-2 text-[#24211D] shadow-[0_16px_40px_rgba(36,33,29,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#141414]/95 dark:text-white dark:shadow-[0_18px_44px_rgba(0,0,0,0.4)]"
      >
        <div className="px-2 pt-1.5 pb-2 text-xs font-medium text-[#7A7369] dark:text-white/55">
          Call to Action
        </div>

        <div className="grid max-h-52 gap-0.5 overflow-y-auto">
          {CTA_OPTIONS.map((option) => {
            const isSelected = cta === option.value;

            return (
              <button
                key={option.label}
                type="button"
                onClick={() => dispatch(setFields({ cta: option.value }))}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-[#FFF4E7] text-[#24211D] dark:bg-white/10 dark:text-white'
                    : 'text-[#615B52] hover:bg-[#F1EDE6] hover:text-[#24211D] dark:text-white/70 dark:hover:bg-white/8 dark:hover:text-white'
                }`}
              >
                <span>{option.label}</span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#F6A623] dark:text-[#15DCFF]" />
                )}
              </button>
            );
          })}
        </div>

        <div className="my-2 h-px bg-black/8 dark:bg-white/10" />

        <div className="px-1 pb-1">
          <label
            htmlFor="ad-copy-custom-call-to-action"
            className="mb-1.5 block px-1 text-[11px] font-medium text-[#7A7369] dark:text-white/55"
          >
            Custom CTA
          </label>
          <Input
            id="ad-copy-custom-call-to-action"
            className="adcopy-cta-input h-9 w-full rounded-full border border-[#DDD7CD] bg-white px-3 text-xs text-[#24211D] shadow-xs transition-all placeholder:text-[#948C80] focus-visible:border-[#02C8C4] focus-visible:ring-1 focus-visible:ring-[#02C8C4]/30 focus-visible:ring-offset-0 dark:border-white/10 dark:bg-[#1C1C1C] dark:text-white dark:placeholder:text-white/35 dark:focus-visible:border-[#15DCFF] dark:focus-visible:ring-[#15DCFF]/30"
            onChange={(event) => dispatch(setFields({ cta: event.target.value }))}
            placeholder="For example: Start free trial"
            value={cta}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default CallToActionDropdown;
