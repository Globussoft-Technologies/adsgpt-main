import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const CommonDropdown = ({
  options = [],
  label = '',
  icon = null,
  value = '',
  type = '',
  onChange,
  className = '',
}) => {
  const Icon = value?.Icon;
  const dropdownLabel = label;
  const triggerLabel = value?.label?.replace(/\s*\(.*?\)\s*$/, '') || label;
  // const selectedOption = options?.find((opt) => opt.value === value?.value);
  // const SelectedIcon = selectedOption?.Icon;
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className={`prompt_selection_button_no_gradient group 2xl:text-13 relative flex md:text-[11px] 2xl:py-[18px] ${label === 'AI Model' || type === 'b-roll' || type === 'ugc' ? '[&>svg]:block' : '[&>svg]:hidden'} items-center gap-0 rounded-[50px] text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 dark:border-none ${type === 'b-roll' ? 'dark:bg-[#909294]/10 dark:text-[#f0f0f0]' : 'dark:bg-[#202020]/50 dark:text-[#AFAFAF]'} ${className}`}
      >
        <div className="flex items-center gap-1 pr-1 capitalize 2xl:gap-1.5">
          {Icon ? Icon : (typeof icon === 'string' ? <img src={icon} alt="icon" className="h-3 w-3 2xl:h-4 2xl:w-4" /> : icon)}
          <span className="font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {triggerLabel}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent className="z-[999999] min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        {label && (
          <div className="text-10 px-2 py-1 font-normal tracking-wide text-[#636363] 2xl:py-2 2xl:text-xs dark:text-[#D9D9D9]">
            {label}
          </div>
        )}
        <div className="flex flex-col 2xl:gap-1">
          {options.map(({ value: optionValue, Icon, label, credit, tier }) => {
            const isAuto = label?.toLowerCase() === 'auto';
            const [ratioW, ratioH] = (label || '').split(':');
            const numericW = Number(ratioW);
            const numericH = Number(ratioH);
            const isWide =
              Number.isFinite(numericW) && Number.isFinite(numericH)
                ? numericW / numericH >= 1
                : true;
            const shouldShowPreview =
              (dropdownLabel || '').toLowerCase() === 'aspect ratio' && !isAuto;
            return (
              <SelectItem
                key={optionValue}
                value={optionValue}
                className={`group cursor-pointer text-[10px] hover:bg-[#DFDFDF] 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                  value?.value === optionValue ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
                } focus:bg-transparent focus:text-inherit`}
              >
                {Icon}
                <div className="flex w-full items-center justify-between">
                  {shouldShowPreview && (
                    <div className="mr-1 flex h-3.5 w-3.5 items-center justify-center">
                      <div
                        className={`rounded-[2px] border border-[#AFAFAF] bg-transparent group-hover:border-white`}
                        style={{
                          aspectRatio: `${numericW} / ${numericH}`,
                          width: isWide ? '100%' : 'auto',
                          height: isWide ? 'auto' : '100%',
                        }}
                      />
                    </div>
                  )}

                  {credit ? (
                    <ShadcnTooltip label={`${credit} `} side="right" className="z-[1000000]">
                      <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                        {label}
                      </span>
                    </ShadcnTooltip>
                  ) : (
                    <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                      {label}
                    </span>
                  )}

                  {tier === 'premium' && (
                    <span className="mr-5 ml-1.5 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 px-1.5 py-0.5 text-[8px] font-semibold 2xl:text-[10px]">
                      <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                        ★ Premium
                      </span>
                    </span>
                  )}

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
            );
          })}
        </div>
      </SelectContent>
    </Select>
  );
};

export default CommonDropdown;
