import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';

import adCreativeLogo from '@/assets/layouts/profile/adcreative.svg';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';
import getCookies from '@/utils/getCookies';
import GenerationUsageGraph from './GenerationUsageGraph';
import ModelCreditValue from './ModelCreditValue';
import { fetchModelCredits, fetchAdCreativeImageTiers } from '@/utils/fetchModelCredits';
import { getCanvaStatus, disconnectCanva, checkCanvaAuth } from '@/apis/canva/canvaApi';
import { getFacebookAccounts, metaDisconnect } from '@/apis/metaAds/metaAdsApi';
import { getGoogleUser, googleDisconnect } from '@/apis/googleAds/googleAdsApi';
import { clearSelectedFacebookId } from '@/utils/metaFacebookAccount';
import { globalToast } from '@/utils/globalToast';

const CANVA_CLIENT_ID = import.meta.env.VITE_CANVA_CLIENT_ID;
const CANVA_REDIRECT_URI = import.meta.env.VITE_CANVA_REDIRECT_URI;
const CANVA_SCOPES = import.meta.env.VITE_CANVA_SCOPES;
const BACKEND_HOST_AUTH = import.meta.env.VITE_SOCKET_URL;

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

  const [canvaStatus, setCanvaStatus] = useState(null); // null = loading, { connected, display_name, email, ... }
  const [canvaActionLoading, setCanvaActionLoading] = useState(false);

  useEffect(() => {
    getCanvaStatus()
      .then((data) => setCanvaStatus(data))
      .catch(() => setCanvaStatus({ connected: false }));
  }, []);

  const handleConnectCanva = async () => {
    setCanvaActionLoading(true);
    try {
      const result = await checkCanvaAuth(null);
      if (result.status) {
        // Already connected — refresh status
        const fresh = await getCanvaStatus();
        setCanvaStatus(fresh);
        setCanvaActionLoading(false);
        return;
      }

      const { state, codeChallenge } = result;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CANVA_CLIENT_ID,
        redirect_uri: CANVA_REDIRECT_URI,
        scope: CANVA_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const popup = window.open(
        `https://www.canva.com/api/oauth/authorize?${params.toString()}`,
        'canva-oauth',
        'width=600,height=700'
      );

      const onMessage = async (event) => {
        if (event.data === 'canva-connected') {
          window.removeEventListener('message', onMessage);
          if (popup && !popup.closed) popup.close();
          const fresh = await getCanvaStatus();
          setCanvaStatus(fresh);
          setCanvaActionLoading(false);
        }
      };
      window.addEventListener('message', onMessage);

      // Fallback: if popup is closed manually without completing OAuth
      const pollClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollClosed);
          window.removeEventListener('message', onMessage);
          setCanvaActionLoading(false);
        }
      }, 500);
    } catch (err) {
      console.error('Canva connect error:', err);
      setCanvaActionLoading(false);
    }
  };

  const handleDisconnectCanva = async () => {
    setCanvaActionLoading(true);
    try {
      await disconnectCanva();
      setCanvaStatus({ connected: false });
    } catch (err) {
      console.error('Canva disconnect error:', err);
    } finally {
      setCanvaActionLoading(false);
    }
  };

  // ── Meta ──
  const [metaAccounts, setMetaAccounts] = useState(undefined);
  const [metaActionLoading, setMetaActionLoading] = useState(false);
  const [metaRemovingId, setMetaRemovingId] = useState('');

  const loadMetaAccounts = useCallback(async () => {
    if (!userData?.user_id) return;
    try {
      const data = await getFacebookAccounts(userData.user_id);
      setMetaAccounts(data?.accounts || []);
    } catch {
      setMetaAccounts([]);
    }
  }, [userData?.user_id]);

  useEffect(() => {
    loadMetaAccounts();
  }, [loadMetaAccounts]);

  const handleConnectMeta = () => {
    setMetaActionLoading(true);
    const feUrl = window.location.href;
    window.location.href = `${BACKEND_HOST_AUTH}/api/auth/facebook?userId=${userData?.user_id}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleDisconnectMeta = async (facebookId) => {
    setMetaRemovingId(facebookId);
    try {
      await metaDisconnect(userData?.user_id, facebookId);
      clearSelectedFacebookId(userData?.user_id, facebookId);
      setMetaAccounts((accounts) =>
        (accounts || []).filter((account) => account.facebookId !== facebookId),
      );
      globalToast.success('Facebook account removed');
    } catch (err) {
      console.error('Meta disconnect error:', err);
      globalToast.error('Failed to remove Facebook account');
    } finally {
      setMetaRemovingId('');
    }
  };

  const usableMetaAccounts =
    metaAccounts?.filter((account) => account.isUsable) || [];

  // ── Google ──
  const [googleUser, setGoogleUser] = useState(undefined);
  const [googleActionLoading, setGoogleActionLoading] = useState(false);

  useEffect(() => {
    if (!userData?.user_id) return;
    getGoogleUser(userData.user_id)
      .then((data) => setGoogleUser(data || null))
      .catch(() => setGoogleUser(null));
  }, [userData?.user_id]);

  const handleConnectGoogle = () => {
    setGoogleActionLoading(true);
    const feUrl = window.location.href;
    window.location.href = `${BACKEND_HOST_AUTH}/api/auth/google?token=${getCookies()}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  const handleDisconnectGoogle = async () => {
    setGoogleActionLoading(true);
    try {
      await googleDisconnect(userData?.user_id);
      setGoogleUser(null);
    } catch (err) {
      console.error('Google disconnect error:', err);
    } finally {
      setGoogleActionLoading(false);
    }
  };

  useEffect(() => {
    const loadCredits = async () => {
      const [data, imageTiers] = await Promise.all([
        fetchModelCredits(),
        fetchAdCreativeImageTiers(),
      ]);

      setExtraCredits({
        // Prefer the tiered AdCreative image rows (per-quality breakdown);
        // fall back to the flat rows if that surface returns nothing.
        imageModels: imageTiers.length > 0 ? imageTiers : data.imageModels,
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
    <div className="flex items-start justify-center p-0 text-zinc-900 lg:p-6 dark:text-white">
      <div className="mx-auto flex w-full max-w-[43rem] flex-col gap-6 lg:max-w-6xl lg:gap-8 2xl:max-w-7xl">
        {/* Two-column area: Profile + Subscription (left), Integrations (right), Credits full width below */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        {/* Profile Section */}
        <div className="flex items-center space-x-6 lg:col-start-1 lg:row-start-1">
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
        <div className="lg:col-start-1 lg:row-start-2">
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
            <div className="flex shrink-0 items-center gap-2">
              {subscriptionType !== '9' && subscriptionType !== '12' && (
                <div className="inline-block rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                  <button className="rounded-[50px] bg-white px-3 py-1 text-xs hover:bg-gray-50 dark:bg-[#2A2A2A] dark:hover:bg-[#333333]">
                    <a
                      href={import.meta.env.VITE_SIGNUP_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] bg-clip-text text-[11px] font-semibold whitespace-nowrap text-transparent hover:from-[#3F51B5] hover:to-[#3A91B7] 2xl:text-sm dark:from-[#7EA7F3] dark:to-[#6FD3F7]"
                    >
                      Upgrade Plan
                    </a>
                  </button>
                </div>
              )}
              {/* cancel button */}
              {import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true' && subscriptionType !== '8' && (
                <a
                  href={import.meta.env.VITE_SUBSCRIPTION_CANCELLATION_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[50px] cursor-pointer border border-red-500 px-3 py-1 text-[11px] font-medium whitespace-nowrap text-red-500 transition-colors hover:bg-red-50 2xl:text-sm dark:border-red-400 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  Cancel
                </a>
              )}
            </div>

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
        <div className="flex flex-col gap-4 lg:col-span-2 lg:row-start-3">
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
              <div className="grid grid-cols-1 gap-y-4 lg:grid-cols-2 lg:gap-x-6">
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
                  <div className="mt-4 flex flex-col gap-3 border-t border-black/10 pt-4 lg:mt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6 dark:border-white/5">
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
              </div>
            ) : null}
          </div>
        </div>

        {/* Integrations Section */}
        <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2">
          <h3 className="mb-0 text-lg font-semibold text-zinc-800 2xl:text-2xl dark:text-[#E0E0E0]">Integrations</h3>
          <div className="rounded-2xl border border-black/5 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-transparent dark:bg-[#303030]/50 dark:shadow-none">
          <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">

            {/* ── Meta ── */}
            <div className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1877F2]/10">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073C24 5.404 18.628 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-900 dark:text-white">Meta</p>
                    {metaAccounts === undefined ? (
                      <div className="mt-0.5 h-2.5 w-20 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
                    ) : usableMetaAccounts.length === 0 ? (
                      <p className="text-10 text-zinc-400 dark:text-white/40">Not connected</p>
                    ) : (
                      <p className="text-10 text-zinc-500 dark:text-white/50">
                        {usableMetaAccounts.length} connected Facebook {usableMetaAccounts.length === 1 ? 'account' : 'accounts'}
                      </p>
                    )}
                  </div>
                  {usableMetaAccounts.length > 0 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-10 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      Connected
                    </span>
                  )}
                </div>

                {metaAccounts === undefined ? null : (
                  <div className="inline-block shrink-0 rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                    <button
                      onClick={handleConnectMeta}
                      disabled={metaActionLoading}
                      className="flex items-center gap-1.5 rounded-[50px] bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 dark:bg-[#2A2A2A] dark:hover:bg-[#333333]"
                    >
                      {metaActionLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin text-[#3F51B5]" />
                      ) : usableMetaAccounts.length > 0 ? (
                        <Plus className="h-3 w-3 text-[#3F51B5] dark:text-[#7EA7F3]" />
                      ) : null}
                      <span className="bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] bg-clip-text text-xs font-medium whitespace-nowrap text-transparent dark:from-[#7EA7F3] dark:to-[#6FD3F7]">
                        {usableMetaAccounts.length === 0 ? 'Connect' : 'Add account'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {metaAccounts?.length > 0 && (
                <div className="mt-3 ml-10 space-y-1.5">
                  {metaAccounts.map((account) => (
                    <div
                      key={account.facebookId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-zinc-50 px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-800 dark:text-white/90">
                          {account.name}
                        </p>
                        <p className="truncate text-10 text-zinc-500 dark:text-white/45">
                          {account.email || `Facebook ID: ${account.facebookId}`}
                        </p>
                        {!account.isUsable && (
                          <p className="mt-0.5 text-10 font-medium text-amber-600 dark:text-amber-400">
                            Reconnect required
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${account.name}`}
                        title={`Remove ${account.name}`}
                        onClick={() => handleDisconnectMeta(account.facebookId)}
                        disabled={metaRemovingId === account.facebookId}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:text-white/40 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        {metaRemovingId === account.facebookId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Google ── gated behind the same env switch as the Google
                posting / Ads Manager flows (VITE_ENABLE_GOOGLE_POSTING). */}
            {import.meta.env.VITE_ENABLE_GOOGLE_POSTING === 'true' && (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-[#232323]">
                  <svg className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white">Google</p>
                  {googleUser === undefined ? (
                    <div className="mt-0.5 h-2.5 w-20 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
                  ) : !googleUser ? (
                    <p className="text-10 text-zinc-400 dark:text-white/40">Not connected</p>
                  ) : null}
                </div>
                {googleUser && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-10 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Connected</span>
                )}
              </div>
              {googleUser === undefined ? null : googleUser ? (
                <button
                  onClick={handleDisconnectGoogle}
                  disabled={googleActionLoading}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {googleActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Disconnect'}
                </button>
              ) : (
                <div className="inline-block shrink-0 rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                  <button
                    onClick={handleConnectGoogle}
                    disabled={googleActionLoading}
                    className="flex items-center gap-1.5 rounded-[50px] bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 dark:bg-[#2A2A2A] dark:hover:bg-[#333333]"
                  >
                    {googleActionLoading && <Loader2 className="h-3 w-3 animate-spin text-[#3F51B5]" />}
                    <span className="bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] bg-clip-text text-xs font-medium whitespace-nowrap text-transparent dark:from-[#7EA7F3] dark:to-[#6FD3F7]">
                      Connect
                    </span>
                  </button>
                </div>
              )}
            </div>
            )}

            {/* ── Canva ── */}
            
            <div className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-[#232323]">
                  <img src={canvaIconLogo} alt="Canva" className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white">Canva</p>
                  {canvaStatus === null ? (
                    <div className="mt-0.5 h-2.5 w-20 animate-pulse rounded bg-zinc-200 dark:bg-white/10" />
                  ) : !canvaStatus.connected ? (
                    <p className="text-10 text-zinc-400 dark:text-white/40">Not connected</p>
                  ) : null}
                </div>
                {canvaStatus?.connected && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-10 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Connected</span>
                )}
              </div>
              {canvaStatus === null ? null : canvaStatus.connected ? (
                <button
                  onClick={handleDisconnectCanva}
                  disabled={canvaActionLoading}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  {canvaActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Disconnect'}
                </button>
              ) : (
                <div className="inline-block shrink-0 rounded-[50px] bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] p-[1px]">
                  <button
                    onClick={handleConnectCanva}
                    disabled={canvaActionLoading}
                    className="flex items-center gap-1.5 rounded-[50px] bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 dark:bg-[#2A2A2A] dark:hover:bg-[#333333]"
                  >
                    {canvaActionLoading && <Loader2 className="h-3 w-3 animate-spin text-[#3F51B5]" />}
                    <span className="bg-gradient-to-r from-[#3F51B5] to-[#3A91B7] bg-clip-text text-xs font-medium whitespace-nowrap text-transparent dark:from-[#7EA7F3] dark:to-[#6FD3F7]">
                      Connect
                    </span>
                  </button>
                </div>
              )}
            </div>
            

          </div>
        </div>
        </div>{/* end Integrations */}
        </div>{/* end two-column area */}

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
