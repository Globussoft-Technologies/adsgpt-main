import { motion } from 'framer-motion';
import { CornerDownRight } from 'lucide-react';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const UserMessage = ({ c, setLightboxOpen, handleReplyImageClick }) => {
  return (
    <motion.div
      variants={FADE_UP_ANIMATION_VARIANT}
      initial="initial"
      whileInView="whileInView"
      viewport={{ once: false }}
      className="flex justify-end gap-3"
    >
      <div className="ml-12 flex max-w-sm flex-col gap-2">
        {c?.edit_image?.image && (
          <div
            className="relative mr-2 flex cursor-pointer items-center gap-2"
            onClick={() =>
              handleReplyImageClick(
                c?.edit_image?.image,
                c?.edit_image?.botId,
                c?.edit_image?.adIndex
              )
            }
          >
            <CornerDownRight className="h-5 w-5 text-gray-500 dark:text-white" />
            <img
              src={`${S3_BASE_URL}${c?.edit_image?.image}`}
              alt="preview"
              className="h-[60px] w-[60px] rounded-sm border object-cover opacity-50"
            />
          </div>
        )}
        {c?.image && (
          <div className="image_container relative mb-2 flex justify-end">
            <img
              onClick={() => setLightboxOpen(`${S3_BASE_URL}${c?.image}`)}
              src={`${S3_BASE_URL}${c?.image}`}
              alt="user reference"
              className="h-52 cursor-pointer rounded-2xl object-cover transition-transform hover:scale-105"
            />
          </div>
        )}
        <div
          className="border border-[#2A2A2A] bg-[#212121] px-4 py-3 text-xs break-words 2xl:text-sm"
          style={{ borderRadius: '30px 30px 1px 30px' }}
        >
          {c?.message}
        </div>
      </div>
    </motion.div>
  );
};

export default UserMessage;
