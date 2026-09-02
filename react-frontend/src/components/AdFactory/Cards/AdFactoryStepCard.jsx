// In AdFactoryStepCard.js - Update the component to respect enabled state
import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CheckCircle, Info } from 'lucide-react';
import { ShadcnTooltip } from '@/components/layout/ShadcnTooltip';

import { useSelector } from 'react-redux';

const AdFactoryStepCard = ({ data, dragging }) => {
  const activeForm = useSelector((state) => state.adFactory?.activeForm);
  const {
    title,
    subtitle,
    type = 'default',
    status, // 'idle', 'pending', 'running', 'success', 'failed'
    progress = 0,
    icon,
    isEnabled = true,
    workflowStatus,
    onNodeClick,
    id,
    handle = { source: 'right', target: 'left' },
    infoMessage,
    // Optional `beta: true` on the node config flags an unfinished
    // step. Renders an amber "Beta" pill next to the title so users
    // know to expect rougher edges (matches the campaign-wizard
    // objective tile pattern).
    beta = false,
  } = data;

  const getNodeState = () => {
    if (!isEnabled) {
      // If node is disabled, check why
      if (
        data.isFormCompleted !== undefined &&
        !data.isFormCompleted &&
        data.status === 'idle' &&
        data.progress === 0
      ) {
        return {
          text: 'Form Incomplete',
          color: 'text-amber-400',
          bg: 'bg-amber-500/20',
          borderColor: 'border-amber-500/30',
        };
      }
      return {
        text: 'Locked',
        color: 'text-gray-400',
        bg: 'bg-gray-500/20',
        borderColor: 'border-gray-600/30',
      };
    }
    if (status === 'failed') {
      return {
        text: 'Failed',
        color: 'text-red-400',
        bg: 'bg-red-500/20',
        borderColor: 'border-red-500/30',
      };
    }
    if (status === 'pending') {
      return {
        text: 'Processing',
        color: 'text-amber-400',
        bg: 'bg-amber-500/20',
        borderColor: 'border-amber-500/30',
      };
    }

    if (status === 'success') {
      return {
        text: id === 'post-ad' || type === 'adpost' ? 'Completed' : '',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/20',
        borderColor: 'border-emerald-500/30',
      };
    }
    if (workflowStatus === 'running' || status === 'running') {
      return {
        text: 'In Progress',
        color: 'text-blue-400',
        bg: 'bg-blue-500/20',
        borderColor: 'border-blue-500/30',
      };
    }

    return {
      text:
        id !== 'image-generation' &&
        id !== 'video-generation' &&
        id !== 'text-generation' &&
        'Ready to configure',
      color: 'text-green-400',
      bg: 'bg-green-500/20',
      borderColor: 'border-green-500/30',
    };
  };
  const nodeState = getNodeState();

  // Card surface — light default, dark gradient gated behind `dark:`.
  // Disabled cards get a slightly greyer fill in both themes.
  const bgClass = !isEnabled
    ? 'bg-[linear-gradient(135deg,rgba(238,238,240,0.9),rgba(226,226,230,0.95))] dark:bg-[linear-gradient(135deg,rgba(45,45,45,0.8),rgba(30,30,30,0.9))]'
    : 'bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(247,248,250,0.95))] dark:bg-[linear-gradient(135deg,rgba(48,48,48,0.3),rgba(40,40,40,0.5))]';

  const handleClick = (e) => {
    e.stopPropagation();
    if (activeForm) return;
    if (isEnabled && onNodeClick) {
      onNodeClick(id);
    } else if (!isEnabled) {
      // Show tooltip or toast about why node is disabled
      console.log(`Node ${id} is disabled. Complete prerequisites first.`);
    }
  };

  // Determine handle positions
  const sourcePosition =
    handle?.source === 'bottom'
      ? Position.Bottom
      : handle?.source === 'top'
        ? Position.Top
        : handle?.source === 'left'
          ? Position.Left
          : Position.Right;

  const targetPosition =
    handle?.target === 'bottom'
      ? Position.Bottom
      : handle?.target === 'top'
        ? Position.Top
        : handle?.target === 'right'
          ? Position.Right
          : Position.Left;

  return (
    <div
      id={`tour_${id}`}
      className={`ad_factory_card workspace-card group relative w-80 rounded-2xl border ${bgClass} transition-all duration-200 select-none ${
        dragging
          ? 'z-50 border-blue-500 shadow-blue-500/30'
          : !isEnabled
            ? `${nodeState.borderColor} cursor-not-allowed opacity-70`
            : status === 'failed'
              ? `${nodeState.borderColor} shadow-red-500/20`
              : `${nodeState.borderColor} cursor-pointer hover:shadow-green-500/20`
      }`}
      onClick={handleClick}
    >
      {/* Handles */}
      {handle?.target && (
        <Handle
          type="target"
          position={targetPosition}
          className={`!h-3 !w-3 !border-2 !border-[#303030] ${
            !isEnabled ? '!bg-gray-600' : '!bg-zinc-400'
          } opacity-0`}
        />
      )}
      {handle?.source && (
        <Handle
          type="source"
          position={sourcePosition}
          className={`!h-3 !w-3 !border-2 !border-[#303030] ${
            !isEnabled ? '!bg-gray-600' : '!bg-zinc-400'
          } opacity-0`}
        />
      )}

      {/* Locked Overlay */}
      {!isEnabled && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/40 backdrop-blur-[1px] dark:bg-gray-900/40">
          <div className="text-center">
            <div className="mb-2 text-gray-400">
              <svg className="mx-auto h-8 w-8" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">Complete previous steps</p>
          </div>
        </div>
      )}

      {/* Node Header */}
      <div
        className={`relative flex items-start justify-between px-5 py-4 ${!isEnabled ? 'invisible' : ''}`}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src={icon} className="size-[22px]" />
            <div className={`text-[18px] font-semibold text-gray-900 dark:text-white`}>{title}</div>
            {beta && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-10 font-bold uppercase tracking-wider text-amber-300">
                Beta
              </span>
            )}
            <ShadcnTooltip label={infoMessage} side="top" className="max-w-[350px] text-sm">
              <Info className="h-4 w-4 cursor-pointer text-gray-400 hover:text-black dark:hover:text-white" />
            </ShadcnTooltip>
          </div>

          <div className={`text-sm font-semibold ${nodeState.color}`}>
            {progress > 0 && (
              <div className="flex items-center">
                <CheckCircle className="h-6 w-6" />
              </div>
            )}
          </div>
        </div>
        <div className="absolute right-0 bottom-0 left-0 h-0.5 bg-gradient-to-r from-black/30 to-black/10 opacity-40 dark:from-white dark:to-white/50 dark:opacity-20"></div>
      </div>

      <div
        className={`footer relative z-0 flex flex-col px-5 py-4 pt-4 ${!isEnabled ? 'invisible' : ''}`}
      >
        {/* Node Content */}
        {subtitle && <div className={`text-base text-gray-500 dark:text-[#AFAFAF]`}>{subtitle}</div>}

        {/* Progress Bar */}
        {(id === 'image-generation' || id === 'video-generation' || id === 'text-generation') && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-[#424242]">
            <div
              className="relative h-full overflow-hidden rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progress}%`,
                background:
                  status === 'failed'
                    ? 'linear-gradient(90deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))'
                    : 'linear-gradient(90deg, #02C8C4, #5867EB)',
              }}
            >
              {progress > 0 && progress < 100 && isEnabled && (
                <div className="absolute inset-0 animate-pulse bg-white/20"></div>
              )}
            </div>
          </div>
        )}

        {/* Node Status */}
        <div className="relative flex items-center justify-between">
          <div className={`mt-0.5 text-xs font-medium ${nodeState.color}`}>{nodeState.text}</div>
        </div>
      </div>

      {/* Hover Effect - Only show if enabled */}
      {isEnabled && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-green-500/5 to-blue-500/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
      )}
    </div>
  );
};

export default memo(AdFactoryStepCard);
