import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Repeat,
  MoreVertical,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Bookmark,
  Volume2,
  RefreshCw,
  Loader2,
  X,
  PencilLine,
  Download,
  CornerDownRight,
  Loader,
  Pencil,
} from 'lucide-react';
import chatResponseIcon from '@/assets/layouts/adstudio/chat-response-dark.svg';
import { motion, AnimatePresence } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import AdCreativeEditorLightBox from './Lightbox/AdCreativeEditorLightBox';
import { useDispatch, useSelector } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import { clearTimer, setFeedBack } from '@/store/reducers/adStudio/adCreativeSlice';
import AdCreativeAction from '../Actions/AdCreativeAction';
import {
  handleCreativeRegenerateClick,
  updateFields,
} from '@/store/actions/adStudio/adCreativeActions';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const EXPIRED_URL = import.meta.env.VITE_EXPIRED_URL;
import { RiThumbUpFill, RiThumbDownFill } from 'react-icons/ri';
import ReadAloud from '@/components/common/ReadAloud';
import { resetEditorSlice, setEditorFields } from '@/store/reducers/adStudio/editorSlice';
import ShowLightBox from '@/components/common/ShowLightBox';
import UserMessage from './UserMessage';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import CreativeGeneratingLoader from './Loader/CreativeGeneratingLoader';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import { useSidebar } from '@/components/ui/sidebar';

