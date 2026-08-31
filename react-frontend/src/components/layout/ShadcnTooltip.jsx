import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function ShadcnTooltip({ label, children, side = 'top', className = '' }) {
  if (!label) return children;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className={`pointer-events-none z-[1000] motion-reduce:animate-none ${className}`}
      >
        <p className="text-10 capitalize 2xl:text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
