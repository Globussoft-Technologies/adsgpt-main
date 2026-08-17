import React, { useState } from 'react';
import { AlertTriangle, Loader2, Pause, Play, Square } from 'lucide-react';

import { Panel, PanelBody, PanelHeader, GhostBtn } from './Panel';
import CadencePills from './CadencePills';

// ----------------------------------------------------------------------------
// SchedulePanel — the cadence of a LIVE brief, and the controls that change it.
//
// This is the half of automation Quick setup didn't have. Once a brief went
// live the schedule became unreachable: the setup card only renders before
// activation, so there was no way to move the time, change how often, or stop —
// only pause. v1 had Edit and Stop on its active node from day one.
//
// The edit path is not a second implementation. It is the same CadencePills the
// setup card uses, and the same PATCH — the server now forwards job-owned
// fields onto the running job (services/adFactory/briefToJobPatch). Before that
// existed, editing here would have saved, rendered, and changed nothing.
//
// `syncWarning` is how that honesty reaches the screen. `updateJob` refuses
// while a cycle is mid-run, and a refusal the user cannot see is the exact bug
// this whole change is fixing, one layer further out.
// ----------------------------------------------------------------------------

export default function SchedulePanel({
  status,
  frequency,
  hour,
  timezone,
  pairsPerCycle,
  nextRunAt,
  onCadenceChange,
  onPause,
  onResume,
  onStop,
  busy = false,
  saving = false,
  syncWarning,
}) {
  const [confirmingStop, setConfirmingStop] = useState(false);

  const live = status === 'active';
  const paused = status === 'paused';
  // Archived or completed: nothing left to schedule, and editing a cadence that
  // will never run again would be theatre.
  const over = !live && !paused;

  return (
    <Panel>
      <PanelHeader
        title="Schedule"
        subtitle={
          over
            ? 'Deliveries have ended. Your past runs are below.'
            : nextRunAt
              ? `Next run ${when(nextRunAt)}`
              : 'Paused — nothing is scheduled'
        }
        right={
          <span className="flex items-center gap-2">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 dark:text-white/45" />}
            {live && (
              <GhostBtn onClick={onPause} disabled={busy}>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </GhostBtn>
            )}
            {paused && (
              <GhostBtn onClick={onResume} disabled={busy}>
                <Play className="h-3.5 w-3.5" />
                <span>Resume</span>
              </GhostBtn>
            )}
            {!over && (
              <GhostBtn onClick={() => setConfirmingStop(true)} disabled={busy}>
                <Square className="h-3.5 w-3.5" />
                <span>Stop</span>
              </GhostBtn>
            )}
          </span>
        }
      />

      <PanelBody className="flex flex-col gap-3">
        <CadencePills
          frequency={frequency}
          hour={hour}
          timezone={timezone}
          pairsPerCycle={pairsPerCycle}
          onChange={onCadenceChange}
          disabled={over || busy}
        />

        {/* The one message that must never be swallowed: the brief now says one
            thing and the running job still does another. */}
        {syncWarning && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              {syncWarning} Your change is saved, but the schedule running right now hasn&apos;t
              changed yet.
            </p>
          </div>
        )}

        {!over && !syncWarning && (
          <p className="text-xs text-gray-500 dark:text-white/55">
            Changes apply from the next run. Pausing keeps everything; stopping ends deliveries for
            good.
          </p>
        )}
      </PanelBody>

      {/* Stopping is irreversible and spends nothing to confirm, so it asks.
          Inline rather than a modal: it belongs to this panel, and a dialog over
          the whole page for one sentence is heavier than the decision. */}
      {confirmingStop && (
        <div className="border-t border-gray-200 px-4 py-3.5 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-13 text-gray-700 dark:text-white/70">
              Stop deliveries for good? Ads already live stay live, and your run history is kept —
              but restarting means setting the schedule up again.
            </p>
            <span className="flex shrink-0 items-center gap-2">
              <GhostBtn onClick={() => setConfirmingStop(false)} disabled={busy}>
                <span>Keep running</span>
              </GhostBtn>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingStop(false);
                  onStop?.();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/15 px-3.5 py-2 text-13 font-semibold text-red-600 transition hover:bg-red-500/25 disabled:opacity-50 dark:text-red-400"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Stop deliveries
              </button>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function when(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
