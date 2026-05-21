import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  ThumbsUp,
  Share2,
  MessageSquare,
  Megaphone,
} from 'lucide-react';

const ReelStories2 = ({ adCreativesData }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="w-full overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Left navigation */}
      <div className="flex h-9 w-full items-center justify-start bg-gradient-to-b from-black/30 to-black/0 text-white">
        <ChevronLeft className="ml-1 h-5 w-5" />
      </div>
      {/* Main image */}
      <div className="flex min-h-52 items-center justify-center">
        <img src={adCreativesData?.image} alt="Ad creative" className="w-full" />
      </div>

      {/* Bottom content */}
      <div className="relative bottom-0 flex w-full flex-col items-start justify-between bg-gradient-to-b from-black/0 to-black/70 px-2 pt-2">
        {/* Profile + Brand */}
        <div className="flex items-center justify-between gap-1">
          {adCreativesData?.isValidPostOwnerImage ? (
            <img src={adCreativesData?.postOwnerImage} className="h-7 w-7 rounded-full" alt="" />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs leading-none font-bold text-white uppercase">
              {adCreativesData?.postOwnerImage}
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold text-white">{adCreativesData?.postOwner}</p>
          </div>
        </div>

        {/* CTA + Description */}
        <div className="mt-2 flex flex-col items-start justify-start">
          <p className="mt-2 max-h-[80px] overflow-x-hidden overflow-y-auto text-[10px] break-words text-white">
            {isExpanded ? adCreativesData?.description : adCreativesData?.description?.slice(0, 60)}

            {adCreativesData?.description?.length > 50 && (
              <button onClick={toggleText} className="ml-2 font-bold text-black">
                {isExpanded ? '...Read Less' : '...Read More'}
              </button>
            )}
          </p>

          <button className="mt-2 mb-2 flex items-center justify-center gap-1 rounded-md bg-[#4A4A4A] p-0.5 px-2 text-[10px] text-white">
            <Megaphone className="h-3 w-3" />
            Sponsored
          </button>
        </div>

        {/* Bottom-right actions */}
        <div className="absolute right-2 bottom-2 flex flex-col items-center justify-between gap-2">
          {[ThumbsUp, MessageSquare, Share2].map((Icon, index) => (
            <p key={index} className="flex flex-col items-center text-xs">
              <Icon className="h-5 w-5 rounded-full bg-[#3E3E3E]/50 p-1 text-white" />
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReelStories2;
