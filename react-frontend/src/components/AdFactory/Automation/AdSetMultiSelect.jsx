import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

// ----------------------------------------------------------------------------
// AdSetMultiSelect — multi-select dropdown for Meta ad sets.
//
// Backend treats the array as an ordered rotation list — when one ad set hits
// the 50-ad limit, it rotates to the next. We preserve insertion order: the
// first picked ad set goes first in the array, etc. Unselecting removes the
// chip; reselecting puts it back at the end. No drag-to-reorder.
//
// Visual matches the surrounding panels (rounded-full pill, dark background,
// faint border on hover) so it doesn't look out of place next to the existing
// single-select InputCommonDropdown fields.
// ----------------------------------------------------------------------------

export default function AdSetMultiSelect({
  label = 'Select ad sets',
  options = [],
  value = [],
  onChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);

  const selectedValues = Array.isArray(value) ? value : [];

  const selectedOptions = useMemo(
    () =>
      selectedValues
        .map((v) => options.find((o) => o.value === v))
        .filter(Boolean),
    [selectedValues, options]
  );

  const toggle = (val) => {
    if (disabled) return;
    if (selectedValues.includes(val)) {
      onChange?.(selectedValues.filter((v) => v !== val));
    } else {
      onChange?.([...selectedValues, val]);
    }
  };

  const remove = (val, e) => {
    e?.stopPropagation?.();
    if (disabled) return;
    onChange?.(selectedValues.filter((v) => v !== val));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`group flex min-h-10 w-full items-center gap-2 rounded-full bg-[#383838]/50 px-4 py-1.5 text-left text-sm text-white outline-none transition 2xl:min-h-[49px] ${
            disabled
              ? 'cursor-not-allowed opacity-50'
              : 'hover:bg-[#383838]/70'
          }`}
        >
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {selectedOptions.length === 0 ? (
              <span className="text-sm font-light text-[#AFAFAF] 2xl:text-base">
                {label}
              </span>
            ) : (
              selectedOptions.map((opt) => (
                <span
                  key={opt.value}
                  className="inline-flex items-center gap-1 rounded-full border border-[#15DCFF]/30 bg-[#15DCFF]/10 px-2 py-0.5 text-xs text-white"
                >
                  <span className="max-w-[140px] truncate">{opt.label}</span>
                  <X
                    role="button"
                    aria-label={`Remove ${opt.label}`}
                    className="size-3 cursor-pointer text-[#AFAFAF] hover:text-white"
                    onClick={(e) => remove(opt.value, e)}
                  />
                </span>
              ))
            )}
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-[#AFAFAF] transition ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="z-[9999] w-[var(--radix-popover-trigger-width)] border border-white/20 bg-[#0D0D0D]/95 p-1.5 backdrop-blur-[100px]"
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-center text-sm text-[#AFAFAF]">
            No ad sets available
          </div>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            {options.map((opt) => {
              const isSelected = selectedValues.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                    isSelected
                      ? 'bg-[#0D0D0D]/50 text-white'
                      : 'text-[#AFAFAF] hover:bg-[#0D0D0D]/30 hover:text-white'
                  }`}
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-[#15DCFF] bg-[#15DCFF]/20'
                        : 'border-[#AFAFAF]'
                    }`}
                  >
                    {isSelected && <Check className="size-3 text-[#15DCFF]" />}
                  </span>
                  <span className="flex-1 truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
