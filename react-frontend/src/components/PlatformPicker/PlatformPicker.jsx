import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { getAdAccounts, getUserAdPostingInfo } from '@/apis/metaAds/metaAdsApi';
import { checkTiktokAccount } from '@/apis/tikTokAds/tikTokAdsApi';
import getCookies from '@/utils/getCookies';
import metaIcon from '@/assets/layouts/appsidebar/meta-icon.svg';
import googleAdsIcon from '@/assets/layouts/google-ads-icon.png';
import tiktokIcon from '@/assets/layouts/appsidebar/tiktok-icon.jpg';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

/**
 * Shared platform picker — Meta, Google Ads, and TikTok cards. Used as the
 * home for both Ads Manager (`/ads-manager`) and Autopilot (`/autopilot`).
 * Caller passes the destination route the Meta card should navigate to once
 * Meta is connected.
 *
 * Props
 *   metaDestination  required  Where to send the user when they click the
 *                              Meta card AND Meta is connected.
 *   title            optional  H1 above the cards. Defaults to "Choose Your
 *                              Ad Platform".
 *   subtitle         optional  Sub-line under the H1. Defaults to "Select
 *                              where you want to launch your ads".
 */
const PlatformPicker = ({
  metaDestination,
  title = 'Choose Your Ad Platform',
  subtitle = 'Select where you want to launch your ads',
  // googleComingSoon = false,
  googleComingSoon = false,
  tiktokComingSoon = import.meta.env.VITE_TIKTOK_COMING_SOON !== 'true',
}) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedPlatform = searchParams.get('connect');
  const [metaConnected, setMetaConnected] = useState(false);
  const [checkingMeta, setCheckingMeta] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [checkingTiktok, setCheckingTiktok] = useState(true);
  const [hoveredCard, setHoveredCard] = useState(null);
  const { userData } = useSelector((state) => state.socket);

  useEffect(() => {
    const userId = userData?.user_id;
    if (!userId) return;

    // Meta connection check
    (async () => {
      try {
        await getUserAdPostingInfo(userId);
        const res = await getAdAccounts();
        setMetaConnected(!!(res.adAccounts && res.adAccounts.length > 0));
      } catch (err) {
        setMetaConnected(false);
      } finally {
        setCheckingMeta(false);
      }
    })();

    // Google connection check
    (async () => {
      try {
        const res = await axios.get(`${BASE_URL}/adsgpt/google-ads/check-account`, {
          headers: { Authorization: `Bearer ${getCookies()}` },
        });
        setGoogleConnected(!!(res.data?.isConnected && res.data?.hasAccount));
      } catch {
        setGoogleConnected(false);
      } finally {
        setCheckingGoogle(false);
      }
    })();

    // TikTok connection check (skip if the card is in "Coming Soon" mode)
    if (!tiktokComingSoon) {
      (async () => {
        try {
          const res = await checkTiktokAccount();
          setTiktokConnected(!!(res?.isConnected && res?.hasAccount));
        } catch {
          setTiktokConnected(false);
        } finally {
          setCheckingTiktok(false);
        }
      })();
    } else {
      setCheckingTiktok(false);
    }
  }, [userData?.user_id]);

  const handleMetaConnect = () => {
    const feUrl = window.location.href;
    const userId = userData?.user_id;
    if (!userId) return;
    window.location.href = `${BASE_URL}/api/auth/facebook?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleGoogleConnect = () => {
    const userId = userData?.user_id;
    if (!userId) return;
    const feUrl = window.location.href;
    window.location.href = `${BASE_URL}/api/auth/google?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleTiktokConnect = () => {
    const userId = userData?.user_id;
    if (!userId) return;
    const feUrl = window.location.href;
    window.location.href = `${BASE_URL}/api/auth/tiktok?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleMetaCardClick = () => {
    if (metaConnected && metaDestination) {
      navigate(metaDestination);
    }
  };

  const handleGoogleCardClick = () => {
    if (googleConnected) {
      navigate('/google-ads');
    }
  };

  const handleTiktokCardClick = () => {
    if (tiktokConnected) {
      navigate('/tiktok-ads');
    }
  };

  const platforms = [
    {
      id: 'meta',
      name: 'Meta',
      description: 'Best for massive reach that converts broad audiences into loyal customers',
      enabled: true,
      logo: (
        <div className="flex items-center gap-3">
          <img src={metaIcon} alt="Meta" className="h-10 w-10 shrink-0" />
          <span className="text-2xl font-semibold tracking-tight text-[#1C2B33]">Meta</span>
        </div>
      ),
    },
    {
      id: 'google',
      name: 'Google Ads',
      description: 'Reach customers across Google Search, YouTube, and the web',
      enabled: !googleComingSoon,
      logo: (
        <div className="flex items-center gap-3">
          <img src={googleAdsIcon} alt="Google Ads" className="h-12 w-12 shrink-0" />
          <span className="text-2xl font-semibold tracking-tight text-[#1C2B33]">Google Ads</span>
        </div>
      ),
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      description: 'Best for turning entertainment into viral demand and purchases',
      enabled: !tiktokComingSoon,
      logo: (
        <div className="flex items-center gap-3">
          <img src={tiktokIcon} alt="TikTok" className="h-12 w-12 shrink-0" />
          <span className="text-2xl font-bold tracking-tight text-[#1C2B33]">TikTok</span>
        </div>
      ),
    },
  ];

  return (
    <div className="relative mt-25 flex h-full w-full flex-col overflow-auto">
      <div className="relative z-10 flex flex-col items-center px-6 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-10 text-center"
        >
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-[#AFAFAF]">{subtitle}</p>
        </motion.div>

        {/* Cards Grid */}
        <div className="mt-10 grid w-full max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform, index) => {
            const isMetaPlatform = platform.id === 'meta';
            // When Google is "Coming Soon" (Autopilot), treat it like an
            // inactive card — no connect overlay, no navigation.
            const isGooglePlatform = platform.id === 'google' && !googleComingSoon;
            const isTiktokPlatform = platform.id === 'tiktok' && !tiktokComingSoon;
            const isHovered = hoveredCard === platform.id;
            const isRequested = requestedPlatform === platform.id;
            const isConnected = isMetaPlatform
              ? metaConnected
              : isGooglePlatform
                ? googleConnected
                : isTiktokPlatform
                  ? tiktokConnected
                  : false;
            const isChecking = isMetaPlatform
              ? checkingMeta
              : isGooglePlatform
                ? checkingGoogle
                : isTiktokPlatform
                  ? checkingTiktok
                  : false;

            const handleClick =
              isMetaPlatform && metaConnected
                ? handleMetaCardClick
                : isGooglePlatform && googleConnected
                  ? handleGoogleCardClick
                  : isTiktokPlatform && tiktokConnected
                    ? handleTiktokCardClick
                    : undefined;

            return (
              <motion.div
                key={platform.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                onMouseEnter={() => setHoveredCard(platform.id)}
                onMouseLeave={() => setHoveredCard(null)}
                onClick={handleClick}
                className={`relative overflow-hidden rounded-2xl border border-gray-200 transition-all duration-300 dark:border-transparent ${
                  platform.enabled
                    ? `${isConnected ? 'cursor-pointer' : 'cursor-default'} shadow-md hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/10 dark:hover:shadow-black/40`
                    : 'cursor-not-allowed'
                }`}
              >
                {/* White logo area */}
                <div className="relative flex h-40 items-center justify-center bg-white transition-all duration-300">
                  {platform.logo}

                  {/* A routed connection request keeps the action visible; normal
                      platform browsing reveals it on hover. */}
                  {(isMetaPlatform || isGooglePlatform || isTiktokPlatform) &&
                    !isConnected &&
                    !isChecking &&
                    (isHovered || isRequested) && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/40"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMetaPlatform) handleMetaConnect();
                            else if (isGooglePlatform) handleGoogleConnect();
                            else if (isTiktokPlatform) handleTiktokConnect();
                          }}
                          className="rounded-lg bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-sm font-semibold text-white shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                        >
                          Connect {platform.name}
                        </button>
                      </motion.div>
                    )}
                </div>

                {/* Dark info area */}
                <div className="bg-gray-50 p-4 dark:bg-[#1A1A1A]">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 2xl:text-base dark:text-white">
                      {platform.name}
                    </h3>
                    {!platform.enabled && (
                      <span className="2xl:text-5 rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase shadow-md">
                        Coming Soon
                      </span>
                    )}
                    {isConnected && (
                      <span className="flex items-center gap-1 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:border-emerald-500/30 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500 2xl:text-sm dark:text-[#AFAFAF]">
                    {platform.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PlatformPicker;
