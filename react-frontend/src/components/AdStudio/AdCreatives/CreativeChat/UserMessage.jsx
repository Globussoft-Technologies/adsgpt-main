import { motion } from 'framer-motion';
import { CornerDownRight } from 'lucide-react';
import { useState } from 'react';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;

const TRUNCATE_AT = 280;

const UserMessage = ({ c, setLightboxOpen, handleReplyImageClick }) => {
  const [expanded, setExpanded] = useState(false);
  const message = c?.message || '';
  const isLong = message.length > TRUNCATE_AT;
  const visibleMessage = !isLong || expanded ? message : `${message.slice(0, TRUNCATE_AT).trimEnd()}…`;
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
          className="border border-zinc-200 bg-zinc-100 px-4 py-3 text-xs break-words text-zinc-900 2xl:text-sm dark:border-[#2A2A2A] dark:bg-[#212121] dark:text-white"
          style={{ borderRadius: '30px 30px 1px 30px' }}
        >
          <span className="whitespace-pre-wrap">{visibleMessage}</span>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-1 cursor-pointer font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default UserMessage;
