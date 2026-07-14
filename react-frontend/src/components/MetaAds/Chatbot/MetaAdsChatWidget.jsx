import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import MetaAdsChatPanel from './MetaAdsChatPanel';

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;

// Docked right-hand chat sidebar for the Meta Ads dashboard. When open it is
// an in-flow column that PUSHES the dashboard content (the dashboard's main
// area is flex-1), rather than a floating overlay that covers it. A floating
// launcher button opens it. Scoped to the dashboard's selected ad account.
const MetaAdsChatWidget = ({
  adAccountId,
  adAccountName,
  adAccountCurrency,
  campaignId,
  adSetId,
  adId,
}) => {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: DEFAULT_WIDTH });
  const rafRef = useRef(null);
  const latestClientXRef = useRef(0);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };
    setIsResizing(true);
  }, [width]);

  // stable reference — MetaAdsChatPanel is memoized so it doesn't re-render (with
  // its full transcript/cards) on every width-drag frame; a new inline function
  // here every render would defeat that.
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!isResizing) return undefined;
    // mousemove can fire far more often than the screen repaints; setWidth on every
    // event forces a reflow of the pushed dashboard content each time, which is what
    // made dragging feel janky. Coalesce to at most one width update per animation
    // frame instead.
    const applyWidth = (clientX) => {
      // handle sits on the panel's left edge — dragging left (lower clientX) grows it
      const delta = dragRef.current.startX - clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setWidth(next);
    };
    const handleMove = (e) => {
      latestClientXRef.current = e.clientX;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          applyWidth(latestClientXRef.current);
        });
      }
    };
    const handleUp = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setIsResizing(false);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  return (
    <>
      {/* launcher — floats over the main area; hidden while the panel is open */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="launcher"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(true)}
            aria-label="Open Ads Chat"
            className="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#15DCFF] to-[#6b72f8] text-white shadow-lg shadow-[#6b72f8]/30 transition-transform hover:scale-105"
          >
            <Bot className="h-6 w-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* docked sidebar — in-flow, animates its width so the dashboard reflows */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="sidebar"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: isResizing ? 0 : 0.22, ease: 'easeOut' }}
            className="relative my-4 mr-4 h-[calc(100%-2rem)] shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#161616]"
            style={{ maxWidth: '85vw' }}
          >
            {/* drag handle — resizes the panel. Must stay fully inside (left-0, not a
                negative offset) since the aside has overflow-hidden for the width
                animation; anything poking outside its bounds gets clipped and stops
                being clickable. */}
            <div
              onMouseDown={handleResizeStart}
              className="absolute top-0 left-0 z-20 h-full w-2.5 cursor-col-resize select-none"
            >
              <div className="mx-auto h-full w-px bg-transparent transition-colors hover:bg-[#15DCFF]/50" />
            </div>

            {/* fixed inner width keeps text from reflowing during the width animation */}
            <div className="flex h-full flex-col" style={{ width, maxWidth: '85vw' }}>
              <MetaAdsChatPanel
                adAccountId={adAccountId}
                adAccountName={adAccountName}
                adAccountCurrency={adAccountCurrency}
                campaignId={campaignId}
                adSetId={adSetId}
                adId={adId}
                onClose={handleClose}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};

export default MetaAdsChatWidget;
