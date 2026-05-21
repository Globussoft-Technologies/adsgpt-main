import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';

const AllPlateformDropdown = ({ options = [], label = '', value = '', onChange }) => {
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className="group 2xl:text-13 backdrop-blur-100 relative flex min-w-fit items-center gap-0 rounded-[50px] border border-white/20 py-3.5 text-[10px] text-[#AFAFAF] shadow-none 2xl:py-[18px] dark:bg-[#0D0D0D]/50 dark:hover:bg-transparent dark:data-[state=open]:text-white"
      >
        <div className="flex items-center gap-1.5 pr-1 capitalize group-hover:text-white 2xl:gap-2 2xl:text-sm">
          {(() => {
            const active = options.find((opt) => opt.value === value?.value);
            if (!active) return <span>{label}</span>;
            const IconComp = active.icon;
            return (
              <>
                {/* {IconComp && <IconComp className="h-3 w-3 2xl:h-4 2xl:w-4" />} */}
                <span className="dark:group-data-[state=open]:text-white">{active.label}</span>
              </>
            );
          })()}
        </div>
      </SelectTrigger>

      <SelectContent className="min-w-40 border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <div className="flex flex-col 2xl:gap-1">
          {options.map(({ value: optionValue, label, icon }) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className={`group cursor-pointer text-[10px] hover:bg-[#DFDFDF] 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                value?.value === optionValue ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
              } focus:bg-transparent focus:text-inherit`}
            >
              <div className="flex items-center gap-2">
                {(() => {
                  const IconComp = icon;
                  return IconComp ? <IconComp className="h-3 w-3 2xl:h-4 2xl:w-4" /> : null;
                })()}
                <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                  {label}
                </span>
              </div>
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
};

export default AllPlateformDropdown;
