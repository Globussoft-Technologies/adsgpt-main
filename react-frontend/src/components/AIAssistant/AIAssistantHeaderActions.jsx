import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { History, Loader2, MessageCirclePlus, MessageSquare, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  deleteConversation as deleteConversationApi,
  getHistory,
  listConversations,
} from '@/apis/aiAssistant/aiAssistantApi';
import {
  loadConversation,
  setConversations,
  setConversationsLoading,
  startNewSession,
} from '@/store/reducers/aiAssistant/aiAssistantSlice';

const PILL_BTN =
  'backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-white/20 bg-[#0D0D0D]/50 text-xs text-[#AFAFAF] transition-colors hover:text-white has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm';

const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
};

const AIAssistantHeaderActions = () => {
  const dispatch = useDispatch();
  const { conversations, conversationsLoading, sessionId } = useSelector(
    (state) => state.aiAssistant,
  );
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState(null);

  // Refresh the conversation list each time the popover opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      dispatch(setConversationsLoading(true));
      try {
        const list = await listConversations();
        if (!cancelled) dispatch(setConversations(list || []));
      } catch (err) {
        if (!cancelled) {
          dispatch(setConversations([]));
          toast.error(err?.response?.data?.detail || 'Failed to load history');
        }
      } finally {
        if (!cancelled) dispatch(setConversationsLoading(false));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dispatch]);

  const handleNewChat = () => {
    dispatch(startNewSession());
  };

  const handleSelect = async (conv) => {
    if (!conv?.id || loadingId) return;
    setLoadingId(conv.id);
    try {
      const history = await getHistory(conv.id);
      dispatch(loadConversation({ sessionId: conv.id, messages: history || [] }));
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load conversation');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (e, conv) => {
    e.stopPropagation();
    if (!conv?.id) return;
    try {
      await deleteConversationApi(conv.id);
      // Drop it from the visible list immediately.
      dispatch(
        setConversations((conversations || []).filter((c) => c.id !== conv.id)),
      );
      // If we just deleted the currently-loaded conversation, start fresh.
      if (sessionId === conv.id) dispatch(startNewSession());
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to delete conversation');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className={PILL_BTN}>
            <History className="h-4 w-4 2xl:h-5 2xl:w-5" />
            <span>History</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[340px] max-h-[420px] overflow-hidden border border-white/10 bg-[#0D0D0D]/95 p-0 text-white backdrop-blur-xl"
        >
          <div className="border-b border-white/10 px-4 py-3 text-[13px] font-medium text-white/85">
            Conversation history
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {conversationsLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (conversations || []).length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/50">
                No past conversations yet.
              </div>
            ) : (
              <ul className="flex flex-col">
                {conversations.map((conv) => {
                  const isCurrent = conv.id === sessionId;
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(conv)}
                        className={`group flex w-full items-start gap-2 border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5 ${
                          isCurrent ? 'bg-white/5' : ''
                        }`}
                      >
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] text-white/90">
                              {conv.title || 'Untitled'}
                            </span>
                            <span className="shrink-0 text-[10px] text-white/40">
                              {formatRelativeTime(conv.updatedAt)}
                            </span>
                          </div>
                          {conv.lastMessage && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-white/50">
                              {conv.lastMessage}
                            </p>
                          )}
                        </div>
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => handleDelete(e, conv)}
                          className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/40 hover:text-red-400 group-hover:flex"
                          aria-label="Delete conversation"
                        >
                          {loadingId === conv.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="ghost" onClick={handleNewChat} className={PILL_BTN}>
        <MessageCirclePlus className="h-4 w-4 2xl:h-5 2xl:w-5" />
        <span>New Chat</span>
      </Button>
    </div>
  );
};

export default AIAssistantHeaderActions;
