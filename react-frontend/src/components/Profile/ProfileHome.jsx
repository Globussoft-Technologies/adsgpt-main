import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, LogOut, Plus, Trash2 } from 'lucide-react';

import adCreativeLogo from '@/assets/layouts/profile/adcreative.svg';
import canvaIconLogo from '@/assets/layouts/Canva Icon logo_32x32.png';
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
const AUTO_GENERATED_PLAN_ID = import.meta.env.VITE_AUTO_GENERATED_PLAN_ID;

// Fallback model definitions matching the redesign screenshot
const DEFAULT_IMAGE_MODELS = [
  {
    label: 'Seedream 5.0 lite',
    value: '1 CREDITS/IMAGE',
    qualityTiers: [
      { quality: 'low', creditsPerImage: 1 },
      { quality: 'medium', creditsPerImage: 1 },
      { quality: 'high', creditsPerImage: 1 },
    ],
  },
  {
    label: 'Nano Banana Pro',
    value: '2-4 CREDITS/IMAGE',
    qualityTiers: [
      { quality: 'low', creditsPerImage: 2 },
      { quality: 'medium', creditsPerImage: 3 },
      { quality: 'high', creditsPerImage: 4 },
    ],
  },
  {
    label: 'Nano Banana 2',
    value: '1-4 CREDITS/IMAGE',
    qualityTiers: [
      { quality: 'low', creditsPerImage: 1 },
      { quality: 'medium', creditsPerImage: 2 },
      { quality: 'high', creditsPerImage: 4 },
    ],
  },
  {
    label: 'OpenAI 1.5',
    value: '1-4 CREDITS/IMAGE',
    qualityTiers: [
      { quality: 'low', creditsPerImage: 1 },
      { quality: 'medium', creditsPerImage: 2 },
      { quality: 'high', creditsPerImage: 4 },
    ],
  },
  {
    label: 'OpenAI 2.0',
    value: '1-6 CREDITS/IMAGE',
    qualityTiers: [
      { quality: 'low', creditsPerImage: 1 },
      { quality: 'medium', creditsPerImage: 3 },
      { quality: 'high', creditsPerImage: 6 },
    ],
  },
];

const DEFAULT_VIDEO_MODELS = [
  { label: 'abcd', value: '0 CREDITS/SECOND' },
  { label: 'Optra', value: '0 CREDITS/SECOND' },
  { label: 'Omni', value: '3 CREDITS/SECOND' },
  { label: 'Seedance 2.0 Fast', value: '3 CREDITS/SECOND' },
  { label: 'Veo 3.1 fast', value: '4 CREDITS/SECOND' },
  { label: 'Seedance 2.0', value: '4 CREDITS/SECOND' },
  { label: 'Veo 3', value: '5 CREDITS/SECOND' },
  { label: 'Kling 3.0', value: '5 CREDITS/SECOND' },
  { label: 'Seedance 2.5', value: '6 CREDITS/SECOND' },
  { label: 'Ad 1', value: '10 CREDITS/SECOND' },
  { label: 'Veo 4K', value: '10 CREDITS/SECOND' },
];

