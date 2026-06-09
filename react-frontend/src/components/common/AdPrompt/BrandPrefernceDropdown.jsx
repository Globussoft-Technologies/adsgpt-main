import { FaChevronDown } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BrandSelect from './BrandSelect';
import {
  Box,
  CloudUpload,
  Command,
  Image,
  Info,
  Loader2,
  Palette,
  Repeat2,
  ScanFace,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';
import ShowBrandLogos from './AdCreative/ShowBrandLogos';
import { uploadToNAS } from '@/utils/imageUpload';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const preferenceOptions = [
  { icon: Repeat2, label: 'Auto', value: 'AUTO' },
  { icon: Command, label: 'General', value: 'GENERAL' },
  { icon: Palette, label: 'Design', value: 'DESIGN' },
  { icon: ScanFace, label: 'Anime', value: 'ANIME' },
  { icon: Box, label: '3D', value: 'RENDER_3D' },
  { icon: Image, label: 'Realistic', value: 'REALISTIC' },
];

const BrandPreferenceDropdown = () => {
  const [fileName, setFileName] = useState('');
  const dispatch = useDispatch();
  const { cta, style_type, selectedBrand, uploadedLogo, brand_name } = useSelector(
    (state) => state.prompt
  );
  const { userData } = useSelector((state) => state.socket);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const user_id = userData?.user_id;
  const [errorMsg, setErrorMsg] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const selectedPreference = preferenceOptions.find((opt) => opt.value === style_type);

  useEffect(() => {
    if (!uploadedLogo) {
      setFileName('');
    }
  }, [uploadedLogo]);

  const handleFileChange = async (event) => {
    setErrorMsg('');
    const file = event.target.files[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Only image files are allowed.');
      event.target.value = '';
      return;
    }

    // Check file transparency
    const hasTransparency = await checkTransparency(file);
    if (!hasTransparency) {
      setErrorMsg('Please upload a logo with transparent background.');
      event.target.value = '';
      return;
    }

    setIsImageUploading(true);

    const url = await uploadToNAS(file, user_id);
    if (url) {
      dispatch(setFields({ uploadedLogo: url }));
    }
    setFileName(event.target.files?.[0]?.name);
    // Reset file input
    event.target.value = '';
    setIsImageUploading(false);
  };

  const handleLogoRemove = () => {
    dispatch(setFields({ uploadedLogo: '' }));
    setFileName('');
  };

  const checkTransparency = (file) => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height).data;

        // Check if any pixel has alpha < 255
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 255) {
            resolve(true); // has transparency
            return;
          }
        }
        resolve(false); // no transparency
      };
      img.src = URL.createObjectURL(file);
    });
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setErrorMsg(''); // clear error when popover closes
        }
      }}
    >
      <PopoverTrigger asChild>
        <div
          id="tour_describe_brand_for_creative"
          className="prompt_selection_button_no_gradient group 2xl:text-13 relative flex max-w-[200px] cursor-pointer items-center gap-2 rounded-[50px] px-4 py-1.5 text-[9px] text-zinc-800 shadow-none transition-all duration-200 ease-in hover:bg-slate-100 md:text-[11px] 2xl:py-2 dark:border-none dark:bg-[#0d0d0d]/50 dark:text-[#AFAFAF]"
        >
          <span className="truncate font-light text-zinc-800 dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {brand_name || 'Describe Brand'}
            {/* . {selectedPreference?.label || 'Preference'} */}
          </span>
          <FaChevronDown className="flex-shrink-0 font-light text-zinc-600 dark:text-[#afafaf] dark:group-data-[state=open]:text-white" />
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="backdrop-blur-100 mb-2 w-68 rounded-3xl border border-black/10 bg-white px-2 py-4 pb-6 2xl:w-86 2xl:pb-8 dark:border-white/20 dark:bg-[#0D0D0D]/50"
      >
        <div className="w-full">
          <Tabs defaultValue="brand" className="flex w-full">
            {/* Tabs header */}
            <TabsList className="mx-auto h-9 w-58 rounded-full border border-black/10 !bg-zinc-100 p-1 2xl:h-12 2xl:w-70 2xl:p-1.25 dark:border-white/30 dark:!bg-[#0d0d0d]/60">
              <TabsTrigger
                value="brand"
                className="bg-transparent px-3 !text-[11px] !font-medium !text-zinc-700 !outline-0 transition-all duration-200 focus-within:!border-0 hover:!text-zinc-900 focus:!ring-0 data-[state=active]:!rounded-full data-[state=active]:!bg-zinc-800 data-[state=active]:!text-white 2xl:px-4 2xl:!text-sm dark:!text-[#d9d9d9] dark:hover:!text-white dark:data-[state=active]:!bg-[#606060] dark:data-[state=active]:!text-white"
              >
                Describe Brand
              </TabsTrigger>
              {/* <TabsTrigger
                value="preference"
                className="bg-transparent px-3 !text-[11px] !font-medium !text-[#d9d9d9] !outline-0 transition-all duration-200 focus-within:!border-0 hover:!text-white focus:!ring-0 data-[state=active]:!rounded-full data-[state=active]:!bg-[#606060] data-[state=active]:!text-white 2xl:px-4 2xl:!text-sm"
              >
                Preference
              </TabsTrigger> */}
            </TabsList>

            {/* Brand Content */}
            <TabsContent value="brand" className="mt-0 px-2 2xl:mt-1">
              <div>
                <div className="grid gap-3">
                  <div className="grid gap-1">
                    <BrandSelect />
                  </div>

                  {Array.isArray(selectedBrand?.logoUrls) &&
                    selectedBrand?.logoUrls?.length > 0 &&
                    !uploadedLogo && (
                      <div className="grid gap-1">
                        <ShowBrandLogos logos={selectedBrand?.logoUrls} />
                      </div>
                    )}
                  {uploadedLogo && !isImageUploading && (
                    <div
                      key="static-id"
                      onClick={() => {}}
                      className="prompt_selection_button relative h-12 w-fit flex-shrink-0 cursor-pointer rounded-lg bg-zinc-100 p-2.5 backdrop-blur-[80px] transition-all duration-200 hover:shadow-md hover:ring-1 hover:ring-black/20 dark:bg-[#202020]/50 dark:hover:ring-white/40"
                      title="Brand Logo"
                    >
                      <img
                        src={uploadedLogo}
                        alt="Brand Logo"
                        className="mx-auto h-full w-fit object-contain"
                      />

                      <button
                        className="absolute -top-2 -right-1.5 rounded-full border border-black/10 bg-white p-0.5 text-zinc-600 backdrop-blur-[60px] transition-colors hover:border-black/30 hover:text-black dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:border-white/40 dark:hover:text-white"
                        aria-label="Remove logo"
                        onClick={handleLogoRemove}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {isImageUploading && (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-700 2xl:h-5 2xl:w-5 dark:text-white" />
                  )}
                  <div className="grid gap-1">
                    <div className="flex items-center gap-1 2xl:gap-2">
                      <label
                        htmlFor="brand-logo"
                        className="text-[11px] font-normal text-zinc-700 2xl:text-sm dark:text-[#afafaf]"
                      >
                        Brand Logo
                      </label>

                      <ShadcnTooltip
                        label="Please upload a brand logo in PNG or JPEG format with a transparent background, of size up to 2MB."
                        side="top"
                        className="max-w-[300px] text-sm text-wrap 2xl:max-w-[350px]"
                      >
                        <Info className="h-2.5 w-2.5 cursor-pointer text-zinc-500 hover:text-zinc-900 2xl:h-3 2xl:w-3 dark:text-gray-400 dark:hover:text-white" />
                      </ShadcnTooltip>
                    </div>

                    <label
                      htmlFor="brand-logo"
                      className="flex items-center gap-3 rounded-4xl border border-black/10 bg-zinc-50 px-1 py-1 text-[10px] text-zinc-700 transition 2xl:text-sm dark:border-white/20 dark:bg-[#0d0d0d]/50 dark:text-[#afafaf]"
                    >
                      <div className="flex cursor-pointer items-center gap-1.5 rounded-4xl bg-zinc-800 px-2.5 py-1.5 text-[10px] text-white hover:opacity-70 2xl:gap-2 dark:bg-[#606060]">
                        <CloudUpload className="h-3.5 w-3.5 text-white 2xl:h-4 2xl:w-4" />
                        <span className="!text-[10px] whitespace-nowrap 2xl:!text-xs">
                          Choose File
                        </span>
                      </div>
                      <p className="max-w-32 truncate font-light 2xl:max-w-40">
                        {fileName || 'No files selected'}
                      </p>

                      <input
                        id="brand-logo"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleFileChange}
                      />
                    </label>
                    {errorMsg && (
                      <p className="mt-1 text-[10px] text-red-500 2xl:text-[13px]">{errorMsg}</p>
                    )}
                  </div>

                  <div className="grid gap-1.5">
                    <label
                      htmlFor="call-to-action"
                      className="text-[11px] font-normal text-zinc-700 2xl:text-sm dark:text-[#afafaf]"
                    >
                      Call to Action
                    </label>
                    <Input
                      id="call-to-action"
                      className="h-7! rounded-4xl border border-black/10 bg-zinc-50 text-zinc-800 text-[10px]! placeholder:text-[10px]! placeholder:text-zinc-500 focus-within:border-zinc-400 focus:!ring-0 2xl:h-10! 2xl:text-sm! placeholder:2xl:text-sm! dark:border-white/20 dark:bg-[#0d0d0d]/50 dark:text-white dark:placeholder:text-[#ccc]/60 dark:focus-within:border-white/50"
                      value={cta}
                      placeholder="Enter Call to Action"
                      onChange={(e) => {
                        dispatch(setFields({ cta: e.target.value }));
                      }}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Preference Content */}
            <TabsContent value="preference">
              <div className="mt-4 flex w-full flex-wrap items-center justify-center gap-1 gap-y-2 2xl:gap-2 2xl:gap-y-4">
                {preferenceOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <div
                      key={option.label}
                      className={`flex w-20 cursor-pointer items-center justify-center gap-1 rounded-sm border 2xl:w-25 ${style_type === option.value ? 'border-zinc-400 bg-zinc-100 text-zinc-900 dark:border-white/50 dark:bg-[#0d0d0d]/50 dark:text-white' : 'border-black/10 bg-zinc-50 text-zinc-600 dark:border-white/20 dark:bg-[#313131]/50 dark:text-[#afafaf]'} px-2 py-2 text-[11px] hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 2xl:text-sm dark:hover:border-white/50 dark:hover:bg-[#0d0d0d]/50 dark:hover:text-white`}
                      onClick={() => dispatch(setFields({ style_type: option.value }))}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{option.label}</span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BrandPreferenceDropdown;
