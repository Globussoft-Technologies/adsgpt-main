import { FaChevronDown } from 'react-icons/fa';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StudioImage from '@/assets/layouts/prompt/advideo/studio.webp';
import OutdoorImage from '@/assets/layouts/prompt/advideo/outdoor.webp';
import LuxuryImage from '@/assets/layouts/prompt/advideo/luxury.webp';
import IndustrialImage from '@/assets/layouts/prompt/advideo/industrial.webp';
import ModernImage from '@/assets/layouts/prompt/advideo/modern.webp';
import CozyImage from '@/assets/layouts/prompt/advideo/cozy.webp';
import BeautyImage from '@/assets/layouts/prompt/advideo/beauty.webp';
import RomanticImage from '@/assets/layouts/prompt/advideo/romantic.webp';
import { useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setField } from '@/store/reducers/adStudio/promptSlice';
import HumanShowcaseImage from '@/assets/layouts/prompt/advideo/human-showcase.webp';
import ProductSlotImage from '@/assets/layouts/prompt/advideo/product-shot.webp';

const VideoTypeArray = [
  {
    url: ProductSlotImage,
    label: 'Product Shot',
    value: 'product_shot',
  },
  {
    url: HumanShowcaseImage,
    label: 'UGC Ad',
    value: 'ugc_ad',
  },
];

const PreferenceArray = [
  { url: StudioImage, label: 'Studio', value: 'studio' },
  { url: OutdoorImage, label: 'Outdoor', value: 'outdoor' },
  { url: LuxuryImage, label: 'Luxury', value: 'luxury' },
  { url: IndustrialImage, label: 'Industrial', value: 'industrial' },
  { url: ModernImage, label: 'Modern', value: 'modern' },
  { url: CozyImage, label: 'Cozy', value: 'cozy' },
  { url: BeautyImage, label: 'Beauty', value: 'beauty' },
  { url: RomanticImage, label: 'Romantic', value: 'romantic' },
];

