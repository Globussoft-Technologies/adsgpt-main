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
    <div className="flex animate-pulse items-start justify-center p-4 text-zinc-900 dark:text-white">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-11">
        {/* Avatar + Name shimmer */}
        <div className="flex items-center space-x-6">
          <div className="h-[110px] w-[110px] rounded-full bg-zinc-200 dark:bg-gray-700" />
          <div className="flex flex-col gap-3">
            <div className="h-4 w-40 rounded bg-zinc-200 dark:bg-gray-700" />
            <div className="h-3 w-60 rounded bg-zinc-200 dark:bg-gray-700" />
            <div className="h-8 w-28 rounded-full bg-zinc-200 dark:bg-gray-700" />
          </div>
        </div>

        {/* Subscription shimmer */}
        <div>
          <div className="mb-4 h-5 w-32 rounded bg-zinc-200 dark:bg-gray-700" />
          <div className="h-20 rounded-lg bg-zinc-200 dark:bg-gray-700" />
        </div>

        {/* Credits shimmer */}
        <div>
          <div className="mb-4 h-5 w-28 rounded bg-zinc-200 dark:bg-gray-700" />
          <div className="flex justify-between gap-3">
            <div className="h-12 w-24 rounded-lg bg-zinc-200 dark:bg-gray-700" />
            <div className="h-12 w-24 rounded-lg bg-zinc-200 dark:bg-gray-700" />
            <div className="h-12 w-24 rounded-lg bg-zinc-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProfileHome() {
  const { userData, credits } = useSelector((state) => state.socket);
  const subscriptionType = Object.keys(userData?.userSubscriptionType || {})[0];
  const hasPlan8 = Object.keys(userData?.userSubscriptionType || {}).includes('8');
  const [showImageModels, setShowImageModels] = useState(true);
  const [showVideoModels, setShowVideoModels] = useState(true);
  const [extraCredits, setExtraCredits] = useState({ imageModels: [], videoModels: [] });
  const [loadingCredits, setLoadingCredits] = useState(true);
  const HideUpgrade = import.meta.env.VITE_MODE == 'dev' ? '12' : '9';
