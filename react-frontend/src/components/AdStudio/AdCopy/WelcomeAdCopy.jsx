import { fetchSuggestions, submitAdCopyRequest } from '@/store/actions/adStudio/adCopyActions';
import { suggestionIcons } from '@/utils/ui/iconMap';
import { Lightbulb, Calendar, Megaphone } from 'lucide-react';
import { useEffect } from 'react';
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
          className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-2xl text-center font-semibold text-transparent mb-2 2xl:text-3xl"
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
        >
          Hello, {userData?.user_name}
        </motion.h1>

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
                className="animate-pulse rounded-2xl bg-gradient-to-tr from-transparent via-black/10 to-transparent p-[1px] dark:via-white/20"
                variants={fadeUpVariants}
              >
                <div className="flex h-40 flex-col gap-3 rounded-2xl border border-black/[0.04] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6 dark:border-transparent dark:bg-[#222222]/50 dark:shadow-none">
                  <div className="h-5 w-5 rounded bg-zinc-200 dark:bg-gray-600"></div>
                  <div className="h-3 w-3/4 rounded bg-zinc-200 dark:bg-gray-600"></div>
                  <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-gray-600"></div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Language support note */}
        <motion.p
          className="mb-8 text-center 2xl:mb-11 text-xs text-zinc-500 2xl:text-sm dark:text-[#AFAFAF]"
          variants={fadeUpVariants}
          initial="hidden"
          animate="visible"
        >
          Type in English, हिंदी, தமிழ், or తెలుగు etc..— we understand all of them.
        </motion.p>

        {/* Cards */}
        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3 md:gap-4 2xl:max-w-3xl 2xl:gap-6">
          {Array.isArray(suggestions) &&
            !suggestionsLoading &&
            suggestions.map((card, index) => {
              const Icon = suggestionIcons[card.icon];
              return (
                <div
                  className="group rounded-2xl from-transparent via-black/20 to-transparent p-[1px] transition-all duration-500 ease-in hover:bg-gradient-to-tr dark:via-white/30"
                  onClick={() => handleSuggestionClick(card.text)}
                  key={card?.id || index}
                >
                  <div className="group relative flex h-full cursor-pointer flex-col gap-6 rounded-2xl border border-black/[0.04] bg-white p-4 text-sm text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)] to-[#5771F6]/50 sm:p-6 group-hover:bg-zinc-50 dark:border-transparent dark:from-[#222222] dark:bg-[#222222]/50 dark:text-[#AFAFAF] dark:shadow-none dark:group-hover:bg-gradient-to-br">
                    <Icon className="h-5 w-5 text-[#6e7782] opacity-90 dark:text-white dark:opacity-70 dark:group-hover:text-[#5E66F5]" />
                    <p className="max-w-[176px] text-xs 2xl:text-sm">{card.text}</p>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default WelcomeAdCopy;
