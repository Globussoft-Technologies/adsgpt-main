import React from 'react';
import { motion } from 'framer-motion';
import welcomeAdVideoImageURL from '@/assets/layouts/prompt/advideo/welcome-advideo.webp';
import { fadeUpVariants, containerFadeUpVariants } from '@/utils/ui/framerMotionVariants';
import { useSelector } from 'react-redux';

const WelcomeAdVideo = () => {
  const { userData } = useSelector((state) => state.socket);
  return (
    <div className="welcome_ad_copy_container flex h-full items-center justify-center">
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
          className="mb-5 bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-2xl font-semibold text-transparent sm:mb-4 2xl:mb-8 2xl:text-3xl"
        >
          Hello, {userData?.user_name}
        </motion.h1>

        {/* Language support note */}
        <motion.p
          variants={fadeUpVariants}
          custom={1}
          className="mb-4 text-xs text-[#AFAFAF] 2xl:text-sm"
        >
          Type in English, हिंदी, தமிழ், or తెలుగు etc..— we understand all of them.
        </motion.p>

        {/* Cards */}
        <motion.div
          variants={fadeUpVariants}
          custom={2}
          className="flex w-full items-center justify-center"
        >
          <div className="home_initital_image_container lg:h-[48vh] xl:h-[52vh] 2xl:h-[55vh]">
            <img
              className="mx-auto h-full w-auto rounded-2xl object-contain"
              src={welcomeAdVideoImageURL}
            />
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default WelcomeAdVideo;
