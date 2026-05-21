import React, { useState } from 'react';
import { MoreVertical, ThumbsUp, Share2, MessageCircle, Heart, Send } from 'lucide-react';

function FbFeed2({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleText = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="rounded-lg bg-white shadow-sm">
      <div className="">
        {/* Header */}
        <div className="flex items-center justify-between p-2">
          <div className="flex items-center gap-1">
            {adCreativesData?.isValidPostOwnerImage ? (
              <img src={adCreativesData?.postOwnerImage} className="h-7 w-7 rounded-full" alt="" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs leading-none font-bold text-white uppercase">
                {adCreativesData?.postOwnerImage}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-black">{adCreativesData?.postOwner}</p>
              <p className="text-[7px] text-gray-500">Sponsored</p>
            </div>
          </div>
          <button className="flex items-center justify-center">
            <MoreVertical className="h-3 w-3 text-gray-500" />
          </button>
        </div>

        {/* Image */}
        <div className="flex min-h-52 items-center justify-center">
          <img src={adCreativesData?.image} alt="Ad creative" className="w-full" />
        </div>

        <div className="footer_container flex flex-col gap-1.5 p-1 px-1 text-gray-600">
          {/* Actions */}
          <div className="mx-auto mt-1 flex w-[90%] items-center justify-between gap-3 text-gray-600">
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

          {/* Text */}
          <div className="paragraph-container mt-1">
            <p className="text-10 word_break max-h-20 overflow-y-auto px-2 pb-2 break-words text-gray-600 2xl:text-xs">
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
      </div>
    </div>
  );
}

export default FbFeed2;
