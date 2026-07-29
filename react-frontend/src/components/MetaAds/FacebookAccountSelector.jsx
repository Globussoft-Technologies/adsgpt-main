import { useCallback, useEffect, useRef, useState } from 'react';
import { FaFacebook } from 'react-icons/fa6';
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import { getFacebookAccounts } from '@/apis/metaAds/metaAdsApi';
import { Dropdown } from './MetaAdsAtoms';
import {
  getSelectedFacebookId,
  setSelectedFacebookId,
} from '@/utils/metaFacebookAccount';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

export default function FacebookAccountSelector({
  userId,
  onChange,
  className = '',
}) {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const select = useCallback(
    (facebookId, nextAccounts = []) => {
      const id = facebookId ? String(facebookId) : '';
      setSelectedId(id);
      setSelectedFacebookId(userId, id);
      onChangeRef.current?.(
        nextAccounts.find((account) => account.facebookId === id) || null,
      );
    },
    [userId],
  );

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await getFacebookAccounts(userId);
      const list = (response?.accounts || []).filter((account) => account.isUsable);
      setAccounts(list);

      const params = new URLSearchParams(window.location.search);
      const oauthFacebookId = params.get('facebookId');
      const stored = getSelectedFacebookId(userId);
      const preferred =
        (oauthFacebookId &&
          list.some((account) => account.facebookId === oauthFacebookId) &&
          oauthFacebookId) ||
        (stored &&
          list.some((account) => account.facebookId === stored) &&
          stored) ||
        list[0]?.facebookId ||
        '';
      select(preferred, list);

      if (oauthFacebookId) {
        params.delete('facebookId');
        params.delete('auth');
        const next =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : '') +
          window.location.hash;
        window.history.replaceState({}, '', next);
      }
    } catch {
      setAccounts([]);
      select('', []);
    } finally {
      setLoading(false);
    }
  }, [select, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = () => {
    if (!userId) return;
    const feUrl = window.location.href;
    window.location.href = `${BASE_URL}/api/auth/facebook?userId=${encodeURIComponent(userId)}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  if (!loading && accounts.length === 0) {
    return (
      <button
        type="button"
        onClick={connect}
        disabled={!userId}
        className={`flex h-9 items-center gap-1.5 rounded-xl bg-[#1877F2] px-3 text-xs font-bold text-white transition hover:bg-[#1465d4] disabled:opacity-50 ${className}`}
      >
        <FaFacebook className="h-3.5 w-3.5" />
        Connect Facebook
      </button>
    );
  }

  return (
    <div className={className}>
      <Dropdown
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <button
            type="button"
            aria-label="Facebook account"
            aria-expanded={open}
            onClick={() => !loading && accounts.length > 0 && setOpen((value) => !value)}
            disabled={loading || accounts.length === 0}
            className="flex h-9 min-w-48 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs text-gray-900 backdrop-blur-xl transition-all hover:border-gray-300 disabled:cursor-default disabled:opacity-70 dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500 dark:text-white/60" />
                <span className="font-medium">Loading accounts</span>
              </>
            ) : (
              <>
                <FaFacebook className="h-3.5 w-3.5 shrink-0 text-[#1877F2]" />
                <span className="max-w-44 flex-1 truncate text-left font-medium">
                  {accounts.find((account) => account.facebookId === selectedId)?.name ||
                    'No Facebook account'}
                </span>
                {accounts.length > 0 && (
                  <ChevronDown className="h-3 w-3 shrink-0 text-gray-500 dark:text-[#BEBEBE]" />
                )}
              </>
            )}
          </button>
        }
      >
        <div className="w-72 p-1">
          <div className="max-h-64 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
            {accounts.map((account) => {
              const active = account.facebookId === selectedId;
              return (
                <button
                  type="button"
                  key={account.facebookId}
                  onClick={() => {
                    select(account.facebookId, accounts);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                    active ? 'bg-gray-100 dark:bg-white/5' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-xs font-medium ${
                        active ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {account.name}
                    </p>
                    <p className="truncate text-10 text-gray-500 dark:text-white/55">
                      {account.email || `Facebook ID: ${account.facebookId}`}
                    </p>
                  </div>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#15DCFF]" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-gray-200 pt-1 dark:border-white/10">
            <button
              type="button"
              onClick={connect}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-[#1877F2] transition-colors hover:bg-gray-100 dark:text-[#65A4FF] dark:hover:bg-white/5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Facebook account
            </button>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