function ProfileShimmer() {
  return (
    <div className="flex animate-pulse items-start justify-center p-4 text-zinc-900 dark:text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        {/* Avatar + Name shimmer */}
        <div className="flex items-center space-x-5">
          <div className="h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex flex-col gap-2.5">
            <div className="h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-56 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-8 w-44 rounded-full bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>

        {/* 2-column: Subscription + Integrations */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 h-36 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="lg:col-span-7 h-36 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* Credits shimmer */}
        <div className="h-56 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />

        {/* Usage shimmer */}
        <div className="h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-800" />
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
  const [extraCredits, setExtraCredits] = useState({
    imageModels: DEFAULT_IMAGE_MODELS,
    videoModels: DEFAULT_VIDEO_MODELS,
  });
  const [loadingCredits, setLoadingCredits] = useState(true);

  // ── Canva ──
  const [canvaStatus, setCanvaStatus] = useState(null);
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
        if (!event || event.origin !== window.location.origin) return;
        if (event.data === 'canva-connected') {
          window.removeEventListener('message', onMessage);
          if (popup && !popup.closed) popup.close();
          const fresh = await getCanvaStatus();
          setCanvaStatus(fresh);
          setCanvaActionLoading(false);
        }
      };
      window.addEventListener('message', onMessage);

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
        (accounts || []).filter((account) => account.facebookId !== facebookId)
      );
      globalToast.success('Facebook account removed');
    } catch (err) {
      console.error('Meta disconnect error:', err);
      globalToast.error('Failed to remove Facebook account');
    } finally {
      setMetaRemovingId('');
    }
  };

  const usableMetaAccounts = metaAccounts?.filter((account) => account.isUsable) || [];

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

  // ── Credits ──
  useEffect(() => {
    const loadCredits = async () => {
      try {
        const [data, imageTiers] = await Promise.all([
          fetchModelCredits(),
          fetchAdCreativeImageTiers(),
        ]);

        const resolvedImageModels =
          imageTiers.length > 0
            ? imageTiers
            : data.imageModels?.length > 0
              ? data.imageModels
              : DEFAULT_IMAGE_MODELS;

        const resolvedVideoModels =
          data.videoModels?.length > 0 ? data.videoModels : DEFAULT_VIDEO_MODELS;

        setExtraCredits({
          imageModels: resolvedImageModels,
          videoModels: resolvedVideoModels,
        });
      } catch {
        setExtraCredits({
          imageModels: DEFAULT_IMAGE_MODELS,
          videoModels: DEFAULT_VIDEO_MODELS,
        });
      } finally {
        setLoadingCredits(false);
      }
    };

    loadCredits();
  }, []);

  if (!userData?.featureObject) {
    return <ProfileShimmer />;
  }

  // User Initials
  const firstName = userData?.name_f || '';
  const lastName = userData?.name_l || '';
  const userName = userData?.user_name || userData?.login || 'Testcreation Test';
  const initials =
    firstName && lastName
      ? `${firstName[0]}${lastName[0]}`.toUpperCase()
      : userName
        ? userName.slice(0, 2).toUpperCase()
        : 'TT';

  const resetDate =
    Object.values(userData?.userSubscriptionType || {})[0] || '2026-10-17';
  const planName =
    userData?.featureObject?.planDetails?.name || 'Basic';

  return (
    <div className="flex h-full min-h-0 w-full flex-col text-zinc-900 dark:text-white">
      {/* =========================================================================
          TOP: USER PROFILE SECTION (Fixed above the scrollable content area)
         ========================================================================= */}
      <div className="shrink-0 px-4 pt-4 pb-2 sm:pb-3 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl 2xl:max-w-7xl">
          <div className="flex items-center gap-5 sm:gap-6 pt-1">
            {/* Avatar circle: White-framed sleek dark charcoal in light mode, neutral #181818 in dark mode */}
            <div className="flex h-20 w-20 sm:h-24 sm:w-24 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white shadow-md ring-4 ring-white border border-black/10 dark:bg-[#181818] dark:text-white dark:border-white/15 dark:ring-0 dark:shadow-none text-2xl sm:text-3xl font-bold tracking-tight">
              {userData?.profileImage ? (
                <img
                  src={userData.profileImage}
                  alt="User Avatar"
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span className="select-none">{initials}</span>
              )}
            </div>

            <div className="flex flex-col justify-center min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-white capitalize leading-tight">
                {userName}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 truncate">
                {userData?.user_email || 'superadmin@medcore.local'}
              </p>

              <div className="mt-3 flex items-center gap-2.5 flex-nowrap">
                <Link
                  to="/logout"
                  className="group inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-black/10 bg-white/80 px-4 text-xs font-semibold whitespace-nowrap text-zinc-800 shadow-xs transition-all hover:bg-white hover:border-black/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/90 dark:hover:bg-white/10"
                >
                  <LogOut
                    className="h-3.5 w-3.5 text-zinc-500 transition-transform group-hover:translate-x-0.5 dark:text-zinc-400"
                    aria-hidden="true"
                  />
                  <span>Sign Out</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SCROLLABLE CONTENT AREA: Starts from Subscription & Integrations level
         ========================================================================= */}
      <div className="account-profile-content-scroll ad-library-grid-scroll min-h-0 w-full flex-1 overflow-y-auto px-4 pb-10 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl 2xl:max-w-7xl pt-5 sm:pt-6 space-y-7">
          {/* =========================================================================
              SECTION 1 & 2: SUBSCRIPTION & INTEGRATIONS (TWO-COLUMN ROW)
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* ── Subscription Section ── */}
          <div className="lg:col-span-5 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-[#8B5CF6]" />
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                Subscription
              </h3>
            </div>

            <div className="profile-account-card flex-1 flex flex-col justify-between overflow-hidden rounded-2xl border border-black/[0.07] bg-white/60 p-4 sm:p-5 shadow-sm backdrop-blur-xl transition-all hover:border-black/20 dark:border-white/[0.08] dark:bg-[#141414] dark:hover:border-white/15">
              {/* Top: Current Plan Info & Action Buttons */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    CURRENT PLAN
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <h4 className="text-xl font-bold text-zinc-900 dark:text-white leading-none">
                      {planName}
                    </h4>
                    <span className="rounded-full bg-gradient-to-r from-[#D946EF] to-[#8B5CF6] px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white shadow-xs">
                      PLAN
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {subscriptionType !== '9' && subscriptionType !== '12' && (
                    <a
                      href={import.meta.env.VITE_SIGNUP_URL || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7.5 items-center justify-center rounded-full border border-black/15 bg-black/[0.04] px-3.5 text-xs font-semibold text-zinc-900 shadow-2xs transition-all hover:bg-black/[0.08] hover:border-black/25 dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/10"
                    >
                      Upgrade Plan
                    </a>
                  )}
                  {subscriptionType !== '8' && (
                    <a
                      href={import.meta.env.VITE_SUBSCRIPTION_CANCELLATION_URL || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7.5 items-center justify-center rounded-full border border-red-500/25 bg-red-500/[0.05] px-3 text-xs font-medium text-red-500 transition-all hover:bg-red-500/[0.12] hover:border-red-500/40 dark:border-red-400/25 dark:bg-red-500/[0.08] dark:text-red-400 dark:hover:bg-red-400/[0.15]"
                    >
                      Cancel
                    </a>
                  )}
                </div>
              </div>

              {/* Bottom: Status badge & reset date footer */}
              <div className="mt-3 flex items-center justify-between border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </span>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Usage reset on{' '}
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                    {resetDate}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* ── Integrations Section ── */}
          <div className="lg:col-span-7 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-[#10B981]" />
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
                Integrations
              </h3>
            </div>

            <div className="profile-account-card flex-1 flex flex-col justify-between overflow-hidden rounded-2xl border border-black/[0.07] bg-white/60 p-4 sm:p-5 shadow-sm backdrop-blur-xl transition-all hover:border-black/20 dark:border-white/[0.08] dark:bg-[#141414] dark:hover:border-white/15">
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-black/[0.08] dark:divide-white/[0.08] items-start h-full">
                {/* ── Meta (Facebook) ── */}
                <div className="sm:pr-3 lg:pr-4 flex flex-col justify-between h-full pb-3 sm:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1877F2] text-white shadow-xs">
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                          <path d="M24 12.073C24 5.404 18.628 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-zinc-900 dark:text-white leading-tight whitespace-nowrap">
                          Meta
                        </p>
                        {usableMetaAccounts.length > 0 ? (
                          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 leading-tight whitespace-nowrap">
                            Connected
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight whitespace-nowrap">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={handleConnectMeta}
                        disabled={metaActionLoading}
                        className="inline-flex h-7.5 items-center justify-center gap-1 rounded-full border border-[#3B82F6]/30 bg-[#3B82F6]/15 px-3 text-xs font-medium whitespace-nowrap text-[#2563EB] transition-colors hover:bg-[#3B82F6]/25 disabled:opacity-50 dark:border-[#3B82F6]/40 dark:bg-[#3B82F6]/25 dark:text-[#60A5FA]"
                      >
                        {metaActionLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin text-[#3B82F6]" />
                        ) : usableMetaAccounts.length > 0 ? (
                          <>
                            <Plus className="h-3 w-3" />
                            <span>Add</span>
                          </>
                        ) : (
                          <span>Connect</span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Connected Facebook Account Sub-card if any */}
                  {metaAccounts && metaAccounts.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {metaAccounts.map((account) => (
                        <div
                          key={account.facebookId}
                          className="flex items-center justify-between gap-1.5 rounded-xl border border-black/[0.05] bg-zinc-50/80 px-2.5 py-1.5 dark:border-white/[0.05] dark:bg-white/[0.03]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold text-zinc-900 dark:text-white">
                              {account.name}
                            </p>
                            <p className="truncate text-[9px] text-zinc-500 dark:text-zinc-400">
                              {account.email || `ID: ${account.facebookId}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            title={`Remove ${account.name}`}
                            onClick={() => handleDisconnectMeta(account.facebookId)}
                            disabled={metaRemovingId === account.facebookId}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-red-500 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
                          >
                            {metaRemovingId === account.facebookId ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.01] px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.01]">
                      <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                        No account linked
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Google ── */}
                <div className="sm:px-3 lg:px-4 flex flex-col justify-between h-full py-3 sm:py-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-white/5">
                        <svg className="h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-zinc-900 dark:text-white leading-tight whitespace-nowrap">
                          Google
                        </p>
                        {googleUser ? (
                          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 leading-tight whitespace-nowrap">
                            Connected
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight whitespace-nowrap">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {googleUser ? (
                        <button
                          type="button"
                          onClick={handleDisconnectGoogle}
                          disabled={googleActionLoading}
                          className="inline-flex h-7.5 items-center justify-center rounded-full border border-red-500/30 bg-red-500/[0.06] px-3.5 text-xs font-medium whitespace-nowrap text-red-500 transition-colors hover:bg-red-500/[0.12] hover:border-red-500/40 dark:border-red-400/30 dark:bg-red-500/[0.08] dark:text-red-400 dark:hover:bg-red-400/[0.15]"
                        >
                          {googleActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <span>Disconnect</span>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleConnectGoogle}
                          disabled={googleActionLoading}
                          className="inline-flex h-7.5 items-center justify-center rounded-full border border-black/15 bg-black/[0.03] px-3.5 text-xs font-medium whitespace-nowrap text-zinc-800 transition-colors hover:bg-black/[0.06] dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/10"
                        >
                          {googleActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <span>Connect</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Connected Google Account Sub-card if any */}
                  {googleUser ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5 rounded-xl border border-black/[0.05] bg-zinc-50/80 px-2.5 py-1.5 dark:border-white/[0.05] dark:bg-white/[0.03]">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-zinc-900 dark:text-white">
                            {googleUser?.name || googleUser?.data?.name || googleUser?.email || googleUser?.data?.email || 'Google Account'}
                          </p>
                          <p className="truncate text-[9px] text-zinc-500 dark:text-zinc-400">
                            {(googleUser?.email || googleUser?.data?.email) && (googleUser?.email || googleUser?.data?.email) !== (googleUser?.name || googleUser?.data?.name)
                              ? googleUser?.email || googleUser?.data?.email
                              : googleUser?.googleId || googleUser?.data?.googleId
                                ? `ID: ${googleUser?.googleId || googleUser?.data?.googleId}`
                                : 'Connected'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.01] px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.01]">
                      <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                        No account linked
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Canva ── */}
                <div className="sm:pl-3 lg:pl-4 flex flex-col justify-between h-full pt-3 sm:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-white/5">
                        <img src={canvaIconLogo} alt="Canva" className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-zinc-900 dark:text-white leading-tight whitespace-nowrap">
                          Canva
                        </p>
                        {canvaStatus?.connected ? (
                          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 leading-tight whitespace-nowrap">
                            Connected
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight whitespace-nowrap">
                            Not connected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {canvaStatus?.connected ? (
                        <button
                          type="button"
                          onClick={handleDisconnectCanva}
                          disabled={canvaActionLoading}
                          className="inline-flex h-7.5 items-center justify-center rounded-full border border-red-500/30 bg-red-500/[0.06] px-3.5 text-xs font-medium whitespace-nowrap text-red-500 transition-colors hover:bg-red-500/[0.12] hover:border-red-500/40 dark:border-red-400/30 dark:bg-red-500/[0.08] dark:text-red-400 dark:hover:bg-red-400/[0.15]"
                        >
                          {canvaActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <span>Disconnect</span>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleConnectCanva}
                          disabled={canvaActionLoading}
                          className="inline-flex h-7.5 items-center justify-center rounded-full border border-black/15 bg-black/[0.03] px-3.5 text-xs font-medium whitespace-nowrap text-zinc-800 transition-colors hover:bg-black/[0.06] dark:border-white/15 dark:bg-white/[0.06] dark:text-white dark:hover:bg-white/10"
                        >
                          {canvaActionLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <span>Connect</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Connected Canva Status / Sub-card */}
                  {canvaStatus?.connected ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-1.5 rounded-xl border border-black/[0.05] bg-zinc-50/80 px-2.5 py-1.5 dark:border-white/[0.05] dark:bg-white/[0.03]">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-zinc-900 dark:text-white">
                            Canva Workspace
                          </p>
                          <p className="truncate text-[9px] text-emerald-600 dark:text-emerald-400">
                            Ready to sync designs
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 rounded-xl border border-dashed border-black/[0.08] bg-black/[0.01] px-2.5 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.01]">
                      <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
                        No account linked
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            SECTION 3: CREDITS (FULL WIDTH CARD)
           ========================================================================= */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
              Credits
            </h3>
          </div>

          <div className="profile-account-card overflow-hidden rounded-2xl border border-black/[0.08] bg-white/60 p-6 shadow-sm backdrop-blur-xl transition-all hover:border-black/20 dark:border-white/[0.08] dark:bg-[#141414] dark:hover:border-white/15">
            {/* Credits Summary Row (One line) */}
            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
              <div className="flex flex-col items-center">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Total Credits
                </p>
                <div className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white pl-3.5 pr-6 py-1.5 shadow-xs transition-all hover:border-zinc-400 dark:border-white/30 dark:bg-white/[0.07] dark:shadow-none dark:hover:border-white/45">
                  <img src={adCreativeLogo} alt="Credits" className="h-[18px] w-[18px] object-contain shrink-0" />
                  <span className="text-xs font-bold text-zinc-900 dark:text-white tracking-tight tabular-nums leading-none">{credits?.creditsUsed || 0}/{credits?.totalCredits || 0}</span>
                </div>
              </div>

              {!hasPlan8 && (
                <div className="flex flex-col items-center">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Subscription
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white pl-3.5 pr-6 py-1.5 shadow-xs transition-all hover:border-zinc-400 dark:border-white/30 dark:bg-white/[0.07] dark:shadow-none dark:hover:border-white/45">
                    <img src={adCreativeLogo} alt="Subscription" className="h-[18px] w-[18px] object-contain shrink-0" />
                    <span className="text-xs font-bold text-zinc-900 dark:text-white tracking-tight tabular-nums leading-none">{credits?.subscription?.used || 0}/{credits?.subscription?.total || 0}</span>
                  </div>
                </div>
              )}

              {!hasPlan8 && (
                <div className="flex flex-col items-center">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Rolled Over
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white pl-3.5 pr-6 py-1.5 shadow-xs transition-all hover:border-zinc-400 dark:border-white/30 dark:bg-white/[0.07] dark:shadow-none dark:hover:border-white/45">
                    <img src={adCreativeLogo} alt="Rolled Over" className="h-[18px] w-[18px] object-contain shrink-0" />
                    <span className="text-xs font-bold text-zinc-900 dark:text-white tracking-tight tabular-nums leading-none">{credits?.rollover?.used || 0}/{credits?.rollover?.total || 0}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Image Models Section */}
            {extraCredits.imageModels.length > 0 && (
              <div className="mt-6 pt-5 border-t border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setShowImageModels(!showImageModels)}
                  className="flex items-center gap-2 pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                >
                  <span>IMAGE MODELS</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      showImageModels ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <AnimatePresence>
                  {showImageModels && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-2.5 pt-1">
                        <ModelCreditValue credits={extraCredits.imageModels} isImage={true} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Video Models Section */}
            {extraCredits.videoModels.length > 0 && (
              <div className="mt-6 pt-5 border-t border-black/5 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setShowVideoModels(!showVideoModels)}
                  className="flex items-center gap-2 pb-3 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
                >
                  <span>VIDEO MODELS</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      showVideoModels ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <AnimatePresence>
                  {showVideoModels && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-2.5 pt-1">
                        <ModelCreditValue credits={extraCredits.videoModels} isImage={false} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {/* =========================================================================
            SECTION 4: GENERATED IMAGE & VIDEO USAGE (FULL WIDTH CARD)
           ========================================================================= */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2 w-2 rounded-full bg-[#3B82F6]" />
            <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
              Generated Image & Video Usage
            </h3>
          </div>

          <div className="profile-account-card overflow-hidden rounded-2xl border border-black/[0.07] bg-white/60 p-6 shadow-sm backdrop-blur-xl transition-all hover:border-black/20 dark:border-white/[0.08] dark:bg-[#141414] dark:hover:border-white/15">
            <GenerationUsageGraph userId={userData?.user_id} />
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}

