import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';

const InputCommonDropdown = ({
  label = '',
  icon = null,
  options = [],
  value,
  onChange,
  disabled = false,
}) => {
  const selectedValue =
    value !== undefined && value !== ''
      ? options?.find((option) => option.value === value) || null
      : null;

  const Icon = selectedValue?.Icon;
  const dropdownLabel = label;
  const triggerLabel = selectedValue?.label?.replace(/\s*\(.*?\)\s*$/, '') || label;

  return (
    <Select
      value={value}
      onValueChange={(val) => {
        if (onChange) {
          onChange(val);
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger
        hideIcon
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className={`group placeholder:sm relative flex h-10! w-full items-center gap-0 rounded-full border border-gray-300 bg-gray-100 dark:border-none dark:bg-[#383838]/50 px-4! py-2.5 text-[9px] text-gray-900 shadow-none backdrop-blur-md transition duration-200 ease-in outline-none placeholder:text-gray-500 dark:placeholder:text-[#AFAFAF] hover:border-gray-400 hover:bg-gray-100 md:text-[11px] 2xl:h-[49px]! 2xl:py-[18px] 2xl:text-base 2xl:placeholder:text-base dark:text-[#AFAFAF] ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
        disabled={disabled}
      >
        <div className="flex items-center gap-1 pr-1 capitalize 2xl:gap-1.5">
          {Icon
            ? Icon
            : icon && <img src={icon} alt="icon" className="h-3 w-3 2xl:h-full 2xl:w-full" />}
          <span className="text-sm font-light text-gray-700 group-data-[state=open]:text-gray-900 2xl:text-base dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {triggerLabel}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="z-[9999] min-w-fit border border-black/10 bg-white text-gray-900 backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white"
      >
        <div className="flex flex-col 2xl:gap-1">
          {options?.length === 0 ? (
            <div className="bg-black-500 2xl:text-15 m-3 h-8 w-full text-center text-sm text-gray-500 dark:text-gray-300">
              No options found
            </div>
          ) : (
            options?.map(({ value: optionValue, Icon, label }) => {
              const isSelected = value === optionValue;

              const isAuto = label?.toLowerCase() === 'auto';
              const [ratioW, ratioH] = (label || '').split(':');
              const numericW = Number(ratioW);
              const numericH = Number(ratioH);
              const isWide =
                Number.isFinite(numericW) && Number.isFinite(numericH)
                  ? numericW / numericH >= 1
                  : true;
              const shouldShowPreview = dropdownLabel?.toLowerCase() === 'aspect ratio' && !isAuto;

              return (
                <SelectItem
                  key={optionValue}
                  value={optionValue}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`group cursor-pointer text-base hover:bg-[#DFDFDF] dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                    isSelected ? 'bg-gray-100 dark:bg-[#0D0D0D]/50' : 'bg-transparent'
                  } focus:bg-transparent focus:text-inherit`}
                  disabled={disabled}
                >
                  {Icon}
                  <div className="flex w-full items-center justify-between">
                    {shouldShowPreview && (
                      <div className="mr-1 flex h-3.5 w-3.5 items-center justify-center">
                        <div
                          className="rounded-[2px] border border-[#AFAFAF] bg-transparent group-hover:border-black dark:group-hover:border-white"
                          style={{
                            aspectRatio: `${numericW} / ${numericH}`,
                            width: isWide ? '100%' : 'auto',
                            height: isWide ? 'auto' : '100%',
                          }}
                        />
                      </div>
                    )}

                    <span className="text-sm group-hover:text-black dark:group-hover:text-white 2xl:text-base dark:text-inherit">
                      {label}
                    </span>

                    <span
                      className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                        isSelected
                          ? 'border-gray-500 bg-gray-500 dark:border-[#575757] dark:bg-[#575757]'
                          : 'border-gray-400 dark:border-[#AFAFAF]'
                      }`}
                    >
                      {isSelected && <div className="h-[6px] w-[6px] rounded-full bg-white" />}
                    </span>
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

export default InputCommonDropdown;
