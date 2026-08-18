import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { ListFilter } from 'lucide-react';

const CreativeFilterDropdown = ({
  options = [],
  label = '',
  value = '',
  onChange,
  onClear,
  contentClassName = '',
  triggerClassName = '',
}) => {
  // Find the selected option from options array
  const selectedOption = options.find((opt) => opt.value === value?.value);
  const selectedLabel = selectedOption?.label || label || 'Filter';
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        className={`adstudio-creative-filter-trigger !h-auto items-center gap-2 rounded-full border border-[var(--ws-border)] bg-[var(--ws-surface-control)] px-4 py-1.5 text-xs font-medium text-[#24211D] shadow-xs transition-colors 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:border-white/40 dark:hover:text-white [&>svg]:hidden ${triggerClassName}`}
      >
        <span className="flex items-center gap-1.5 capitalize 2xl:gap-2">
          {/* Show selected icon (as React element), else ListFilter */}
          {selectedOption?.Icon ? (
            selectedOption.Icon
          ) : (
            <ListFilter className="text-zinc-700 dark:text-[#afafaf]" />
          )}
          <span className="hidden text-xs font-medium text-[#24211D] md:block 2xl:text-sm dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selectedLabel}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent className={`mt-2 min-w-fit border border-[var(--ws-border)] bg-[var(--ws-surface-control)] text-zinc-800 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white ${contentClassName}`}>
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
              className={`group cursor-pointer text-[10px] text-zinc-800 2xl:text-xs hover:bg-[var(--ws-surface-header)] hover:text-zinc-900 focus:bg-[var(--ws-surface-header)] focus:text-zinc-900 data-highlighted:bg-[var(--ws-surface-header)] data-highlighted:text-zinc-900 [&_svg]:text-current! dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/50 dark:hover:text-white dark:focus:bg-[#0D0D0D]/50 dark:focus:text-white dark:data-highlighted:bg-[#0D0D0D]/50 dark:data-highlighted:text-white ${
                value?.value === optionValue
                  ? 'bg-[var(--ws-surface-header)] dark:bg-[#0D0D0D]/50'
                  : 'bg-transparent'
              }`}
              >
              {Icon}
              <div className="flex w-full items-center justify-between">
                <span className="text-[9px] text-inherit 2xl:text-xs">
                  {label}
                </span>
                <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    value?.value === optionValue
                      ? 'border-zinc-700 bg-zinc-700 dark:border-[#575757] dark:bg-[#575757]'
                      : 'border-zinc-400 dark:border-[#AFAFAF]'
                  }`}
                >
                  {value?.value === optionValue && (
                    <div className="h-[6px] w-[6px] rounded-full bg-white" />
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
