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
import { CheckCircle2, ChevronDown, Circle } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

export default function BrandSearch() {
  const { myBrands: brands } = useSelector((state) => state.brandIQTabs);
  const { selectedBrand, brand_name } = useSelector((state) => state.prompt);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const dispatch = useDispatch();

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredBrands = brands.filter((b) =>
    b?.name?.toLowerCase().includes(brand_name.toLowerCase())
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
      setFields({ brand_name: val || '', selectedBrand: {}, brand_description: '', brand_logo: '' })
    );
  };
  return (
    <div className="w-full">
      <label htmlFor="brand-name" className="text-[11px] font-normal text-[#afafaf] 2xl:text-sm">
        Brand Name
      </label>

      <div ref={wrapperRef} className="relative w-full transition-colors focus-within:shadow-lg">
        <Command className="mt-1 rounded-4xl border bg-[#0d0d0d]/50 shadow-md focus-within:border-white/50">
          <div className="relative flex w-full items-center [&_svg]:hidden">
            <CommandInput
              value={brand_name}
              placeholder="Enter Brand"
              onValueChange={handleBrandNameChange}
              onFocus={() => setOpen(true)}
              className="truncate pr-0 text-[10px] placeholder:text-[10px] placeholder:text-[#ccc]/60 2xl:text-sm placeholder:2xl:text-sm"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen((prev) => !prev)}
            className="group absolute top-1/2 right-2 -translate-y-1/2 rounded-full hover:!bg-transparent"
          >
            <ChevronDown className="h-6 w-6 opacity-50 group-hover:opacity-100" />
          </Button>

          {/* Dropdown list */}
          {open && (
            <CommandList className="backdrop-blur-100 absolute top-full z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-white/20 bg-[#0D0D0D]/90 p-2 shadow-lg 2xl:max-h-60">
              <CommandEmpty>No brand found.</CommandEmpty>
              {filteredBrands.map((b) => (
                <CommandItem
                  key={b?.id}
                  value={b?.name}
                  onSelect={() => handleBrandSelect(b)}
                  className={`flex w-full cursor-pointer justify-between py-1 pr-[25px] text-[10px] wrap-anywhere hover:!bg-[#4a4a4a]/50 2xl:py-1.5 2xl:text-sm ${selectedBrand?.name === b?.name ? 'dark:!bg-[#4a4a4a]/50' : '!bg-transparent'} focus:!bg-transparent focus:!text-inherit`}
                >
                  {b?.name}
                  <span
                    className={`absolute right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border 2xl:h-4 2xl:w-4 ${
                      selectedBrand?.name === b?.name
                        ? 'border-[#575757] dark:bg-[#575757]'
                        : 'border-[#AFAFAF]'
                    }`}
                  >
                    {selectedBrand?.name === b?.name && (
                      <div className="h-[6px] w-[6px] rounded-full dark:bg-white" />
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          )}
        </Command>
      </div>
    </div>
  );
}