const VideoTypePreference = () => {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const {
    video_type: selectedVideo,
    video_preference: selectedPreference,
    product_name,
    persona,
    video_model,
  } = useSelector((state) => state.prompt);
  const dispatch = useDispatch();
  const selectedVideoItem = VideoTypeArray?.find((item) => item.value === selectedVideo);
  const selectedPrefItem = PreferenceArray?.find((item) => item.value === selectedPreference);
  const handleTypeClick = useCallback((value) => {
    dispatch(setField({ key: 'video_type', value }));
    setPopoverOpen(false);
  }, []);

  const handlePreferenceClick = useCallback((value) => {
    dispatch(setField({ key: 'video_preference', value }));
    setPopoverOpen(false);
  }, []);

  const handleInputChange = (key, value) => {
    dispatch(setField({ key, value }));
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <div className="prompt_selection_button_no_gradient group 2xl:text-13 backdrop-blur-100 relative flex cursor-pointer items-center gap-2 rounded-[50px] bg-[#202020]/50 px-4 py-1.5 text-[9px] text-[#AFAFAF] shadow-none transition-all duration-200 ease-in 2xl:py-2 dark:border-none">
          <div className="flex gap-2 font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {video_model != 'veo' && (
              <>
                <span>
                  {product_name
                    ? `${product_name?.slice(0, 12)}${product_name?.length > 12 ? '...' : ''}`
                    : 'Product Name'}
                </span>
                <span>•</span>
              </>
            )}
            <span>{selectedVideoItem ? selectedVideoItem.label : 'Video Type'}</span>
            <span>•</span>
            <span>{selectedPrefItem ? selectedPrefItem.label : 'Preference'}</span>
          </div>
          <FaChevronDown className="font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white" />
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="backdrop-blur-100 mb-2 w-86 rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-2 py-4.5 pb-5"
      >
        <div className="w-full">
          <Tabs defaultValue="product" className="flex w-full">
            {/* Tabs header */}
            <TabsList className="mx-auto h-12 w-80 rounded-full border border-white/30 !bg-[#0d0d0d]/50 p-1">
              {video_model != 'veo' && (
                <TabsTrigger
                  value="product"
                  className="bg-transparent px-4 !text-sm !font-medium !text-[#d9d9d9] hover:!text-white data-[state=active]:!rounded-full data-[state=active]:!bg-[#3c3c3c] data-[state=active]:!text-white"
                >
                  Product
                </TabsTrigger>
              )}
              <TabsTrigger
                value="videoType"
                className="bg-transparent px-4 !text-sm !font-medium !text-[#d9d9d9] hover:!text-white data-[state=active]:!rounded-full data-[state=active]:!bg-[#3c3c3c] data-[state=active]:!text-white"
              >
                Video Type
              </TabsTrigger>
              <TabsTrigger
                value="videoPreference"
                className="bg-transparent px-4 !text-sm !font-medium !text-[#d9d9d9] hover:!text-white data-[state=active]:!rounded-full data-[state=active]:!bg-[#3c3c3c] data-[state=active]:!text-white"
              >
                Preference
              </TabsTrigger>
            </TabsList>

            {/* Product Content */}
            <TabsContent value="product" className="mt-3 px-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col">
                  <label className="mb-1 text-sm text-[#d9d9d9]">Product Name</label>
                  <input
                    type="text"
                    placeholder="Enter product name"
                    value={product_name}
                    onChange={(e) => handleInputChange('product_name', e.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-[#1A1A1A] px-3 py-2 text-sm text-white placeholder-[#777] focus:border-[#5771F6] focus:ring-0"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="mb-1 text-sm text-[#d9d9d9]">Persona(Only for UGC Ad)</label>
                  <input
                    type="text"
                    placeholder="Young friendly adult"
                    value={persona}
                    onChange={(e) => handleInputChange('persona', e.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-[#1A1A1A] px-3 py-2 text-sm text-white placeholder-[#777] focus:border-[#5771F6] focus:ring-0"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Video Type Content */}
            <TabsContent value="videoType" className="mt-2.5 px-2.5">
              <div className="grid grid-cols-2 gap-3.5">
                {VideoTypeArray.map(({ url, label, value }) => (
                  <div
                    key={label}
                    onClick={() => handleTypeClick(value)}
                    className={`relative cursor-pointer overflow-hidden rounded-lg border transition-all ${
                      selectedVideo === value
                        ? 'border-[#5771F6] ring-2 ring-[#5771F6]'
                        : 'border-white/20'
                    }`}
                  >
                    <img
                      className="w-full transition-all duration-300 ease-out hover:scale-110"
                      src={url}
                      alt={label}
                    />
                    <div className="absolute bottom-0 flex h-10 w-full items-center bg-gradient-to-b from-[#0F0F0F]/0 to-[#0F0F0F]">
                      <span className="relative top-1 p-3 text-sm text-white">{label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Preference Content */}
            <TabsContent value="videoPreference" className="mt-2.5 px-2.5">
              <div className="grid grid-cols-3 gap-3">
                {PreferenceArray.map(({ url, label, value }) => (
                  <div
                    key={label}
                    onClick={() => handlePreferenceClick(value)}
                    className={`video_type relative cursor-pointer overflow-hidden rounded-lg border transition-all ${
                      selectedPreference === value
                        ? 'border-[#5771F6] ring-2 ring-[#5771F6]'
                        : 'border-white/20'
                    }`}
                  >
                    <img
                      className="w-full cursor-pointer transition-all duration-300 ease-out hover:scale-110"
                      src={url}
                      alt={label}
                    />
                    <div className="absolute bottom-0 flex h-10 w-full items-center justify-start bg-gradient-to-b from-[#0F0F0F]/0 to-[#0F0F0F]">
                      <span className="relative top-1 p-3 text-sm break-words text-white">
                        {label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default VideoTypePreference;
