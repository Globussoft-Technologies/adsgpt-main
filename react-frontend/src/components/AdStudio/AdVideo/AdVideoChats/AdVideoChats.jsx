import React, { useEffect, useRef, useState } from 'react';
import chatResponseIcon from '@/assets/layouts/adstudio/chat-response-dark.svg';
import { motion, AnimatePresence } from 'framer-motion';
import { FADE_UP_ANIMATION_VARIANT } from '@/utils/ui/framerMotionVariants';
import { useSelector } from 'react-redux';
import CreativeGeneratingLoader from '../../AdCreatives/CreativeChat/Loader/CreativeGeneratingLoader';
import { saveVideoAndRedirect } from '@/utils/VideoRedirect';
import { Edit } from 'lucide-react';
import ShowLightBox from '@/components/common/ShowLightBox';
import CustomVideoPlayer from './CustomVideoPlayer';
const S3_BASE_URL = import.meta.env.VITE_S3_BASE_URL;
const NAS_VIEW_URL = import.meta.env.VITE_NAS_BASE_URL;
const EXPIRED_URL = import.meta.env.VITE_EXPIRED_URL;
const CREDIT_EXCEEDED_URL = import.meta.env.VITE_CREDIT_EXCEEDED_URL;
const CREDIT_VARIATION_URL = import.meta.env.VITE_CREDIT_VARIATION_URL;

const AdVideoChats = () => {
  const { conversations } = useSelector((state) => state.adVideo);
  const [lightboxImage, setLightboxImage] = useState(null);

  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations]);

  const openLightbox = (imageUrl) => {
    setLightboxImage(imageUrl);
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (lightboxImage) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [lightboxImage]);

  return (
    <>
      <div className="mb-10 flex w-full max-w-full flex-col gap-10 text-white">
        {conversations?.map((c) => (
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
                <div className="ml-12 max-w-sm">
                  {c?.image && (
                    <div className="image_container relative mb-2 flex justify-end">
                      <img
                        src={`${S3_BASE_URL}${c?.image}`}
                        alt="user reference"
                        className="h-52 cursor-pointer rounded-2xl object-cover transition-transform"
                        onClick={() => openLightbox(`${S3_BASE_URL}${c?.image}`)}
                      />
                    </div>
                  )}
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
                  <motion.p
                    variants={FADE_UP_ANIMATION_VARIANT}
                    initial="initial"
                    whileInView="whileInView"
                    viewport={{ once: false }}
                    className="text-sm text-[#CCCCCC] italic 2xl:text-base"
                  ></motion.p>
                  <div className="flex flex-col gap-5">
                    {c?.ads?.map((cr) => (
                      <motion.div
                        key={cr?.id}
                        variants={FADE_UP_ANIMATION_VARIANT}
                        initial="initial"
                        whileInView="whileInView"
                        viewport={{ once: false }}
                        className="h-96 max-h-80 w-96 max-w-80 overflow-hidden rounded-2xl shadow-md"
                      >
                        {/* EXACT LAYOUT: image left, content right */}
                        <div className="flex h-full w-full">
                          {/* Left video with rounded-left corners */}
                          {cr?.video_complete ? (
                            <div className="relative h-full w-full">
                              {cr?.video_ad && cr?.video_ad?.includes('failed') ? (
                                <p className="advideo flex h-full w-full items-center bg-slate-600/20 p-2 text-center leading-7">
                                  Couldn't generate Ad Video. However, your credit is not deducted.
                                  Please try again!
                                </p>
                              ) : cr?.video_ad && cr?.video_ad == '400' ? (
                                <p className="ad_video flex h-full w-full items-center bg-slate-600/20 p-2 text-center leading-7">
                                  Video request restricted for safety compliance. However, your
                                  credit is not deducted. Please revise your prompt and retry.
                                </p>
                              ) : cr?.video_ad && cr?.video_ad?.includes('planExpired') ? (
                                <div className="ad_video flex h-full w-full items-center justify-center bg-slate-600/20">
                                  <a
                                    href={import.meta.env.VITE_SIGNUP_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-full w-full"
                                  >
                                    <img
                                      src={`${S3_BASE_URL}${EXPIRED_URL}`}
                                      alt="Plan Expired"
                                      className="h-full w-full cursor-pointer rounded-2xl object-cover"
                                    />
                                  </a>
                                </div>
                              ) : cr?.video_ad && cr?.video_ad?.includes('creditErr') ? (
                                <div className="ad_video flex h-full w-full items-center justify-center bg-slate-600/20">
                                  <a
                                    href={import.meta.env.VITE_SIGNUP_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-full w-full"
                                  >
                                    <img
                                      src={`${S3_BASE_URL}${CREDIT_VARIATION_URL}`}
                                      alt="Plan Expired"
                                      className="h-full w-full cursor-pointer rounded-2xl object-cover"
                                    />
                                  </a>
                                </div>
                              ) : cr?.video_ad && cr?.video_ad?.includes('creditZero') ? (
                                <div className="ad_video flex h-full w-full items-center justify-center bg-slate-600/20">
                                  <a
                                    href={import.meta.env.VITE_SIGNUP_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-full w-full"
                                  >
                                    <img
                                      src={`${S3_BASE_URL}${CREDIT_EXCEEDED_URL}`}
                                      alt="Plan Expired"
                                      className="h-full w-full cursor-pointer rounded-2xl object-cover"
                                    />
                                  </a>
                                </div>
                              ) : (
                                <>
                                  {/* <video
                                    src={`${S3_BASE_URL}${cr?.video_ad}`}
                                    className="adcreative_generated_image h-full w-full cursor-pointer object-cover transition-transform"
                                    //  onClick={() => openLightbox(cr.video_ad)}
    controls
    playsInline
                                  ></video> */}

                                  <CustomVideoPlayer
                                    src={`${S3_BASE_URL}${cr?.video_ad}`}
                                    aspect={cr?.aspect_ratio}
                                  />

                                  {/* <button
                                    onClick={() =>
                                      saveVideoAndRedirect(`${S3_BASE_URL}${cr?.video_ad}`)
                                    }
                                    className="absolute top-3 right-3 rounded-full p-2 text-white shadow-lg transition hover:bg-blue-100"
                                    title="Edit Video"
                                  >
                                    <Edit className="h-5 w-5 text-black" />
                                  </button> */}
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="relative h-full w-full">
                              <div className="relative h-full w-full animate-pulse rounded-l-2xl bg-[#212121]">
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <CreativeGeneratingLoader />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        <div ref={endRef} />
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxImage && (
          <ShowLightBox lightboxImage={lightboxImage} closeLightbox={closeLightbox} />
        )}
      </AnimatePresence>
    </>
  );
};

export default AdVideoChats;
