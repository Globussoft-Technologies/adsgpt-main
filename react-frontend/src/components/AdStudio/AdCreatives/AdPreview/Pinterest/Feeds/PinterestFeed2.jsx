import { useState } from 'react';
import { Ellipsis } from 'lucide-react';

function PinterestFeed2({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleText = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="rounded-lg bg-white shadow-sm">
      <div className="space-y-2 p-2">
        {/* Header */}
        <div className="flex items-center justify-between">
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
            <Ellipsis className="h-3 w-3 text-gray-500" />
          </button>
        </div>
        {/* Image */}
        <div className="">
          <img src={adCreativesData?.image} alt="Ad creative" className="rounded-10 w-full" />
        </div>

        <div className="flex justify-between py-2 pb-3 text-xs">
          {/* Left Loader Section */}
          <div className="flex w-full max-w-xs flex-col space-y-2">
            <p className="font-bold text-[#171717]">
              {isExpanded
                ? adCreativesData?.description
                : adCreativesData?.description?.slice(0, 50)}

              {adCreativesData?.description?.length > 50 && (
                <button onClick={toggleText} className="ml-2 font-bold text-black">
                  {isExpanded ? '...Read Less' : '...Read More'}
                </button>
              )}
            </p>
            <p className="leading-2.5 text-[#2D2D2D]">{adCreativesData?.postOwner} </p>
            <p className="leading-2.5 text-[#8D8D8D]">Sponsored</p>
          </div>

          <div className="icon relative -top-2">
            <Ellipsis className="w-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default PinterestFeed2;
