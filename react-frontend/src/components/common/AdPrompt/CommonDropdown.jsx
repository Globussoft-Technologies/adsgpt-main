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
  side,
  triggerVariant = 'default',
  disabled = false,
}) => {
  const Icon = value?.Icon;
  const dropdownLabel = label;
  const triggerLabel = value?.label?.replace(/\s*\(.*?\)\s*$/, '') || label;
  const isVoiceChip = triggerVariant === 'voice-chip';
  const isField = triggerVariant === 'field';
  // const selectedOption = options?.find((opt) => opt.value === value?.value);
  // const SelectedIcon = selectedOption?.Icon;
  return (
    <Select value={value?.value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        hideIcon
        disabled={disabled}
        className={
          isVoiceChip
            ? `group relative flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[12px] font-medium text-gray-900 opacity-100 shadow-[0_0_8px_rgba(52,211,153,0.2)] transition hover:bg-emerald-400/10 focus-visible:border-emerald-400/50 focus-visible:ring-0 sm:text-[13px] dark:bg-emerald-400/10 dark:text-white dark:hover:bg-emerald-400/10 ${className}`
            : isField
              ? `group relative flex !h-11 w-full items-center rounded-lg border border-black/10 bg-black/[0.03] px-3 text-sm text-gray-700 opacity-100 shadow-none transition hover:bg-black/[0.045] focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/20 dark:border-white/10 dark:bg-white/[0.035] dark:text-white/75 dark:hover:bg-white/[0.05] [&>svg]:block ${className}`
            : `prompt_selection_button_no_gradient group 2xl:text-13 relative flex md:text-[11px] 2xl:py-[18px] ${label === 'AI Model' || type === 'b-roll' || type === 'ugc' ? '[&>svg]:block' : '[&>svg]:hidden'} items-center gap-0 rounded-[50px] text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 dark:border-none [&_img]:opacity-80 [&_img]:brightness-0 dark:[&_img]:opacity-100 dark:[&_img]:brightness-100 [&_svg]:text-current! opacity-80 hover:opacity-100 ${type === 'b-roll' ? 'dark:bg-[#909294]/10 dark:text-[#f0f0f0]' : 'dark:bg-[#202020]/50 dark:text-[#AFAFAF]'} ${className}`
        }
      >
        <div className="flex items-center gap-1 pr-1 capitalize 2xl:gap-1.5">
          {Icon ? Icon : (typeof icon === 'string' ? <img src={icon} alt="icon" className="h-3 w-3 brightness-0 opacity-50 2xl:h-4 2xl:w-4 dark:brightness-100 group-hover:opacity-100" /> : icon)}
          <span
            className={
              isVoiceChip
                ? 'font-medium text-gray-900 dark:text-white'
                : isField
                  ? 'font-normal text-gray-700 dark:text-white/75'
                : 'font-light text-zinc-800 dark:text-[#afafaf] dark:group-data-[state=open]:text-white'
            }
          >
            {triggerLabel}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent
        side={side}
        className="z-[999999] min-w-fit border border-black/10 bg-white text-zinc-800 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white"
      >
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
                className={`group cursor-pointer text-[10px] text-zinc-800 hover:bg-zinc-100 hover:text-zinc-900 focus:bg-zinc-100 focus:text-zinc-900 data-highlighted:bg-zinc-100 data-highlighted:text-zinc-900 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white dark:focus:bg-[#0D0D0D]/30 dark:focus:text-white dark:data-highlighted:bg-[#0D0D0D]/30 dark:data-highlighted:text-white [&_svg]:text-current! ${
                  value?.value === optionValue
                    ? 'bg-zinc-100 dark:bg-[#0D0D0D]/50'
                    : 'bg-transparent'
                }`}
              >
                {Icon}
                <div className="flex w-full items-center justify-between">
                  {shouldShowPreview && (
                    <div className="mr-1 flex h-3.5 w-3.5 items-center justify-center">
                      <div
                        className={`rounded-[2px] border border-current bg-transparent`}
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
                      <span className="text-[9px] text-inherit 2xl:text-xs">{label}</span>
                    </ShadcnTooltip>
                  ) : (
                    <span className="text-[9px] text-inherit 2xl:text-xs">{label}</span>
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
            );
          })}
        </div>
      </SelectContent>
    </Select>
  );
};

export default CommonDropdown;
