import { Eye, Download, DownloadCloud, MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { handleDownloadAs } from '@/utils/download';
import AdPreviewDialogMain from '../AdPreview/layout/AdPreviewDialogMain';
import { getAdText } from '@/utils/getAdText';
import { useSelector } from 'react-redux';
import AdPreviewPintMain from '../AdPreview/layout/AdPreviewPintMain';

const AdCreativeAction = ({ imageUrl, baseUrl, adText, userInput }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [open, setOpen] = useState(false);
  const { ad } = useSelector((state) => state.prompt);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleButtonClick = (network) => {
    setIsDialogOpen(true);
    setSelectedNetwork(network);
  };

  return (
    <>
      <div ref={ref} className="relative">
        <button
          className="bg-[#3c3c3c] flex items-center justify-center rounded-full p-1.5 text-white"
          // style={{ backgroundColor: '#000000' }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <MoreVertical className="h-4 w-4 text-white" />
        </button>

        {open && (
          <div
            className="absolute top-0 left-full z-[9999] ml-1 w-52 overflow-hidden rounded-md border border-black/10 bg-white shadow-lg dark:border-white/20 dark:bg-[#0D0D0D]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col">
              {!(
                userInput?.platform?.toLowerCase() === 'youtube' ||
                userInput?.platform?.toLowerCase() === 'linkedin' ||
                userInput?.platform?.toLowerCase() === 'reddit' ||
                userInput?.platform?.toLowerCase() === 'google_display_ads'
              ) && (
                <button
                  onClick={() => {
                    setOpen(false);
                    handleButtonClick(userInput?.platform || 'meta');
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  <Eye className="h-4 w-4" />
                  <span>Ad Preview</span>
                </button>
              )}
              {imageUrl && (
                <>
                  <button
                    onClick={() => {
                      setOpen(false);
                      handleDownloadAs(imageUrl, 'webp');
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download as WebP</span>
                  </button>
                  <button
                    onClick={() => {
                      setOpen(false);
                      handleDownloadAs(imageUrl, 'jpeg');
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download as JPEG</span>
                  </button>
                </>
              )}
              {baseUrl && (
                <>
                  <button
                    onClick={() => {
                      setOpen(false);
                      handleDownloadAs(baseUrl, 'webp');
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <DownloadCloud className="h-4 w-4" />
                    <span>Download (without logo) as WebP</span>
                  </button>
                  <button
                    onClick={() => {
                      setOpen(false);
                      handleDownloadAs(baseUrl, 'jpeg');
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#AFAFAF] dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <DownloadCloud className="h-4 w-4" />
                    <span>Download (without logo) as JPEG</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedNetwork === 'meta' ? (
        <AdPreviewDialogMain
          isDialogOpen={isDialogOpen}
          setIsDialogOpen={setIsDialogOpen}
          postOwner={ad?.postOwner}
          postOwnerImage={ad?.postOwnerImage}
          description={getAdText(adText)}
          image={imageUrl}
        />
      ) : selectedNetwork === 'pinterest' ? (
        <AdPreviewPintMain
          isDialogOpen={isDialogOpen}
          setIsDialogOpen={setIsDialogOpen}
          postOwner={ad?.postOwner}
          postOwnerImage={ad?.postOwnerImage}
          description={getAdText(adText)}
          image={imageUrl}
        />
      ) : null}
    </>
  );
};

export default AdCreativeAction;
