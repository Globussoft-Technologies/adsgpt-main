import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';

const BrandsDropdown = ({ options = [], label = '', value = '', onChange }) => {
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className="group 2xl:text-13 backdrop-blur-100 relative flex min-w-fit items-center gap-0 rounded-[50px] border border-white/20 py-3.5 text-[#AFAFAF] shadow-none 2xl:py-[18px] dark:bg-[#0D0D0D]/50 dark:hover:bg-transparent dark:data-[state=open]:text-white"
      >
        <div className="text-10 flex items-center gap-1.5 pr-1 capitalize group-hover:text-white 2xl:gap-2 2xl:text-sm [&>svg]:group-hover:text-white">
          <span className="dark:group-data-[state=open]:text-white">{value?.label || label}</span>
        </div>
      </SelectTrigger>

      <SelectContent className="min-w-40 border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <div className="flex flex-col 2xl:gap-1">
          {options.map(({ value: optionValue, label }) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className={`group cursor-pointer text-[10px] hover:bg-[#DFDFDF] 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                value?.value === optionValue
                  ? 'bg-gradient-to-r from-[#02C8C4] to-[#5867EB] text-white dark:text-white'
                  : 'bg-transparent'
              } focus:bg-transparent focus:text-inherit`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                  {label}
                </span>
                {/* <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    value?.value === optionValue
                      ? 'border-[#575757] dark:bg-[#575757]'
                      : 'border-[#AFAFAF]'
                  }`}
                >
                  {value?.value === optionValue && (
                    <div className="h-[6px] w-[6px] rounded-full dark:bg-white" />
                  )}
                </span> */}
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
};

export default BrandsDropdown;
