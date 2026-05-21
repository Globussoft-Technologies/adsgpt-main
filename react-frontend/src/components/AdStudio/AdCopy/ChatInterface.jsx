import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader, Repeat, Send } from 'lucide-react';
import chatResponseIcon from '@/assets/layouts/adstudio/chat-response-dark.svg';
import ReactMarkdown from 'react-markdown';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import ReadAloud from '@/components/common/ReadAloud';
import { regenerateAdCopy } from '@/store/actions/adStudio/adCopyActions';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const ChatInterface = () => {
  const dispatch = useDispatch();
  const { conversations, isTyping, isLoading } = useSelector((state) => state.adCopy);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const { historyLoading } = useSelector((state) => state.adHistory);

  const messagesEndRef = useRef(null);

  // 🔽 Auto scroll when conversations update
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations, isTyping, isLoading]);

  const handleCopy = (text, messageId) => {
    navigator.clipboard
      .writeText(text)
      .then(() => handleShowTick(messageId))
      .catch((err) => {
        console.error('Failed to copy: ', err);
      });
  };

  // After copying show tick icon for 2 seconds
  const handleShowTick = (messageId) => {
    setCopiedMessageId(messageId);
    const timeout = setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
    return () => clearTimeout(timeout);
  };
  const handleRegenerateClick = (inputs) => {
    dispatch(regenerateAdCopy(inputs));
  };

  return (
    <div className="flex w-full max-w-full flex-col gap-10 text-white">
      {/* Chat Messages */}
      {historyLoading ? (
        <div className="flex min-h-[75vh] w-full items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      ) : (
        <>
          {Array.isArray(conversations) &&
            conversations.length > 0 &&
            conversations.map((conversation, index) => (
              <div className="space-y-6 px-0 pr-2" key={conversation?.id}>
                {/* User Message */}
                {conversation?.type === 'user' && (
                  <div className="flex justify-end gap-3">
                    <div className="ml-12 max-w-3xl">
                      <div
                        className="border border-solid border-[#2A2A2A] bg-[#212121] px-4 py-4 text-xs backdrop-blur-[100px] 2xl:text-sm"
                        style={{
                          borderRadius: '30px 30px 1px 30px',
                        }}
                      >
                        {conversation?.message || ''}
                      </div>
                    </div>
                  </div>
                )}

                {/* Assistant Message */}
                {conversation?.type === 'bot' && (
                  <div className="flex justify-start gap-3">
                    <div className="flex-shrink-0">
                      <img
                        src={chatResponseIcon}
                        alt="Assistant"
                        className="h-6 w-6 2xl:h-8 2xl:w-8"
                      />
                    </div>

                    {!conversation?.complete && !conversation?.message && (
                      <motion.div
                        variants={FADE_UP_ANIMATION_VARIANT}
                        initial="initial"
                        whileInView="whileInView"
                        viewport={{ once: false }}
                        className="relative flex w-full animate-pulse items-start justify-start gap-2"
                      >
                        {/* <div className="h-8 w-8 rounded-full bg-slate-400"></div> */}
                        <div className="flex w-4/5 flex-col gap-1">
                          <div className="mb-1 h-6 w-4/5 rounded-full bg-slate-400 text-lg"></div>
                          <div className="mb-1 h-6 w-4/5 rounded-full bg-slate-400 text-lg"></div>
                          <div className="mb-1 h-6 w-3/5 rounded-full bg-slate-400 text-lg"></div>
                        </div>
                      </motion.div>
                    )}

                    {conversation?.message && (
                      <div className="mr-12 max-w-3xl">
                        <div className="text-xs leading-relaxed 2xl:text-sm">
                          <div className="prose prose-invert prose-sm flex max-w-none flex-col gap-2">
                            <ReactMarkdown>{conversation?.message || ''}</ReactMarkdown>
                            {isTyping && index === conversations.length - 1 && (
                              <div className="typing-indicator">
                                <div className="dot"></div>
                                <div className="dot"></div>
                                <div className="dot"></div>
                              </div>
                            )}
                            {conversation?.complete && (
                              <div className="chat_actions_container z-0 flex gap-1 shadow-none">
                                <ShadcnTooltip label="Read a Loud">
                                  <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full from-[#222222] to-[#5771F6] hover:bg-gradient-to-br">
                                    <ReadAloud text={conversation?.message} />
                                  </span>
                                </ShadcnTooltip>
                                <ShadcnTooltip label="Copy Response">
                                  <span className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full from-[#222222] to-[#5771F6] hover:bg-gradient-to-br">
                                    {copiedMessageId === index ? (
                                      <Check className="z-[5555] h-4 w-4 cursor-pointer text-black/80 shadow-none focus:outline-none dark:text-white" />
                                    ) : (
                                      <Copy
                                        className="z-[5555] h-4 w-4 cursor-pointer text-black/80 shadow-none focus:outline-none dark:text-white"
                                        onClick={() => handleCopy(conversation?.message, index)}
                                      />
                                    )}
                                  </span>
                                </ShadcnTooltip>
                                <ShadcnTooltip label="Regenerate">
                                  <span
                                    onClick={() => handleRegenerateClick(conversation?.inputs)}
                                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full from-[#222222] to-[#5771F6] hover:bg-gradient-to-br"
                                  >
                                    <Repeat className="z-[5555] h-4 w-4 cursor-pointer text-black/80 shadow-none focus:outline-none dark:text-white" />
                                  </span>
                                </ShadcnTooltip>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
        </>
      )}

      {/* {isLoading && (
        <motion.div
          variants={FADE_UP_ANIMATION_VARIANT}
          initial="initial"
          whileInView="whileInView"
          viewport={{ once: false }}
          className="relative flex w-full animate-pulse items-start justify-start gap-2 p-4"
        >
          <div className="h-8 w-8 rounded-full bg-slate-400"></div>
          <div className="flex w-4/5 flex-col gap-1">
            <div className="mb-1 h-6 w-4/5 rounded-full bg-slate-400 text-lg"></div>
            <div className="mb-1 h-6 w-4/5 rounded-full bg-slate-400 text-lg"></div>
            <div className="mb-1 h-6 w-3/5 rounded-full bg-slate-400 text-lg"></div>
          </div>
        </motion.div>
      )} */}
      {/* 🔽 Dummy element for scroll target */}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatInterface;
