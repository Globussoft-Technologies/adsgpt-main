import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

import adCreativeLogo from '@/assets/layouts/profile/adcreative.svg';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import getCookies from '@/utils/getCookies';
import GenerationUsageGraph from './GenerationUsageGraph';
import ModelCreditValue from './ModelCreditValue';
import { fetchModelCredits } from '@/utils/fetchModelCredits';

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const AUTO_GENERATED_PLAN_ID = import.meta.env.VITE_AUTO_GENERATED_PLAN_ID;

function ProfileShimmer() {
  return (
    <div className="flex animate-pulse items-start justify-center p-4 text-white">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-11">
        {/* Avatar + Name shimmer */}
        <div className="flex items-center space-x-6">
          <div className="h-[110px] w-[110px] rounded-full bg-gray-700" />
          <div className="flex flex-col gap-3">
            <div className="h-4 w-40 rounded bg-gray-700" />
            <div className="h-3 w-60 rounded bg-gray-700" />
            <div className="h-8 w-28 rounded-full bg-gray-700" />
          </div>
        </div>

        {/* Subscription shimmer */}
        <div>
          <div className="mb-4 h-5 w-32 rounded bg-gray-700" />
          <div className="h-20 rounded-lg bg-gray-700" />
        </div>

        {/* Credits shimmer */}
        <div>
          <div className="mb-4 h-5 w-28 rounded bg-gray-700" />
          <div className="flex justify-between gap-3">
            <div className="h-12 w-24 rounded-lg bg-gray-700" />
            <div className="h-12 w-24 rounded-lg bg-gray-700" />
            <div className="h-12 w-24 rounded-lg bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfileHome() {
  const { userData, credits } = useSelector((state) => state.socket);
  const subscriptionType = Object.keys(userData?.userSubscriptionType || {})[0];
  const [showImageModels, setShowImageModels] = useState(true);
  const [showVideoModels, setShowVideoModels] = useState(true);
  const [extraCredits, setExtraCredits] = useState({ imageModels: [], videoModels: [] });
  const [loadingCredits, setLoadingCredits] = useState(true);
  const HideUpgrade = import.meta.env.VITE_MODE == 'dev' ? '12' : '9';

  useEffect(() => {
    const loadCredits = async () => {
      const data = await fetchModelCredits();

      setExtraCredits({
        imageModels: data.imageModels,
        videoModels: data.videoModels,
      });

      setLoadingCredits(false);
    };

    loadCredits();
  }, []);

  if (!userData?.featureObject) {
    return <ProfileShimmer></ProfileShimmer>;
  }

  const formatLargeNumber = (num) => {
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return num.toString();
  };

  const getCreditDisplay = (used, total, threshold = 300000000) => {
    if (!total) return '0/0';
    if (Math.max(used || 0, total || 0) > threshold) return 'Unlimited';
    return `${formatLargeNumber(Math.min(used || 0, total || 0))}/${formatLargeNumber(total || 0)}`;
  };

  return (
    <div className="relative top-0 flex scale-100 items-start justify-center p-0 text-white lg:-top-[10vh] lg:scale-[0.8] 2xl:top-0 2xl:scale-100 2xl:p-6">
      <div className="mx-auto flex w-full max-w-[43rem] flex-col gap-6 lg:gap-10 2xl:max-w-3xl">
        {/* Profile Section */}
        <div className="flex items-center space-x-6">
          <div className="relative size-[6.75rem] overflow-hidden rounded-full bg-white/10 2xl:size-[6.75rem]">
            {userData?.profileImage ? (
              <img
                src={userData?.profileImage}
                alt="User Avatar"
                className="rounded-full object-cover"
              />
            ) : (
              (() => {
                const planType = Object.keys(userData?.userSubscriptionType || {})[0];
                const isPlan = planType == AUTO_GENERATED_PLAN_ID;

                if (isPlan) {
                  const login = userData?.login || 'U';
                  return (
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-[#282828] text-[2rem] font-semibold text-white 2xl:text-[3rem]">
                      {login.slice(0, 2).toUpperCase()}
                    </div>
                  );
                }

                const firstName = userData?.name_f || '';
                const lastName = userData?.name_l || '';
                const userName = userData?.user_name || 'U';

                const initials =
                  firstName && lastName
                    ? `${firstName[0]}${lastName[0]}`
                    : firstName
                      ? firstName.slice(0, 2)
                      : lastName
                        ? lastName.slice(0, 2)
                        : userName.slice(0, 2);

                return (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#282828] text-[2rem] font-semibold text-white 2xl:text-[3rem]">
                    {initials.toUpperCase()}
                  </div>
                );
              })()
            )}
          </div>

          <div className="flex h-full flex-col gap-0">
            <h2 className="mb-[1px] font-bold text-white capitalize 2xl:text-xl">
              {(Object.keys(userData?.userSubscriptionType || {})[0] == AUTO_GENERATED_PLAN_ID
                ? (userData?.login ?? '')
                : (userData?.user_name ?? userData?.login)) || 'User Name'}
            </h2>
            <p className="mt-[-3px] mb-[7px] text-sm text-white/60 2xl:text-base">
              {' '}
              {userData?.user_email || 'user@email.com'}
            </p>
            {
              <Link
                to={'/logout'}
                className="block w-[135px] max-w-max items-center gap-2 rounded-full bg-white/20 px-5 py-[7px] text-xs font-medium whitespace-nowrap text-white backdrop-blur-2xl transition-colors hover:bg-white/30 disabled:opacity-40 disabled:hover:bg-white/20 2xl:text-sm"
              >
                Sign Out
              </Link>
            }
          </div>
        </div>

        {/* Subscription Section */}
        <div>
          <h3 className="mb-[16px] text-lg font-semibold text-[#E0E0E0] 2xl:text-2xl">
            Subscription
          </h3>
          <div className="relative flex items-center justify-between gap-3 rounded-2xl bg-[#303030]/50 p-6">
            <div className="upper w-full">
              <p className="text-sm font-semibold text-white 2xl:text-lg">
                {' '}
                {userData?.featureObject?.planDetails?.name || 'No Active Plan'}
              </p>
              <p className="mt-1 text-xs font-medium text-[#C7C7C7] 2xl:text-base">
                Usage reset on{' '}
                <span className="whitespace-nowrap">
                  {Object.values(userData?.userSubscriptionType || {})[0] || 'N/A'}
                </span>
              </p>
            </div>
            {subscriptionType !== '9' && subscriptionType !== '12' && (
              <div className="inline-block rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px] hover:text-white">
                <button className="rounded-[50px] bg-[#2A2A2A] px-4 py-1.5 text-sm text-white">
                  <a
                    href={import.meta.env.VITE_SIGNUP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-gradient-to-r from-[#7EA7F3] to-[#6FD3F7] bg-clip-text text-xs font-semibold whitespace-nowrap text-transparent hover:from-white hover:to-white 2xl:text-base"
                  >
                    Upgrade Plan
                  </a>
                </button>
              </div>
            )}

            {/* ✅ Upgrade button only if topPlan is false */}
            {/* {userData?.featureObject?.planDetails?.topPlan === false && (
              <div className="inline-block rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                <a
                  href={import.meta.env.VITE_AMEMBER_URL+ "/signup"}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-[50px] rounded-[50px] bg-[#2A2A2A] px-7 py-2.5 text-center text-[20px] font-semibold text-white"
                >
                  Upgrade Plan
                </a>
              </div>
            )} */}
          </div>
        </div>
        {/* Credits Section */}
        <div className="flex flex-col gap-6">
          <h3 className="mb-0 text-lg font-semibold text-[#E0E0E0] 2xl:text-2xl">Credits</h3>

          <div className="flex flex-col gap-4 rounded-2xl bg-[#303030]/50 p-4 2xl:p-6">
            {/* AdCreative Credits */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-13 text-white font-bold">Total Credits</p>

              <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-white/5 bg-[#333333]/50 p-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
                  <img src={adCreativeLogo} className="h-7 w-7" />
                </div>
                <span className="text-sm font-medium text-white">
                  {credits?.creditsUsed || 0}/{credits?.totalCredits || 0}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-col items-center gap-4">
              {/* Subscription Credits */}
              <div className="mt-4 flex flex-wrap justify-center gap-6">
                {/* Subscription Credits */}
                <div className="flex flex-col items-center gap-1">
                  <p className="text-13 text-white font-bold">Subscription</p>
                  <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-white/5 bg-[#333333]/50 p-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                      <img src={adCreativeLogo} className="h-7 w-7" />
                    </div>
                    <span className="text-sm font-medium text-white">
                      {credits?.subscription?.used || 0}/{credits?.subscription?.total || 0}
                    </span>
                  </div>
                </div>

                {/* Rollover Credits */}
                <div className="flex flex-col items-center gap-1">
                  <p className="text-13 text-white font-bold">Rolled Over</p>
                  <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-white/5 bg-[#333333]/50 p-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                      <img src={adCreativeLogo} className="h-7 w-7" />
                    </div>
                    <span className="text-sm font-medium text-white">
                      {credits?.rollover?.used || 0}/{credits?.rollover?.total || 0}
                    </span>
                  </div>
                </div>

                {/* Frozen (in-progress) Credits */}
                <div className="flex flex-col items-center gap-1">
                  <p className="text-13 text-white font-bold">Frozen</p>
                  <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-white/5 bg-[#333333]/50 p-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                      <img src={adCreativeLogo} className="h-7 w-7" />
                    </div>
                    <span className="text-sm font-medium text-white">
                      {credits?.frozenCredits || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {loadingCredits ? (
              <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-[#7EA7F3]" />
              </div>
            ) : extraCredits.imageModels.length > 0 || extraCredits.videoModels.length > 0 ? (
              <>
                {/* Image Models Row */}
                {extraCredits.imageModels.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div
                      onClick={() => setShowImageModels(!showImageModels)}
                      className="flex cursor-pointer items-center justify-center gap-2 transition-opacity hover:opacity-80"
                    >
                      <h4 className="text-xs font-medium tracking-wider text-white/50 uppercase">
                        Image Models
                      </h4>
                      <ChevronDown
                        className={`h-4 w-4 text-white/60 transition-transform duration-300 ${
                          showImageModels ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                    <AnimatePresence>
                      {showImageModels && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-wrap items-center justify-center gap-2.5 gap-y-3 pt-2">
                            <ModelCreditValue credits={extraCredits.imageModels} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Video Models Row */}
                {extraCredits.videoModels.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-white/5 pt-4">
                    <div
                      onClick={() => setShowVideoModels(!showVideoModels)}
                      className="flex cursor-pointer items-center justify-center gap-2 transition-opacity hover:opacity-80"
                    >
                      <h4 className="text-xs font-medium tracking-wider text-white/50 uppercase">
                        Video Models
                      </h4>
                      <ChevronDown
                        className={`h-4 w-4 text-white/60 transition-transform duration-300 ${
                          showVideoModels ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                    <AnimatePresence>
                      {showVideoModels && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="flex flex-wrap items-center justify-center gap-2.5 gap-y-4 pt-2">
                            <ModelCreditValue credits={extraCredits.videoModels} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-[#303030]/50 p-6">
          <h3 className="mb-4 text-lg font-semibold text-[#E0E0E0]">
            Generated Image & Video Usage
          </h3>

          <GenerationUsageGraph userId={userData?.user_id} />
        </div>
      </div>
    </div>
  );
}
