import { useState } from 'react';
import { MessageCircle, EllipsisIcon, Smile, Heart, Send, Bookmark } from 'lucide-react';

function InstaFeed1({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="w-full rounded-lg bg-white shadow-sm">
      <div className="">
        {/* Feed Header */}
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
                <p className="text-10 leading-3 font-semibold text-black 2xl:text-xs">
                  {adCreativesData?.postOwner}
                </p>
                <p className="text-[9px] text-[#111111]">Sponsored</p>
              </div>
            </div>
            <button className="flex items-center justify-center">
              <EllipsisIcon className="h-3 w-3 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Post Image */}
        <div className="overflow-hidden">
          <img
            src={adCreativesData?.image}
            alt="Ad creative"
            className="max-h-72 w-full object-cover"
          />
        </div>
        <div className="h-[1px] w-full bg-[#D9D9D9]"></div>

        {/* Footer Actions */}
        <div className="w-full px-2 py-2">
          {/* Icons row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Heart size={16} className="text-black" />
              <MessageCircle size={16} className="text-black" />
              <Send size={16} className="text-black" />
            </div>
            <Bookmark size={16} className="text-black" />
          </div>

          {/* Caption */}
          <p className="mt-1 max-h-[200px] overflow-y-auto text-xs text-[#363636]">
            <span className="font-semibold">{adCreativesData?.postOwner} </span>
            {isExpanded ? adCreativesData?.description : adCreativesData?.description?.slice(0, 50)}

            {adCreativesData?.description?.length > 50 && (
              <button onClick={toggleText} className="ml-2 font-bold text-black">
                {isExpanded ? '...Read Less' : '...Read More'}
              </button>
            )}
          </p>

          {/* Comment input */}
          <div className="mt-2 flex items-center justify-between pb-2">
            <p className="text-xs text-[#363636]">Add a comment...</p>
            <Smile size={16} className="text-black" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default InstaFeed1;
