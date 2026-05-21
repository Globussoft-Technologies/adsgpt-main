import { useState } from 'react';
import { Ellipsis } from 'lucide-react';

function PinterestFeed3({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="w-full rounded-lg bg-white shadow-sm">
      <div className="space-y-2 p-2">
        {/* Image */}
        <div className="rounded-lg">
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
            <p className="leading-2.5 text-[#8D8D8D]">Promoted</p>
          </div>

          <div className="icon relative -top-2">
            <Ellipsis className="w-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default PinterestFeed3;
