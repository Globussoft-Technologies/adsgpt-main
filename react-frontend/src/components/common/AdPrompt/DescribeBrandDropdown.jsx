import React from 'react';
import { FaChevronDown } from 'react-icons/fa';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import BrandSelect from './BrandSelect';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

const DescribeBrandDropdown = () => {
  const dispatch = useDispatch();
  const { cta, brand_name } = useSelector((state) => state.prompt);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="describe-brand-trigger group relative flex max-w-[200px] items-center gap-2 rounded-full border border-[#DDD7CD] bg-[#FCFAF7] px-3.5 py-1.5 text-xs font-medium text-[#24211D] shadow-xs transition-all hover:bg-[#EAE5DC] 2xl:py-2 dark:border-white/10 dark:bg-[#1E1E1E] dark:text-[#AFAFAF] dark:hover:bg-[#2A2A2A] dark:hover:text-white"
        >
          <span className="truncate font-medium text-inherit">
            {brand_name || 'Describe Brand'}
          </span>
          <FaChevronDown className="h-2.5 w-2.5 shrink-0 text-[#7A7369] transition-transform duration-200 group-data-[state=open]:rotate-180 dark:text-[#BEBEBE]" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="describe-brand-popover mb-2 w-84 rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] p-4.5 text-[#24211D] shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#141414] dark:text-white"
      >
        <div className="w-full">
          <h4 className="mb-3.5 text-center text-[13px] font-semibold text-[#24211D] dark:text-white">
            Describe Brand
          </h4>

          <div className="flex flex-col gap-3">
            <BrandSelect className="describe-brand-name-field" />

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="call-to-action"
                className="text-[12px] font-medium text-[#7A7369] dark:text-white/70"
              >
                Call to Action
              </label>
              <Input
                id="call-to-action"
                className="describe-brand-cta-input h-10 w-full rounded-full border border-[#DDD7CD] bg-white px-3.5 text-xs text-[#24211D] shadow-xs placeholder:text-[#948C80] focus-visible:border-[#02C8C4] focus-visible:ring-1 focus-visible:ring-[#02C8C4]/30 focus-visible:ring-offset-0 dark:border-white/10 dark:bg-[#1C1C1C] dark:text-white dark:placeholder:text-[#afafaf]/50 dark:focus-visible:border-[#15DCFF] dark:focus-visible:ring-[#15DCFF]/30 transition-all"
                onChange={(e) => {
                  dispatch(setFields({ cta: e.target.value }));
                }}
                placeholder="Enter Call to Action"
                value={cta || ''}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DescribeBrandDropdown;