const AdCreativeChat = () => {
  // const [copiedId, setCopiedId] = useState(null);

  const dispatch = useDispatch();
  const { conversations, timers } = useSelector((state) => state.adCreative);
  const { baseWithLogoImage } = useSelector((state) => state.editor);
  const { open: isSidebarOpen } = useSidebar();
  const { historyLoading } = useSelector((state) => state.adHistory);

  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations]);

  // const copyText = (text, id) => {
  //   navigator.clipboard.writeText(text).then(() => {
  //     setCopiedId(id);
  //     setTimeout(() => setCopiedId(null), 1500);
  //   });
  // };

  const openLightbox = (baseImage, logoImage, baseWithLogoImage, botId, adIndex, editorType) => {
    if (baseWithLogoImage == EXPIRED_URL) {
      window.open(import.meta.env.VITE_SIGNUP_URL, '_blank');
      return;
    }
    dispatch(
      setEditorFields({
        baseImage,
        logoImage,
        baseWithLogoImage,
        botId,
        adIndex,
        isEditorOpen: true,
        isOldEditorOpen: editorType === 'old' ? true : false,
      })
    );
  };

  const closeLightbox = () => {
    dispatch(resetEditorSlice());
  };

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (baseWithLogoImage) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [baseWithLogoImage]);

  const handleReplyImageClick = (editImagePath, convIndex, imageIndex) => {
    if (!editImagePath) return;
    const conv = conversations.find((c) => c?.id === convIndex);
    const image_ad = conv?.ads[imageIndex]?.image_ad;
    const imgEl = document.querySelector(`div.gen-image img[src*="${image_ad}"]`);
    if (imgEl) {
      imgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // sample show common lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeNormalLightbox = () => {
    setLightboxOpen(false);
  };

  const handleLikeDislike = (botId, currentFeedback, index, type) => {
    dispatch(
      setFeedBack({
        botId,
        index,
        feedback: currentFeedback === type ? null : type,
      })
    );
    dispatch(
      updateFields({
        botId,
        index,
        field: 'feedback',
        value: currentFeedback === type ? null : type,
      })
    );
  };

  const portraitRatios = ['3:4', '9:16'];
  const landscapeRatios = ['4:3', '16:9'];

  // Function to extract ratio and return class based on type
  const getImageRatioClass = (ratioText) => {
    const ratio = ratioText.replace('ASPECT_', '').replace('_', ':'); // ratioText : "ASPECT_4_3"
    if (portraitRatios.includes(ratio)) {
      return 'img-potrait-container h-[320px] max-sm:w-full max-w-[200px] max-sm:max-w-[100%] aspect-square relative';
    } else if (landscapeRatios.includes(ratio)) {
      return 'img-landscape-container w-[300px] h-[228px] max-sm:w-full max-w-[300px] max-sm:max-w-[100%] aspect-square relative';
    } else {
      return 'img-default-container w-[250px] h-[250px] aspect-square relative';
    }
  };

  return (
    <>
      {historyLoading ? (
        <div className="flex min-h-[75vh] w-full items-center justify-center">
          <Loader className="h-8 w-8 animate-spin text-gray-600" />
        </div>
      ) : (
        <div className="mb-10 flex w-full max-w-full flex-col gap-10 text-zinc-900 dark:text-white">
          {conversations.map((c) => (
            <div key={c?.id} className="space-y-6 px-0 pr-2">
              {/* USER */}
              {c?.type === 'user' && (
                <UserMessage
                  c={c}
                  setLightboxOpen={setLightboxOpen}
                  handleReplyImageClick={handleReplyImageClick}
                />
              )}

              {/* BOT */}
              {c.type === 'bot' && (
                <div className="flex justify-start gap-3">
                  <div className="flex-shrink-0">
                    <img
                      src={chatResponseIcon}
                      alt="Assistant"
                      className="h-6 w-6 2xl:h-8 2xl:w-8"
                    />
                  </div>
                  <div className="reply_bot_container flex w-full max-w-[500px] flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      {c?.ads?.map((cr, index) => (
                        <motion.div
                          key={cr.id}
                          variants={FADE_UP_ANIMATION_VARIANT}
                          initial="initial"
                          whileInView="whileInView"
                          viewport={{ once: false }}
                          className="rounded-2xl border border-zinc-200 bg-white shadow-md w-full dark:border-[#2A2A2A] dark:bg-[#111111]"
                        >
                          <div className="h-full w-full">
                            {/* Image */}
                            {cr?.image_complete ? (
                              <div className="gen-image relative h-[240px] w-full rounded-2xl">
                                {cr?.image_ad && cr?.image_ad?.includes('failed') ? (
                                  <p className="flex h-full w-full items-center justify-center rounded-2xl bg-zinc-100 p-4 text-center text-sm leading-7 text-zinc-700 dark:bg-slate-600/20 dark:text-white">
                                    Couldn't generate Ad Creative. However, your credit is not
                                    deducted. Please try again!
                                  </p>
                                ) : cr?.image_ad && cr?.image_ad == '400' ? (
                                  <p className="flex h-full w-full items-center justify-center rounded-2xl bg-zinc-100 p-4 text-center text-sm leading-7 text-zinc-700 dark:bg-slate-600/20 dark:text-white">
                                    Image request restricted for safety compliance. However, your
                                    credit is not deducted. Please revise your prompt and retry.
                                  </p>
                                ) : cr?.image_ad && cr?.image_ad?.includes('planExpired') ? (
                                  <div className="group relative h-full w-full">
                                    <a
                                      href={import.meta.env.VITE_SIGNUP_URL}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mb-2 h-32 w-32"
                                    >
                                      <img
                                        src={`${S3_BASE_URL}${EXPIRED_URL}`}
                                        alt="Restricted"
                                        className="adcreative_generated_image h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
                                      />
                                    </a>
                                  </div>
                                ) : (
                                  <div className="group relative h-full w-full">
                                    <div className="overflow-hidden rounded-2xl h-full w-full">
                                      <img
                                        src={`${S3_BASE_URL}${cr?.image_ad}`}
                                        alt={cr?.title}
                                        className="adcreative_generated_image h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-105"
                                        onClick={() =>
                                          openLightbox(
                                            cr?.base_image,
                                            cr?.logo,
                                            cr?.image_ad,
                                            c?.id,
                                            index,
                                            'old'
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="absolute bottom-2 left-2 rounded-full bg-white px-2 py-0.5 text-10 text-black font-bold  backdrop-blur-sm">
                                      Brand-aware applied
                                    </div>
                                    {EXPIRED_URL != cr?.image_ad && (
                                      <>
                                        {/* Top-right: Edit + three-dots */}
                                        <div className="absolute top-2 right-2 hidden opacity-0 transition-all duration-200 group-hover:flex group-hover:opacity-100">
                                          <div className="flex items-center gap-1">
                                            <div
                                              className="animated-border"
                                              style={{
                                                '--ab-width': 'fit-content',
                                                '--ab-height': 'fit-content',
                                                '--ab-radius': '9999px',
                                                '--ab-border-size': '2px',
                                                '--color-1': '#3c3c3c',
                                                '--color-3': '#FFFFFF',
                                                '--color-2': 'transparent',
                                                '--color-4': 'transparent',
                                              }}
                                            >
                                              <button
                                                onClick={() =>
                                                  openLightbox(
                                                    cr?.base_image,
                                                    cr?.logo,
                                                    cr?.image_ad,
                                                    c?.id,
                                                    index,
                                                    'new'
                                                  )
                                                }
                                                title="Edit"
                                                className="flex items-center justify-center rounded-full bg-[#3c3c3c] p-1.5 text-white hover:bg-black/80"
                                              >
                                                <Pencil size={15} />
                                              </button>
                                            </div>
                                            {cr?.image_ad &&
                                              cr?.image_ad != '400' &&
                                              !cr?.image_ad?.includes('failed') && (
                                                <AdCreativeAction
                                                  key={index}
                                                  imageUrl={`${S3_BASE_URL}${cr?.image_ad}`}
                                                  baseUrl={
                                                    cr?.base_image
                                                      ? `${S3_BASE_URL}${cr?.base_image}`
                                                      : ''
                                                  }
                                                  adText={cr?.text_ad}
                                                  userInput={c?.inputs}
                                                />
                                              )}
                                          </div>
                                        </div>
                                        {/* Bottom-right: Regenerate */}
                                        <div className="absolute bottom-2 right-2 hidden opacity-0 transition-all duration-200 group-hover:flex group-hover:opacity-100">
                                          <ShadcnTooltip label="Regenerate Creative">
                                            <button
                                              className="flex items-center justify-center rounded-full bg-[#3c3c3c] p-1.5 text-white hover:bg-black/80"
                                              onClick={() =>
                                                dispatch(
                                                  handleCreativeRegenerateClick(c?.inputs, isSidebarOpen)
                                                )
                                              }
                                            >
                                              <RefreshCw size={15} />
                                            </button>
                                          </ShadcnTooltip>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="h-60 w-full">
                                <div className="relative h-full w-full animate-pulse rounded-2xl bg-zinc-200 dark:bg-[#212121]">
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    {/* {timers[`${c?.id}-${index}`] ? (
                                    <div className="h-9 w-9 text-white">
                                      <CountdownCircleTimer
                                        isPlaying
                                        duration={timers[`${c?.id}-${index}`]?.duration || 100}
                                        initialRemainingTime={
                                          timers[`${c?.id}-${index}`]
                                            ? timers[`${c?.id}-${index}`]?.duration -
                                              Math.floor(
                                                (Date.now() -
                                                  timers[`${c?.id}-${index}`]?.startTime) /
                                                  1000
                                              )
                                            : 100
                                        }
                                        colors={['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF']}
                                        colorsTime={[7, 5, 2, 0]}
                                        size={50}
                                        strokeWidth={4}
                                        onComplete={() => {
                                          dispatch(clearTimer(`${c?.id}-${index}`));
                                        }}
                                      >
                                        {({ remainingTime }) => remainingTime}
                                      </CountdownCircleTimer>
                                    </div>
                                  ) : (
                                    <Loader2 className="h-9 w-9 animate-spin text-white" />
                                  )} */}
                                    <CreativeGeneratingLoader />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Right content — commented out */}
                            {/* <div className="flex w-full flex-1 flex-col justify-between p-4">
                              {cr?.text_complete ? (
                                <>
                                  <div className="contents_chat flex w-full flex-1 flex-col">
                                    <div className="relative mb-2 flex items-start justify-between">
                                      <h3 className="mb-2 text-sm font-semibold text-white 2xl:text-base">
                                        Ad Creative {index + 1}
                                      </h3>
                                    </div>
                                    <p className="flex-1 basis-0 overflow-y-auto text-sm max-sm:text-sm">
                                      <ReactMarkdown>{cr?.text_ad || ''}</ReactMarkdown>
                                    </p>
                                  </div>
                                  <div className="mt-3 flex items-center justify-end gap-0">
                                    <ShadcnTooltip label="Read Aloud">
                                      <button className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#2A2A2A]">
                                        <ReadAloud text={cr?.text_ad} />
                                      </button>
                                    </ShadcnTooltip>
                                    <ShadcnTooltip label="Copy">
                                      <button
                                        onClick={() => copyText(cr?.text_ad, `${c?.id}${index}`)}
                                        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#2A2A2A]"
                                      >
                                        {copiedId === `${c?.id}${index}` ? (
                                          <Check className="h-4 w-4" />
                                        ) : (
                                          <Copy className="h-4 w-4" />
                                        )}
                                      </button>
                                    </ShadcnTooltip>
                                  </div>
                                </>
                              ) : (
                                <div className="w-full animate-pulse space-y-4">
                                  <div className="h-4 w-1/3 rounded bg-slate-700"></div>
                                  <div className="w-full space-y-2">
                                    <div className="h-3 w-full rounded bg-slate-700"></div>
                                    <div className="h-3 w-11/12 rounded bg-slate-700"></div>
                                    <div className="h-3 w-10/12 rounded bg-slate-700"></div>
                                    <div className="h-3 w-1/2 rounded bg-slate-700"></div>
                                  </div>
                                </div>
                              )}
                            </div> */}


                          </div>
                        </motion.div>
                      ))}
                    </div>
                    {/* <motion.p
                    variants={FADE_UP_ANIMATION_VARIANT}
                    initial="initial"
                    whileInView="whileInView"
                    viewport={{ once: false }}
                    className="text-sm max-sm:text-sm"
                  >
                    <ReactMarkdown>{c?.end_message}</ReactMarkdown>
                  </motion.p> */}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div ref={endRef} />
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {baseWithLogoImage && <AdCreativeEditorLightBox closeLightbox={closeLightbox} />}
      </AnimatePresence>

      {/* light box show sample */}
      {lightboxOpen && (
        <ShowLightBox lightboxImage={lightboxOpen} closeLightbox={closeNormalLightbox} />
      )}
    </>
  );
};

export default AdCreativeChat;
