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
import { Check, ChevronDown } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields, updateBrandName } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';


export default function BrandSearch({
  isAvatarAdsSearch = false,
  placeholder,
  isBrandInfoStep = false,
  portal = true,
  surfaceVariant = 'default',
  // Opt-in (AI Ads): refill from the header brand whenever the field ends up
  // empty without the user touching it, e.g. a sibling step's unmount reset
  // landing after this instance's mount-time seed.
  refillFromHeader = false,
}) {

  const { myBrands: brands, selectedCompetitorBrand } = useSelector((state) => state.brandIQTabs);
  const { selectedBrand, brand_name, brandInfo } = useSelector((state) => state.adFactoryNew);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const dispatch = useDispatch();
  const isBroll = surfaceVariant === 'broll' || surfaceVariant === 'form-pill' || isAvatarAdsSearch;
  const usesNeutralFormSurface = surfaceVariant === 'neutral-form';
  const isAiAdsCompact = surfaceVariant === 'ai-ads-compact';
  const headerBrand = Array.isArray(brands)
    ? brands.find((brand) => brand.id === selectedCompetitorBrand?.id)
    : null;

  // True once the user picks or types in this instance; a refill must never
  // overwrite their local override. Cleared when the header brand changes.
  const userTouchedRef = useRef(false);

  const seedFromHeader = () => {
    const logo = headerBrand.logoUrls?.[0] || headerBrand.logoUrl || headerBrand.brandLogo || '';
    dispatch(
      setFields({
        selectedBrand: headerBrand,
        brand_name: headerBrand.name || '',
        brand_description: headerBrand.description || '',
        brand_logo: logo,
      })
    );
  };

  // Every instance of this control (including AI Ads and Avatar Ads) reflects
  // the top-right Ad Studio brand immediately, without invoking any analysis.
  useEffect(() => {
    if (!headerBrand?.id) return;
    userTouchedRef.current = false;
    seedFromHeader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, headerBrand?.id]);

  useEffect(() => {
    if (!refillFromHeader || !headerBrand?.id || userTouchedRef.current) return;
    if (selectedBrand?.id || brand_name) return;
    seedFromHeader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refillFromHeader, headerBrand?.id, selectedBrand?.id, brand_name]);

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
  const compactInputText =
    brand_name || brandInfo?.brandName || placeholder || 'Select a brand';
  const compactInputCharacters = Math.min(18, Math.max(7, compactInputText.length));

  const isBrandSelected = (brand) =>
    selectedBrand?.id && brand?.id
      ? selectedBrand.id === brand.id
      : selectedBrand?.name === brand?.name;

  const handleBrandSelect = (val) => {
    userTouchedRef.current = true;
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
    userTouchedRef.current = true;
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
      } ${
        isAiAdsCompact
          ? '!w-fit rounded-full border border-black/15 bg-white shadow-sm transition-[border-color,box-shadow] hover:border-black/25 focus-within:border-[#5867EB] focus-within:ring-2 focus-within:ring-[#5867EB]/15 dark:border-white/[0.12] dark:bg-[#242428] dark:shadow-black/20 dark:hover:border-white/20 dark:focus-within:border-[#7C88FF] dark:focus-within:ring-[#5867EB]/20 [&_[data-slot=command-input-wrapper]]:!w-auto'
          : ''
      }`}
    >
      <div ref={wrapperRef} className="relative w-full">
        <div>
          <Command
            className={`relative !overflow-visible rounded-full border transition-all ${
              isAiAdsCompact
                ? 'border-transparent bg-transparent text-zinc-900 shadow-none dark:bg-transparent dark:text-white'
                : isBroll
                ? 'border-black/10 bg-zinc-50 text-zinc-800 shadow-none hover:bg-zinc-100/60 dark:border-transparent dark:bg-[#909294]/10 dark:text-white'
                : usesNeutralFormSurface
                  ? 'adfactory-brand-select-control border-black/10 bg-[#E2E8EE] text-zinc-900 shadow-none dark:border-white/10 dark:bg-[#383838]/50 dark:text-white dark:shadow-none'
                  : 'border-white/80 bg-[#E2E6EA] text-zinc-900 shadow-[inset_2px_2px_5px_rgba(160,172,188,0.30),inset_-2px_-2px_5px_rgba(255,255,255,0.85)] dark:border-white/10 dark:bg-[#383838]/50 dark:text-white dark:shadow-none'
            }`}
            shouldFilter={false}
          >
            <div
              className={`relative flex w-full items-center [&_[data-slot=command-input-wrapper]_svg]:hidden ${
                isAiAdsCompact ? 'h-7 min-h-0 !w-auto' : 'min-h-11 2xl:min-h-[49px]'
              }`}
            >
              <CommandInput
                value={brand_name || brandInfo?.brandName || ''}
                placeholder={placeholder || 'Select brand or type a new one'}
                onValueChange={handleBrandNameChange}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                style={
                  isAiAdsCompact
                    ? { width: `calc(${compactInputCharacters}ch + 0.875rem)` }
                    : undefined
                }
                className={`w-full border-none bg-transparent text-zinc-800 placeholder:text-zinc-500 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 dark:text-white dark:placeholder:text-[#AFAFAF] ${
                  isAiAdsCompact
                    ? 'h-7 py-0 pl-2.5 pr-1 text-xs font-medium [&::-webkit-search-cancel-button]:hidden'
                    : `h-11 ${isBroll ? 'px-4' : 'px-5'} text-sm 2xl:h-[49px] 2xl:text-base placeholder:2xl:text-base`
                }`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Toggle brand list"
                onClick={() => setOpen((prev) => !prev)}
                className={`group rounded-full hover:bg-transparent ${
                  isAiAdsCompact
                    ? 'relative mr-1 h-5 w-5'
                    : 'absolute top-1/2 right-2 -translate-y-1/2'
                }`}
              >
                {isAiAdsCompact ? (
                  <span
                    aria-hidden="true"
                    className="mb-0.5 h-1.5 w-1.5 rotate-45 border-r border-b border-zinc-500 transition-colors group-hover:border-zinc-900 dark:border-zinc-400 dark:group-hover:border-white"
                  />
                ) : (
                  <ChevronDown className="size-4 text-zinc-500 transition-colors hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:text-white" />
                )}
              </Button>
            </div>

            {/* Dropdown list */}
            {open && !portal && (
              <CommandList className={`absolute top-full left-0 z-[9999] mt-2 max-h-52 w-full overflow-auto rounded-2xl border border-black/10 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1b1c1f] dark:shadow-2xl ${isBroll ? 'bg-white text-zinc-800' : 'bg-[#EEF1F3]'}`}>
                <CommandEmpty className="py-3 text-center text-sm text-zinc-500 2xl:text-base dark:text-[#AFAFAF]">
                  No brand found
                </CommandEmpty>
                {filteredBrands.map((b) => (
                  <CommandItem
                    key={b?.id}
                    value={b?.name}
                    onSelect={() => handleBrandSelect(b)}
                    className={`flex w-full cursor-pointer justify-between rounded-xl px-3.5 py-2.5 text-sm text-zinc-800 transition-colors hover:bg-zinc-100 2xl:text-base data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 dark:text-white dark:hover:bg-white/10 dark:data-[selected=true]:bg-white/10 dark:data-[selected=true]:text-white ${
                      selectedBrand?.name === b?.name ? 'bg-zinc-100 font-semibold dark:bg-[#454545]' : ''
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
                  className={`z-[9999] w-[var(--radix-popover-trigger-width)] border ${
                    isAiAdsCompact
                      ? '!w-36 rounded-lg border-black/10 bg-white p-1 text-zinc-800 shadow-[0_10px_28px_rgba(0,0,0,0.16)] dark:border-white/10 dark:bg-[#242428] dark:text-white dark:shadow-[0_14px_32px_rgba(0,0,0,0.4)]'
                      : `rounded-2xl p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:border-white/10 dark:bg-[#1b1c1f] dark:shadow-2xl ${isBroll
                      ? 'border-black/10 bg-white text-zinc-800 shadow-xl'
                      : usesNeutralFormSurface
                        ? 'adfactory-brand-select-popover border-black/10 bg-[#EEF1F3]'
                        : 'border-black/10 bg-[#EEF1F3]'}`
                  }`}
                  align="start"
                  sideOffset={isAiAdsCompact ? 6 : 4}
                >
                  <CommandList
                    className={`relative w-full overflow-auto border-none bg-transparent ${
                      isAiAdsCompact ? 'max-h-36 space-y-0.5' : 'max-h-32 2xl:max-h-45'
                    }`}
                  >
                    <CommandEmpty
                      className={`${isAiAdsCompact ? 'py-2 text-xs' : 'py-2 text-sm 2xl:text-base'} text-center text-zinc-500 dark:text-[#AFAFAF]`}
                    >
                      No brand found
                    </CommandEmpty>
                    {filteredBrands.map((b, index) => {
                      const isSelected = isBrandSelected(b);
                      const commandValue = String(
                        b?.id || `${b?.name || 'brand'}-${index}`
                      );

                      return (
                        <CommandItem
                          key={commandValue}
                          value={commandValue}
                          onSelect={() => handleBrandSelect(b)}
                          className={`flex w-full cursor-pointer justify-between text-zinc-800 dark:text-white ${
                            isAiAdsCompact
                              ? 'min-h-7 rounded-[5px] !bg-transparent px-2 py-1.5 text-xs transition-colors hover:!bg-black/[0.05] data-[selected=true]:!bg-black/[0.05] data-[selected=true]:text-zinc-900 dark:hover:!bg-white/[0.07] dark:data-[selected=true]:!bg-white/[0.07] dark:data-[selected=true]:text-white'
                              : 'rounded-xl px-3 py-2 text-[10px] hover:bg-zinc-100 2xl:px-4 2xl:py-3 2xl:text-sm data-[selected=true]:bg-zinc-100 data-[selected=true]:text-zinc-900 dark:hover:bg-white/10 dark:data-[selected=true]:bg-white/10 dark:data-[selected=true]:text-white'
                          } ${
                            isSelected
                              ? isAiAdsCompact
                                ? 'font-semibold'
                                : 'bg-zinc-100 font-semibold dark:bg-[#454545]'
                              : ''
                          }`}
                        >
                          <span className="min-w-0 truncate">{b?.name}</span>
                          {isAiAdsCompact ? (
                            isSelected && <Check className="ml-1.5 size-3 shrink-0 text-[#7C88FF]" />
                          ) : (
                            <span
                              className={`flex min-h-3 min-w-3 items-center justify-center rounded-full border 2xl:min-h-4 2xl:min-w-4 ${
                                isSelected
                                  ? 'border-zinc-700 bg-zinc-700 dark:border-[#575757] dark:bg-[#575757]'
                                  : 'border-zinc-400 dark:border-[#AFAFAF]'
                              }`}
                            >
                              {isSelected && (
                                <div className="h-[6px] w-[6px] rounded-full bg-white dark:bg-white" />
                              )}
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
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
