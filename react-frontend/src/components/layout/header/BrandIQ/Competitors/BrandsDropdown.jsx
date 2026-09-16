import { Check, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const getBrandInitials = (label = '') =>
  label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || 'B';

const BrandLogo = ({ logoUrl, label, size = 'sm' }) => {
  const sizeClass =
    size === 'compact'
      ? 'h-5 w-5 rounded-full 2xl:h-6 2xl:w-6'
      : size === 'md'
        ? 'h-8 w-8 rounded-full'
        : 'h-7 w-7 rounded-lg';

  return (
    <span
      className={`relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden border border-black/8 bg-zinc-100 text-[10px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/10 dark:text-white/70`}
      aria-hidden="true"
    >
      {getBrandInitials(label)}
      {logoUrl && (
        <img
          src={logoUrl}
          alt=""
          className="absolute inset-0 h-full w-full bg-white object-contain p-0.5 dark:bg-zinc-900"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
};

const BrandsDropdown = ({
  options = [],
  label = '',
  value = null,
  onChange,
  onManageBrands,
  compact = false,
}) => {
  const selectedLabel = value?.label || label;
  const selectedOption = options.find((option) => option.value === value?.value) || value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch brand. Current brand: ${selectedLabel}`}
          className={`group flex items-center rounded-full border border-black/10 bg-white/90 font-semibold text-[#24211D] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02C8C4]/30 dark:border-white/15 dark:bg-[#18181b]/90 dark:text-white dark:hover:bg-[#222225] ${
            compact
              ? 'h-8 min-w-[116px] max-w-[152px] gap-1.5 px-2 text-[11px] shadow-xs 2xl:h-9 2xl:min-w-[128px] 2xl:max-w-[172px] 2xl:px-2.5 2xl:text-xs dark:shadow-[0_2px_10px_rgba(0,0,0,0.18)]'
              : 'h-10 min-w-[142px] max-w-[190px] gap-2 px-2.5 text-sm shadow-[0_3px_14px_rgba(36,33,29,0.08)] sm:min-w-[154px] 2xl:h-11 2xl:min-w-[170px] 2xl:max-w-[220px] 2xl:px-3 dark:shadow-[0_3px_16px_rgba(0,0,0,0.25)]'
          }`}
        >
          <BrandLogo
            logoUrl={selectedOption?.logoUrl}
            label={selectedLabel}
            size={compact ? 'compact' : 'md'}
          />
          <span className="min-w-0 flex-1 truncate text-left capitalize">{selectedLabel}</span>
          <ChevronDown
            className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-[#7A7369] transition-transform duration-200 group-data-[state=open]:rotate-180 dark:text-white/60`}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className={`${compact ? 'w-[232px]' : 'w-[246px]'} overflow-hidden rounded-2xl border border-[#E5E0D8] bg-white/95 p-1.5 text-[#24211D] shadow-[0_16px_44px_rgba(36,33,29,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#18181b]/95 dark:text-white dark:shadow-[0_18px_44px_rgba(0,0,0,0.4)]`}
      >
        <DropdownMenuLabel
          className={`${compact ? 'px-2.5 pt-1.5 pb-1' : 'px-3 pt-2 pb-1.5'} text-xs font-medium text-[#948C80] dark:text-white/45`}
        >
          Switch Brand
        </DropdownMenuLabel>

        <div
          className={`scrollbar-thin flex ${compact ? 'max-h-56' : 'max-h-64'} flex-col gap-0.5 overflow-y-auto pr-0.5`}
        >
          {options.length > 0 ? (
            options.map(({ value: optionValue, label: optionLabel, logoUrl }) => {
              const isSelected = value?.value === optionValue;

              return (
                <DropdownMenuItem
                  key={optionValue}
                  onSelect={() => onChange?.(optionValue)}
                  className={`${compact ? 'min-h-10 gap-2 px-2 py-1.5 text-[13px]' : 'min-h-11 gap-2.5 px-2.5 py-2 text-sm'} cursor-pointer rounded-xl font-medium transition-colors focus:text-[#24211D] dark:focus:text-white ${
                    isSelected
                      ? 'bg-[#EEF0FF] focus:bg-[#E4E7FF] dark:bg-white/10 dark:focus:bg-white/15'
                      : 'focus:bg-[#F4F1EC] dark:focus:bg-white/8'
                  }`}
                >
                  <BrandLogo
                    logoUrl={logoUrl}
                    label={optionLabel}
                    size={compact ? 'compact' : 'sm'}
                  />
                  <span className="min-w-0 flex-1 truncate capitalize">{optionLabel}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-[#5867EB] dark:text-[#15DCFF]" />
                  )}
                </DropdownMenuItem>
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-xs text-[#948C80] dark:text-white/45">
              No brands available
            </div>
          )}
        </div>

        {onManageBrands && (
          <>
            <DropdownMenuSeparator className="my-1.5 bg-black/8 dark:bg-white/10" />
            <DropdownMenuItem
              onSelect={onManageBrands}
              className={`${compact ? 'min-h-10 gap-2 px-2 py-1.5 text-[13px]' : 'min-h-11 gap-2.5 px-2.5 py-2 text-sm'} cursor-pointer rounded-xl font-medium focus:bg-[#F4F1EC] focus:text-[#24211D] dark:focus:bg-white/8 dark:focus:text-white`}
            >
              <Settings className="h-4 w-4 text-[#615B52] dark:text-white/65" />
              <span className="flex-1">Manage Brands</span>
              <ChevronRight className="h-4 w-4 text-[#7A7369] dark:text-white/50" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default BrandsDropdown;
