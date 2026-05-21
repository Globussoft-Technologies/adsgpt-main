import { FaChevronDown } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BrandSelect from './BrandSelect';
import { Box, CloudUpload, Command, Image, Palette, Repeat2, ScanFace, Upload } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { setFields } from '@/store/reducers/adStudio/promptSlice';

const DescribeBrandDropdown = () => {
  const dispatch = useDispatch();
  const { cta, brand_name } = useSelector((state) => state.prompt);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="prompt_selection_button_no_gradient group 2xl:text-13 group backdrop-blur-80 relative flex max-w-[200px] items-center gap-2 rounded-[50px] px-4 py-1.5 text-[9px] shadow-none transition-all duration-200 ease-in hover:bg-slate-100 2xl:py-2 dark:border-none dark:bg-[#202020]/50 dark:text-[#AFAFAF]">
          <span className="truncate font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white">
            {brand_name || 'Describe Brand'}
          </span>
          <FaChevronDown className="flex-shrink-0 font-light dark:text-[#afafaf] dark:group-data-[state=open]:text-white" />
        </div>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="backdrop-blur-100 mb-2 w-86 rounded-3xl border border-white/20 bg-[#0D0D0D]/50 px-2 py-4.5 pb-8"
      >
        <div className="w-full">
          <Tabs defaultValue="brand" className="flex w-full">
            {/* Tabs header */}
            {/* <TabsList className="mx-auto h-12 rounded-full border border-white/30 !bg-[#0d0d0d]/50 p-1">
              <TabsTrigger
                value="brand"
                className="bg-transparent px-4 !text-sm !font-medium !text-[#d9d9d9] !outline-0 transition-all duration-200 focus-within:!border-0 hover:!text-white focus:!ring-0 data-[state=active]:!rounded-full data-[state=active]:!bg-[#3c3c3c] data-[state=active]:!text-white"
              >
                Describe Brand
              </TabsTrigger>
            </TabsList> */}
            <div className="text-center">Describe Brand</div>

            {/* Brand Content */}
            <TabsContent value="brand" className="mt-1 px-2">
              <div>
                <div className="grid gap-2">
                  <div className="grid gap-1">
                    <BrandSelect />
                  </div>

                  <div className="grid gap-1.5">
                    <label htmlFor="call-to-action" className="text-sm font-normal text-[#afafaf]">
                      Call to Action
                    </label>
                    <Input
                      id="call-to-action"
                      className="rounded-4xl border focus-within:border-white/50 focus:!ring-0 dark:bg-[#0d0d0d]/50"
                      onChange={(e) => {
                        dispatch(setFields({ cta: e.target.value }));
                      }}
                      placeholder="Enter Call to Action"
                      value={cta}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DescribeBrandDropdown;
