import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';

/**
 * Wraps message content and lets the user highlight any text inside it to get a
 * floating "Quote" button. Clicking it calls `onQuote(selectedText)`.
 *
 * The button is portaled to <body> and fixed-positioned at the selection so it
 * isn't clipped by the scroll container.
 */
const QuotableText = ({ onQuote, children, className }) => {
  const ref = useRef(null);
  const [pop, setPop] = useState(null); // { text, x, y } in viewport coords

  const showFromSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount || !ref.current || !ref.current.contains(sel.anchorNode)) {
      setPop(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setPop(null);
      return;
    }
    setPop({ text, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  // Dismiss on scroll/resize so the button never floats out of place.
  useEffect(() => {
    if (!pop) return undefined;
    const dismiss = () => setPop(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [pop]);

  return (
    <div ref={ref} onMouseUp={showFromSelection} className={className}>
      {children}
      {pop &&
        createPortal(
          <button
            type="button"
            // preventDefault keeps the text selection alive through the click
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onQuote?.(pop.text);
              setPop(null);
              window.getSelection()?.removeAllRanges();
            }}
            style={{
              position: 'fixed',
              left: pop.x,
              top: Math.max(8, pop.y - 40),
              transform: 'translateX(-50%)',
              zIndex: 60,
            }}
            className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black shadow-lg hover:brightness-95"
          >
            <Quote className="h-3 w-3" />
            Quote
          </button>,
          document.body,
        )}
    </div>
  );
};

export default QuotableText;
