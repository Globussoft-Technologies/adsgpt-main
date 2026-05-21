import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Paintbrush } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDispatch, useSelector } from 'react-redux';
import { setField } from '@/store/reducers/adStudio/promptSlice';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const ColorVariantsDropdown = () => {
  const dispatch = useDispatch();
  const { color_palette } = useSelector((state) => state.prompt);

  const colorVariants = [
    {
      name: 'Auto',
      colors: [],
      value: '',
    },
    {
      name: 'Ember',
      colors: ['#F97DA1', '#A7B9D9', '#E07E43', '#D9503F', '#F52E8A'],
      value: 'EMBER',
    },
    {
      name: 'Fresh',
      colors: ['#F77C25', '#EB465A', '#12A6B7', '#F2D22A', '#F77C25'],
      value: 'FRESH',
    },
    {
      name: 'Magic',
      colors: ['#2C53E5', '#E36D3E', '#5B65E5', '#69D48D', '#2C53E5'],
      value: 'MAGIC',
    },
    {
      name: 'Melon',
      colors: ['#302E96', '#E5A9C1', '#9FA3C4', '#EF4D7E', '#302E96'],
      value: 'MELON',
    },
    {
      name: 'Pastel',
      colors: ['#60D9D1', '#E7E77B', '#F8C57A', '#F6E4E2', '#60D9D1'],
      value: 'PASTEL',
    },
  ];

  const handleColorSelect = (data) => {
    dispatch(setField({ key: 'color_palette', value: data || '' }));
  };

  // Find the selected color name from color_palette value
  const selectedColor = colorVariants.find((c) => c.value === color_palette);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="focus:outline-none">
        <ShadcnTooltip label="Color Pallete">
          <button className="group relative flex h-6 w-auto items-center justify-center rounded-full px-2 text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 focus:outline-none 2xl:h-8 2xl:w-auto dark:border-none dark:bg-[#202020]/50 dark:text-[#AFAFAF]">
            <Paintbrush className="h-3 w-3 text-[#AFAFAF] 2xl:h-4 2xl:w-4" />
            {selectedColor && selectedColor.value !== '' && (
              <span className="ml-1 pr-0.5 font-light 2xl:text-xs dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
                {selectedColor && selectedColor.value ? selectedColor.name : ''}
              </span>
            )}
          </button>
        </ShadcnTooltip>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-fit border backdrop-blur-[100px] dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-white">
        <DropdownMenuLabel className="px-2 py-1 text-[10px] font-normal tracking-wide text-[#636363] 2xl:py-2 2xl:text-xs dark:text-[#D9D9D9]">
          Color Palette
        </DropdownMenuLabel>

        {colorVariants.map(({ name, colors, value }) => (
          <DropdownMenuItem
            key={name}
            onClick={() => handleColorSelect(value)}
            className={`flex w-full cursor-pointer items-center justify-between gap-3 text-[10px] hover:bg-[#DFDFDF] 2xl:mt-1 2xl:text-xs dark:font-normal dark:text-[#AFAFAF] dark:hover:bg-[#0D0D0D]/30 dark:hover:text-white ${
              color_palette === value ? 'dark:bg-[#0D0D0D]/50' : 'bg-transparent'
            }`}
          >
            <span className="text-[9px] 2xl:text-xs">{name}</span>
            <div className="flex gap-0.5">
              {colors.map((c, i) => (
                <span key={i} className="h-4 w-4 rounded-[2px]" style={{ backgroundColor: c }} />
              ))}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ColorVariantsDropdown;