// console.log(userData)
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
    <div className="relative top-0 flex scale-100 items-start justify-center p-0 text-zinc-900 lg:-top-[10vh] lg:scale-[0.8] 2xl:top-0 2xl:scale-100 2xl:p-6 dark:text-white">
      <div className="mx-auto flex w-full max-w-[43rem] flex-col gap-6 lg:gap-10 2xl:max-w-3xl">
        {/* Profile Section */}
        <div className="flex items-center space-x-6">
          <div className="relative size-[6.75rem] overflow-hidden rounded-full bg-zinc-100 2xl:size-[6.75rem] dark:bg-white/10">
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
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-zinc-800 text-[2rem] font-semibold text-white 2xl:text-[3rem] dark:bg-[#282828]">
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
            <h2 className="mb-[1px] font-bold text-zinc-900 capitalize 2xl:text-xl dark:text-white">
              {(Object.keys(userData?.userSubscriptionType || {})[0] == AUTO_GENERATED_PLAN_ID
                ? (userData?.login ?? '')
                : (userData?.user_name ?? userData?.login)) || 'User Name'}
            </h2>
            <p className="mt-[-3px] mb-[7px] text-sm text-zinc-600 2xl:text-base dark:text-white/60">
              {' '}
              {userData?.user_email || 'user@email.com'}
            </p>
            {
              <Link
                to={'/logout'}
                className="block w-[135px] max-w-max items-center gap-2 rounded-full bg-zinc-200 px-5 py-[7px] text-xs font-medium whitespace-nowrap text-zinc-800 backdrop-blur-2xl transition-colors hover:bg-zinc-300 disabled:opacity-40 disabled:hover:bg-zinc-200 2xl:text-sm dark:bg-white/20 dark:text-white dark:hover:bg-white/30 dark:disabled:hover:bg-white/20"
              >
                Sign Out
              </Link>
            }
          </div>
        </div>

        {/* Subscription Section */}
        <div>
          <h3 className="mb-[16px] text-lg font-semibold text-zinc-800 2xl:text-2xl dark:text-[#E0E0E0]">
            Subscription
          </h3>
          <div className="relative flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-transparent dark:bg-[#303030]/50 dark:shadow-none">
            <div className="upper w-full">
              <p className="text-sm font-semibold text-zinc-900 2xl:text-lg dark:text-white">
                {' '}
                {userData?.featureObject?.planDetails?.name || 'No Active Plan'}
              </p>
              <p className="mt-1 text-xs font-medium text-zinc-600 2xl:text-base dark:text-[#C7C7C7]">
                Usage reset on{' '}
                <span className="whitespace-nowrap">
                  {Object.values(userData?.userSubscriptionType || {})[0] || 'N/A'}
                </span>
              </p>
            </div>
            {subscriptionType !== '9' && subscriptionType !== '12' && (
              <div className="inline-block rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                <button className="rounded-[50px] bg-white px-4 py-1.5 text-sm hover:bg-gray-50 dark:bg-[#2A2A2A] dark:hover:bg-[#333333]">
                  <a
                    href={import.meta.env.VITE_SIGNUP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] bg-clip-text text-xs font-semibold whitespace-nowrap text-transparent hover:from-[#3F51B5] hover:to-[#3A91B7] 2xl:text-base dark:from-[#7EA7F3] dark:to-[#6FD3F7]"
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
          <h3 className="mb-0 text-lg font-semibold text-zinc-800 2xl:text-2xl dark:text-[#E0E0E0]">
            Credits
          </h3>

          <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] 2xl:p-6 dark:border-transparent dark:bg-[#303030]/50 dark:shadow-none">
            {/* AdCreative Credits */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-13 font-bold text-zinc-900 dark:text-white">Total Credits</p>

              <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-black/10 bg-zinc-50 p-2.5 dark:border-white/5 dark:bg-[#333333]/50">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-white/5">
                  <img src={adCreativeLogo} className="h-7 w-7" />
                </div>
                <span className="text-sm font-medium text-zinc-900 dark:text-white">
                  {credits?.creditsUsed || 0}/{credits?.totalCredits || 0}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-6">
              {/* Subscription Credits */}
              {!hasPlan8 && (
              <div className="flex flex-col items-center gap-1">
                <p className="text-13 font-bold text-zinc-900 dark:text-white">Subscription</p>
                <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-black/10 bg-zinc-50 p-2.5 dark:border-white/5 dark:bg-[#333333]/50">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                    <img src={adCreativeLogo} className="h-7 w-7" />
                  </div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-white">
                    {credits?.subscription?.used || 0}/{credits?.subscription?.total || 0}
                  </span>
                </div>
              </div>
              )}

              {/* Rollover Credits — hidden for free plan (plan 8) */}
              {!hasPlan8 && (
                <div className="flex flex-col items-center gap-1">
                  <p className="text-13 font-bold text-zinc-900 dark:text-white">Rolled Over</p>
                  <div className="flex w-[180px] items-center space-x-2 rounded-lg border border-black/10 bg-zinc-50 p-2.5 dark:border-white/5 dark:bg-[#333333]/50">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 dark:bg-white/5">
                      <img src={adCreativeLogo} className="h-7 w-7" />
                    </div>
                    <span className="text-sm font-medium text-zinc-900 dark:text-white">
                      {credits?.rollover?.used || 0}/{credits?.rollover?.total || 0}
                    </span>
                  </div>
                </div>
              )}
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
                      <h4 className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-white/50">
                        Image Models
                      </h4>
                      <ChevronDown
                        className={`h-4 w-4 text-zinc-500 transition-transform duration-300 dark:text-white/60 ${
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
                  <div className="mt-4 flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/5">
                    <div
                      onClick={() => setShowVideoModels(!showVideoModels)}
                      className="flex cursor-pointer items-center justify-center gap-2 transition-opacity hover:opacity-80"
                    >
                      <h4 className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-white/50">
                        Video Models
                      </h4>
                      <ChevronDown
                        className={`h-4 w-4 text-zinc-500 transition-transform duration-300 dark:text-white/60 ${
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

        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-transparent dark:bg-[#303030]/50 dark:shadow-none">
          <h3 className="mb-4 text-lg font-semibold text-zinc-800 dark:text-[#E0E0E0]">
            Generated Image & Video Usage
          </h3>

          <GenerationUsageGraph userId={userData?.user_id} />
        </div>
      </div>
    </div>
  );
}
