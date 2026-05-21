import { useState } from 'react';

function FbFeed6({ adCreativesData }) {
  const [isExpanded, setIsExpanded] = useState(false);
  adCreativesData['title'] = adCreativesData?.title || adCreativesData?.description;
  const toggleText = () => setIsExpanded(!isExpanded);

  return (
    <div className="flex flex-row overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Image */}
      <div className="min-h-32 w-[50%]">
        <img
          src={adCreativesData?.image}
          alt="Ad creative"
          className="h-full w-full object-cover"
        />
      </div>
      <div className="feed_header_part m-auto flex max-h-[13vh] w-[50%] flex-col gap-2 overflow-y-auto p-1 text-gray-600">
        <p className="text-10 px-0.5 leading-3 break-words 2xl:text-xs">
          {isExpanded
            ? adCreativesData?.title?.split('||')?.[0]
            : adCreativesData?.title?.split('||')?.[0]?.slice(0, 60)}

          {adCreativesData?.title?.length > 0
            ? adCreativesData?.title?.split('||')?.[0]?.length > 50 && (
                <button onClick={toggleText} className="ml-2 font-bold text-black">
                  {isExpanded ? '...Read Less' : '...Read More'}
                </button>
              )
            : adCreativesData?.postOwner}
        </p>
      </div>
    </div>
  );
}

export default FbFeed6;
