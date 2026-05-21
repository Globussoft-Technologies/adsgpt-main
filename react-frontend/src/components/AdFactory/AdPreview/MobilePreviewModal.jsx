import { X } from 'lucide-react';
import MobilePreview from './MobilePreview';

const MobilePreviewModal = ({ open, onClose, creative }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-50 rounded-full bg-black/60 p-2 text-white"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Preview */}
      <div className="max-h-[90vh] overflow-auto">
        <MobilePreview
          image={creative?.image}
          text={creative?.text}
          cta={creative?.cta}
          ctaLink={creative?.ctaLink}
        />
      </div>
    </div>
  );
};

export default MobilePreviewModal;
