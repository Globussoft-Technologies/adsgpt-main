import { Download, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { handleDownloadAs } from '@/utils/download';

// Download picker for generated images. Instead of dumping the raw .webp, it
// converts client-side (via canvas) to the chosen format. Two shapes:
//   variant="icon"   → round icon button (image-grid hover overlay)
//   variant="button" → labelled "Download" pill (lightbox / larger surfaces)
const FORMATS = [
  { key: 'png', label: 'PNG' },
  { key: 'jpg', label: 'JPG' },
  { key: 'webp', label: 'WebP' },
];

const DownloadMenu = ({ url, variant = 'icon', className = '' }) => {
  if (!url) return null;

  const pick = (fmt) => handleDownloadAs(url, fmt);

  const trigger =
    variant === 'button' ? (
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.12]"
      >
        <Download className="h-3.5 w-3.5" />
        Download
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
    ) : (
      <button
        type="button"
        title="Download"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/85 backdrop-blur transition-colors hover:bg-black/80 hover:text-white ${className}`}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DropdownMenuTrigger>
      {/* z-[60]: must paint above the image-lightbox dialog overlay (z-55) —
          at the default z-50 the menu opens BEHIND the overlay and the
          Download button looks dead. */}
      <DropdownMenuContent align="end" className="z-[60] min-w-[9rem]">
        {FORMATS.map((f) => (
          <DropdownMenuItem
            key={f.key}
            onClick={(e) => {
              e.stopPropagation();
              pick(f.key);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Download as {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default DownloadMenu;
