import React from 'react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

// Copied from AdFactory/PostAd/FbAccountReady.jsx so the MySpace Post Ad
// flow can render the rich Ad-Account / Page picker without coupling to
// the AdFactory file. Keep visual parity with the original — if the
// AdFactory dropdown changes, mirror the change here.
const FbCustomDropdown = ({
  label = '',
  options = [],
  value,
  onChange,
  disabled = false,
  type = 'account', // 'account' | 'page'
}) => {
  const selectedValue = options?.find((option) => option.id === value) || null;

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        if (onChange) onChange(val);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className={`group relative flex h-10! w-full items-center gap-0 rounded-full border border-black/10 bg-gray-100 px-4! py-2.5 text-base text-gray-900 shadow-none backdrop-blur-md transition duration-200 ease-in outline-none placeholder:text-base placeholder:text-gray-500 hover:bg-gray-200 md:text-[11px] 2xl:h-[49px]! 2xl:py-[18px] dark:border-none dark:bg-[#383838]/50 dark:text-[#AFAFAF] dark:hover:bg-slate-100/10 ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        disabled={disabled}
      >
        <div className="flex items-center gap-2 pr-1 capitalize 2xl:gap-1.5">
          {type === 'page' && selectedValue?.image && (
            <img
              src={selectedValue.image}
              alt="selected page"
              className="h-6 w-6 rounded-full object-cover"
            />
          )}
          <span className="text-sm font-light text-gray-700 group-data-[state=open]:text-gray-900 2xl:text-base dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selectedValue?.name || label}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent className="backdrop-blur-100 z-9999 min-w-[300px] border border-black/10 bg-white text-gray-900 dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <div className="fb_account_ready flex flex-col 2xl:gap-1">
          {options?.length === 0 ? (
            <div className="bg-black-500 2xl:text-15 m-3 h-8 w-full text-center text-sm text-gray-300">
              No options found
            </div>
          ) : (
            options?.map((option) => {
              const isSelected = value === option.id;

              return (
                <SelectItem
                  key={option.id}
                  value={option.id}
                  className={`group cursor-pointer pr-4! text-base text-gray-900 hover:bg-gray-100 dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                    isSelected ? 'bg-gray-100 dark:bg-[#0D0D0D]/50' : 'bg-transparent'
                  } focus:bg-transparent focus:text-inherit`}
                  disabled={disabled}
                >
                  <div className="flex w-full items-center py-1">
                    <div className="flex items-center gap-3">
                      {type === 'page' && (
                        <div className="h-10 w-10 shrink-0">
                          <img
                            src={option.image}
                            alt={option.name}
                            className="h-full w-full rounded-full object-cover ring-2 ring-white/10"
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-0">
                        <span
                          className={`text-base font-semibold group-hover:text-gray-900 dark:group-hover:text-white ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-inherit'}`}
                        >
                          {option.name}
                        </span>
                        {type === 'account' && (
                          <div className="mt-1 flex flex-col gap-0.5 text-xs">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${option.isActive ? 'bg-blue-500' : 'bg-gray-500'}`}
                              />
                              <span className={option.isActive ? 'text-blue-400' : 'text-gray-400'}>
                                {option.isActive ? 'Active' : 'Inactive'}
                              </span>
                              <span className="rounded bg-black/5 px-1.5 py-0.5 text-gray-600 dark:bg-white/10 dark:text-gray-300">
                                {option.currency}
                              </span>
                              <div className="text-red-400">Spent: {option.spent}</div>
                            </div>
                          </div>
                        )}
                        {type === 'page' && (
                          <span className="text-sm text-gray-400 group-hover:text-gray-300">
                            {option.category}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="absolute right-2 ml-auto flex items-center pr-1">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                          isSelected ? 'border-[#575757] dark:bg-[#575757]' : 'border-[#AFAFAF]'
                        }`}
                      >
                        {isSelected && <div className="h-[6px] w-[6px] rounded-full bg-gray-800 dark:bg-white" />}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })
          )}
        </div>
      </SelectContent>
    </Select>
  );
};

export default FbCustomDropdown;
