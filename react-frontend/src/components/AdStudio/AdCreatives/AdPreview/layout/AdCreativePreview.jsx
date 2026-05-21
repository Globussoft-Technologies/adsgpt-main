import { Separator } from '@/components/ui/separator';
import { MessageCircle, MoreVertical, Share2, ThumbsUp } from 'lucide-react';
import { useState } from 'react';

const AdCreativePreview = ({ adCreativesData }) => {
  const [isLeftTextExpanded, setIsLeftTextExpanded] = useState(false);
  const [isLeftTitleExpanded, setIsLeftTitleExpanded] = useState(false);

  const toggleLeftText = () => {
    setIsLeftTextExpanded(!isLeftTextExpanded);
  };

  const toggleLeftTitle = () => {
    setIsLeftTitleExpanded(!isLeftTitleExpanded);
  };

  return (
    <div className="w-full rounded-lg text-black shadow-sm dark:bg-white">
      <div className="">
        <div className="header_part p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
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
                <p className="text-10 font-semibold 2xl:text-xs">{adCreativesData?.postOwner}</p>
                <p className="text-[7px]">Sponsored</p>
              </div>
            </div>
            <MoreVertical className="h-4 w-4 text-gray-500" />
          </div>
          <p className="text-10 mt-2 max-h-[200px] overflow-y-auto text-sm 2xl:text-xs">
            {isLeftTextExpanded
              ? adCreativesData?.description
              : adCreativesData?.description?.slice(0, 100)}

            {adCreativesData?.description?.length > 100 && (
              <button onClick={toggleLeftText} className="ml-2 font-bold text-black">
                {isLeftTextExpanded ? '...Read Less' : '...Read More'}
              </button>
            )}
          </p>
        </div>

        {/* Image */}
        <div className="overflow-hidden">
          <img src={adCreativesData?.image} alt="Ad creative" className="w-full" />
        </div>

        <div className="previe_footer flex w-full flex-col gap-3 p-3">
          <div className="flex items-center justify-between">
            <div>
              {/* <p className="text-10 text-gray-400 2xl:text-xs">Sponsored</p> */}
              <p className="text-10 font-medium text-black 2xl:text-xs">
                {isLeftTitleExpanded
                  ? adCreativesData?.title?.split('||')?.[0]?.trim()
                  : adCreativesData?.title?.split('||')?.[0]?.trim()?.slice(0, 200)}

                {adCreativesData?.title?.split('||')?.[0]?.trim()?.length > 100 && (
                  <button onClick={toggleLeftTitle} className="ml-2 font-bold text-black">
                    {isLeftTitleExpanded ? '...Read Less' : '...Read More'}
                  </button>
                )}
              </p>
            </div>
            {false && (
              <button className="text-10 rounded-md bg-gray-100 px-4 py-1 font-medium text-black hover:bg-gray-200 2xl:text-xs">
                Sign Up
              </button>
            )}
          </div>

          <Separator className="h-[0.75px] bg-[#CACACA]/80" />
          {/* Actions */}
          <div className="flex items-center justify-between">
            <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
              <ThumbsUp className="h-3 w-3" /> Like
            </button>
            <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
              <MessageCircle className="h-3 w-3" /> Comment
            </button>
            <button className="text-10 flex items-center gap-1 font-medium 2xl:text-xs">
              <Share2 className="h-3 w-3" /> Share
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdCreativePreview;
