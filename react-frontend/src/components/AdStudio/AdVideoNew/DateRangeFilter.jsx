import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { DateRange } from 'react-date-range';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Import react-date-range styles
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

const DateRangeFilter = ({ onDateChange, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState([
    {
      startDate: new Date(),
      endDate: new Date(),
      key: 'selection',
    },
  ]);

  const [hasSelection, setHasSelection] = useState(false);

  const handleSelect = (item) => {
    setState([item.selection]);

    if (item.selection.startDate && item.selection.endDate) {
      setHasSelection(true);
      const start = format(item.selection.startDate, 'dd-MM-yyyy');
      const end = format(item.selection.endDate, 'dd-MM-yyyy');
      onDateChange(start, end);
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    setState([
      {
        startDate: new Date(),
        endDate: new Date(),
        key: 'selection',
      },
    ]);
    setHasSelection(false);
    onClear?.();
  };

  const displayText = hasSelection
    ? `${format(state[0].startDate, 'MMM d')} - ${format(state[0].endDate, 'MMM d')}`
    : 'Select Date Range';

  return (
    <div className="flex items-center gap-2">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2 rounded-full border border-white/20 bg-[#0D0D0D]/50 px-4 py-2 text-xs text-[#AFAFAF] backdrop-blur-md transition-all hover:border-white/40 hover:text-white 2xl:text-sm',
              hasSelection && 'border-[#15DCFF]/50 text-white'
            )}
          >
            <CalendarIcon className={cn('h-4 w-4', hasSelection && 'text-[#15DCFF]')} />
            <span className="font-medium">{displayText}</span>
            {hasSelection && (
              // <X
              //   className="h-3 w-3 ml-1 hover:text-red-400"
              //   onClick={handleClear}
              // />
              <button className="text-[#15DCFF]" onClick={handleClear}>
                clear
              </button>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto overflow-hidden rounded-2xl border-white/10 bg-[#1a1a1a] p-0 shadow-2xl backdrop-blur-xl"
          align="end"
        >
          <div className="date-range-picker-dark p-1">
            <DateRange
              editableDateInputs={true}
              onChange={handleSelect}
              moveRangeOnFirstSelection={false}
              ranges={state}
              months={1}
              direction="horizontal"
              rangeColors={['#15DCFF']}
              color="#15DCFF"
              className="bg-transparent text-white"
              maxDate={new Date()}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DateRangeFilter;
