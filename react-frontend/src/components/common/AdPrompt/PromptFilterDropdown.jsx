import { useState } from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';

const PromptFilterDropdown = ({ options = [], label = '', icon = null, defaultValue = '' }) => {
  // Local state
  const [selected, setSelected] = useState(defaultValue || options[0]);

  return (
    <Select value={selected} onValueChange={setSelected}>
      <SelectTrigger
        hideIcon
        className={`prompt_selection_button group 2xl:text-13 relative flex ${label === 'AI Model' ? '[&>svg]:block' : '[&>svg]:hidden'} items-center gap-0 rounded-[50px] bg-[#202020]/50 text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 dark:border-none dark:text-[#AFAFAF]`}
      >
        <div className="flex items-center gap-1.5 pr-1 capitalize 2xl:gap-2">
          {icon && <img src={icon} alt="icon" className="h-3 w-3 2xl:h-full 2xl:w-full" />}
          <span className="font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {selected}
          </span>
        </div>
      </SelectTrigger>

      <SelectContent className="min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        {label && (
          <div className="text-10 px-2 py-1 font-normal tracking-wide text-[#636363] 2xl:py-2 2xl:text-xs dark:text-[#D9D9D9]">
            {label}
          </div>
        )}
        <div className="flex flex-col 2xl:gap-1">
          {options.map(({ value, Icon, label }) => (
            <SelectItem
              key={value}
              value={label}
              className={`group cursor-pointer text-[10px] hover:bg-[#DFDFDF] 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
                selected === label ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
              } focus:bg-transparent focus:text-inherit`}
            >
              {Icon}
              <div className="flex w-full items-center justify-between">
                <span className="text-[9px] group-hover:text-white 2xl:text-xs dark:text-inherit">
                  {label}
                </span>
                <span
                  className={`absolute right-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    selected === label ? 'border-[#575757] dark:bg-[#575757]' : 'border-[#AFAFAF]'
                  }`}
                >
                  {selected === label && (
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

export default PromptFilterDropdown;
