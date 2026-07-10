import React, { useEffect, useState } from 'react';
import { History as HistoryIcon, Loader2, MessageSquare } from 'lucide-react';
import { Dropdown } from '../MetaAdsAtoms';
import { listChatSessions } from '@/apis/metaAds/metaChatApi';

const timeAgo = (iso) => {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

// Past-sessions dropdown for the current ad account — lets the user resume
// an earlier conversation instead of it only being reachable by a lucky
// localStorage-restored refresh. Fetches lazily, only while open.
const ChatHistoryMenu = ({ adAccountId, currentSessionId, onSelectSession }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    if (!open || !adAccountId) return;
    let cancelled = false;
    setLoading(true);
    listChatSessions(adAccountId)
      .then((r) => {
        if (!cancelled) setSessions(r.sessions || []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, adAccountId]);

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      anchor="right"
      trigger={
        <button
          onClick={() => setOpen((p) => !p)}
          disabled={!adAccountId}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/10"
          aria-label="Chat history"
          title="Chat history"
        >
          <HistoryIcon className="size-4" />
        </button>
      }
    >
      <div className="w-72 p-1">
        <p className="px-2 py-1.5 text-10 font-bold tracking-wider text-gray-400 uppercase dark:text-white/40">
          Recent conversations
        </p>
        <div className="max-h-72 overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/20">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400 dark:text-white/40" />
            </div>
          )}
          {!loading && sessions.length === 0 && (
            <p className="px-2 py-3 text-xs text-gray-400 dark:text-white/40">
              No past conversations for this account yet.
            </p>
          )}
          {!loading &&
            sessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => {
                  onSelectSession(s.sessionId);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-all hover:bg-gray-100 dark:hover:bg-white/5 ${
                  s.sessionId === currentSessionId ? 'bg-gray-100 dark:bg-white/5' : ''
                }`}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-white/30" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-gray-900 dark:text-white">
                    {s.preview || 'New conversation'}
                  </span>
                  <span className="text-10 text-gray-400 dark:text-white/40">
                    {timeAgo(s.updatedAt)} · {formatDate(s.updatedAt)}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </div>
    </Dropdown>
  );
};

export default ChatHistoryMenu;
