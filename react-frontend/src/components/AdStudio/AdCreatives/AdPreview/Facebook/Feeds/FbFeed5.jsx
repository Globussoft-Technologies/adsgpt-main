import { useState } from 'react';
import {
  MoreVertical,
  MessageCircle,
  Repeat2,
  Heart,
  BarChart2,
  Bookmark,
  Share,
} from 'lucide-react';

function FbFeed5({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="w-full rounded-lg bg-white shadow-sm">
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
        <div className="px-2">
          <img
            src={adCreativesData?.image}
            alt="Ad creative"
            className="h-20 w-full rounded-md object-cover"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-around gap-3 p-2 py-3 text-gray-600">
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <MessageCircle className="h-3 w-3" />
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <Repeat2 className="h-3 w-3" />
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <Heart className="h-3 w-3" />
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <BarChart2 className="h-3 w-3" />
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <Bookmark className="h-3 w-3" />
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <Share className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default FbFeed5;
