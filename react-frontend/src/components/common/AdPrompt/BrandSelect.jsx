'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

export default function BrandSearch({ className = '' }) {
  const { myBrands: brands } = useSelector((state) => state.brandIQTabs);
  const { selectedBrand, brand_name } = useSelector((state) => state.prompt);

  const [open, setOpen] = useState(false);
  const [listMaxHeight, setListMaxHeight] = useState(192);
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

  useLayoutEffect(() => {
    if (!open) return undefined;

    const updateListPosition = () => {
      const fieldBounds = wrapperRef.current?.getBoundingClientRect();
      if (!fieldBounds) return;

      const viewportInset = 12;
      const listGap = 6;
      const availableBelow = Math.max(0, window.innerHeight - fieldBounds.bottom - viewportInset - listGap);

      setListMaxHeight(Math.min(192, Math.floor(availableBelow)));
    };

    updateListPosition();
    window.addEventListener('resize', updateListPosition);
    window.addEventListener('scroll', updateListPosition, true);

    return () => {
      window.removeEventListener('resize', updateListPosition);
      window.removeEventListener('scroll', updateListPosition, true);
    };
  }, [open]);

  const filteredBrands = (brands || []).filter((b) =>
    b?.name?.toLowerCase().includes((brand_name || '').toLowerCase())
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
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      <label htmlFor="brand-name" className="text-[12px] font-medium text-[#7A7369] dark:text-white/70">
        Brand Name
      </label>

      <div ref={wrapperRef} className="relative w-full">
        <div className="brand-select-control relative flex h-10 w-full items-center rounded-full border border-[#DDD7CD] bg-white shadow-xs focus-within:border-[#02C8C4] focus-within:ring-1 focus-within:ring-[#02C8C4]/30 dark:border-white/10 dark:bg-[#1C1C1C] dark:focus-within:border-[#15DCFF] dark:focus-within:ring-[#15DCFF]/30 transition-all">
          <input
            id="brand-name"
            type="text"
            value={brand_name || ''}
            placeholder="Enter Brand"
            onChange={(e) => handleBrandNameChange(e.target.value)}
            onFocus={() => setOpen(true)}
            autoComplete="off"
            className="h-full w-full rounded-full bg-transparent pl-3.5 pr-8 text-xs text-[#24211D] placeholder:text-[#948C80] outline-none dark:text-white dark:placeholder:text-[#afafaf]/50"
          />
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            tabIndex={-1}
            className="absolute right-3 flex items-center justify-center text-[#7A7369] transition-colors hover:text-[#24211D] dark:text-white/60 dark:hover:text-white"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Dropdown list */}
        {open && (
          <div
            className="scrollbar-thin absolute top-full left-0 z-50 mt-1.5 w-full overflow-y-auto rounded-xl border border-[#DDD7CD] bg-white p-1 shadow-[0_12px_32px_rgba(80,70,58,0.16)] dark:border-white/10 dark:bg-[#1E1E1E] dark:shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
            style={{ maxHeight: `${listMaxHeight}px` }}
          >
            {filteredBrands.length === 0 ? (
              <div className="py-2.5 text-center text-xs text-[#7A7369] dark:text-white/50">
                No brand found.
              </div>
            ) : (
              filteredBrands.map((b) => {
                const isSelected = selectedBrand?.name === b?.name || brand_name === b?.name;
                return (
                  <button
                    key={b?.id || b?._id || b?.name}
                    type="button"
                    onClick={() => handleBrandSelect(b)}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-[#02C8C4]/10 font-medium text-[#02C8C4] dark:bg-[#15DCFF]/15 dark:text-[#15DCFF]'
                        : 'text-[#24211D] hover:bg-[#F7F4EE] dark:text-white/90 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="truncate">{b?.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[#02C8C4] dark:text-[#15DCFF]" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
