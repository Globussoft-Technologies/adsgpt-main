'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields, updateBrandName } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';


export default function BrandSearch({
  isAvatarAdsSearch = false,
  placeholder,
  isBrandInfoStep = false,
  portal = true,
  surfaceVariant = 'default',
}) {

  const { myBrands: brands } = useSelector((state) => state.brandIQTabs);
  const { selectedBrand, brand_name, brandInfo } = useSelector((state) => state.adFactoryNew);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const dispatch = useDispatch();
  const usesNeutralFormSurface = surfaceVariant === 'neutral-form';

  useEffect(() => {
    if (portal) return;
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [portal]);


  const filteredBrands = brands.filter((b) =>
    b?.name?.toLowerCase().includes(brand_name?.toLowerCase() || '')
  );

  const handleBrandSelect = (val) => {
    setOpen(false);
    dispatch(
      setFields({
        selectedBrand: val,
        brand_name: val?.name || '',
        brand_description: val?.description || '',
      })
    );

    if (Array.isArray(val?.logoUrls) && val?.logoUrls.length > 0) {
      dispatch(setFields({ brand_logo: val?.logoUrls[0], uploadedLogo: '' }));
    }
  };

  const handleBrandNameChange = (val) => {
    dispatch(
      setFields({
        brand_name: val || '',
        selectedBrand: {},
        brand_description: '',
        brand_logo: '',
      })
    );
    dispatch(updateBrandName({ brandName: val || '' }));
  };

  return (
    <div
      className={`brand_select_from_adfactory w-full ${
        usesNeutralFormSurface ? 'adfactory-brand-select' : ''
      }`}
    >
      <div ref={wrapperRef} className="relative w-full">
        <div>
          <Command
            className={`relative !overflow-visible rounded-full border text-zinc-900 transition-all dark:border-white/10 dark:bg-[#383838]/50 dark:text-white dark:shadow-none ${
              usesNeutralFormSurface
                ? 'adfactory-brand-select-control border-black/10 bg-[#E2E8EE] shadow-none'
                : 'border-white/80 bg-[#E2E6EA] shadow-[inset_2px_2px_5px_rgba(160,172,188,0.30),inset_-2px_-2px_5px_rgba(255,255,255,0.85)]'
            }`}
            shouldFilter={false}
          >
            <div className="relative flex w-full items-center min-h-11 2xl:min-h-[49px] [&_svg]:hidden">
              <CommandInput
                value={brand_name || brandInfo?.brandName || ''}
                placeholder={placeholder || 'Select brand or type a new one'}
                onValueChange={handleBrandNameChange}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                className="h-11 w-full border-none bg-transparent px-5 text-sm text-zinc-900 placeholder:text-zinc-500 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 dark:text-white dark:placeholder:text-[#AFAFAF] 2xl:h-[49px] 2xl:text-base placeholder:2xl:text-base"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen((prev) => !prev)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full hover:bg-transparent"
            >
              <ChevronDown
                className="size-4 text-zinc-500 dark:text-[#AFAFAF] hover:text-zinc-900 dark:hover:text-white"
              />
            </Button>

            {/* Dropdown list */}
            {open && !portal && (
              <CommandList className="absolute top-full left-0 z-[9999] mt-2 max-h-52 w-full overflow-auto rounded-2xl border border-black/10 bg-[#EEF1F3] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1b1c1f] dark:shadow-2xl">
                <CommandEmpty className="py-3 text-center text-sm text-zinc-500 2xl:text-base dark:text-[#AFAFAF]">
                  No brand found
                </CommandEmpty>
                {filteredBrands.map((b) => (
                  <CommandItem
                    key={b?.id}
                    value={b?.name}
                    onSelect={() => handleBrandSelect(b)}
                    className={`flex w-full cursor-pointer justify-between rounded-xl px-3.5 py-2.5 text-sm text-zinc-800 transition-colors hover:bg-black/5 2xl:text-base data-[selected=true]:bg-black/5 data-[selected=true]:text-zinc-900 dark:text-white dark:hover:bg-white/10 dark:data-[selected=true]:bg-white/10 dark:data-[selected=true]:text-white ${
                      selectedBrand?.name === b?.name ? 'bg-black/5 font-semibold dark:bg-[#454545]' : ''
                    }`}
                  >
                    {b?.name}
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        selectedBrand?.name === b?.name
                          ? 'border-zinc-700 bg-zinc-700 dark:border-[#575757] dark:bg-[#575757]'
                          : 'border-zinc-400 dark:border-[#AFAFAF]'
                      }`}
                    >
                      {selectedBrand?.name === b?.name && (
                        <div className="h-[6px] w-[6px] rounded-full bg-white dark:bg-white" />
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            )}

            {portal && (
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverAnchor asChild>
                  <div className="absolute bottom-0 left-0 h-0 w-full" />
                </PopoverAnchor>
                <PopoverContent
                  className={`z-[9999] w-[var(--radix-popover-trigger-width)] rounded-2xl border border-black/10 bg-[#EEF1F3] p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1b1c1f] dark:shadow-2xl ${
                    usesNeutralFormSurface ? 'adfactory-brand-select-popover' : ''
                  }`}
                  align="start"
                  sideOffset={4}
                >
                  <CommandList className="relative max-h-32 2xl:max-h-45 w-full overflow-auto bg-transparent border-none">
                    <CommandEmpty className="py-2 text-center text-sm text-zinc-500 2xl:text-base dark:text-[#AFAFAF]">
                      No brand found
                    </CommandEmpty>
                    {filteredBrands.map((b) => (
                      <CommandItem
                        key={b?.id}
                        value={b?.name}
                        onSelect={() => handleBrandSelect(b)}
                        className={`flex w-full cursor-pointer justify-between rounded-xl px-3 2xl:px-4 py-2 2xl:py-3 text-[10px] text-zinc-800 hover:bg-black/5 2xl:text-sm data-[selected=true]:bg-black/5 data-[selected=true]:text-zinc-900 dark:text-white dark:hover:bg-white/10 dark:data-[selected=true]:bg-white/10 dark:data-[selected=true]:text-white ${
                          selectedBrand?.name === b?.name ? 'bg-black/5 font-semibold dark:bg-[#454545]' : ''
                        }`}
                      >
                        {b?.name}
                        <span
                          className={`flex min-h-3 min-w-3 2xl:min-h-4 2xl:min-w-4 items-center justify-center rounded-full border ${
                            selectedBrand?.name === b?.name
                              ? 'border-zinc-700 bg-zinc-700 dark:border-[#575757] dark:bg-[#575757]'
                              : 'border-zinc-400 dark:border-[#AFAFAF]'
                          }`}
                        >
                          {selectedBrand?.name === b?.name && (
                            <div className="h-[6px] w-[6px] rounded-full bg-white dark:bg-white" />
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandList>
                </PopoverContent>
              </Popover>
            )}
          </Command>
        </div>
      </div>
    </div>
  );
}
