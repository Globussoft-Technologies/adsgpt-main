import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Eye, Download, DownloadCloud, Save, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { handleDownloadAs } from '@/utils/download';
import AdPreviewDialogMain from '../AdPreview/layout/AdPreviewDialogMain';
import { getAdText } from '@/utils/getAdText';
import { useSelector } from 'react-redux';
import AdPreviewPintMain from '../AdPreview/layout/AdPreviewPintMain';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const AdCreativeAction = ({ imageUrl, baseUrl, adText, userInput }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const { ad } = useSelector((state) => state.prompt);
  // const buttonsArray = [
  //   { label: 'Ad Preview', icon: <Eye className="h-4 w-4" /> },
  //   { label: 'Download', icon: <Download className="h-4 w-4" /> },
  //   { label: 'Download (without logo)', icon: <DownloadCloud className="h-4 w-4" /> },
  //   // { label: 'Save & Download', icon: <Save className="h-4 w-4" /> },
  // ];
  const [open, setOpen] = useState(false);
  const handleButtonClick = (network) => {
    setIsDialogOpen(true);
    setSelectedNetwork(network);
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="prompt_selection_button flex h-8 w-8 items-center justify-center rounded-full text-[#AFAFAF] hover:scale-105 hover:bg-[#2A2A2A]">
            <MoreVertical className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="backdrop-blur-100 w-fit border border-white/20 bg-[#0D0D0D]/50 p-0.5">
          <div className="flex flex-col space-y-0">
            {!(
              userInput?.platform?.toLowerCase() === 'youtube' ||
              userInput?.platform?.toLowerCase() === 'linkedin' ||
              userInput?.platform?.toLowerCase() === 'reddit'||
              userInput?.platform?.toLowerCase() === 'google_display_ads'
            ) && (
              <button
                onClick={() => {
                  setOpen(false);
                  handleButtonClick(userInput?.platform || 'meta');
                }}
                className="2xl:text-13 flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-[#AFAFAF] hover:text-white hover:dark:bg-slate-800/60"
              >
                <Eye className="h-4 w-4" />
                <span>Ad Preview</span>
              </button>
            )}
            {imageUrl && (
              <>
                <button
                  onClick={() => { setOpen(false); handleDownloadAs(imageUrl, 'webp'); }}
                  className="2xl:text-13 flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-[#AFAFAF] hover:text-white hover:dark:bg-slate-800/60"
                >
                  <Download className="h-4 w-4" />
                  <span>Download as WebP</span>
                </button>
                <button
                  onClick={() => { setOpen(false); handleDownloadAs(imageUrl, 'jpeg'); }}
                  className="2xl:text-13 flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-[#AFAFAF] hover:text-white hover:dark:bg-slate-800/60"
                >
                  <Download className="h-4 w-4" />
                  <span>Download as JPEG</span>
                </button>
              </>
            )}
            {baseUrl && (
              <>
                <button
                  onClick={() => { setOpen(false); handleDownloadAs(baseUrl, 'webp'); }}
                  className="2xl:text-13 flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-[#AFAFAF] hover:text-white hover:dark:bg-slate-800/60"
                >
                  <DownloadCloud className="h-4 w-4" />
                  <span>Download (without logo) as WebP</span>
                </button>
                <button
                  onClick={() => { setOpen(false); handleDownloadAs(baseUrl, 'jpeg'); }}
                  className="2xl:text-13 flex items-center gap-2 rounded-sm px-2.5 py-2 text-left text-xs text-[#AFAFAF] hover:text-white hover:dark:bg-slate-800/60"
                >
                  <DownloadCloud className="h-4 w-4" />
                  <span>Download (without logo) as JPEG</span>
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedNetwork === 'meta' ? (
        <AdPreviewDialogMain
          isDialogOpen={isDialogOpen}
          setIsDialogOpen={setIsDialogOpen}
          postOwner={ad?.postOwner}
          postOwnerImage={ad?.postOwnerImage}
          description={getAdText(adText)}
          image={imageUrl}
        />
      ) : selectedNetwork == 'pinterest' ? (
        <AdPreviewPintMain
          isDialogOpen={isDialogOpen}
          setIsDialogOpen={setIsDialogOpen}
          postOwner={ad?.postOwner}
          postOwnerImage={ad?.postOwnerImage}
          description={getAdText(adText)}
          image={imageUrl}
        />
      ) : (
        ''
      )}
    </>
  );
};

export default AdCreativeAction;
