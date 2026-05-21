import { motion } from 'framer-motion';
import chatResponseIcon from '@/assets/layouts/adstudio/chat-response-dark.svg';
import CreativeGeneratingLoader from '@/components/AdStudio/AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { useEffect, useState } from 'react';

const FADE_UP_ANIMATION_VARIANT = {
  initial: { opacity: 0, y: 10 },
  whileInView: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

const ChatWithBotInterface = () => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const endRef = null;

  // dummy data
  const conversations = [
    {
      id: 1,
      type: 'user',
      message: 'Yuji Itadori, brave high school student fighting curses.',
      image: 'https://i.ibb.co/mFy7tnv/user.jpg',
    },
    {
      id: 2,
      type: 'bot',
      reply: 'Here is your generated creative based on your prompt.',
      ads: [
        {
          id: 'img1',
          image: 'https://i.ibb.co/jv6q4pQq/craiyon-173248-Yuji-Itadori.png',
        },
      ],
    },
    {
      id: 3,
      type: 'user',
      message: 'Yuji Itadori, energetic and selfless hero.',
    },
    {
      id: 4,
      type: 'bot',
      reply: 'Done! Below is the creative based on your prompt.',
      ads: [
        { id: 'img2', image: 'https://i.ibb.co/jv6q4pQq/craiyon-173248-Yuji-Itadori.png' },
        { id: 'img3', image: 'https://i.ibb.co/jv6q4pQq/craiyon-173248-Yuji-Itadori.png' },
      ],
    },
  ];

  return (
    <div className="mb-10 flex w-full max-w-full flex-col gap-10 text-white">
      {conversations.map((c) => (
        <div key={c.id} className="space-y-6 px-0 pr-2">
          {/* USER */}
          {c.type === 'user' && (
            <motion.div
              variants={FADE_UP_ANIMATION_VARIANT}
              initial="initial"
              whileInView="whileInView"
              viewport={{ once: false }}
              className="flex justify-end gap-3"
            >
              <div className="ml-12 max-w-md">
                <div className="flex justify-end">
                  <span
                    style={{ borderRadius: '30px 30px 1px 30px' }}
                    className="flex w-fit justify-end border border-[#2A2A2A] bg-[#212121] px-5 py-4 text-xs 2xl:text-sm"
                  >
                    {c?.message}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* BOT */}
          {c.type === 'bot' && (
            <div className="flex justify-start gap-3.5">
              <div className="flex-shrink-0">
                <img src={chatResponseIcon} alt="Assistant" className="h-8 w-8" />
              </div>

              <div className="reply_bot_container mt-1.5 flex w-fit flex-col gap-3">
                {/* generated image list */}
                <div className="flex flex-col gap-5">
                  {c?.ads?.map((cr) =>
                    !isLoading ? (
                      <motion.div
                        key={cr?.id}
                        variants={FADE_UP_ANIMATION_VARIANT}
                        initial="initial"
                        whileInView="whileInView"
                        viewport={{ once: false }}
                        className="max-h-80 max-w-80 overflow-hidden rounded-2xl shadow-md sm:h-96 sm:w-96"
                      >
                        <img
                          src={cr?.image}
                          alt="generated"
                          className="h-full w-full cursor-pointer rounded-2xl object-cover"
                        />
                      </motion.div>
                    ) : (
                      <div className="relative h-64 w-64 overflow-hidden rounded-lg 2xl:h-72 2xl:w-72">
                        <div className="relative h-full w-full animate-pulse rounded-l-2xl bg-[#212121]">
                          <div className="absolute inset-0 flex items-center justify-center">
                            <CreativeGeneratingLoader />
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
                <motion.p
                  variants={FADE_UP_ANIMATION_VARIANT}
                  initial="initial"
                  whileInView="whileInView"
                  viewport={{ once: false }}
                  className="text-sm text-[#CCCCCC] 2xl:text-base"
                >
                  {c?.reply}
                </motion.p>
              </div>
            </div>
          )}
        </div>
      ))}

      <div ref={endRef} />
    </div>
  );
};

export default ChatWithBotInterface;
