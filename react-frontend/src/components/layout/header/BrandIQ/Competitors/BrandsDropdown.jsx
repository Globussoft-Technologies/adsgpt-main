import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { Check } from 'lucide-react';

const BrandsDropdown = ({ options = [], label = '', value = '', onChange }) => {
  return (
    <Select value={value?.value} onValueChange={onChange}>
      <SelectTrigger
        hideIcon
        className="group relative flex min-w-fit items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 bg-white/90 dark:bg-[#18181b]/90 px-4 py-2 text-xs font-medium text-gray-800 dark:text-white shadow-xs hover:bg-gray-50 dark:hover:bg-white/10 transition-all"
      >
        <div className="flex items-center gap-1.5 capitalize text-xs font-medium text-gray-800 dark:text-white">
          <span>{value?.label || label}</span>
        </div>
      </SelectTrigger>

      <SelectContent className="min-w-48 overflow-hidden rounded-[18px] border border-black/10 dark:border-white/10 bg-white dark:bg-[#18181b] p-1.5 text-gray-900 dark:text-white shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col gap-1">
          {options.map(({ value: optionValue, label }) => {
            const isSelected = value?.value === optionValue;
            return (
              <SelectItem
                key={optionValue}
                value={optionValue}
                className={`cursor-pointer rounded-[10px] px-3 py-2 text-xs font-medium transition-all outline-none ${
                  isSelected
                    ? 'bg-gradient-to-r! from-[#02C8C4]! to-[#5867EB]! text-white! font-semibold shadow-xs focus:bg-gradient-to-r! focus:from-[#02C8C4]! focus:to-[#5867EB]! focus:text-white!'
                    : 'text-gray-700! hover:bg-gray-100! hover:text-gray-900! dark:text-white/80! dark:hover:bg-white/10! dark:hover:text-white! focus:bg-gray-100! dark:focus:bg-white/10! focus:text-gray-900! dark:focus:text-white!'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="text-xs font-medium">{label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                </div>
              </SelectItem>
            );
          })}
        </div>
      </SelectContent>
    </Select>
  );
};

export default BrandsDropdown;
