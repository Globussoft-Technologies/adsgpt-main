import { Download, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { handleDownload } from '@/utils/download';
import toMediaUrl from '@/utils/mediaUrl';

// In-app full-size image viewer with a download action. Clicking a generated /
// uploaded image opens it here instead of a new browser tab, keeping the user
// inside the assistant. `src` is the raw (possibly S3-path) URL; we resolve it.
const ImageLightbox = ({ src, alt = '', onClose }) => {
  const open = !!src;
  const resolved = toMediaUrl(src);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[92vw] border-white/10 bg-[#0D0D0D]/95 p-3 sm:max-w-3xl sm:scale-100 2xl:max-w-4xl"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        {resolved && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => handleDownload(resolved)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.12]"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                type="button"
                onClick={() => onClose?.()}
                aria-label="Close"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={resolved}
              alt={alt}
              className="max-h-[80vh] w-full rounded-lg object-contain"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ImageLightbox;
