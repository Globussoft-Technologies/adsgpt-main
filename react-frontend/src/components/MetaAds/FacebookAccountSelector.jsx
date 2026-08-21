import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaFacebook, FaFacebookF } from 'react-icons/fa6';
import { AlertTriangle, Check, ChevronDown, Loader2, Plus, Settings2 } from 'lucide-react';
import { getFacebookAccounts } from '@/apis/metaAds/metaAdsApi';
import { Dropdown } from './MetaAdsAtoms';
import {
  getSelectedFacebookId,
  setSelectedFacebookId,
} from '@/utils/metaFacebookAccount';
import { GA4Events } from '@/utils/ga4';

const BASE_URL = import.meta.env.VITE_SOCKET_URL;

export default function FacebookAccountSelector({
  userId,
  onChange,
  className = '',
  preferredFacebookId = '',
  disabled = false,
  variant = 'default',
  dropdownAnchor = 'right',
  showManageAccounts = false,
  onLoadingChange,
}) {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const onChangeRef = useRef(onChange);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const preferredFacebookIdRef = useRef(preferredFacebookId);
  const accountsRef = useRef(accounts);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  }, [onLoadingChange]);
  useEffect(() => {
    preferredFacebookIdRef.current = preferredFacebookId;
  }, [preferredFacebookId]);
  useEffect(() => {
    onLoadingChangeRef.current?.(loading);
  }, [loading]);

  const select = useCallback(
    (facebookId, nextAccounts) => {
      const id = facebookId ? String(facebookId) : '';
      setSelectedId(id);
      if (userId) {
        setSelectedFacebookId(userId, id);
      }
      const accountList =
        nextAccounts && nextAccounts.length > 0 ? nextAccounts : accountsRef.current;
      onChangeRef.current?.(
        accountList.find((account) => account.facebookId === id) || null,
      );
    },
    [userId],
  );

  const load = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      setSelectedId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await getFacebookAccounts(userId);
      const list = (response?.accounts || []).filter((account) => account.isUsable);
      setAccounts(list);

      const params = new URLSearchParams(window.location.search);
      const oauthFacebookId = params.get('facebookId');
      const stored = getSelectedFacebookId(userId);
      const preferredFacebookIdValue = preferredFacebookIdRef.current;
      const preferred =
        (preferredFacebookIdValue &&
          list.some((account) => account.facebookId === String(preferredFacebookIdValue)) &&
          String(preferredFacebookIdValue)) ||
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

  // A saved job can hydrate its preferred account after the list request has
  // already completed. Select it from the loaded list without fetching the
  // same accounts again. This also prevents our own onChange from causing a
  // second loading cycle when the first account is selected automatically.
  useEffect(() => {
    if (loading || !preferredFacebookId) return;
    const preferred = String(preferredFacebookId);
    if (preferred === selectedId) return;
    if (accounts.some((account) => account.facebookId === preferred)) {
      select(preferred, accounts);
    }
  }, [accounts, loading, preferredFacebookId, select, selectedId]);

  const connect = () => {
    if (!userId) return;
    try {
      GA4Events?.accountConnectionStarted?.('meta');
    } catch {
      // ignore analytics tracking failures
    }
    const feUrl = window.location.href;
    window.location.href = `${BASE_URL}/api/auth/facebook?userId=${encodeURIComponent(userId)}&feUrl=${encodeURIComponent(feUrl)}`;
  };

  if (variant === 'card') {
    if (loading) {
      return (
        <div className={`flex items-center gap-2 rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] p-3 text-xs text-[#7A7369] shadow-xs dark:border-white/10 dark:bg-[#13171A] dark:text-white/60 ${className}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#1877F2]" />
          <span>Loading Facebook accounts…</span>
        </div>
      );
    }

    if (accounts.length === 0) {
      return (
        <div className={`flex items-center gap-2 self-start rounded-full border border-amber-500/30 bg-amber-500/10 py-1 pr-1 pl-3 ${className}`}>
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <span className="text-xs font-medium text-amber-900 dark:text-white">Meta not connected — required to activate</span>
          <button
            type="button"
            onClick={connect}
            disabled={!userId}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1877F2] px-2.5 py-0.5 text-xs font-medium text-white transition hover:bg-[#1665d8] disabled:opacity-50"
          >
            <FaFacebookF className="size-3" />
            Connect
          </button>
        </div>
      );
    }

    return (
      <div className={`w-full max-w-sm rounded-2xl border border-[#DDD7CD] bg-[#FCFAF7] p-2.5 shadow-xs dark:border-white/10 dark:bg-[#13171A] ${className}`}>
        <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
          {accounts.map((account) => {
            const active = account.facebookId === selectedId;
            return (
              <div
                key={account.facebookId}
                onClick={() => !disabled && select(account.facebookId, accounts)}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-all cursor-pointer ${active
                  ? 'bg-[#EAE5DC] dark:bg-[#1C2228] border border-transparent dark:border-white/5'
                  : 'hover:bg-[#EAE5DC] dark:hover:bg-white/5 opacity-80'
                  }`}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-xs font-semibold ${active ? 'text-[#0082FB]' : 'text-[#24211D] dark:text-white'
                      }`}
                  >
                    {account.name}
                  </p>
                  <p className="truncate text-[11px] text-[#7A7369] dark:text-white/55 mt-0.5">
                    {account.email || `Facebook ID: ${account.facebookId}`}
                  </p>
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-[#0082FB]" />}
              </div>
            );
          })}
        </div>
        <div className="mt-2 border-t border-[#DDD7CD] pt-2 dark:border-white/10">
          <button
            type="button"
            onClick={connect}
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-xs font-medium text-[#1877F2] transition-colors hover:bg-[#EAE5DC] dark:text-[#65A4FF] dark:hover:bg-white/5 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Facebook account
          </button>
        </div>
      </div>
    );
  }

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
        anchor={dropdownAnchor}
        trigger={
          <button
            type="button"
            aria-label="Facebook account"
            aria-expanded={open}
            onClick={() => !disabled && !loading && accounts.length > 0 && setOpen((value) => !value)}
            disabled={disabled || loading || accounts.length === 0}
            className="flex h-9 min-w-48 items-center gap-2 rounded-xl border border-[#DDD7CD] bg-[#FCFAF7] px-3 text-xs text-[#24211D] shadow-xs backdrop-blur-xl transition-all hover:border-[#DDD7CD] hover:bg-[#EAE5DC] disabled:cursor-default disabled:opacity-70 dark:border-white/[0.06] dark:bg-[#171717] dark:text-white dark:hover:border-white/10"
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
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-[#EAE5DC] dark:hover:bg-white/5 ${active ? 'bg-[#EAE5DC] dark:bg-white/5' : ''
                    }`}
                >
                  <div className="min-w-0">
                    <p
                      className={`truncate text-xs font-medium ${active ? 'text-[#0082FB]' : 'text-[#24211D] dark:text-white'
                        }`}
                    >
                      {account.name}
                    </p>
                    <p className="truncate text-[11px] text-[#7A7369] dark:text-white/55">
                      {account.email || `Facebook ID: ${account.facebookId}`}
                    </p>
                  </div>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#0082FB]" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-[#DDD7CD] pt-1 dark:border-white/10">
            <button
              type="button"
              onClick={connect}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-[#1877F2] transition-colors hover:bg-[#EAE5DC] dark:text-[#65A4FF] dark:hover:bg-white/5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Facebook account
            </button>
            {showManageAccounts && (
              <Link
                to="/profile"
                onClick={() => setOpen(false)}
                className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-medium text-[#7A7369] transition-colors hover:bg-[#EAE5DC] hover:text-[#24211D] dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage accounts
              </Link>
            )}
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
