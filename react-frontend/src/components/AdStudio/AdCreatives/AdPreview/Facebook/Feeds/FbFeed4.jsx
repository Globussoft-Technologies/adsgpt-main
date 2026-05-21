import { useState } from 'react';
import { MoreVertical } from 'lucide-react';

function FbFeed4({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="rounded-lg bg-white shadow-sm">
      <div className="">
        <div className="feed_header_part flex flex-col gap-2 p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
              <div>
                <p className="text-10 font-semibold text-black 2xl:text-xs">
                  {adCreativesData?.postOwner}
                </p>
                <p className="text-[9px] text-gray-500">Sponsored</p>
              </div>
            </div>
            <button aria-label="More options">
              <MoreVertical className="h-3 w-3 text-gray-500" />
            </button>
          </div>
          <div className="">
            <p className="text-10 px-0.5 text-gray-600 2xl:text-xs">
              {isExpanded
                ? adCreativesData?.description
                : adCreativesData?.description?.slice(0, 60)}

              {adCreativesData?.description?.length > 50 && (
                <button onClick={toggleText} className="ml-2 font-bold text-black">
                  {isExpanded ? '...Read Less' : '...Read More'}
                </button>
              )}
            </p>
          </div>
        </div>

        {/* Image */}
        <div className="">
          <img src={adCreativesData?.image} alt="Ad creative" className="w-full object-cover" />
        </div>

        {/* Action buttons */}
        <div className="mx-auto flex w-full flex-col items-center justify-center py-3">
          <div className="h-1 w-[40%] animate-pulse rounded bg-[#D9D9D9]"></div>
        </div>
      </div>
    </div>
  );
}

export default FbFeed4;
