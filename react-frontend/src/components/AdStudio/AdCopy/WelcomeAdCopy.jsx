import React, { useEffect } from 'react';
import { fetchSuggestions, submitAdCopyRequest } from '@/store/actions/adStudio/adCopyActions';
import { suggestionIcons } from '@/utils/ui/iconMap';
import { ArrowUpRight } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { containerFadeUpVariants, fadeUpVariants } from '@/utils/ui/framerMotionVariants';

const WelcomeAdCopy = () => {
  const dispatch = useDispatch();
  const { suggestions, suggestionsLoading } = useSelector((state) => state.adCopy);
  const { userData } = useSelector((state) => state.socket);

  useEffect(() => {
    dispatch(fetchSuggestions());
  }, [dispatch]);

  const handleSuggestionClick = (text) => {
    if (text) dispatch(submitAdCopyRequest(text));
  };

  return (
    <div className="welcome_ad_copy_container flex h-full items-center justify-center">
      <div className="flex w-full flex-col items-center justify-center">
        {/* Heading */}
        <motion.h1
          className="mb-2 text-center text-2xl font-semibold text-transparent bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text 2xl:text-3xl"
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
        >
          Hello, {userData?.user_name}
        </motion.h1>

        {/* Language support note */}
        <motion.p
          className="mb-8 text-center text-xs text-[#7A7369] 2xl:mb-11 2xl:text-sm dark:text-[#AFAFAF]"
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
        >
          Type in English, हिंदी, தமிழ், or తెలుగు etc..— we understand all of them.
        </motion.p>

        {/* Loader */}
        {suggestionsLoading && (
          <motion.div
            className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4 2xl:max-w-3xl 2xl:gap-6"
            variants={containerFadeUpVariants}
            initial="hidden"
            animate="visible"
          >
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className="rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] p-4 sm:p-6 dark:border-white/10 dark:bg-[#161616]"
                variants={fadeUpVariants}
              >
                <div className="flex h-36 flex-col gap-3 animate-pulse">
                  <div className="h-8 w-8 rounded-xl bg-[#EAE5DC] dark:bg-white/10" />
                  <div className="h-3 w-3/4 rounded bg-[#EAE5DC] dark:bg-white/10 mt-2" />
                  <div className="h-3 w-1/2 rounded bg-[#EAE5DC] dark:bg-white/10" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Cards */}
        {!suggestionsLoading && Array.isArray(suggestions) && (
          <motion.div
            className="grid w-full max-w-2xl grid-cols-1 gap-3.5 sm:grid-cols-3 md:gap-4.5 2xl:max-w-3xl 2xl:gap-6"
            variants={containerFadeUpVariants}
            initial="hidden"
            animate="visible"
          >
            {suggestions.map((card, index) => {
              const Icon = suggestionIcons[card.icon];
              return (
                <motion.div
                  key={card?.id || index}
                  variants={fadeUpVariants}
                  whileHover={{
                    y: -5,
                    transition: { type: 'spring', stiffness: 400, damping: 28 },
                  }}
                  whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
                  onClick={() => handleSuggestionClick(card.text)}
                  className="group relative flex h-full cursor-pointer flex-col justify-between rounded-2xl"
                >
                  {/* Layer 1: Ambient Soft Glow behind card (Fades in on hover) */}
                  <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#0c9fbd]/15 via-[#5057d6]/15 to-[#6b72f8]/15 opacity-0 blur-xl transition-opacity duration-500 ease-out group-hover:opacity-100 dark:from-[#15DCFF]/20 dark:via-[#5057d6]/15 dark:to-[#6b72f8]/20" />

                  {/* Main Card Surface */}
                  <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7]/95 p-4.5 text-sm shadow-[0_4px_20px_-2px_rgba(80,70,58,0.06),0_2px_6px_-1px_rgba(80,70,58,0.03)] backdrop-blur-xl transition-colors duration-300 group-hover:border-[#5057d6]/30 sm:p-5 2xl:p-6 dark:border-white/10 dark:bg-[#161616]/95 dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)] dark:group-hover:border-[#6b72f8]/40">
                    {/* Layer 2: Glass highlight gradient sheen */}
                    <div className="pointer-events-none absolute top-0 left-0 right-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/70 to-transparent opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100 dark:from-white/[0.04]" />

                    {/* Top Row: Icon + Arrow Indicator */}
                    <div className="relative z-10 flex items-start justify-between gap-2 mb-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EAE5DC] text-[#555048] shadow-xs ring-1 ring-[#DDD7CD]/60 transition-all duration-300 group-hover:scale-105 group-hover:bg-gradient-to-tr group-hover:from-[#0c9fbd] group-hover:to-[#5057d6] group-hover:text-white group-hover:ring-0 group-hover:shadow-[0_4px_14px_rgba(80,87,214,0.35)] dark:bg-white/[0.06] dark:text-white/70 dark:ring-0 dark:group-hover:from-[#15DCFF] dark:group-hover:to-[#6b72f8] dark:group-hover:text-white dark:group-hover:shadow-[0_4px_16px_rgba(107,114,248,0.4)]">
                        {Icon && <Icon className="h-4.5 w-4.5" />}
                      </div>

                      <div className="flex h-7 w-7 items-center justify-center rounded-full text-[#7A7369]/0 -translate-x-1 translate-y-1 transition-all duration-300 group-hover:text-[#5057d6] group-hover:translate-x-0 group-hover:translate-y-0 dark:group-hover:text-[#6b72f8]">
                        <ArrowUpRight className="h-4 w-4" />
                      </div>
                    </div>

                    {/* Bottom: Prompt text */}
                    <div className="relative z-10">
                      <p className="text-xs 2xl:text-[13px] font-medium leading-relaxed text-[#24211D] transition-colors duration-200 group-hover:text-black dark:text-[#E0E0E0] dark:group-hover:text-white">
                        {card.text}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default WelcomeAdCopy;


