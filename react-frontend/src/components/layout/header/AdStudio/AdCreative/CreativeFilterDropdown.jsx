import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { ListFilter } from 'lucide-react';

const CreativeFilterDropdown = ({ options = [], label = '', value = '', onChange, onClear }) => {
  // Find the selected option from options array
  const selectedOption = options.find((opt) => opt.value === value?.value);
  const selectedLabel = selectedOption?.label || label || 'Filter';
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        className={`items-center gap-0 rounded-[50px] border-none bg-transparent bg-none !p-0 text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-transparent dark:border-none dark:text-[#AFAFAF] [&>svg]:hidden`}
      >
        <div className="backdrop-blur-100 relative flex items-center gap-2 rounded-full border border-white/20 bg-[#0D0D0D]/50 p-2 text-xs text-[#AFAFAF] transition-colors hover:text-white has-[>svg]:px-4 md:px-3 md:py-1.5 2xl:px-5 2xl:text-sm">
          <span className="flex items-center gap-1.5 capitalize 2xl:gap-2">
            {/* Show selected icon (as React element), else ListFilter */}
            {selectedOption?.Icon ? (
              selectedOption.Icon
            ) : (
              <ListFilter className="dark:text-[#afafaf]" />
            )}
            <span className="hidden !text-[9px] font-light md:block 2xl:!text-sm dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
              {selectedLabel}
            </span>
          </span>
        </div>
      </SelectTrigger>
      <SelectContent className="mt-2 min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        {label && (
          <div className="text-10 flex items-center justify-between px-2 py-1 font-normal tracking-wide text-[#636363] 2xl:py-2 2xl:text-xs dark:text-[#D9D9D9]">
            {label}
            {onClear && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="cursor-pointer text-[#15DCFF] hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col 2xl:gap-1">
          {options.map(({ value: optionValue, Icon, label }) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className={`group cursor-pointer text-[10px] hover:bg-[#DFDFDF] 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/50 dark:hover:text-white ${
                value?.value === optionValue ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
              } focus:bg-transparent focus:text-inherit`}
            >
              {Icon}
              <div className="flex w-full items-center justify-between">
                <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                  {label}
                </span>
                <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    value?.value === optionValue
                      ? 'border-[#575757] dark:bg-[#575757]'
                      : 'border-[#AFAFAF]'
                  }`}
                >
                  {value?.value === optionValue && (
                    <div className="h-[6px] w-[6px] rounded-full dark:bg-white" />
                  )}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
};

export default CreativeFilterDropdown;
