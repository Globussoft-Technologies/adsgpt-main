import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowRight,
  ChevronsRight,
  MessageCirclePlus,
  Mic,
  Plus,
  Search,
  Send,
  X,
} from 'lucide-react';
import addieIcon from '@/assets/layouts/addie-chats/addie.svg';
import chatResponseIcon from '@/assets/layouts/adstudio/chat-response-dark.svg';
import AddieWelcomeChat from './AddieWelcomeChat';
import AddiePrompt from './AddiePromptBox';
import {
  toggleAddieChatVisibility,
  setAddieConversation,
  resetAddieStates,
  setShowWelcomePage,
  setIsFreshUser,
  resetScrollState,
  setShowAdvertiserSearch,
  setSelectedBrands,
  setBrandInput,
  addBrand,
  removeBrand,
  clearBrands,
  setScrollLoading,
  setScrollSkip,
  toggleAddieHistory,
} from '@/store/reducers/adInsights/Addie/AddieChatBotSlice';
import { useDispatch, useSelector } from 'react-redux';
import PostOwnerLogo from '@/assets/layouts/addie-chats/postowner.svg';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { BiSolidMessageAdd } from 'react-icons/bi';
import { GiHamburgerMenu } from 'react-icons/gi';
import { TfiMenu } from 'react-icons/tfi';
import AddieHistory from './AddieHistory';
import { AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { getFaqData, submitAddieRequest } from '@/store/actions/adInsights/addieActions';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import { motion } from 'framer-motion';
import { createNewSessionAddie } from '@/store/reducers/adInsights/Addie/addieHistorySlice';
import { resetAddiePromptSlice } from '@/store/reducers/adInsights/Addie/addiePromptSlice';
import ImageCarousel from './ImageCarousel';

const AddieChatBotHome = () => {
  const dispatch = useDispatch();

  const spanRef = useRef(null);
  const messagesEndRef = useRef(null);

  const {
    isTyping,
    isLoading,
    showAddieHistory,
    conversations,
    showWelcomePage,
    faqData,
    faqLoading,
    showAdvertiserSearch,
    loading,
    selectedBrands = [],
    brandInput = '',
    suggestionAds,
  } = useSelector((state) => state?.addie);

  // Optimized auto-scroll
  useEffect(() => {
    const container = messagesEndRef?.current?.parentElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [conversations, isTyping, isLoading]);

  useEffect(() => {
    dispatch(getFaqData());
  }, [dispatch]);

  const handleAddieNewChatClick = () => {
    dispatch(createNewSessionAddie());
    dispatch(resetAddieStates());
    dispatch(resetAddiePromptSlice());
    dispatch(setIsFreshUser(true));
    dispatch(getFaqData());
    dispatch(setScrollLoading(false));
    dispatch(setScrollSkip(0));
    dispatch(clearBrands());
  };

  // Redux-based brand handlers
  const handleAddBrand = useCallback(
    (brand) => {
      dispatch(addBrand(brand));
    },
    [dispatch]
  );

  const handleRemoveBrand = useCallback(
    (brandToRemove) => {
      dispatch(removeBrand(brandToRemove));
    },
    [dispatch]
  );

  const handleBrandInputChange = useCallback(
    (value) => {
      dispatch(setBrandInput(value));
    },
    [dispatch]
  );

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && brandInput?.trim()) {
      handleAddBrand(brandInput);
    }
  };

  const getSearchQueryText = () => {
    // Use local computation instead of relying solely on Redux state
    const allBrands = [...selectedBrands];
    if (brandInput?.trim()) {
      allBrands.push(brandInput.trim());
    }

    if (allBrands.length === 0) {
      return 'Could you provide me with some popular ads from brands like';
    }

    const cleanBrands = allBrands
      .filter((brand) => brand?.trim()?.length > 0)
      .map((brand) => brand?.replace(/^,+|,+$/g, '').trim())
      .filter((brand) => brand?.length > 0);

    if (cleanBrands.length === 0) {
      return 'Could you provide me with some popular ads from brands like';
    }

    const brandsText = cleanBrands.join(', ');
    return `Could you provide me with some popular ads from ${cleanBrands.length === 1 ? 'brand' : 'brands'} like ${brandsText}`;
  };

  // Update the handleSearchSubmit function
  const handleSearchSubmit = useCallback(() => {
    if (selectedBrands?.length === 0 && !brandInput?.trim()) return;

    let finalBrands = [...selectedBrands];

    // Add current input to the brands list
    if (brandInput?.trim()) {
      finalBrands.push(brandInput.trim());
      // Also update Redux state
      dispatch(addBrand(brandInput.trim()));
    }

    // Generate query from the final brands array
    const cleanBrands = finalBrands
      .filter((brand) => brand?.trim()?.length > 0)
      .map((brand) => brand?.replace(/^,+|,+$/g, '').trim())
      .filter((brand) => brand?.length > 0);

    if (cleanBrands.length === 0) return;

    const brandsText = cleanBrands.join(', ');
    const query = `Could you provide me with some popular ads from ${cleanBrands.length === 1 ? 'brand' : 'brands'} like ${brandsText}`;

    // Submit the request
    dispatch(submitAddieRequest(query));
    dispatch(setShowAdvertiserSearch(false));

    // Clear brands after search with a slight delay to ensure the query is displayed
    setTimeout(() => {
      dispatch(clearBrands());
    }, 500);
  }, [selectedBrands, brandInput, dispatch]);

  const images = [
    {
      url: 'https://content-dev.poweradspy.com//PowerAdspy-Dev/fb/adImage/2025/90616.webp',
      type: 'image',
    },
    {
      url: 'https://content-dev.poweradspy.com//PowerAdspy-Dev/insta/adImage/2025/136899.webp',
      type: 'image',
    },
    {
      url: 'https://content-dev.poweradspy.com//PowerAdspy-Dev/fb/adImage/2025/90616.webp',
      type: 'image',
    },
    {
      url: 'https://content-dev.poweradspy.com//PowerAdspy-Dev/insta/adImage/2025/136899.webp',
      type: 'image',
    },
    {
      url: 'https://cdn.pixabay.com/video/2024/05/31/214669_large.mp4',
      type: 'video',
    },
    {
      url: 'https://content-dev.poweradspy.com//PowerAdspy-Dev/fb/adImage/2025/90616.webp',
      type: 'image',
    },
    {
      url: 'https://media.w3.org/2010/05/sintel/trailer_hd.mp4',
      type: 'video',
    },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-3xl border border-white/20 bg-[#0D0D0D]/50 backdrop-blur-[100px]">
      {/* Top header */}
      <div className="relative flex items-center justify-between bg-[#202020]/50 p-3 backdrop-blur-[80px] 2xl:p-5">
        <div className="action_button">
          <div
            id="tour_show_chat_history"
            className="icons_container flex items-center justify-center gap-3"
          >
            <ShadcnTooltip label="Close Addie">
              <button
                onClick={() => dispatch(toggleAddieHistory())}
                className="flex size-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-slate-700/40 2xl:size-9"
              >
                <TfiMenu className="size-5 text-[#AFAFAF] 2xl:size-6" />
              </button>
            </ShadcnTooltip>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <img src={addieIcon} alt="Addie" className="h-5 2xl:h-7" />
          <span className="bg-gradient-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-base font-semibold text-transparent 2xl:text-lg">
            Addie
          </span>
        </div>

        <div className="action_button">
          <div className="icons_container relative top-0 left-4 flex scale-75 items-center justify-center gap-2 2xl:inset-0 2xl:scale-100 2xl:gap-3">
            <ShadcnTooltip label="Search Advertiser">
              <button
                id="tour_search_advertiser"
                onClick={() => {
                  dispatch(setShowAdvertiserSearch(!showAdvertiserSearch));
                  dispatch(setShowWelcomePage(!showWelcomePage));
                  // Clear brands when toggling advertiser search
                  if (showAdvertiserSearch) {
                    dispatch(clearBrands());
                  }
                }}
                className="prompt_selection_button flex size-8 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-white 2xl:size-9"
              >
                <img src={PostOwnerLogo} className="size-5 2xl:size-6" />
              </button>
            </ShadcnTooltip>
            <ShadcnTooltip label="New Chat">
              <button
                id="tour_open_newchat"
                onClick={handleAddieNewChatClick}
                className="prompt_selection_button flex size-8 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-white 2xl:size-9"
              >
                <MessageCirclePlus className="size-4 text-[#AFAFAF] 2xl:size-5" />
              </button>
            </ShadcnTooltip>
            <ShadcnTooltip label="Close Addie">
              <button
                id="tour_close_addie"
                onClick={() => dispatch(toggleAddieChatVisibility())}
                className="prompt_selection_button flex size-8 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 hover:bg-white 2xl:size-9"
              >
                <ChevronsRight className="size-5 text-[#AFAFAF] 2xl:size-6" />
              </button>
            </ShadcnTooltip>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className={`flex flex-1 overflow-y-auto p-4 2xl:px-6 2xl:py-6`}>
        {showWelcomePage && Array.isArray(conversations) && conversations?.length === 0 ? (
          <AddieWelcomeChat faqData={faqData} isLoading={faqLoading} />
        ) : (
          <div className="addie_chats_container mx-auto w-full max-w-2xl space-y-6">
            {conversations?.map((msg, index) => (
              <div
                key={msg?.id}
                className={msg?.type === 'user' ? 'flex justify-end' : 'flex justify-start pb-5'}
              >
                {msg?.type === 'bot' && (
                  <>
                    <div className="mt-1 mr-3 flex h-6 w-6 items-center justify-center rounded-full">
                      <img src={chatResponseIcon} alt="bot" className="h-6 w-6" />
                    </div>
                    {!msg?.isFinalResponse && !msg?.message && (
                      <motion.div
                        variants={FADE_UP_ANIMATION_VARIANT}
                        initial="initial"
                        whileInView="whileInView"
                        viewport={{ once: false }}
                        className="relative flex w-full animate-pulse items-start justify-start gap-2"
                      >
                        <div className="mt-2 flex w-5/6 flex-col gap-1">
                          <div className="mb-1 h-2 w-9/4 rounded-full bg-slate-400 text-lg"></div>
                          <div className="mb-1 h-2 w-9/4 rounded-full bg-slate-400 text-lg"></div>
                          <div className="mb-1 h-2 w-9/5 rounded-full bg-slate-400 text-lg"></div>
                        </div>
                      </motion.div>
                    )}
                  </>
                )}

                {msg?.type === 'user' ? (
                  <div className="flex max-w-[75%] flex-col gap-4">
                    <div className="rounded-[10px_10px_0px_10px] bg-[#2A2A2A] px-4 py-2.5 text-xs text-white 2xl:text-sm">
                      {msg?.message}
                    </div>
                  </div>
                ) : (
                  <div className="w-[90%] rounded-2xl text-xs leading-6 text-[#AFAFAF] 2xl:text-sm">
                    <div className="max-w-[85%]">
                      {msg?.message?.split('\n')?.map((line, i) => (
                        <>
                          <p key={i} className={i === 0 ? '' : 'mt-2'}>
                            {line}
                          </p>

                          {isTyping &&
                            msg?.message &&
                            msg?.id === conversations[conversations?.length - 1]?.id &&
                            i === msg?.message?.split('\n')?.length - 1 && (
                              <div className="typing-indicator">
                                <div className="dot-indicator"></div>
                                <div className="dot-indicator"></div>
                                <div className="dot-indicator"></div>
                              </div>
                            )}
                        </>
                      ))}
                    </div>

                    {/* {!isTyping && <ImageCarousel slides={images} />} */}
                  </div>
                )}
              </div>
            ))}

            {/* 👉 for search advertiser  */}
            {showAdvertiserSearch && (
              <div className="flex justify-end">
                <div className="flex max-w-[75%] flex-col gap-2">
                  <div className="relative rounded-[10px_10px_0px_10px] bg-[#2A2A2A] px-4 py-2.5 text-xs text-white 2xl:text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{getSearchQueryText()}</span>

                      {/* Selected brands chips */}
                      {selectedBrands?.map((brand, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 rounded bg-[#3A3A3A] px-2 py-1"
                        >
                          {brand}
                          <button
                            onClick={() => handleRemoveBrand(brand)}
                            className="hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}

                      {/* Show pending input with loader */}
                      {brandInput?.trim() && (
                        <span className="inline-flex items-center gap-1 rounded bg-[#4A4A4A] px-2 py-1">
                          {brandInput}
                          <div className="ml-1 flex items-center">
                            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400"></div>
                            <div
                              className="mx-0.5 h-2 w-2 animate-pulse rounded-full bg-blue-400"
                              style={{ animationDelay: '0.2s' }}
                            ></div>
                            <div
                              className="h-2 w-2 animate-pulse rounded-full bg-blue-400"
                              style={{ animationDelay: '0.4s' }}
                            ></div>
                          </div>
                        </span>
                      )}

                      <Input
                        placeholder={
                          selectedBrands?.length === 0 ? 'Enter Brand Name' : 'Add another brand'
                        }
                        type="text"
                        value={brandInput}
                        onChange={(e) => handleBrandInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="h-6 w-32 max-w-fit rounded-sm px-2 text-xs text-[#AFAFAF] placeholder:text-xs placeholder:text-[#AFAFAF] focus-visible:ring-0"
                      />

                      {brandInput?.trim() && (
                        <button
                          className="plus_icon prompt_selection_button flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 hover:scale-105"
                          onClick={() => handleAddBrand(brandInput)}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {(selectedBrands?.length > 0 || brandInput?.trim()) && (
                      <div className="icons_ absolute right-1.5 bottom-1.5">
                        <button
                          className="plus_icon prompt_selection_button flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200 hover:scale-105"
                          onClick={handleSearchSubmit}
                        >
                          <Search className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom prompt input */}
      <AddiePrompt handleSearchSubmit={handleSearchSubmit} />

      {/* Addie History section */}
      <AnimatePresence initial={false} mode="wait">
        {showAddieHistory && <AddieHistory key="addie-history" />}
      </AnimatePresence>
    </div>
  );
};

export default AddieChatBotHome;
