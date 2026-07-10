import React from 'react';

// One-tap follow-up chips. Tapping sends the chip's `prompt` as the next turn.
const SuggestionChips = ({ actions = [], onAction, disabled, center = false }) => {
  if (!actions.length) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${center ? 'justify-center' : ''}`}>
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onAction?.(a.prompt)}
          className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-all hover:-translate-y-0.5 hover:border-[#15DCFF]/60 hover:text-[#0082FB] hover:shadow-[0_2px_10px_-2px_rgba(21,220,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none dark:border-white/15 dark:bg-white/5 dark:text-gray-200 dark:hover:border-[#15DCFF]/50 dark:hover:text-[#15DCFF]"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
};

export default SuggestionChips;
