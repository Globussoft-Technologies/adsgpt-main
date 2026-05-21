import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FaFacebookF } from 'react-icons/fa6';
import { CheckCircle2, LogOut, AlertTriangle } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import googleAdsIcon from '@/assets/layouts/google-ads-icon.png';
import getCookies from '@/utils/getCookies';
import { metaDisconnect } from '@/apis/metaAds/metaAdsApi';
import {
  checkFbUser,
  checkGoogleUser,
  disconnectGoogleUser,
} from '@/store/actions/adFactoryNew/adFactoryActions';
import { clearFbUser } from '@/store/reducers/adFactoryNew/adFactoryNewSlice';
import { toast } from 'react-toastify';

const getGoogleAuthUrl = (feUrl) =>
  `${import.meta.env.VITE_SOCKET_URL}/api/auth/google?token=${getCookies()}&feUrl=${encodeURIComponent(feUrl)}`;

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;

const PLATFORMS = [
  {
    key: 'facebook',
    label: 'Facebook',
    icon: FaFacebookF,
    iconBg: 'bg-[#1877F2]',
    glowColor: 'shadow-[0_0_30px_-8px_#1877F2]',
    gradientFrom: 'from-[#1877F2]',
    gradientVia: 'via-[#1b74e4]',
    gradientTo: 'to-[#0f5bd7]',
    getAuthUrl: ({ userId, feUrl }) =>
      `${BACKEND_HOST}/api/auth/facebook?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`,
    available: true,
  },
  {
    key: 'google',
    label: 'Google',
    iconImg: googleAdsIcon,
    iconBg: 'bg-white',
    glowColor: 'shadow-[0_0_30px_-8px_#4285F4]',
    gradientFrom: 'from-[#4285F4]',
    gradientVia: 'via-[#34A853]',
    gradientTo: 'to-[#EA4335]',
    getAuthUrl: ({ feUrl }) => getGoogleAuthUrl(feUrl),
    available: true,
  },
];

const DisconnectModal = ({ platformLabel, onConfirm, onCancel, isLoading }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1a1a1a] p-6 shadow-2xl">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
          <AlertTriangle className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Disconnect {platformLabel}?</h3>
          <p className="text-xs text-gray-400">This will remove your connected account.</p>
        </div>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1 rounded-xl border border-white/10 py-2 text-sm text-gray-400 transition hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isLoading}
          className="flex-1 rounded-xl bg-red-500/20 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/30 disabled:opacity-50"
        >
          {isLoading ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  </div>
);

