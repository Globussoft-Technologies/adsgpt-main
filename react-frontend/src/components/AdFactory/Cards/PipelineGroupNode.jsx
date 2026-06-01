// PipelineGroupNode — collapsible container that wraps either the manual
// (Image Gen → Text Gen → Prepare → Post Ad) or the automation
// (Automation Active → Result) sub-pipeline.
//
// Three rendered states:
//   - collapsed + inactive: padlock placeholder (matches the "Complete
//     previous steps" lock card used elsewhere in the workflow)
//   - collapsed + active:   icon + title + Maximize2 fullscreen arrow on
//     the right, a horizontal divider, then subtitle + accent status line
//   - expanded:             full-bleed chrome (header + minimize button)
//     with inner children rendered on top via ReactFlow's parentId

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Hammer, Zap, Info, Lock, Maximize2, Minimize2 } from 'lucide-react';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

const VARIANTS = {
  manual: {
    Icon: Hammer,
    borderInactive: 'border-white/10',
    borderActive: 'border-emerald-400/60',
    borderExpanded: 'border-emerald-400/40',
    accentColor: '#34D399',
    accentText: 'text-emerald-400',
    hoverBorder: 'hover:border-emerald-400/60',
  },
  auto: {
    Icon: Zap,
    borderInactive: 'border-white/10',
    borderActive: 'border-[#15DCFF]/60',
    borderExpanded: 'border-[#15DCFF]/40',
    accentColor: '#15DCFF',
    accentText: 'text-[#15DCFF]',
    hoverBorder: 'hover:border-[#15DCFF]/60',
  },
};

const PipelineGroupNode = ({ data, dragging }) => {
  const {
    variant = 'manual',
    title,
    subtitle,
    inactiveText = 'Complete previous steps',
    isActive = false,
    expanded = false,
    onToggleExpand,
    id,
    infoMessage,
  } = data || {};

  const cfg = VARIANTS[variant] || VARIANTS.manual;
  const { Icon } = cfg;

  // Inactive group cards are strictly non-interactive — the user has to
  // complete the upstream step (generate a result / set up an automation)
  // before they can drill into the pipeline.
  const isClickable = !expanded && isActive;

  const handleCardClick = (e) => {
    if (!isClickable || dragging) return;
    e.stopPropagation();
    onToggleExpand?.(id);
  };

  const handleMinimize = (e) => {
    e.stopPropagation();
    onToggleExpand?.(id);
  };

  const borderClass = expanded
    ? cfg.borderExpanded
    : isActive
      ? cfg.borderActive
      : cfg.borderInactive;

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : -1}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (!isClickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick(e);
        }
      }}
      className={`group relative rounded-2xl border backdrop-blur-3xl transition-all duration-300 select-none ${
        expanded
          ? 'h-full w-full'
          : isClickable
            ? `cursor-pointer ${cfg.hoverBorder}`
            : 'cursor-not-allowed'
      } ${borderClass} ${dragging ? 'z-50' : ''}`}
      style={{
        background:
          'linear-gradient(135deg, rgba(48, 48, 48, 0.3), rgba(40, 40, 40, 0.5))',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="h-3! w-3! border-2! border-[#303030]! bg-zinc-400! opacity-0"
      />

      {expanded ? (
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/5">
                <Icon className="size-4 text-white" />
              </span>
              <h3 className="text-18 font-semibold text-white">{title}</h3>
              {infoMessage && (
                <ShadcnTooltip
                  label={infoMessage}
                  side="top"
                  className="max-w-87.5 text-sm"
                >
                  <Info className="h-4 w-4 cursor-pointer text-gray-400 hover:text-white" />
                </ShadcnTooltip>
              )}
            </div>
            <button
              type="button"
              title="Minimize"
              onClick={handleMinimize}
              className="flex size-7 items-center justify-center rounded border border-white/10 bg-white/3 text-[#AFAFAF] transition hover:border-white/20 hover:bg-white/6 hover:text-white"
            >
              <Minimize2 className="size-3.5" />
            </button>
          </div>
          {/* Body left intentionally empty — children render on top of this
              node via ReactFlow's parentId. */}
        </div>
      ) : !isActive ? (
        // Locked placeholder — node-specific text below a padlock icon.
        <div className="flex w-80 flex-col items-center justify-center gap-2 px-5 py-8">
          <Lock className="size-7 text-gray-400" />
          <p className="text-center text-sm text-gray-300">{inactiveText}</p>
        </div>
      ) : (
        // Active / ready — icon + title + fullscreen arrow, divider, then
        // subtitle and accent-coloured status line.
        <div className="flex w-80 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/5">
                <Icon className="size-4 text-white" />
              </span>
              <h3 className="text-18 font-semibold text-white">{title}</h3>
            </div>
            <Maximize2 className="size-4 text-[#AFAFAF]" />
          </div>
          <div className="flex flex-col gap-1 px-5 py-4">
            {subtitle && <p className="text-sm text-[#AFAFAF]">{subtitle}</p>}
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="h-3! w-3! border-2! border-[#303030]! bg-zinc-400! opacity-0"
      />
    </div>
  );
};

const ManualGroupNode = memo((props) => (
  <PipelineGroupNode {...props} data={{ ...props.data, variant: 'manual' }} />
));
ManualGroupNode.displayName = 'ManualGroupNode';

const AutoGroupNode = memo((props) => (
  <PipelineGroupNode {...props} data={{ ...props.data, variant: 'auto' }} />
));
AutoGroupNode.displayName = 'AutoGroupNode';

export { ManualGroupNode, AutoGroupNode };
export default memo(PipelineGroupNode);
