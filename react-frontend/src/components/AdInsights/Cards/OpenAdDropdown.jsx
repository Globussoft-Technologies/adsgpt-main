import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EllipsisVertical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const OpenAdDropdown = ({ open, setOpen, adUrl }) => {
  const navigate = useNavigate();

  const handleOpenAd = () => {
    setOpen(false); // Close the dropdown
    window.open(adUrl, '_blank'); // Navigate to the ad URL
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`rounded-full p-2 hover:bg-[#2a2a2a]/50`}
          onClick={(e) => e.stopPropagation()}
        >
          <EllipsisVertical className="h-3 w-3 2xl:h-4 2xl:w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-fit border-white/20 p-2 backdrop-blur-[100px] dark:bg-[#2a2a2a]/80">
        <button
          className="flex w-full items-center rounded-sm p-1 text-xs hover:bg-white/10 2xl:text-sm"
          onClick={adUrl?.includes('https') && handleOpenAd}
        >
          Open Ad
        </button>
      </PopoverContent>
    </Popover>
  );
};

export default OpenAdDropdown;
