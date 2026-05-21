import { ChevronUp, MoreHorizontal, X } from 'lucide-react';
import { BsPatchCheckFill } from 'react-icons/bs';

const ReelStories3 = ({ adCreativesData }) => {
  return (
    <div className="w-full overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Main story image */}
      <div className="image_main relative flex min-h-76 items-center justify-center">
        <img
          src={adCreativesData?.image}
          alt="Ad creative"
          className="h-full w-full object-cover"
        />
        <div className="absolute -top-0.5 right-0 left-0 flex items-center justify-between rounded-t-none bg-gradient-to-t from-black/0 to-black/70 p-2 py-3">
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
                <span className="text-10 font-normal whitespace-nowrap text-white 2xl:text-xs">
                  {adCreativesData?.postOwner}
                </span>
                <BsPatchCheckFill className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-[9px] text-gray-100">Sponsored</span>
            </div>
          </div>

          {/* Right Section */}
          <div className="flex items-center space-x-2">
            <MoreHorizontal className="h-4 w-4 cursor-pointer text-white" />
            <X className="h-4 w-4 cursor-pointer text-white" />
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="mt-1 mb-2 flex w-full flex-col items-center justify-center">
        <ChevronUp className="h-5 w-5 text-black" />
      </div>

      {/* Right Button */}
      {false && (
        <div className="container mx-auto mb-0 flex flex-col items-center justify-center">
          <button className="mb-2 rounded-2xl bg-[#E5E6EB] p-2 py-1 text-[10px] font-medium whitespace-nowrap text-black">
            Sign Up
          </button>
          <div className="h-1 w-[50%] animate-pulse rounded-4xl bg-slate-500"></div>
        </div>
      )}
    </div>
  );
};

export default ReelStories3;
