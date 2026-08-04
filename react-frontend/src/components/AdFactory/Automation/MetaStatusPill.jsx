import React from 'react';
import { useSelector } from 'react-redux';
import { AlertTriangle } from 'lucide-react';
import { FaFacebookF } from 'react-icons/fa6';
import { toast } from 'react-toastify';
import { useSearchParams } from 'react-router-dom';

// ----------------------------------------------------------------------------
// MetaStatusPill — single-row Meta connection chip.
// Lives in ServicesForm's fixed top area so it doesn't scroll with the form
// body. Owns its own state lookup so the parent doesn't have to thread
// fbUser/userData props through.
// ----------------------------------------------------------------------------

const BACKEND_HOST = import.meta.env.VITE_SOCKET_URL;
const REOPEN_AFTER_FB_KEY = 'adsgpt:reopen-automation-for';

const buildFbAuthUrl = ({ userId, feUrl }) =>
  `${BACKEND_HOST}/api/auth/facebook?userId=${userId}&feUrl=${encodeURIComponent(feUrl)}`;

export default function MetaStatusPill() {
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId');

  const { userData } = useSelector((state) => state.socket);

  const handleConnect = () => {
    if (!userData?.user_id) {
      toast.error('Please sign in to connect Facebook.');
      return;
    }
    // Leave a breadcrumb so AdFactoryPage reopens the Services modal in
    // Schedule mode when the user bounces back from Meta auth. The form
    // itself starts empty after the round-trip — drafts are not persisted.
    if (campaignId) {
      sessionStorage.setItem(REOPEN_AFTER_FB_KEY, campaignId);
    }
    const feUrl = window.location.href;
    window.location.href = buildFbAuthUrl({ userId: userData.user_id, feUrl });
  };

  return (
    <div className="flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 py-1 pr-1 pl-3">
      <AlertTriangle className="size-3.5 shrink-0 text-amber-300" />
      <span className="text-xs text-white">Meta not connected — required to activate</span>
      <button
        type="button"
        onClick={handleConnect}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#1877F2] px-2.5 py-0.5 text-xs font-medium text-white transition hover:bg-[#1665d8]"
      >
        <FaFacebookF className="size-3" />
        Connect
      </button>
    </div>
  );
}
