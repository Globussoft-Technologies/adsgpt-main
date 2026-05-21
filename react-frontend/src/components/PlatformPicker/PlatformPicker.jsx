import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSelector } from 'react-redux';
import { getAdAccounts, getUserAdPostingInfo } from '@/apis/metaAds/metaAdsApi';
import metaIcon from '@/assets/layouts/appsidebar/meta-icon.svg';
import googleAdsIcon from '@/assets/layouts/google-ads-icon.png';
import tiktokIcon from '@/assets/layouts/appsidebar/tiktok-icon.jpg';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

/**
 * Shared platform picker — three cards (Meta enabled, Google + TikTok
 * "Coming Soon"). Used as the home for both Ads Manager (`/ads-manager`)
 * and Autopilot (`/autopilot`). Caller passes the destination route the
 * Meta card should navigate to once Meta is connected.
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
}) => {
  const navigate = useNavigate();
  const [metaConnected, setMetaConnected] = useState(false);
  const [checkingMeta, setCheckingMeta] = useState(true);
  const [hoveredCard, setHoveredCard] = useState(null);
  const { userData } = useSelector((state) => state.socket);

  useEffect(() => {
    const userId = userData?.user_id;
    if (!userId) return;
    (async () => {
      try {
        await getUserAdPostingInfo(userId);
        const res = await getAdAccounts();
        setMetaConnected(!!(res.adAccounts && res.adAccounts.length > 0));
      } catch (err) {
        // 404 means token expired / user not found — force reconnect
        if (err?.response?.status === 404) {
          setMetaConnected(false);
        } else {
          setMetaConnected(false);
        }
      } finally {
        setCheckingMeta(false);
      }
    })();
  }, [userData?.user_id]);

  const handleMetaConnect = () => {
    const feUrl = window.location.href;
    const userId = userData?.user_id;
    if (!userId) return;
    window.location.href = `${BASE_URL}/api/auth/facebook?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleMetaCardClick = () => {
    if (metaConnected && metaDestination) {
      navigate(metaDestination);
    }
  };

  const platforms = [
    {
      id: 'meta',
      name: 'Meta',
      description:
        'Best for massive reach that converts broad audiences into loyal customers',
      enabled: true,
      logo: (
        <div className="flex items-center gap-3">
          <img src={metaIcon} alt="Meta" className="h-10 w-10 shrink-0" />
          <span className="text-2xl font-semibold tracking-tight text-[#1C2B33]">
            Meta
          </span>
        </div>
      ),
    },
    {
      id: 'google',
      name: 'Google Ads',
      description:
        'Reach customers across Google Search, YouTube, and the web',
      enabled: false,
      logo: (
        <div className="flex items-center gap-3">
          <img
            src={googleAdsIcon}
            alt="Google Ads"
            className="h-12 w-12 shrink-0"
          />
          <span className="text-2xl font-semibold tracking-tight text-[#1C2B33]">
            Google Ads
          </span>
        </div>
      ),
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      description:
        'Best for turning entertainment into viral demand and purchases',
      enabled: false,
      logo: (
        <div className="flex items-center gap-3">
          <img src={tiktokIcon} alt="TikTok" className="h-12 w-12 shrink-0" />
          <span className="text-2xl font-bold tracking-tight text-[#1C2B33]">
            TikTok
          </span>
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
          <h1 className="text-3xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-sm text-[#AFAFAF]">{subtitle}</p>
        </motion.div>

        {/* Cards Grid */}
        <div className="mt-10 grid w-full max-w-5xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform, index) => {
            const isMetaPlatform = platform.id === 'meta';
            const isHovered = hoveredCard === platform.id;

            return (
              <motion.div
                key={platform.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                onMouseEnter={() => setHoveredCard(platform.id)}
                onMouseLeave={() => setHoveredCard(null)}
                onClick={
                  isMetaPlatform && metaConnected ? handleMetaCardClick : undefined
                }
                className={`relative overflow-hidden rounded-2xl transition-all duration-300 ${
                  platform.enabled
                    ? `${metaConnected ? 'cursor-pointer' : 'cursor-default'} shadow-md hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40`
                    : 'cursor-not-allowed'
                }`}
              >
                {/* White logo area */}
                <div className="relative flex h-40 items-center justify-center bg-white transition-all duration-300">
                  {platform.logo}

                  {/* Connect overlay on hover — only for Meta when not connected */}
                  {isMetaPlatform && !metaConnected && !checkingMeta && isHovered && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="absolute inset-0 flex items-center justify-center bg-black/40"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMetaConnect();
                        }}
                        className="rounded-lg bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-5 py-2 text-sm font-semibold text-white shadow-lg transition-transform duration-150 hover:scale-105"
                      >
                        Connect
                      </button>
                    </motion.div>
                  )}
                </div>

                {/* Dark info area */}
                <div className="bg-[#1A1A1A] p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm 2xl:text-base font-semibold text-white">
                      {platform.name}
                    </h3>
                    {!platform.enabled && (
                      <span className="rounded-full bg-gradient-to-r from-[#15DCFF] to-[#6b72f8] px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-white uppercase shadow-md 2xl:text-5">
                        Coming Soon
                      </span>
                    )}
                    {isMetaPlatform && metaConnected && (
                      <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs 2xl:text-sm leading-relaxed text-[#AFAFAF]">
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
