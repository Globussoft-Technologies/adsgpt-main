import React, { useState } from 'react';
import { MoreVertical, ThumbsUp, Share2, MessageCircle } from 'lucide-react';

function FbFeed1({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="w-full overflow-hidden rounded-lg bg-white shadow-sm">
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
                <p className="text-10 font-semibold text-black 2xl:text-xs">
                  {adCreativesData?.postOwner}
                </p>
                <p className="text-[9px] text-gray-500">Sponsored</p>
              </div>
            </div>
            <button className="flex items-center justify-center">
              <MoreVertical className="h-3 w-3 text-gray-500" />
            </button>
          </div>

          <div className="paragraph-container">
            <p className="text-10 px-0.5 text-sm leading-3 text-gray-600 2xl:text-xs">
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

        {/* Post Image */}
        <div className="flex min-h-52 items-center justify-center overflow-hidden">
          <img src={adCreativesData?.image} alt="Ad creative" className="w-full" />
        </div>

        {false && (
          <div className="flex items-center justify-between bg-[#F7F8FA] p-3">
            {/* Left Loader Section */}
            <div className="flex w-full max-w-xs flex-col space-y-2">
              <div className="h-1 w-full animate-pulse rounded bg-[#D9D9D9]"></div>
              <div className="h-1 w-2/3 animate-pulse rounded bg-[#D9D9D9]"></div>
            </div>

            {/* Right Button */}
            {false && (
              <button className="ml-4 rounded-xl bg-[#E5E6EB] p-2 py-1 text-[10px] font-medium whitespace-nowrap text-black">
                Sign Up
              </button>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="mx-auto flex w-[90%] items-center justify-between gap-3 border-t border-[#CACACA] p-2 px-1 text-gray-600">
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <ThumbsUp className="h-3 w-3" />
            Like
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <MessageCircle className="h-3 w-3" />
            Comment
          </button>
          <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
            <Share2 className="h-3 w-3" />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

export default FbFeed1;
