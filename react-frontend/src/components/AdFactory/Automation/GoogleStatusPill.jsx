import React from 'react';
import { useSelector } from 'react-redux';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { toast } from 'react-toastify';
import { useSearchParams } from 'react-router-dom';
import getCookies from '@/utils/getCookies';

// ----------------------------------------------------------------------------
// GoogleStatusPill — mirror of MetaStatusPill for the Google provider.
// Same shape, same placement convention. Reads googleUser from the
// adFactoryNew slice (populated by checkGoogleUser on page mount + on every
// FbConnectStep / Services modal open).
// ----------------------------------------------------------------------------

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const REOPEN_AFTER_FB_KEY = 'adsgpt:reopen-automation-for';

const buildGoogleAuthUrl = ({ userId, feUrl }) =>
  `${BACKEND_HOST}/api/auth/google?userId=${userId}&token=${getCookies()}&feUrl=${encodeURIComponent(feUrl)}`;

export default function GoogleStatusPill() {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');

  const { googleUser } = useSelector((state) => state.adFactoryNew);
  const { userData } = useSelector((state) => state.socket);
  // Google's connected check mirrors the Meta one — the presence of a
  // populated email/sub from the backend means OAuth is good.
  const isConnected = !!(googleUser?.email || googleUser?.googleId || googleUser?.sub);

  const handleConnect = () => {
    if (!userData?.user_id) {
      toast.error('Please sign in to connect Google.');
      return;
    }
    // Same breadcrumb mechanism as Meta — AdFactoryPage uses this key to
    // reopen the Services modal in Schedule mode after the OAuth roundtrip.
    if (campaignId) {
      sessionStorage.setItem(REOPEN_AFTER_FB_KEY, campaignId);
    }
    const feUrl = window.location.href;
    window.location.href = buildGoogleAuthUrl({ userId: userData.user_id, feUrl });
  };

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 py-1 pr-3 pl-1">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white">
          <FcGoogle className="size-4" />
        </div>
        <span className="text-xs font-medium text-white">
          Google{' '}
          {googleUser?.name || googleUser?.email ? (
            <>
              · <span className="text-[#E3E3E3]">{googleUser.name || googleUser.email}</span>
            </>
          ) : (
            'connected'
          )}
        </span>
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 py-1 pr-1 pl-3">
      <AlertTriangle className="size-3.5 shrink-0 text-amber-300" />
      <span className="text-xs text-white">Google not connected — required to activate</span>
      <button
        type="button"
        onClick={handleConnect}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-900 transition hover:bg-gray-100"
      >
        <FcGoogle className="size-3.5" />
        Connect
      </button>
    </div>
  );
}
