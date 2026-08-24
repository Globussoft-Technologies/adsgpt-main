import React, { memo, useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Pause,
  Play,
  Pencil,
  Square as StopIcon,
  ImageIcon,
  Send,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { describeFrequency } from '@/store/reducers/adFactoryAutomation/nextRun';
import { AUTOMATION_STATUS } from '@/store/reducers/adFactoryAutomation/constants';

// ----------------------------------------------------------------------------
// Per-status visual config — colour, title, badge tint, header icon, and
// which lifecycle buttons make sense for the state. Single source of truth
// so adding a new backend state is one entry, not five render branches.
// ----------------------------------------------------------------------------
const STATE_CONFIG = {
  [AUTOMATION_STATUS.ACTIVE]: {
    title: 'Automation active',
    dotColor: '#15DCFF',
    pulse: true,
    border: 'border-[#15DCFF]/30',
    badge: 'border-[#15DCFF]/30 bg-[#15DCFF]/10 text-[#15DCFF]',
    badgeIcon: null,
    nextLabel: 'Next cycle',
    countdownEnabled: true,
    showPause: true,
    showResume: false,
    showStop: true,
  },
  [AUTOMATION_STATUS.PAUSED]: {
    title: 'Automation paused',
    dotColor: '#FBBF24',
    pulse: false,
    border: 'border-amber-400/30',
    badge: 'border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-200',
    badgeIcon: null,
    nextLabel: 'Paused — next',
    countdownEnabled: false,
    showPause: false,
    showResume: true,
    showStop: true,
  },
  [AUTOMATION_STATUS.COMPLETED]: {
    title: 'Schedule completed',
    dotColor: '#34D399',
    pulse: false,
    border: 'border-emerald-400/30',
    badge: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-200',
    badgeIcon: <CheckCircle2 className="size-3" />,
    nextLabel: 'Finished',
    countdownEnabled: false,
    showPause: false,
    showResume: false,
    showStop: true,
  },
  [AUTOMATION_STATUS.FAILED]: {
    title: 'Automation failed',
    dotColor: '#F87171',
    pulse: false,
    border: 'border-red-500/30',
    badge: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-200',
    badgeIcon: <AlertTriangle className="size-3" />,
    nextLabel: 'Failed',
    countdownEnabled: false,
    showPause: false,
    showResume: false,
    showStop: true,
  },
};

// ----------------------------------------------------------------------------
// AutomationActiveNode — React Flow node that replaces the image-gen /
// text-gen / preview / post-ad cluster when automation is running.
//
// Visual language deliberately matches AdFactoryStepCard: same w-80 width,
// rounded-2xl, backdrop-blur, and the same dark-gradient background. The
// active-state cue is a subtle border tint + pulsing dot — not a heavy glow.
//
// Data via `data`:
//   { status, frequency, stats: { generated, posted, lastRunAt, nextRunAt },
//     onPause, onResume, onEdit, onStop, onViewHistory }
// ----------------------------------------------------------------------------

const AutomationActiveNode = ({ data, dragging }) => {
  const {
    status = AUTOMATION_STATUS.ACTIVE,
    frequency,
    stats = {},
    onPause,
    onResume,
    onEdit,
    onStop,
  } = data || {};

  // Fall back to ACTIVE config for any unknown status — keeps the canvas
  // rendering a usable card even if the backend introduces a new state.
  const cfg = STATE_CONFIG[status] || STATE_CONFIG[AUTOMATION_STATUS.ACTIVE];
  const nextRunAt = stats?.schedule?.nextRunAt ? new Date(stats.schedule.nextRunAt) : null;
  
  const remaining = useCountdown(nextRunAt, cfg.countdownEnabled);

  // Clicking the card anywhere outside the icon buttons opens the edit form.
  // IconButton already calls e.stopPropagation(), so button clicks don't
  // bubble up here. React Flow handles drag-vs-click distinction itself —
  // a drag motion won't fire onClick.
  const handleCardClick = (e) => {
    if (dragging) return;
    e.stopPropagation();
    onEdit?.();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick(e);
        }
      }}
      className={`group relative w-80 cursor-pointer rounded-2xl border backdrop-blur-3xl transition-all duration-200 select-none hover:border-[#15DCFF]/60
        bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(247,248,250,0.95))]
        dark:bg-[linear-gradient(135deg,rgba(48,48,48,0.3),rgba(40,40,40,0.5))]
        ${
        dragging ? 'z-50 shadow-blue-500/30' : ''
      } ${cfg.border}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="h-3! w-3! border-2! border-[#303030]! bg-zinc-400! opacity-0"
      />

      <div className="flex flex-col gap-3 px-4 py-3">
        {/* Header — title + frequency badge + controls row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <PulseDot color={cfg.dotColor} animate={cfg.pulse} />
            <div className="flex flex-col">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{cfg.title}</h3>
              <span
                className={`mt-0.5 inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-10 font-medium tracking-wide uppercase ${cfg.badge}`}
              >
                {cfg.badgeIcon}
                {describeFrequency(frequency) || '—'}
              </span>
            </div>
          </div>

          {/* Pause + Stop grouped on the left; History + Edit on the right.
              Pause/Resume only render when the current state supports them. */}
          <div className="flex items-center gap-1">
            {cfg.showPause && (
              <IconButton tooltip="Pause" onClick={onPause}>
                <Pause className="size-3" />
              </IconButton>
            )}
            {cfg.showResume && (
              <IconButton tooltip="Resume" onClick={onResume}>
                <Play className="size-3" />
              </IconButton>
            )}
            {cfg.showStop && (
              <IconButton tooltip="Stop" tone="danger" onClick={onStop}>
                <StopIcon className="size-3" />
              </IconButton>
            )}
            <span className="mx-0.5 h-4 w-px bg-gray-300 dark:bg-white/10" />
            <IconButton tooltip="Edit" onClick={onEdit}>
              <Pencil className="size-3" />
            </IconButton>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1.5">
          <Stat
            icon={<ImageIcon className="size-3" />}
            label="Generated"
            value={(stats.generated || 0).toLocaleString()}
          />
          <Stat
            icon={<Send className="size-3" />}
            label="Posted"
            value={(stats.posted || 0).toLocaleString()}
          />
          <Stat
            label={cfg.nextLabel}
            value={
              cfg.countdownEnabled
                ? remaining || (nextRunAt ? '—' : 'No upcoming')
                : status === AUTOMATION_STATUS.COMPLETED
                  ? 'Done'
                  : status === AUTOMATION_STATUS.FAILED
                    ? 'See history'
                    : '—'
            }
            highlight={cfg.countdownEnabled && !!remaining}
          />
        </div>

        {/* Footer line */}
        <div className="flex items-center justify-between text-10 text-gray-400 dark:text-[#AFAFAF]">
          <span>
            Last:{' '}
            <span className="text-gray-600 dark:text-[#E3E3E3]">
              {stats?.lastRunAt ? formatShort(stats.lastRunAt) : '—'}
            </span>
          </span>
          {nextRunAt && (
            <span>
              Next:{' '}
              <span className="text-gray-600 dark:text-[#E3E3E3]">{formatShort(nextRunAt.toISOString())}</span>
            </span>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="h-3! w-3! border-2! border-[#303030]! bg-zinc-400! opacity-0"
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Inner pieces
// ----------------------------------------------------------------------------

function PulseDot({ color, animate }) {
  return (
    <span className="relative mt-1 flex size-2.5 shrink-0">
      {animate && (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex size-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function Stat({ icon, label, value, highlight }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-gray-200 bg-gray-100/60 px-2 py-1.5 dark:border-white/5 dark:bg-[#0D0D0D]/40">
      <span className="flex items-center gap-1 text-10 tracking-wide text-gray-500 uppercase dark:text-[#AFAFAF]">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={`text-xs font-semibold tabular-nums ${
          highlight ? 'text-[#15DCFF]' : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function IconButton({ children, tooltip, onClick, tone }) {
  const isDanger = tone === 'danger';
  return (
    <button
      type="button"
      title={tooltip}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`flex size-6 items-center justify-center rounded border transition ${
        isDanger
          ? 'border-red-500/20 bg-red-500/5 text-red-500 hover:border-red-500/40 hover:bg-red-500/15 hover:text-red-600 dark:text-red-300 dark:hover:text-red-200'
          : 'border-gray-300 bg-gray-100 text-gray-500 hover:border-gray-400 hover:bg-gray-200 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-[#AFAFAF] dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------
// useCountdown — ticks once per second; returns 'Dd Hh Mm' style remainder.
// ----------------------------------------------------------------------------

function useCountdown(target, running) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, target]);

  if (!target) return '';
  const diff = target.getTime() - now;
  if (diff <= 0) return 'Any moment now';

  const totalSeconds = Math.floor(diff / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

function pad(n) {
  return n.toString().padStart(2, '0');
}

function formatShort(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default memo(AutomationActiveNode);
