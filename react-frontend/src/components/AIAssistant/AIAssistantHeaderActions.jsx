import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { History, Loader2, MessageCirclePlus, MessageSquare, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  deleteConversation as deleteConversationApi,
  getConversationStatus,
  getHistory,
  listConversations,
} from '@/apis/aiAssistant/aiAssistantApi';
import { cleanHistoryText } from './historyText';
import {
  loadConversation,
  setConversations,
  setConversationsLoading,
  startNewSession,
} from '@/store/reducers/aiAssistant/aiAssistantSlice';

const PILL_BTN =
  'backdrop-blur-100 relative flex h-8 items-center gap-2 rounded-full border border-black/10 bg-white/70 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-black has-[>svg]:px-4 2xl:h-9 2xl:px-5 2xl:text-sm dark:border-white/20 dark:bg-[#0D0D0D]/50 dark:text-[#AFAFAF] dark:hover:bg-[#2A2A2A]/70 dark:hover:text-white';

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
  // Conversation queued for deletion, awaiting confirmation. Keeps the History
  // popover open behind the dialog so the list doesn't disappear mid-confirm.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      // Fetch the run state alongside the transcript — a turn started here may
      // still be generating in the background, and the messages alone can't say.
      const [history, status] = await Promise.all([
        getHistory(conv.id),
        getConversationStatus(conv.id).catch(() => ({ generating: false })),
      ]);
      dispatch(
        loadConversation({
          sessionId: conv.id,
          messages: history || [],
          generating: !!status?.generating,
        }),
      );
      setOpen(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load conversation');
    } finally {
      setLoadingId(null);
    }
  };

  // Step 1: clicking the trash icon only queues the conversation for deletion
  // and opens a confirmation dialog — it no longer deletes immediately.
  const handleDeleteClick = (e, conv) => {
    e.stopPropagation();
    if (!conv?.id) return;
    setPendingDelete(conv);
  };

  // Step 2: actually delete, only after the user confirms in the dialog.
  const confirmDelete = async () => {
    const conv = pendingDelete;
    if (!conv?.id) return;
    setDeleting(true);
    try {
      await deleteConversationApi(conv.id);
      // Drop it from the visible list immediately.
      dispatch(
        setConversations((conversations || []).filter((c) => c.id !== conv.id)),
      );
      // If we just deleted the currently-loaded conversation, start fresh.
      if (sessionId === conv.id) dispatch(startNewSession());
      setPendingDelete(null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to delete conversation');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Keep the history list open behind the confirmation dialog.
          if (!next && pendingDelete) return;
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" className={PILL_BTN}>
            <History className="h-4 w-4 2xl:h-5 2xl:w-5" />
            <span>History</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[340px] max-h-[420px] overflow-hidden border border-black/10 bg-white/95 p-0 text-zinc-900 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#0D0D0D]/95 dark:text-white"
        >
          <div className="border-b border-black/10 px-4 py-3 text-[13px] font-medium text-zinc-800 dark:border-white/10 dark:text-white/85">
            Conversation history
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {conversationsLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-zinc-500 dark:text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (conversations || []).length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-zinc-500 dark:text-white/50">
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
                        className={`group flex w-full items-start gap-2 border-b border-black/5 px-4 py-3 text-left transition-colors hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5 ${
                          isCurrent ? 'bg-black/5 dark:bg-white/5' : ''
                        }`}
                      >
                        <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-white/45" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] text-zinc-900 dark:text-white/90">
                              {cleanHistoryText(conv.title) || 'Untitled'}
                            </span>
                            <span className="shrink-0 text-[10px] text-zinc-400 dark:text-white/40">
                              {formatRelativeTime(conv.updatedAt)}
                            </span>
                          </div>
                          {cleanHistoryText(conv.lastMessage) && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500 dark:text-white/50">
                              {cleanHistoryText(conv.lastMessage)}
                            </p>
                          )}
                        </div>
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => handleDeleteClick(e, conv)}
                          className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:text-red-500 group-hover:flex dark:text-white/40 dark:hover:text-red-400"
                          aria-label="Delete conversation"
                        >
                          <Trash2 className="h-3 w-3" />
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

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(next) => {
          if (!next && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-sm border border-black/10 bg-white/95 text-zinc-900 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#0D0D0D]/95 dark:text-white">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription className="text-zinc-500 dark:text-white/60">
              {pendingDelete?.title
                ? `"${pendingDelete.title}" will be permanently deleted. This can't be undone.`
                : "This conversation will be permanently deleted. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className="border border-black/15 text-zinc-700 hover:bg-black/5 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AIAssistantHeaderActions;
