import { memo, useState, useMemo, useEffect } from 'react';
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/dialog';
import { FaPlay } from 'react-icons/fa';
import AdCreativePreview from './AdCreativePreview';
import PinterestFeed1 from '../Pinterest/Feeds/PinterestFeed1';
import PinterestFeed2 from '../Pinterest/Feeds/PinterestFeed2';
import PinterestFeed3 from '../Pinterest/Feeds/PinterestFeed3';
import PinterestLogo from '@/assets/layouts/adstudio/adpreview/pinterest.svg';
import { getAdText } from '@/utils/getAdText';

// Ad components
const adComponents = {
  PinterestFeed1: PinterestFeed1,
  PinterestFeed2: PinterestFeed2,
  PinterestFeed3: PinterestFeed3,
};

// Ad options section component
const AdOptionsSection = ({ selectedAd, title, adTypes, onAdClick, adCreativeData }) => (
  <div className="feeds_section_container mb-5 w-full">
    <h3 className="mb-3 text-base font-semibold text-white">{title}</h3>
    <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {adTypes?.map((adType) => {
        const AdComponent = adComponents[adType];
        return (
          <div
            key={adType}
            onClick={() => onAdClick(adType)}
            className={`flex w-full cursor-pointer items-center justify-center rounded-xl p-4 ${selectedAd === adType ? 'rounded-xl bg-[#0A0A0A]/50 ring-1 ring-[#5E66F5]' : 'bg-[#535353]/50'} `}
          >
            <AdComponent adCreativesData={adCreativeData} />
          </div>
        );
      })}
    </div>
  </div>
);

function AdPreviewPintMain({
  postOwner,
  isDialogOpen,
  setIsDialogOpen,
  image,
  description,
  title,
  postOwnerImage,
  ad,
}) {
  const [selectedAd, setSelectedAd] = useState('PinterestFeed1');
  const [isValidPostOwnerImage, setIsValidPostOwnerImage] = useState(true);
  useEffect(() => {
    const img = new Image();
    img.src = postOwnerImage;
    img.onload = () => setIsValidPostOwnerImage(true);
    img.onerror = () => setIsValidPostOwnerImage(false);
  }, [postOwnerImage]);

  // Memoize ad creative data
  const adCreativeData = useMemo(() => {
    const mainDescription = description?.trim() || title?.trim() || getAdText(ad?.text_ad);
    const mainPostOwner = postOwner
      ? postOwner?.length > 20
        ? postOwner?.slice(0, 20) + '...'
        : postOwner
      : '';
    const defalutPostOwnerImage = postOwner?.slice(0, 2);
    return {
      description: mainDescription,
      image,
      postOwner: mainPostOwner,
      postOwnerImage: isValidPostOwnerImage ? postOwnerImage : defalutPostOwnerImage,
      title,
      isValidPostOwnerImage,
    };
  }, [description, title, ad, image, postOwner, postOwnerImage, isValidPostOwnerImage]);

  const handleAdClick = (adType) => {
    setSelectedAd(adType);
  };

  // Function to render selected ad
  const renderSelectedAd = () => {
    if (!selectedAd) {
      return <AdCreativePreview adCreativesData={adCreativeData} />;
    }
    const AdComponent = adComponents[selectedAd];
    return AdComponent ? (
      <AdComponent selectedAd={selectedAd} adCreativesData={adCreativeData} text={'text-sm'} />
    ) : null;
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger className=""></DialogTrigger>

      <DialogContent className="flex h-[90vh] w-full max-w-[95vw] flex-col overflow-x-hidden rounded-3xl !bg-[#0D0D0D]/30 !backdrop-blur-[50px] sm:scale-[0.65] sm:p-6 md:max-w-[90vw] lg:h-[140vh] lg:max-h-[150vh] lg:max-w-7xl 2xl:h-fit 2xl:max-h-full 2xl:scale-100">
        {/* Heading */}
        <div className="flex items-center justify-center gap-1">
          <FaPlay className="h-4 w-4" />
          <h2 className="font-public text-center text-base font-medium">Ad Preview</h2>
        </div>

        {/* Platform Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center">
              <img src={PinterestLogo} alt="Pinterest" />
            </div>
            <div>
              <p className="text-sm">Pinterest</p>
              <p className="text-sm text-gray-500 dark:text-white">Feed</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="preview_container">
          <div className="col-span-6 grid grid-cols-6 gap-8 sm:col-span-12 sm:grid-cols-12">
            {/* Left Column: Selected Ad / Default */}
            <div className="left_container_preview col-span-6 h-full max-h-[calc(140vh-150px)] overflow-y-auto sm:col-span-12 md:col-span-4 2xl:max-h-[calc(100vh-200px)]">
              <div className="rounded-3xl border-2 border-white/20 p-5 py-14">
                {renderSelectedAd()}
              </div>
            </div>

            {/* Right Column: Options */}
            <div className="col-span-6 flex max-h-[calc(140vh-150px)] w-full flex-col overflow-y-auto rounded-3xl border-2 border-white/20 p-5 text-black sm:col-span-12 md:col-span-8 2xl:max-h-[calc(100vh-200px)]">
              <AdOptionsSection
                selectedAd={selectedAd}
                title="Feed"
                adTypes={['PinterestFeed1', 'PinterestFeed2', 'PinterestFeed3']}
                onAdClick={handleAdClick}
                adCreativeData={adCreativeData}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default memo(AdPreviewPintMain);
