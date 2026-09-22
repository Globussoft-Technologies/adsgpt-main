import React from 'react';

export default function AdCreativeDrawerHandle({
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClick,
  isExpanded,
  className = '',
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Drag or toggle template drawer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      className={`group relative flex w-full shrink-0 items-center justify-center pt-0 pb-[8.5px] transition-all select-none touch-none z-50 ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      } ${className}`}
    >
      <div className="relative flex items-center justify-center pointer-events-none">
        {/* Handle Pill */}
        <div
          className={`h-1.5 w-16 rounded-full transition-all duration-200 ${
            isDragging
              ? 'w-22 bg-[#8B5CF6] shadow-[0_0_14px_rgba(139,92,246,0.6)] scale-105'
              : isExpanded
              ? 'bg-[#8B5CF6]/90 group-hover:bg-[#8B5CF6]'
              : 'bg-zinc-300 dark:bg-zinc-700 group-hover:bg-zinc-400 dark:group-hover:bg-zinc-500'
          }`}
        />
      </div>
    </div>
  );
}
