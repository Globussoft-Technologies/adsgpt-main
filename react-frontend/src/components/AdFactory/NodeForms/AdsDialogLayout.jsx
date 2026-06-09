import { Dialog, DialogContent } from '@/components/ui/dialog';
import React, { useState } from 'react';
import AdFactoryBgEffect from './AdFactoryBgEffect';
import { AdCopyList } from '../Cards/AdCopyList';
import { AdCreativeList } from '../Cards/AdCreativeList';
import { AdVideoList } from '../Cards/AdVideoList';
// import ShowLightBox from '@/components/common/ShowLightBox';
import ImageFormatDialog from '@/components/BrandIQ/ImageFormating/ImageFormatDialog';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { motion } from 'framer-motion';
import { Download } from 'lucide-react';
import ShowLightBox from '../Cards/Lightbox';
// import { useSelector } from 'react-redux';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

import { PostAdDialogContent } from '../PostAd/PostAdDialogContent';

const AdsDialogLayout = ({ type, open, onOpenChange, handleDownloadWithFormat }) => {
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [images, setImages] = useState('');
  // const { results} = useSelector((state) => state?.adFactoryNew);
  // const currentImages = useMemo(() => results?.image || [], [results?.image]).map(
  //   (item) => `${S3_BASE_URL}${item.data}`
  // );
  // console.log(currentImages, 'currentImagescurrentImagescurrentImages');
  const handleOpenLightbox = (imageUrl, index, images) => {
    setLightboxImage(imageUrl);
    setImages(images);
    if (images !== undefined) {
      setLightboxOpen(true);
    }
  };

  const handleCloseLightbox = () => {
    setLightboxOpen(false);
    setLightboxImage(null);
  };

  const renderHeaderDownloadButton = (arg) => (
    <ShadcnTooltip label="Download image (with formatting options)">
      <motion.button
        onClick={(e) => {
          e.stopPropagation();
          handleDownloadWithFormat(arg);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 dark:bg-[#3B3B3B] text-gray-900 dark:text-white transition-all duration-300 hover:scale-110 hover:bg-gray-200 dark:hover:bg-[#4A4A4A] active:scale-95 2xl:h-8 2xl:w-8"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Download className="h-3 w-3 2xl:h-4 2xl:w-4" />
      </motion.button>
    </ShadcnTooltip>
  );
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="backdrop-blur-100 w-[96%] !max-w-3xl scale-100! overflow-hidden rounded-[30px] border border-black/10 bg-white text-gray-900 dark:border-white/10 dark:bg-[#303030]/50 dark:text-white px-6 pt-16 md:w-full 2xl:!max-w-5xl 2xl:pt-20">
          <div className="max-h-[calc(100svh-200px)] space-y-4 overflow-y-auto sm:px-6">
            {type === 'text' && <AdCopyList />}
            {type === 'image' && (
              <AdCreativeList
                onImageClick={handleOpenLightbox}
                renderHeaderDownloadButton={renderHeaderDownloadButton}
              />
            )}
            {type === 'video' && <AdVideoList />}
            {type === 'post-ad' && <PostAdDialogContent />}
          </div>
        </DialogContent>
      </Dialog>
      <AdFactoryBgEffect isGenerated={true} />
      {lightboxOpen && (
        <ShowLightBox
          lightboxImage={lightboxImage}
          closeLightbox={handleCloseLightbox}
          images={images}
        />
      )}
    </>
  );
};

export default AdsDialogLayout;
