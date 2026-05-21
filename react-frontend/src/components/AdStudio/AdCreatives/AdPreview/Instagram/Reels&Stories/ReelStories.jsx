import { MoreHorizontal, Pause } from 'lucide-react';
import { BsPatchCheckFill } from 'react-icons/bs';

const ReelStories = ({ adCreativesData }) => {
  return (
    <div className="w-full overflow-hidden rounded-lg bg-white">
      {/* Main story image */}
      <div className="flex flex-col items-center justify-between gap-2 rounded-t-lg bg-gradient-to-b from-[#202020]/70 to-[#202020]/10 p-2 pb-3">
        <div className="stories_container grid w-full grid-cols-4 gap-0.5">
          <div className="relative h-0.5 w-full rounded-xl bg-white/30">
            <div className="absolute h-full w-[30%] rounded-xl bg-white"></div>
          </div>
          <div className="relative h-0.5 w-full rounded-xl bg-white/30"></div>
          <div className="relative h-0.5 w-full rounded-xl bg-white/30"></div>
          <div className="relative h-0.5 w-full rounded-xl bg-white/30"></div>
        </div>
        <div className="flex w-full items-center justify-between">
          {/* Left Section */}
          <div className="flex items-center space-x-2">
            {/* Profile Logo */}
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border dark:border-[#272176]/30">
              {adCreativesData?.isValidPostOwnerImage ? (
                <img
                  src={adCreativesData?.postOwnerImage}
                  className="h-7 w-7 rounded-full"
                  alt=""
                />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs leading-none font-bold text-white uppercase">
                  {adCreativesData?.postOwnerImage}
                </div>
              )}
            </div>

            {/* Brand Name + Sponsored */}
            <div className="flex flex-col leading-tight">
              <div className="flex items-center space-x-1">
                <span className="text-10 font-normal text-white">{adCreativesData?.postOwner}</span>
                <BsPatchCheckFill className="h-3 w-3 text-white" />
              </div>
              <span className="text-[9px] text-white">Sponsored</span>
            </div>
          </div>

          {/* Right Section */}
          <div className="flex items-center space-x-2">
            <Pause className="h-3 w-3 cursor-pointer text-white" />
            <MoreHorizontal className="h-3 w-3 cursor-pointer text-white" />
          </div>
        </div>
      </div>
      <div className="image_main relative">
        <img
          src={adCreativesData?.image}
          alt="Ad creative"
          className="h-full w-full object-cover"
        />
      </div>

      {/* Right Button */}
      <div className="relative top-1/2 container mx-auto mb-0 flex flex-col items-center justify-center bg-gradient-to-t from-[#202020]/70 to-[#202020]/10 py-4"></div>
    </div>
  );
};

export default ReelStories;
