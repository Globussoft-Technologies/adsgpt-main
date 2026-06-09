import React, { useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import AdVideoCard from './AdVideoCard';
import { motion } from 'framer-motion';
import welcomeAdVideoImageURL from '@/assets/layouts/prompt/advideo/welcome-advideo.webp';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';
import { useDispatch, useSelector } from 'react-redux';
import { fetchProcessingCount } from '@/store/actions/adVideoNew/Advideoactions';

const cards = [
  {
    title: 'AI ADS',
    desc: 'Create full length AI Ad videos',
    img: '/static/adVideo/ai_ads_thumb.jpg',
    gif: '/static/adVideo/ai_ads.gif',
    type: 'ai-ads',
    // comingSoon: true,
  },
  {
    title: 'AI UGC ADS',
    desc: 'Create AI UGC Ad videos',
    img: '/static/adVideo/ai-ugc-ads-photo.jpg',
    gif: '/static/adVideo/ai-ugc-ads-gif.gif',
    type: 'ugc',
  },
  {
    title: 'PRODUCT B-ROLLS',
    desc: 'Create cinematic b-rolls for your products',
    img: '/static/adVideo/product-b-rolls-photo.jpg',
    gif: '/static/adVideo/b-rolls-gif-1.gif',
    type: 'b-roll',
  },
  {
    title: 'AI AVATARS',
    desc: 'Create ad videos with custom avatars',
    img: '/static/adVideo/ai-avatars-photo.jpg',
    gif: '/static/adVideo/ai-avatars-gif.gif',
    type: 'avatar',
    // comingSoon: true,
  },
  {
    title: 'CLONE YOURSELF',
    desc: 'Create AI ad videos with your face and voice',
    img: '/static/adVideo/clone-yourself-photo.jpg',
    gif: '/static/adVideo/clone-yourself-gif.gif',
    type: 'clone',
  },
];

const AdVideoHomeNew = () => {
  const { userData } = useSelector((state) => state.socket);
  const userName = userData?.user_name || 'User';
  const dispatch = useDispatch();
  const { savedCount } = useSelector((state) => state.adVideoNew);

  useEffect(() => {
    dispatch(fetchProcessingCount());
  }, [dispatch, savedCount]);

  return (
    <div className="layout_for_chat mx-auto h-full min-h-[55vh] w-full sm:p-0 2xl:min-h-[60vh]">
      <div>
        <div className="welcome_ad_copy_container flex h-full w-full items-center justify-center">
          <motion.div
            variants={containerFadeUpVariants}
            initial="hidden"
            animate="visible"
            className="mt-3 flex w-full flex-col items-center justify-center 2xl:mt-14"
          >
            {/* Heading */}
            <motion.h1
              variants={fadeUpVariants}
              custom={0}
              className="mb-2 bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-2xl font-semibold text-transparent 2xl:mb-4 2xl:text-4xl"
            >
              Hello, {userName}
            </motion.h1>

            <motion.p
              variants={fadeUpVariants}
              custom={1}
              className="mb-6 text-center text-sm text-zinc-600 2xl:mb-8 2xl:text-base dark:text-[#BEBEBE]"
            >
              Create scroll-stopping Video ads with AI <br />
              that understands your business.
            </motion.p>

            <motion.div
              variants={fadeUpVariants}
              custom={2}
              className="flex w-full items-center justify-center pb-4 lg:h-[48vh] xl:h-[52vh] 2xl:h-[55vh]"
            >
              <div className="grid h-full w-full max-w-[650px] gap-2 grid-cols-2 lg:max-w-[1000px] lg:grid-cols-3 2xl:max-w-[1240px]">
                {cards.map((card, index) => (
                  //  <div key={card.title} className={`${index === 0 || index === 2 ? 'row-span-2' : ''}`}>
                    <div key={card.title} className={`${index === 0 ? 'row-span-2' : ''}`}>
                    <AdVideoCard {...card} />
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AdVideoHomeNew;
