import React from 'react';
import PHONE_FRAME from '@/assets/layouts/ad-factory/preview/phone_frame.png';
import { EllipsisVertical } from 'lucide-react';
import { X } from 'lucide-react';
import { useSelector } from 'react-redux';

const MobilePreview = ({ image, text, cta, ctaLink }) => {
  const { brandInfo } = useSelector((state) => state?.adFactoryNew);
  return (
    <div className="flex justify-center">
      {/* Phone container */}
      <div
        className="relative aspect-[402/874] max-h-[680px] w-[clamp(300px,22vw,400px)] bg-[length:100%_100%] bg-no-repeat 2xl:max-h-[800px]"
        style={{
          backgroundImage: `url(${PHONE_FRAME})`,
        }}
      >
        {/* Post container */}
        <div className="absolute top-[32%] right-[6.5%] bottom-[15%] left-[6.5%] mx-auto flex max-w-[90%] flex-col overflow-hidden bg-white px-3 text-[11px] text-gray-800">
          {/* Header */}
          <div className="flex items-start gap-2 pt-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#167beb] text-xs font-bold text-white">
              {brandInfo?.brandName?.slice(0, 1)?.toUpperCase()}
            </div>

            <div className="flex-1">
              <div className="leading-tight font-semibold">{brandInfo?.brandName}</div>
              {/* <div className="text-[10px] text-gray-500">@adsgpt_ai</div> */}
            </div>

            <EllipsisVertical className="h-4 w-4 text-gray-500" />
          </div>

          {/* Post text */}
          <div className="mt-2 mb-1 line-clamp-4 overflow-hidden leading-snug">
            {text?.primaryText || text?.primary_text}
          </div>

          {/* Ad image */}
          <div className="mt-1 h-[25%] w-full flex-1 bg-[#E4E6EB] 2xl:h-[clamp(150px,28vh,250px)]">
            <img src={image} alt="" className="h-full w-full object-contain" />
          </div>

          {/* Link preview */}
          <div className="flex items-center justify-between gap-2 rounded-xs bg-[#F7F8FA] p-2">
            <div>
              <div className="line-clamp-2 text-[9px] break-all text-gray-500 2xl:text-[10px]">
                {ctaLink}
              </div>
              <div className="leading-tight font-semibold">{text?.headline}</div>
            </div>

            <div className="mt-2">
              <a
                href={ctaLink || '#'}
                target="_blank"
                className="rounded-md bg-[#E4E6EB] px-4 py-1.5 text-[10px] font-semibold whitespace-nowrap text-[#191919] hover:bg-gray-300 2xl:text-[12px]"
                onClick={(e) => !ctaLink && e.preventDefault()}
              >
                {cta}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobilePreview;