const PlatformCard = ({ platform, payload, isConnected, isDisconnecting, onSelectPlatform, onDisconnect }) => {
  const Icon = platform.icon;
  const renderIcon = (sizeClass) =>
    platform.iconImg ? (
      <img src={platform.iconImg} alt={platform.label} className={`${sizeClass} rounded-full object-cover`} />
    ) : (
      <Icon className={`${sizeClass} ${platform.iconColor ?? 'text-white'}`} />
    );

  const handleClick = () => {
    if (!platform.available) return;
    if (isConnected) {
      onSelectPlatform(platform.key);
    } else {
      const { userId, feUrl } = payload;
      window.location.href = platform.getAuthUrl({ userId, feUrl });
    }
  };

  return (
    <div className="group relative flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-white/[0.08] sm:flex-row sm:gap-5">
      {/* Platform icon */}
      <div
        className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${platform.iconImg ? 'bg-transparent' : `bg-linear-to-br ${platform.gradientFrom} ${platform.gradientVia} ${platform.gradientTo} ${platform.glowColor}`}`}
      >
        {!platform.iconImg && (
          <div className="absolute inset-0.5 rounded-full bg-linear-to-br from-white/20 to-transparent" />
        )}
        <span className="relative z-10">{renderIcon(platform.iconImg ? 'h-14 w-14' : 'h-6 w-6')}</span>
      </div>

      {/* Label + status */}
      <div className="flex flex-1 flex-col items-center text-center sm:items-start sm:text-left">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold text-white">{platform.label}</span>
          {isConnected && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
        </div>
        {!platform.comingSoon && (
          <span className="mt-0.5 text-xs text-white/80">
            {isConnected ? 'Connected — click to continue' : 'Click to connect your account'}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {isConnected && !isDisconnecting && (
          <button
            onClick={() => onDisconnect(platform.key)}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 text-sm font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            Disconnect
          </button>
        )}
        <Button
          disabled={!platform.available}
          onClick={handleClick}
          className={`backdrop-blur-100 relative flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-5 text-sm font-medium transition-all duration-200
            ${
              platform.available
                ? isConnected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300'
                  : 'border-white/10 bg-[#0D0D0D]/60 text-[#AFAFAF] hover:border-white/20 hover:bg-[#0D0D0D]/80 hover:text-white'
                : 'cursor-not-allowed border-white/5 bg-[#0D0D0D]/30 text-gray-600'
            }
          `}
        >
          <div className={`flex h-5 w-5 items-center justify-center rounded-full ${platform.iconBg}`}>
            {renderIcon('h-3 w-3')}
          </div>
          <span
            className={
              platform.available
                ? isConnected
                  ? ''
                  : 'bg-linear-to-t from-[#15DCFF] to-[#6b72f8] bg-clip-text text-transparent group-hover:text-white/70'
                : 'text-gray-600'
            }
          >
            {!platform.available ? 'Unavailable' : isConnected ? 'Connected' : `Connect ${platform.label}`}
          </span>
        </Button>
      </div>
    </div>
  );
};

const FbConnectStep = ({ onSelectPlatform }) => {
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.socket);
  const { fbUser, googleUser } = useSelector((state) => state.adFactoryNew);
  const feUrl = window.location.href;

  const [confirmPlatform, setConfirmPlatform] = useState(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectedKeys, setDisconnectedKeys] = useState(new Set());

  useEffect(() => {
    if (userData?.user_id) {
      dispatch(checkFbUser(userData.user_id));
      dispatch(checkGoogleUser(userData.user_id));
    }
  }, [dispatch, userData?.user_id]);

  const payload = { feUrl, userId: userData?.user_id };

  const connectedKeys = {
    facebook: !!fbUser?.facebookId,
    google: !!googleUser,
  };

  const handleDisconnect = (platformKey) => {
    setConfirmPlatform(platformKey);
  };

  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      if (confirmPlatform === 'facebook') {
        await metaDisconnect(userData?.user_id);
        dispatch(clearFbUser());
        setDisconnectedKeys((prev) => new Set(prev).add('facebook'));
        dispatch(checkFbUser(userData?.user_id));
        toast.success('Facebook account disconnected successfully');
      } else if (confirmPlatform === 'google') {
        await dispatch(disconnectGoogleUser(userData?.user_id)).unwrap();
        setDisconnectedKeys((prev) => new Set(prev).add('google'));
        dispatch(checkGoogleUser(userData?.user_id));
        toast.success('Google account disconnected successfully');
      }
    } catch (e) {
      console.error('Disconnect failed:', e);
      toast.error('Failed to disconnect. Please try again.');
    } finally {
      setIsDisconnecting(false);
      setConfirmPlatform(null);
    }
  };

  return (
    <>
      {confirmPlatform && (
        <DisconnectModal
          platformLabel={PLATFORMS.find((p) => p.key === confirmPlatform)?.label}
          onConfirm={handleConfirmDisconnect}
          onCancel={() => setConfirmPlatform(null)}
          isLoading={isDisconnecting}
        />
      )}

      <div className="flex w-full flex-col items-center justify-center space-y-8 px-4 text-center">
        {/* Header */}
        <div className="max-w-md space-y-2">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">Connect Your Accounts</h2>
          <p className="text-sm leading-relaxed text-gray-400 sm:text-base">
            Link your social platforms to start creating and publishing ads.
          </p>
        </div>

        {/* Platform cards */}
        <div className="w-full max-w-lg space-y-3">
          {PLATFORMS.map((platform) => (
            <PlatformCard
              key={platform.key}
              platform={platform}
              payload={payload}
              isConnected={(connectedKeys[platform.key] ?? false) && !disconnectedKeys.has(platform.key)}
              isDisconnecting={isDisconnecting && confirmPlatform === platform.key}
              onSelectPlatform={onSelectPlatform}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      </div>
    </>
  );
};

export default FbConnectStep;
