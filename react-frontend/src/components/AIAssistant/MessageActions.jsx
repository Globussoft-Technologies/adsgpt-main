import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Check, Copy, ThumbsDown, ThumbsUp, Volume2, VolumeX } from 'lucide-react';
import toast from 'react-hot-toast';

import { logActivity, sendFeedback } from '@/apis/aiAssistant/aiAssistantApi';
import { setMessageFeedback } from '@/store/reducers/aiAssistant/aiAssistantSlice';

// Strip markdown / emojis before handing text to speechSynthesis.
const stripForSpeech = (text = '') => {
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#+\s?(.*)/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(emojiRegex, '')
    .replace(/\n+/g, ' ')
    .trim();
};

const ActionButton = ({ active, label, onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
      active ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white'
    }`}
  >
    {children}
  </button>
);

const MessageActions = ({
  messageId,
  conversationId,
  role, // 'user' | 'assistant'
  text,
  feedback, // { rating: 1 | -1 } | null
  className = '',
}) => {
  const dispatch = useDispatch();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pendingRating, setPendingRating] = useState(false);
  const utteranceRef = useRef(null);
  const copyTimerRef = useRef(null);

  // If the user navigates away mid-speech, kill the queued utterance.
  useEffect(() => {
    return () => {
      if (utteranceRef.current && typeof window !== 'undefined') {
        window.speechSynthesis?.cancel();
      }
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1600);
      // Fire-and-forget activity log; don't toast on failure.
      if (messageId) {
        logActivity({
          action: 'copy',
          messageId,
          conversationId,
          metadata: { role },
        }).catch(() => {});
      }
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleRate = async (rating) => {
    if (!messageId || pendingRating) return;
    // If clicking the same rating again, treat as toggle-off (clear feedback).
    const newRating = feedback?.rating === rating ? 0 : rating;
    setPendingRating(true);
    // Optimistic UI: reflect the change immediately.
    dispatch(setMessageFeedback({ messageId, rating: newRating || null }));
    try {
      if (newRating) {
        await sendFeedback({ messageId, rating: newRating });
      } else {
        // No backend "unrate" endpoint; log a neutralising activity event so
        // the analytics layer can compute a current rating from the latest one.
        await logActivity({
          action: 'feedback',
          messageId,
          conversationId,
          value: 0,
          metadata: { type: 'reset' },
        }).catch(() => {});
      }
    } catch (err) {
      // Roll back optimistic update.
      dispatch(setMessageFeedback({ messageId, rating: feedback?.rating || null }));
      toast.error(err?.response?.data?.detail || 'Failed to record feedback');
    } finally {
      setPendingRating(false);
    }
  };

  const handleReadAloud = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      toast.error('Speech is not supported in this browser');
      return;
    }
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const cleaned = stripForSpeech(text);
    if (!cleaned) return;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    synth.cancel(); // clear any previous queue
    synth.speak(utterance);
    setSpeaking(true);
    // Best-effort activity log
    if (messageId) {
      logActivity({
        action: 'read',
        messageId,
        conversationId,
        metadata: { role },
      }).catch(() => {});
    }
  };

  const liked = feedback?.rating === 1;
  const disliked = feedback?.rating === -1;

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <ActionButton onClick={handleCopy} label={copied ? 'Copied' : 'Copy'}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionButton>

      {role === 'assistant' && (
        <>
          <ActionButton
            onClick={() => handleRate(1)}
            label={liked ? 'Liked' : 'Like'}
            active={liked}
            disabled={pendingRating}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton
            onClick={() => handleRate(-1)}
            label={disliked ? 'Disliked' : 'Dislike'}
            active={disliked}
            disabled={pendingRating}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </ActionButton>
          <ActionButton
            onClick={handleReadAloud}
            label={speaking ? 'Stop' : 'Read aloud'}
            active={speaking}
          >
            {speaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </ActionButton>
        </>
      )}
    </div>
  );
};

export default MessageActions;
