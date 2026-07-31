import React, { useState, useRef, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ChevronDown, ChevronUp, ImagePlus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDispatch, useSelector } from 'react-redux';
import { fetchBrands } from '@/store/actions/brandIQ/myBrandActions';
import { nanoid } from 'nanoid';
import { useDynamicBackground } from '@/hooks/useDynamicBackground';

const AdCreativeEditorActions = ({ onSelectLogo }) => {
  // const [selectedLogo, setSelectedLogo] = useState(null);
  // const fileInputRef = useRef(null);

  // const handleFileUpload = (event) => {
  //   const file = event.target.files[0];
  //   if (file) {
  //     const reader = new FileReader();
  //     reader.onload = (e) => {
  //       const customLogo = {
  //         id: 'custom',
  //         name: 'Custom Logo',
  //         logo: e.target.result,
  //       };
  //       setSelectedLogo(customLogo);
  //       setPopoverOpen(false);
  //     };
  //     reader.readAsDataURL(file);
  //   }
  // };

  // const handleUploadClick = () => {
  //   fileInputRef.current?.click();
  // };

  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const { myBrands } = useSelector((state) => state.brandIQTabs);
  const userId = userData?.user_id;

  // const [brands, setBrands] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // const fileInputRef = useRef(null);
  const [logos, setLogos] = useState([]);

  useEffect(() => {
    if (userId) dispatch(fetchBrands(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    if (Array.isArray(myBrands) && myBrands.length > 0) {
      let urls = [];
      myBrands.forEach((b) => {
        if (b?.logoUrls && Array.isArray(b?.logoUrls) && b.logoUrls.length > 0) {
          b.logoUrls.forEach((url) => {
            urls.push({ name: b?.name, url, id: nanoid() });
          });
        }
      });
      // const brandList = myBrands?.filter((b) => b.logoUrls?.length);
      // setBrands(brandList || []);
      setLogos(urls || []);
    }
  }, [myBrands]);

  const handleChange = (value) => {
    setSelectedId(value);
    // const selectedBrand = brands.find((b) => b.id === value);
    const selectedLogoUrl = value?.url || null;
    if (selectedLogoUrl) {
      onSelectLogo(selectedLogoUrl);
      setPopoverOpen(false);
    }
  };

  const bgColors = useDynamicBackground(logos || []);

  // const selectedBrand = brands.find((b) => b.id === selectedId);

  return (
    <div className="z-[9999] w-[180px] text-sm">
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            className="group prompt_selection_button relative flex h-10 w-full items-center gap-2 rounded-lg bg-white/80 px-3 text-left text-sm text-gray-700 shadow-sm transition-colors hover:bg-gray-100 hover:text-gray-900 dark:bg-transparent dark:text-[#AFAFAF] dark:shadow-none dark:hover:bg-[#202020]/50 dark:hover:text-white"
            type="button"
          >
            {selectedId?.url ? (
              <div
                className="image_container flex h-[25px] w-[25px] items-center justify-center overflow-hidden rounded-full p-0.5"
                style={{ backgroundColor: bgColors?.[selectedId.id] || '#fff' }}
              >
                <img
                  src={selectedId?.url}
                  alt={selectedId?.name}
                  className="w-auto object-cover"
                  onError={(e) => (e.target.style.display = 'none')}
                />
              </div>
            ) : (
              <ImagePlus className="h-5 w-5 text-gray-500 group-hover:text-gray-900 dark:text-[#AFAFAF] dark:group-hover:text-white" />
            )}
            <span
              title={selectedId?.name || ''}
              className="truncate font-medium text-gray-700 group-hover:text-gray-900 dark:text-[#AFAFAF] dark:group-hover:text-white"
            >
              {selectedId?.name || 'Choose a logo'}
            </span>
            {popoverOpen ? (
              <ChevronUp className="absolute right-2.5 h-5 w-5" />
            ) : (
              <ChevronDown className="absolute right-2.5 h-5 w-5 text-gray-500 group-hover:text-gray-900 dark:text-[#AFAFAF] dark:group-hover:text-white" />
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent className="z-[9999] w-[180px] overflow-hidden rounded-md border border-black/10 bg-white/95 p-0 text-sm shadow-lg backdrop-blur-[80px] dark:border-white/20 dark:bg-[#202020]/50 dark:shadow-none">
          <div className="hidden-scrollbar max-h-[200px] overflow-auto">
            {logos.length > 0 ? (
              logos?.map((l) => (
                <div
                  key={l?.id}
                  onClick={() => handleChange(l)}
                  className="backdrop-blur-100 flex cursor-pointer items-center justify-center gap-2 px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-[#AFAFAF] dark:hover:bg-[#3c3c3c]/80 dark:hover:text-white"
                >
                  <div
                    className="image_container flex h-[45px] w-[45px] items-center justify-center overflow-hidden rounded-sm"
                    style={{ backgroundColor: bgColors?.[l?.id] || '#fff' }}
                  >
                    <img
                      src={l?.url}
                      alt={l?.name}
                      className="w-auto object-cover"
                      onError={(e) => (e.target.style.display = 'none')}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-4 text-center text-xs text-gray-500 dark:text-[#AFAFAF]">
                <p>No logos available</p>
              </div>
            )}

            {/* Upload Custom Logo Option */}

            {/* <div
              onClick={handleUploadClick}
              className="backdrop-blur-100 flex cursor-pointer items-center justify-center gap-2 p-1 pt-6 pb-2"
            >
              <Button
                variant="ghost"
                onClick={handleUploadClick}
                className="prompt_selection_button backdrop-blur-100 text-10 relative h-8 w-fit rounded-md bg-[#0D0D0D]/50 px-3 text-xs transition-colors 2xl:h-9 2xl:text-xs"
              >
                <div className="group flex items-center gap-2 text-[#AFAFAF]">
                  <Upload className="h-3 w-3 group-hover:text-white 2xl:h-4 2xl:w-4" />
                  <span className="group-hover:text-white">Upload Custom Logo</span>
                </div>
              </Button>
            </div> */}
          </div>
        </PopoverContent>
      </Popover>

      {/* Hidden file input */}
      {/* <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      /> */}
    </div>
  );
};

export default AdCreativeEditorActions;
