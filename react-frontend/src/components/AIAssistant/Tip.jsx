import * as TooltipPrimitive from '@radix-ui/react-tooltip';

// Small, polished tooltip for the AI Assistant / Creative Studio surface.
// Replaces the browser's native `title=""` bubbles (delayed, unstyled, cramped)
// with a dark, rounded, readable popover that matches the rest of the UI.
//
// Usage: <Tip content="…"><button…/></Tip>
// The child becomes the trigger (asChild), so it must be a single element that
// forwards a ref (native elements and most components do).
const Tip = ({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 150,
  className = '',
}) => {
  // Nothing to show → render the child untouched (no dangling trigger).
  if (content == null || content === '') return children;
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={10}
            className={`animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[999] max-w-[260px] rounded-lg border border-white/10 bg-[#1c1c22]/95 px-3 py-2 text-[11.5px] leading-relaxed text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-sm ${className}`}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-[#1c1c22]" width={11} height={6} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};

export default Tip;
