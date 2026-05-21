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


export default function BrandSearch({ isAvatarAdsSearch = false, placeholder, isBrandInfoStep=false, portal = false }) {

  const { myBrands: brands } = useSelector((state) => state.brandIQTabs);
  const { selectedBrand, brand_name, brandInfo } = useSelector((state) => state.adFactoryNew);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const dispatch = useDispatch();

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
    <div className="brand_select_from_adfactory w-full">
      <div ref={wrapperRef} className="relative w-full transition-colors focus-within:shadow-lg">
        <div className={isAvatarAdsSearch ? '' : 'input-gradient-border'}>
          <Command
            className={`rounded-full ${isAvatarAdsSearch || isBrandInfoStep ? 'bg-[#9092941A]' : 'border border-white/10 bg-[#383838]/50'} shadow-md focus-within:border-white/50`}
            shouldFilter={false}
          >
            <div
              className={`relative flex w-full items-center ${isAvatarAdsSearch ? 'min-h-[40px] 2xl:min-h-[46px]' : 'min-h-10 2xl:min-h-[49px]'} [&_svg]:hidden`}
            >
              <CommandInput
                value={brand_name || brandInfo?.brandName || ''}
                placeholder={placeholder || 'Select brand or type a new one'}
                onValueChange={handleBrandNameChange}
                onFocus={() => setOpen(true)}
                className={`h-12 rounded-full bg-transparent ${isAvatarAdsSearch ? 'px-1 text-sm placeholder:text-sm 2xl:placeholder:text-sm' : 'px-3 text-sm placeholder:text-sm 2xl:text-base placeholder:2xl:text-base'} text-white placeholder:text-[#AFAFAF]`}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setOpen((prev) => !prev)}
              className="group absolute top-1/2 right-2 -translate-y-1/2 rounded-full hover:!bg-transparent"
            >
              <ChevronDown
                className={` ${isAvatarAdsSearch ? 'size-5 text-white' : 'size-4 text-[#AFAFAF]'} group-hover:text-white`}
              />
            </Button>

            {/* Dropdown list */}
            {open && !portal && (
              <CommandList className="absolute top-full z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-white/10 bg-[#1b1c1f] p-1 shadow-lg backdrop-blur-[100px]">
                <CommandEmpty className="py-2 text-center text-sm text-[#AFAFAF] 2xl:text-base">
                  No brand found
                </CommandEmpty>
                {filteredBrands.map((b) => (
                  <CommandItem
                    key={b?.id}
                    value={b?.name}
                    onSelect={() => handleBrandSelect(b)}
                    className={`flex w-full cursor-pointer justify-between rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10 2xl:text-base data-[selected=true]:bg-white/10 data-[selected=true]:text-white ${
                      selectedBrand?.name === b?.name ? 'bg-[#454545]' : ''
                    }`}
                  >
                    {b?.name}
                    <span
                      className={`flex min-h-4 min-w-4 items-center justify-center rounded-full border ${
                        selectedBrand?.name === b?.name
                          ? 'border-[#575757] bg-[#575757]'
                          : 'border-[#AFAFAF]'
                      }`}
                    >
                      {selectedBrand?.name === b?.name && (
                        <div className="h-[6px] w-[6px] rounded-full bg-white" />
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
                  className="z-55 w-[var(--radix-popover-trigger-width)] p-1 rounded-xl border border-white/10 bg-[#1b1c1f] shadow-lg backdrop-blur-[100px]"
                  align="start"
                  sideOffset={4}
                >
                  <CommandList className="relative max-h-32 2xl:max-h-45 w-full overflow-auto bg-transparent border-none">
                    <CommandEmpty className="py-2 text-center text-sm text-[#AFAFAF] 2xl:text-base">
                      No brand found
                    </CommandEmpty>
                    {filteredBrands.map((b) => (
                      <CommandItem
                        key={b?.id}
                        value={b?.name}
                        onSelect={() => handleBrandSelect(b)}
                        className={`flex w-full cursor-pointer justify-between rounded-md px-3 2xl:px-4 py-2 2xl:py-3 text-[10px] text-white hover:bg-white/10 2xl:text-sm data-[selected=true]:bg-white/10 data-[selected=true]:text-white ${
                          selectedBrand?.name === b?.name ? 'bg-[#454545]' : ''
                        }`}
                      >
                        {b?.name}
                        <span
                          className={`flex min-h-3 min-w-3 2xl:min-h-4 2xl:min-w-4 items-center justify-center rounded-full border ${
                            selectedBrand?.name === b?.name
                              ? 'border-[#575757] bg-[#575757]'
                              : 'border-[#AFAFAF]'
                          }`}
                        >
                          {selectedBrand?.name === b?.name && (
                            <div className="h-[6px] w-[6px] rounded-full bg-white" />
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
